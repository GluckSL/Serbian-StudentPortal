import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  BatchStudentPaymentRow,
  PaymentHubApiService,
} from './payment-hub-api.service';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentCurrencyPendingTotalsComponent } from './payment-currency-pending-totals.component';
import { formatJourneyDayCurrentTotal } from './payment-journey-metrics.util';
import {
  computeLanguageFeeStatus,
  LANGUAGE_FEE_STATUS_LABELS,
  languageFeeStatusClass,
  LanguageFeeStatus,
} from './payment-language-fee-status.util';
import { formatStudentStatusLabel } from './payment-hub-finance-cohort.util';

type StudentInsightFilter = '' | 'paid_full' | 'have_balance';

interface SilverBatchOption {
  id: string;
  label: string;
  description: string;
  studentCount?: number;
  type: 'go' | 'regular';
}

interface StudentSearchResult {
  studentId: string;
  name: string;
  email: string;
  regNo: string;
  subscription: string;
  batch: string;
  level: string;
  studentStatus: string;
  alreadyAdded: boolean;
}

interface StudentCurrencyTotals {
  lkr: number;
  inr: number;
  usd: number;
}

interface InsightAmountsMap {
  all: StudentCurrencyTotals;
  paid_full: StudentCurrencyTotals;
  have_balance: StudentCurrencyTotals;
}

type InsightAmountKey = keyof InsightAmountsMap;

interface LevelFilterOption {
  value: string;
  label: string;
  total: number;
}

@Component({
  selector: 'app-payment-hub-silver-payment',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyPendingTotalsComponent,
  ],
  templateUrl: './payment-hub-silver-payment.component.html',
  styleUrls: [
    './payment-hub-insights-page.scss',
    './payment-hub-batch-students.component.scss',
    './payment-hub-finance-students.component.scss',
    './payment-hub-silver-payment.component.scss',
  ],
})
export class PaymentHubSilverPaymentComponent implements OnInit, OnDestroy {
  private readonly base = `${environment.apiUrl}/new-payments/finance-dashboard/silver-payment`;
  private readonly destroy$ = new Subject<void>();
  private readonly searchInput$ = new Subject<string>();

  loading = true;
  rows: BatchStudentPaymentRow[] = [];
  totalStudents = 0;
  page = 1;
  pageSize = 50;
  totalPages = 1;
  searchQuery = '';
  studentInsight: StudentInsightFilter = '';
  levelFilterOpen = false;
  selectedLevels: string[] = [];
  draftSelectedLevels: string[] = [];
  levelFilterSearch = '';
  levelOptions: LevelFilterOption[] = [];
  insightCounts: Record<string, number> = { all: 0, paid_full: 0, have_balance: 0 };
  insightAmounts: InsightAmountsMap = {
    all: { lkr: 0, inr: 0, usd: 0 },
    paid_full: { lkr: 0, inr: 0, usd: 0 },
    have_balance: { lkr: 0, inr: 0, usd: 0 },
  };

  totalPaidLKR = 0;
  totalPaidINR = 0;
  totalPaidUSD = 0;
  totalPendingLKR = 0;
  totalPendingINR = 0;
  totalPendingUSD = 0;

  readonly pageSizeOptions = [25, 50, 100, 200];

  // Modal state
  showAddModal = false;
  addMode: 'batch' | 'student' = 'batch';

  // Batch add
  batchOptions: SilverBatchOption[] = [];
  loadingBatchOptions = false;
  selectedBatchIds = new Set<string>();
  addingFromBatch = false;

  // Student search
  studentSearchQuery = '';
  searchResults: StudentSearchResult[] = [];
  searchingStudents = false;
  addingStudentId = '';

  // Remove
  removingStudentId = '';

  readonly studentInsightOptions = [
    { value: '' as StudentInsightFilter, key: 'all', label: 'All students', icon: 'groups', hint: 'Show all', color: 'slate', amountKind: 'expected' as const },
    { value: 'paid_full' as StudentInsightFilter, key: 'paid_full', label: 'Payment clear', icon: 'check_circle', hint: 'Filter fully paid students', color: 'green', amountKind: 'received' as const },
    { value: 'have_balance' as StudentInsightFilter, key: 'have_balance', label: 'Remaining', icon: 'pending_actions', hint: 'Filter students with balance', color: 'amber', amountKind: 'pending' as const },
  ] as const;

  formatStudentStatus = formatStudentStatusLabel;

  constructor(
    private readonly http: HttpClient,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.loadStudents();
    this.searchInput$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.loadStudents();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get pageStart(): number { return this.totalStudents === 0 ? 0 : (this.page - 1) * this.pageSize + 1; }
  get pageEnd(): number { return Math.min(this.page * this.pageSize, this.totalStudents); }

  get displayRows(): BatchStudentPaymentRow[] { return this.rows; }

  rowNumber(i: number): number { return (this.page - 1) * this.pageSize + i + 1; }

  isInsightActive(v: StudentInsightFilter): boolean { return this.studentInsight === v; }

  insightCount(key: string): number { return this.insightCounts[key] ?? 0; }

  /** Students with no received and no outstanding language-fee amount. */
  notStartedCount(): number {
    const all = this.insightCount('all');
    const clear = this.insightCount('paid_full');
    const remaining = this.insightCount('have_balance');
    return Math.max(0, all - clear - remaining);
  }

  hasInsightAmount(key: string): boolean {
    if (key === 'paid_full') {
      return this.totalPaidLKR > 0 || this.totalPaidINR > 0 || this.totalPaidUSD > 0;
    }
    if (key === 'have_balance') {
      return this.totalPendingLKR > 0 || this.totalPendingINR > 0 || this.totalPendingUSD > 0;
    }
    const a = this.insightAmountsFor(key);
    return a.lkr > 0 || a.inr > 0 || a.usd > 0;
  }

  insightAmountLkr(key: string): number {
    if (key === 'paid_full') return this.totalPaidLKR;
    if (key === 'have_balance') return this.totalPendingLKR;
    return this.insightAmountsFor(key).lkr;
  }

  insightAmountInr(key: string): number {
    if (key === 'paid_full') return this.totalPaidINR;
    if (key === 'have_balance') return this.totalPendingINR;
    return this.insightAmountsFor(key).inr;
  }

  insightAmountUsd(key: string): number {
    if (key === 'paid_full') return this.totalPaidUSD;
    if (key === 'have_balance') return this.totalPendingUSD;
    return this.insightAmountsFor(key).usd;
  }

  studentPct(count: number, total: number): string {
    if (!total) return '0%';
    return `${Math.round((count / total) * 100)}%`;
  }

  private isInsightAmountKey(key: string): key is InsightAmountKey {
    return key === 'all' || key === 'paid_full' || key === 'have_balance';
  }

  private insightAmountsFor(key: string): StudentCurrencyTotals {
    return this.isInsightAmountKey(key) ? this.insightAmounts[key] : { lkr: 0, inr: 0, usd: 0 };
  }

  activeInsightLabel(): string {
    return this.studentInsightOptions.find((o) => o.value === this.studentInsight)?.label ?? '';
  }

  applyInsightFilter(v: StudentInsightFilter): void {
    this.studentInsight = this.studentInsight === v ? '' : v;
    this.page = 1;
    this.loadStudents();
  }

  openLevelFilter(): void {
    this.draftSelectedLevels = [...this.selectedLevels];
    this.levelFilterSearch = '';
    this.levelFilterOpen = true;
  }

  closeLevelFilter(): void {
    this.levelFilterOpen = false;
  }

  filteredLevelOptions(): LevelFilterOption[] {
    const q = this.levelFilterSearch.trim().toLowerCase();
    if (!q) return this.levelOptions;
    return this.levelOptions.filter((opt) => opt.label.toLowerCase().includes(q));
  }

  isDraftLevelSelected(value: string): boolean {
    return this.draftSelectedLevels.includes(value);
  }

  toggleDraftLevel(value: string): void {
    this.draftSelectedLevels = this.isDraftLevelSelected(value)
      ? this.draftSelectedLevels.filter((v) => v !== value)
      : [...this.draftSelectedLevels, value];
  }

  selectAllLevelFilter(): void {
    this.draftSelectedLevels = this.levelOptions.map((opt) => opt.value);
  }

  clearLevelFilterDraft(): void {
    this.draftSelectedLevels = [];
  }

  applyLevelFilter(): void {
    this.selectedLevels = [...this.draftSelectedLevels];
    this.page = 1;
    this.studentInsight = '';
    this.levelFilterOpen = false;
    this.loadStudents();
  }

  clearAppliedLevelFilter(): void {
    this.selectedLevels = [];
    this.draftSelectedLevels = [];
    this.page = 1;
    this.studentInsight = '';
    this.loadStudents();
  }

  levelFilterLabel(): string {
    if (!this.selectedLevels.length) return '';
    const byValue = new Map(this.levelOptions.map((opt) => [opt.value, opt.label]));
    if (this.selectedLevels.length === 1) return byValue.get(this.selectedLevels[0]) || this.selectedLevels[0];
    return `${this.selectedLevels.length} levels`;
  }

  trackLevelOption(_index: number, opt: LevelFilterOption): string {
    return opt.value;
  }

  onSearchChange(): void {
    this.searchInput$.next(this.searchQuery);
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.page = 1;
    this.loadStudents();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.loadStudents();
  }

  journeyDayDisplay(r: BatchStudentPaymentRow): string {
    return formatJourneyDayCurrentTotal({ currentCourseDay: r.currentJourneyDay }, r.level);
  }

  rowReceived(r: BatchStudentPaymentRow): StudentCurrencyTotals {
    return { lkr: r.langPaidLKR ?? 0, inr: r.langPaidINR ?? 0, usd: r.langPaidUSD ?? 0 };
  }

  rowPending(r: BatchStudentPaymentRow): StudentCurrencyTotals {
    return { lkr: r.langPendingLKR ?? 0, inr: r.langPendingINR ?? 0, usd: r.langPendingUSD ?? 0 };
  }

  private pendingTotal(row: BatchStudentPaymentRow): number {
    const p = this.rowPending(row);
    return p.lkr + p.inr + p.usd;
  }

  private overdueTotal(row: BatchStudentPaymentRow): number {
    return (row.langOverdueLKR ?? 0) + (row.langOverdueINR ?? 0) + (row.langOverdueUSD ?? 0);
  }

  private rowLanguageFeeStatus(row: BatchStudentPaymentRow): LanguageFeeStatus {
    const pending = this.pendingTotal(row);
    const overdue = this.overdueTotal(row);
    if (pending <= 0 && overdue <= 0 && ['FULLY_PAID', 'GOOD_STANDING'].includes(row.overallStatus)) {
      return 'FULL_PAID';
    }
    return computeLanguageFeeStatus(pending + overdue, row.currentJourneyDay);
  }

  languageFeeStatusLabel(r: BatchStudentPaymentRow): string {
    return LANGUAGE_FEE_STATUS_LABELS[this.rowLanguageFeeStatus(r)] || this.rowLanguageFeeStatus(r);
  }

  languageFeePillClass(r: BatchStudentPaymentRow): string {
    return languageFeeStatusClass(this.rowLanguageFeeStatus(r));
  }

  openStudentDetail(r: BatchStudentPaymentRow): void {
    window.open(`/admin/payment-hub/student/${r.studentId}`, '_blank');
  }

  // ── Add Students Modal ─────────────────────────────────────────────────────

  openAddModal(): void {
    this.showAddModal = true;
    this.addMode = 'batch';
    this.studentSearchQuery = '';
    this.searchResults = [];
    if (!this.batchOptions.length) {
      this.loadBatchOptions();
    }
  }

  closeAddModal(): void {
    if (this.addingFromBatch) return;
    this.showAddModal = false;
    this.selectedBatchIds = new Set();
    this.studentSearchQuery = '';
    this.searchResults = [];
  }

  setAddMode(mode: 'batch' | 'student'): void {
    this.addMode = mode;
    if (mode === 'batch' && !this.batchOptions.length) {
      this.loadBatchOptions();
    }
    if (mode === 'student') {
      this.searchResults = [];
      this.studentSearchQuery = '';
    }
  }

  private loadBatchOptions(): void {
    this.loadingBatchOptions = true;
    this.http
      .get<{ success: boolean; batches: SilverBatchOption[] }>(
        `${this.base}/batch-options`,
        { withCredentials: true },
      )
      .subscribe({
        next: (res) => {
          this.batchOptions = res.batches || [];
          this.loadingBatchOptions = false;
        },
        error: () => {
          this.loadingBatchOptions = false;
        },
      });
  }

  get selectedBatchCount(): number {
    return this.selectedBatchIds.size;
  }

  isBatchSelected(batchId: string): boolean {
    return this.selectedBatchIds.has(batchId);
  }

  toggleBatchSelection(batchId: string): void {
    if (this.selectedBatchIds.has(batchId)) {
      this.selectedBatchIds.delete(batchId);
    } else {
      this.selectedBatchIds.add(batchId);
    }
    this.selectedBatchIds = new Set(this.selectedBatchIds);
  }

  addFromBatch(): void {
    if (!this.selectedBatchCount || this.addingFromBatch) return;
    this.addingFromBatch = true;
    this.http
      .post<{ success: boolean; added: number; alreadyExists: number; total: number; message: string }>(
        `${this.base}/add-from-batch`,
        { batchIds: [...this.selectedBatchIds] },
        { withCredentials: true },
      )
      .subscribe({
        next: (res) => {
          this.addingFromBatch = false;
          this.snack.open(res.message, 'OK', { duration: 4000 });
          this.closeAddModal();
          this.loadStudents();
        },
        error: (err) => {
          this.addingFromBatch = false;
          this.snack.open(err?.error?.message || 'Failed to add students from batch.', 'Dismiss', { duration: 4500 });
        },
      });
  }

  onStudentSearchChange(): void {
    if (this.studentSearchQuery.length < 2) {
      this.searchResults = [];
      return;
    }
    this.searchingStudents = true;
    this.http
      .get<{ success: boolean; students: StudentSearchResult[] }>(
        `${this.base}/search`,
        {
          params: new HttpParams().set('q', this.studentSearchQuery),
          withCredentials: true,
        },
      )
      .subscribe({
        next: (res) => {
          this.searchResults = res.students || [];
          this.searchingStudents = false;
        },
        error: () => {
          this.searchingStudents = false;
        },
      });
  }

  addIndividualStudent(result: StudentSearchResult): void {
    if (result.alreadyAdded || this.addingStudentId) return;
    this.addingStudentId = result.studentId;
    this.http
      .post<{ success: boolean; added: boolean; message: string }>(
        `${this.base}/add-student`,
        { studentId: result.studentId },
        { withCredentials: true },
      )
      .subscribe({
        next: (res) => {
          this.addingStudentId = '';
          result.alreadyAdded = true;
          this.snack.open(res.message, 'OK', { duration: 3000 });
          this.loadStudents();
        },
        error: (err) => {
          this.addingStudentId = '';
          this.snack.open(err?.error?.message || 'Failed to add student.', 'Dismiss', { duration: 4000 });
        },
      });
  }

  removeStudent(r: BatchStudentPaymentRow): void {
    if (this.removingStudentId) return;
    this.removingStudentId = r.studentId;
    this.http
      .delete<{ success: boolean; message: string }>(
        `${this.base}/students/${r.studentId}`,
        { withCredentials: true },
      )
      .subscribe({
        next: (res) => {
          this.removingStudentId = '';
          this.snack.open(res.message, 'OK', { duration: 3000 });
          this.loadStudents();
        },
        error: (err) => {
          this.removingStudentId = '';
          this.snack.open(err?.error?.message || 'Failed to remove student.', 'Dismiss', { duration: 4000 });
        },
      });
  }

  batchOptionIcon(option: SilverBatchOption): string {
    return option.type === 'go' ? 'star' : 'label';
  }

  get goBatchOptions(): SilverBatchOption[] {
    return this.batchOptions.filter((o) => o.type === 'go');
  }

  get regularBatchOptions(): SilverBatchOption[] {
    return this.batchOptions.filter((o) => o.type === 'regular');
  }

  private loadStudents(): void {
    this.loading = true;
    let params = new HttpParams()
      .set('page', String(this.page))
      .set('limit', String(this.pageSize));
    if (this.searchQuery) params = params.set('search', this.searchQuery);
    if (this.studentInsight) params = params.set('insight', this.studentInsight);
    if (this.selectedLevels.length) params = params.set('levels', this.selectedLevels.join(','));

    this.http
      .get<{
        success: boolean;
        data: {
          students: BatchStudentPaymentRow[];
          totalStudents: number;
          page: number;
          totalPages: number;
          levelOptions?: LevelFilterOption[];
          insightCounts: Record<string, number>;
          insightAmounts?: InsightAmountsMap;
          totalPaidLKR: number;
          totalPaidINR: number;
          totalPaidUSD: number;
          totalPendingLKR: number;
          totalPendingINR: number;
          totalPendingUSD: number;
        };
      }>(`${this.base}/students`, { params, withCredentials: true })
      .subscribe({
        next: (res) => {
          const d = res.data;
          this.rows = d.students || [];
          this.totalStudents = d.totalStudents;
          this.page = d.page;
          this.totalPages = d.totalPages;
          this.levelOptions = d.levelOptions || [];
          this.insightCounts = d.insightCounts || {};
          this.insightAmounts = {
            all: d.insightAmounts?.all ?? { lkr: 0, inr: 0, usd: 0 },
            paid_full: d.insightAmounts?.paid_full ?? { lkr: 0, inr: 0, usd: 0 },
            have_balance: d.insightAmounts?.have_balance ?? { lkr: 0, inr: 0, usd: 0 },
          };
          this.totalPaidLKR = d.totalPaidLKR;
          this.totalPaidINR = d.totalPaidINR;
          this.totalPaidUSD = d.totalPaidUSD;
          this.totalPendingLKR = d.totalPendingLKR;
          this.totalPendingINR = d.totalPendingINR;
          this.totalPendingUSD = d.totalPendingUSD;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }
}
