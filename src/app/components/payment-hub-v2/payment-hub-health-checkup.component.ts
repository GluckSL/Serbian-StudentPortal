import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin, Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { BatchLevelSlotTotals, BatchStudentPaymentRow, LanguageLevelSlot, PaymentHubApiService } from './payment-hub-api.service';
import { levelForJourneyDay } from './payment-journey-metrics.util';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentCurrencyPendingTotalsComponent } from './payment-currency-pending-totals.component';
import { downloadPaymentHubCsv } from './payment-hub-export.util';

interface StudentCurrencyTotals {
  lkr: number;
  inr: number;
  usd: number;
}

/** Journey-day start for each CEFR level (1-based). */
const LEVEL_START_DAYS: Record<string, number> = {
  A1: 1,
  A2: 43,
  B1: 85,
  B2: 146,
};

/** CEFR levels in journey order — used to sum A1…current level. */
const LEVEL_ORDER: LanguageLevelSlot[] = ['A1', 'A2', 'B1', 'B2'];

/** Batch numbers to include in the health checkup. */
const HEALTH_CHECKUP_BATCHES = Array.from({ length: 12 }, (_, i) => String(35 + i));

export type HealthColor = 'green' | 'yellow' | 'red';
export type HealthFilter = 'all_students' | 'full_paid' | 'pending' | 'green' | 'yellow' | 'red';

const HEALTH_CHECKUP_PAGE_SIZE = 50;

interface AdminStudentRow {
  _id: string;
  name: string;
  email?: string;
  batch?: string;
  level?: string;
  studentStatus?: string;
  currentCourseDay?: number | null;
}

interface AdminStudentListResponse {
  success: boolean;
  data?: AdminStudentRow[];
  pagination?: { total: number; page: number; limit: number; pages: number };
}

export interface HealthStudentRow extends BatchStudentPaymentRow {
  healthColor: HealthColor | null;
  daysIntoLevel: number | null;
}

/**
 * Returns how many days the student is into their current level (1-based).
 * e.g. A2 starts at day 43 → if journeyDay = 45, daysIntoLevel = 3.
 */
function daysIntoCurrentLevel(journeyDay: number | null, level: string): number | null {
  if (journeyDay == null) return null;
  const levelKey = (level || 'A1').toUpperCase().trim();
  const start = LEVEL_START_DAYS[levelKey] ?? 1;
  return Math.max(1, journeyDay - start + 1);
}

/**
 * Health colour for a PENDING student based on days into their current level:
 *  green  → 1–5   (new level, very likely to pay soon)
 *  yellow → 6–8   (needs a follow-up)
 *  red    → 9+    (urgent — needs a call)
 */
function pendingHealthColor(daysInLevel: number | null): HealthColor | null {
  if (daysInLevel == null) return null;
  if (daysInLevel <= 5) return 'green';
  if (daysInLevel <= 8) return 'yellow';
  return 'red';
}

@Component({
  selector: 'app-payment-hub-health-checkup',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyPendingTotalsComponent,
  ],
  templateUrl: './payment-hub-health-checkup.component.html',
  styleUrls: ['./payment-hub-health-checkup.component.scss', './payment-hub-insights-page.scss'],
})
export class PaymentHubHealthCheckupComponent implements OnInit {
  loading = true;
  exporting = false;
  allRows: HealthStudentRow[] = [];
  activeFilter: HealthFilter = 'all_students';
  searchQuery = '';
  page = 1;
  readonly pageSize = HEALTH_CHECKUP_PAGE_SIZE;

  readonly batches = HEALTH_CHECKUP_BATCHES;

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly http: HttpClient,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  /**
   * Roster from /admin/students (same filters as Students page — batches 35–46, all statuses).
   * Payment rows merged by student id for amounts.
   */
  private load(): void {
    this.loading = true;
    forkJoin({
      roster: this.fetchAllAdminStudents(),
      payments: this.fetchAllPaymentRows(),
    }).subscribe({
      next: ({ roster, payments }) => {
        const paymentById = new Map(payments.map((p) => [String(p.studentId), p]));
        this.allRows = roster
          .map((admin) => this.mergeAdminWithPayment(admin, paymentById.get(String(admin._id))))
          .sort((a, b) => a.name.localeCompare(b.name));
        this.loading = false;
      },
      error: () => {
        this.allRows = [];
        this.loading = false;
      },
    });
  }

  private fetchAllAdminStudents(): Observable<AdminStudentRow[]> {
    const loadPage = (page: number, acc: AdminStudentRow[]): Observable<AdminStudentRow[]> => {
      const params = new HttpParams()
        .set('page', String(page))
        .set('limit', '100')
        .set('batch', HEALTH_CHECKUP_BATCHES.join(','));
      return this.http
        .get<AdminStudentListResponse>(`${environment.apiUrl}/admin/students`, {
          params,
          withCredentials: true,
        })
        .pipe(
          switchMap((res) => {
            const combined = [...acc, ...(res.data ?? [])];
            const pages = res.pagination?.pages ?? 1;
            if (page < pages) return loadPage(page + 1, combined);
            return of(combined);
          }),
        );
    };
    return loadPage(1, []);
  }

  private fetchAllPaymentRows(): Observable<BatchStudentPaymentRow[]> {
    const loadPage = (page: number, acc: BatchStudentPaymentRow[]): Observable<BatchStudentPaymentRow[]> => {
      return this.api
        .getCohortStudentsPaymentDetail('all', undefined, {
          limit: 300,
          page,
        })
        .pipe(
          switchMap((res) => {
            const combined = [...acc, ...(res.data?.students ?? [])];
            const pages = res.data?.totalPages ?? 1;
            if (page < pages) return loadPage(page + 1, combined);
            return of(combined);
          }),
        );
    };
    return loadPage(1, []);
  }

  private mergeAdminWithPayment(
    admin: AdminStudentRow,
    payment?: BatchStudentPaymentRow,
  ): HealthStudentRow {
    const base = payment ?? this.emptyPaymentRow(admin);
    const merged: BatchStudentPaymentRow = {
      ...base,
      studentId: admin._id,
      name: admin.name || base.name,
      email: admin.email || base.email || '',
      batch: admin.batch || base.batch,
      level: admin.level || base.level || '—',
      studentStatus: admin.studentStatus || base.studentStatus,
      currentJourneyDay:
        admin.currentCourseDay != null
          ? Math.min(200, Math.max(1, Math.floor(Number(admin.currentCourseDay))))
          : base.currentJourneyDay,
    };
    return this.toHealthRow(merged);
  }

  private emptyPaymentRow(admin: AdminStudentRow): BatchStudentPaymentRow {
    const zero = { LKR: 0, INR: 0, USD: 0 };
    return {
      studentId: admin._id,
      name: admin.name,
      email: admin.email ?? '',
      batch: admin.batch,
      level: admin.level ?? '—',
      studentStatus: admin.studentStatus,
      currentJourneyDay: admin.currentCourseDay ?? null,
      totalPaid: 0,
      totalPaidLKR: 0,
      totalPaidINR: 0,
      totalPaidUSD: 0,
      pendingApprovalAmount: 0,
      pendingApprovalAmountLKR: 0,
      pendingApprovalAmountINR: 0,
      pendingApprovalAmountUSD: 0,
      overdueAmount: 0,
      overdueAmountLKR: 0,
      overdueAmountINR: 0,
      overdueAmountUSD: 0,
      overallStatus: 'NO_REQUESTS',
      levelPaid: {},
      docsPaidByCurrency: { ...zero },
      visaPaidByCurrency: { ...zero },
      otherPaidByCurrency: { ...zero },
      openRequestCount: 0,
    };
  }

  private toHealthRow(s: BatchStudentPaymentRow): HealthStudentRow {
    const level = levelForJourneyDay(s.currentJourneyDay);
    const daysIntoLevel = daysIntoCurrentLevel(s.currentJourneyDay, level);
    const hasBalance = this.studentHasBalance(s);
    const healthColor: HealthColor | null = hasBalance
      ? pendingHealthColor(daysIntoLevel)
      : null;

    return { ...s, healthColor, daysIntoLevel };
  }

  /**
   * True when the student owes any amount (pending approval OR overdue).
   * Matches the same check used by computeLanguageFeeStatus in the finance dashboard.
   */
  private studentHasBalance(row: BatchStudentPaymentRow): boolean {
    const t = this.scopeTotalsFromRow(row);
    return (
      t.pending.lkr + t.pending.inr + t.pending.usd +
      t.overdue.lkr + t.overdue.inr + t.overdue.usd
    ) > 0;
  }

  // ── Counts ───────────────────────────────────────────────────────────────

  get totalCount(): number {
    return this.allRows.length;
  }

  get fullPaidCount(): number {
    return this.allRows.filter((r) => this.isFullPaid(r)).length;
  }

  get pendingCount(): number {
    return this.allRows.filter((r) => !this.isFullPaid(r)).length;
  }

  get greenCount(): number {
    return this.allRows.filter((r) => r.healthColor === 'green').length;
  }

  get yellowCount(): number {
    return this.allRows.filter((r) => r.healthColor === 'yellow').length;
  }

  get redCount(): number {
    return this.allRows.filter((r) => r.healthColor === 'red').length;
  }

  // ── Filtering ────────────────────────────────────────────────────────────

  setFilter(filter: HealthFilter): void {
    this.activeFilter = this.activeFilter === filter ? 'all_students' : filter;
    this.page = 1;
  }

  onSearchChange(): void {
    this.page = 1;
  }

  goToPage(next: number): void {
    const clamped = Math.min(this.totalPages, Math.max(1, next));
    if (clamped === this.page) return;
    this.page = clamped;
  }

  private isFullPaid(r: HealthStudentRow): boolean {
    return !this.studentHasBalance(r);
  }

  get filteredRows(): HealthStudentRow[] {
    let list = this.allRows;

    switch (this.activeFilter) {
      case 'all_students':
        break;
      case 'full_paid':
        list = list.filter((r) => this.isFullPaid(r));
        break;
      case 'pending':
        list = list.filter((r) => !this.isFullPaid(r));
        break;
      case 'green':
        list = list.filter((r) => r.healthColor === 'green');
        break;
      case 'yellow':
        list = list.filter((r) => r.healthColor === 'yellow');
        break;
      case 'red':
        list = list.filter((r) => r.healthColor === 'red');
        break;
    }

    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.email || '').toLowerCase().includes(q) ||
          (r.batch || '').toLowerCase().includes(q),
      );
    }

    return list;
  }

  get displayRows(): HealthStudentRow[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
  }

  get pageStart(): number {
    if (!this.filteredRows.length) return 0;
    return (this.page - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.page * this.pageSize, this.filteredRows.length);
  }

  rowNumber(index: number): number {
    return (this.page - 1) * this.pageSize + index + 1;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  healthLabel(row: HealthStudentRow): string {
    if (this.isFullPaid(row)) return 'Full Paid';
    const d = row.daysIntoLevel;
    if (d == null) return 'Unknown';
    if (row.healthColor === 'green') return `Day ${d} — Safe`;
    if (row.healthColor === 'yellow') return `Day ${d} — Follow up`;
    return `Day ${d} — Urgent`;
  }

  levelForDay(journeyDay: number | null): string {
    return levelForJourneyDay(journeyDay);
  }

  rowTotal(row: HealthStudentRow): StudentCurrencyTotals {
    return this.scopeTotalsFromRow(row).expected;
  }

  rowPaid(row: HealthStudentRow): StudentCurrencyTotals {
    return this.scopeTotalsFromRow(row).received;
  }

  /**
   * Pending amount for display — uses only slot.pendingLKR (open payment requests),
   * exactly matching what the finance batch students "Pending" column shows.
   * overdueLKR is a separate field that must NOT be added here (would double-count).
   */
  rowPending(row: HealthStudentRow): StudentCurrencyTotals {
    return this.scopeTotalsFromRow(row).pending;
  }

  private scopeTotalsFromRow(row: BatchStudentPaymentRow): {
    expected: StudentCurrencyTotals;
    received: StudentCurrencyTotals;
    pending: StudentCurrencyTotals;
    overdue: StudentCurrencyTotals;
  } {
    const empty: StudentCurrencyTotals = { lkr: 0, inr: 0, usd: 0 };
    const summed = this.sumLevelSlotsUpToCurrent(row);
    if (summed) return this.totalsFromSlot(summed);

    return {
      expected: empty,
      received: { lkr: row.langPaidLKR ?? 0, inr: row.langPaidINR ?? 0, usd: row.langPaidUSD ?? 0 },
      pending: { lkr: row.langPendingLKR ?? 0, inr: row.langPendingINR ?? 0, usd: row.langPendingUSD ?? 0 },
      overdue: { lkr: row.langOverdueLKR ?? 0, inr: row.langOverdueINR ?? 0, usd: row.langOverdueUSD ?? 0 },
    };
  }

  /** Sum level slots from A1 through the student's current level (e.g. A2 → A1 + A2). */
  private sumLevelSlotsUpToCurrent(row: BatchStudentPaymentRow): BatchLevelSlotTotals | null {
    const current = this.currentLevel(row);
    if (!current) return null;
    const endIdx = LEVEL_ORDER.indexOf(current);
    if (endIdx < 0) return null;

    let hasAny = false;
    const acc: BatchLevelSlotTotals = {
      receivedLKR: 0, receivedINR: 0, receivedUSD: 0,
      pendingLKR: 0, pendingINR: 0, pendingUSD: 0,
      overdueLKR: 0, overdueINR: 0, overdueUSD: 0,
      expectedLKR: 0, expectedINR: 0, expectedUSD: 0,
    };

    for (const key of LEVEL_ORDER.slice(0, endIdx + 1)) {
      const s = row.levelSlots?.[key];
      if (!s) continue;
      hasAny = true;
      acc.receivedLKR += s.receivedLKR ?? 0;
      acc.receivedINR += s.receivedINR ?? 0;
      acc.receivedUSD += s.receivedUSD ?? 0;
      acc.pendingLKR += s.pendingLKR ?? 0;
      acc.pendingINR += s.pendingINR ?? 0;
      acc.pendingUSD += s.pendingUSD ?? 0;
      acc.overdueLKR += s.overdueLKR ?? 0;
      acc.overdueINR += s.overdueINR ?? 0;
      acc.overdueUSD += s.overdueUSD ?? 0;
      acc.expectedLKR += s.expectedLKR ?? 0;
      acc.expectedINR += s.expectedINR ?? 0;
      acc.expectedUSD += s.expectedUSD ?? 0;
    }

    return hasAny ? acc : null;
  }

  private totalsFromSlot(slot: BatchLevelSlotTotals): {
    expected: StudentCurrencyTotals;
    received: StudentCurrencyTotals;
    pending: StudentCurrencyTotals;
    overdue: StudentCurrencyTotals;
  } {
    return {
      expected: { lkr: slot.expectedLKR ?? 0, inr: slot.expectedINR ?? 0, usd: slot.expectedUSD ?? 0 },
      received: { lkr: slot.receivedLKR ?? 0, inr: slot.receivedINR ?? 0, usd: slot.receivedUSD ?? 0 },
      pending: { lkr: slot.pendingLKR ?? 0, inr: slot.pendingINR ?? 0, usd: slot.pendingUSD ?? 0 },
      overdue: { lkr: slot.overdueLKR ?? 0, inr: slot.overdueINR ?? 0, usd: slot.overdueUSD ?? 0 },
    };
  }

  private currentLevel(row: BatchStudentPaymentRow): LanguageLevelSlot | null {
    const raw = (row.level || levelForJourneyDay(row.currentJourneyDay) || '').toUpperCase().trim();
    if (raw === 'A1' || raw === 'A2' || raw === 'B1' || raw === 'B2') return raw;
    return null;
  }

  exportCsv(): void {
    if (this.exporting || !this.filteredRows.length) return;
    this.exporting = true;
    try {
      const headers = [
        'Name',
        'Email',
        'Batch',
        'Level',
        'Journey Day',
        'Total LKR',
        'Total INR',
        'Total USD',
        'Paid LKR',
        'Paid INR',
        'Paid USD',
        'Pending LKR',
        'Pending INR',
        'Pending USD',
        'Health',
      ];
      const lines = [
        headers.join(','),
        ...this.filteredRows.map((row) => {
          const total = this.rowTotal(row);
          const paid  = this.rowPaid(row);
          const pending = this.rowPending(row);   // slot.pendingLKR only — matches finance dashboard
          return [
            row.name,
            row.email || '',
            row.batch || '',
            this.levelForDay(row.currentJourneyDay),
            row.currentJourneyDay ?? '',
            total.lkr,
            total.inr,
            total.usd,
            paid.lkr,
            paid.inr,
            paid.usd,
            pending.lkr,
            pending.inr,
            pending.usd,
            this.healthLabel(row),
          ]
            .map((v) => this.csvCell(v))
            .join(',');
        }),
      ];
      const filterLabel = this.activeFilter === 'all_students' ? 'all' : this.activeFilter;
      const date = new Date().toISOString().slice(0, 10);
      downloadPaymentHubCsv(`health-checkup-batches-35-46-${filterLabel}-${date}`, lines.join('\n'));
    } finally {
      this.exporting = false;
    }
  }

  private csvCell(value: string | number | null | undefined): string {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  trackByStudentId(_: number, row: HealthStudentRow): string {
    return row.studentId;
  }
}
