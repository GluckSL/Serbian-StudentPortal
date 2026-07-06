import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  BatchLevelSlotTotals,
  BatchStudentPaymentRow,
  CurrencyBucket,
  CurrencyPaidTotals,
  LanguageLevelSlot,
  PaymentHubApiService,
} from './payment-hub-api.service';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentCurrencyPendingTotalsComponent } from './payment-currency-pending-totals.component';
import { PaymentCurrencyOverdueTotalsComponent } from './payment-currency-overdue-totals.component';
import { paidTotalsFromBucket } from './payment-currency.util';
import { formatJourneyDayCurrentTotal } from './payment-journey-metrics.util';
import {
  computeLanguageFeeStatus,
  LANGUAGE_FEE_STATUS_LABELS,
  languageFeeStatusClass,
  LanguageFeeStatus,
} from './payment-language-fee-status.util';

type StudentInsightFilter = '' | 'paid_full' | 'have_balance' | 'overdue' | 'paid_docs' | 'paid_visa';
type BatchStudentPaymentScope = 'current_level' | 'all_language' | 'all_payment' | LanguageLevelSlot | 'DOCS';

interface BatchStudentCurrencyTotals {
  lkr: number;
  inr: number;
  usd: number;
}

@Component({
  selector: 'app-payment-hub-batch-students',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    MatFormFieldModule,
    MatInputModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyPendingTotalsComponent,
    PaymentCurrencyOverdueTotalsComponent,
  ],
  templateUrl: './payment-hub-batch-students.component.html',
  styleUrls: ['./payment-hub-insights-page.scss', './payment-hub-batch-students.component.scss'],
})
export class PaymentHubBatchStudentsComponent implements OnInit {
  loading = true;
  batch = '';
  rows: BatchStudentPaymentRow[] = [];
  searchQuery = '';
  studentInsight: StudentInsightFilter = '';
  paymentScope: BatchStudentPaymentScope = 'current_level';
  readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8];

  /** Students excluded from the "Have balance" health card pending total. Persisted to localStorage per batch. */
  excludedPendingStudents = new Set<string>();
  private readonly EXCL_STUDENTS_KEY_PREFIX = 'ph_excl_pending_students_';

  readonly scopeButtons: ReadonlyArray<{ value: BatchStudentPaymentScope; label: string }> = [
    { value: 'current_level', label: 'Current Level' },
    { value: 'all_language', label: 'All Language Fees' },
    { value: 'all_payment', label: 'All Payment' },
  ];

  readonly slotScopeOptions: ReadonlyArray<{ value: BatchStudentPaymentScope; label: string }> = [
    { value: 'A1', label: 'A1' },
    { value: 'A2', label: 'A2' },
    { value: 'B1', label: 'B1' },
    { value: 'B2', label: 'B2' },
    { value: 'DOCS', label: 'Document' },
  ];

  get isSlotScope(): boolean {
    return this.slotScopeOptions.some((o) => o.value === this.paymentScope);
  }

  get slotScopeLabel(): string {
    return this.slotScopeOptions.find((o) => o.value === this.paymentScope)?.label ?? 'Level / Type';
  }

  setPaymentScope(scope: BatchStudentPaymentScope): void {
    this.paymentScope = scope;
  }

  readonly studentInsightOptions = [
    { value: '' as StudentInsightFilter, key: 'all', label: 'Total students', icon: 'groups', hint: 'Show all students', color: 'slate', amountKind: 'expected' as const },
    { value: 'paid_full' as StudentInsightFilter, key: 'paid_full', label: 'Paid full', icon: 'check_circle', hint: 'Language fee fully paid', color: 'green', amountKind: 'received' as const },
    { value: 'have_balance' as StudentInsightFilter, key: 'have_balance', label: 'Have balance', icon: 'account_balance_wallet', hint: 'Outstanding balance', color: 'amber', amountKind: 'pending' as const },
    { value: 'overdue' as StudentInsightFilter, key: 'overdue', label: 'Overdue', icon: 'warning_amber', hint: 'Past due payments', color: 'red', amountKind: 'overdue' as const },
    { value: 'paid_docs' as StudentInsightFilter, key: 'paid_docs', label: 'Paid docs', icon: 'description', hint: 'Docs payment approved', color: 'teal', amountKind: 'docs' as const },
    { value: 'paid_visa' as StudentInsightFilter, key: 'paid_visa', label: 'Paid visa', icon: 'flight', hint: 'Visa payment approved', color: 'indigo', amountKind: 'visa' as const },
  ] as const;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: PaymentHubApiService,
  ) {}

  ngOnInit(): void {
    this.batch = decodeURIComponent(this.route.snapshot.paramMap.get('batch') || '');
    this.loadExcludedPendingStudents();
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.getBatchStudentsPaymentDetail(this.batch).subscribe({
      next: (res) => {
        this.rows = res.data?.students || [];
        this.loading = false;
      },
      error: () => {
        this.rows = [];
        this.loading = false;
      },
    });
  }

  get displayRows(): BatchStudentPaymentRow[] {
    let list = this.rows;
    if (this.studentInsight) {
      list = list.filter((r) => this.rowMatchesInsight(r, this.studentInsight));
    }
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q),
    );
  }

  insightCount(key: string): number {
    if (key === 'all') return this.rows.length;
    const insight = key as StudentInsightFilter;
    return this.rows.filter((r) => this.rowMatchesInsight(r, insight)).length;
  }

  studentPct(count: number, total: number): string {
    if (!total) return '0%';
    return `${Math.round((count / total) * 100)}%`;
  }

  applyInsightFilter(insight: StudentInsightFilter): void {
    this.studentInsight = this.studentInsight === insight ? '' : insight;
  }

  isInsightActive(value: StudentInsightFilter): boolean {
    return this.studentInsight === value;
  }

  activeInsightLabel(): string {
    const opt = this.studentInsightOptions.find((o) => o.value === this.studentInsight);
    return opt?.label || '';
  }

  private emptyCurrencyTotals(): BatchStudentCurrencyTotals {
    return { lkr: 0, inr: 0, usd: 0 };
  }

  private totalsFromSlot(slot: BatchLevelSlotTotals | null | undefined): {
    expected: BatchStudentCurrencyTotals;
    received: BatchStudentCurrencyTotals;
    pending: BatchStudentCurrencyTotals;
    overdue: BatchStudentCurrencyTotals;
  } {
    if (!slot) {
      const z = this.emptyCurrencyTotals();
      return { expected: z, received: z, pending: z, overdue: z };
    }
    return {
      expected: { lkr: slot.expectedLKR ?? 0, inr: slot.expectedINR ?? 0, usd: slot.expectedUSD ?? 0 },
      received: { lkr: slot.receivedLKR, inr: slot.receivedINR, usd: slot.receivedUSD },
      pending: { lkr: slot.pendingLKR, inr: slot.pendingINR, usd: slot.pendingUSD },
      overdue: { lkr: slot.overdueLKR, inr: slot.overdueINR, usd: slot.overdueUSD },
    };
  }

  private sumLevelSlots(r: BatchStudentPaymentRow): BatchLevelSlotTotals | null {
    const keys: LanguageLevelSlot[] = ['A1', 'A2', 'B1', 'B2'];
    let hasAny = false;
    const acc: BatchLevelSlotTotals = {
      receivedLKR: 0,
      receivedINR: 0,
      receivedUSD: 0,
      pendingLKR: 0,
      pendingINR: 0,
      pendingUSD: 0,
      overdueLKR: 0,
      overdueINR: 0,
      overdueUSD: 0,
      expectedLKR: 0,
      expectedINR: 0,
      expectedUSD: 0,
    };
    for (const key of keys) {
      const s = r.levelSlots?.[key];
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

  private scopeTotalsFromRow(r: BatchStudentPaymentRow): {
    expected: BatchStudentCurrencyTotals;
    received: BatchStudentCurrencyTotals;
    pending: BatchStudentCurrencyTotals;
    overdue: BatchStudentCurrencyTotals;
  } {
    const z = this.emptyCurrencyTotals();
    switch (this.paymentScope) {
      case 'current_level': {
        const level = r.level as LanguageLevelSlot | null;
        const slot = level ? r.levelSlots?.[level] : null;
        if (slot) return this.totalsFromSlot(slot);
        return {
          expected: z,
          received: { lkr: r.langPaidLKR ?? 0, inr: r.langPaidINR ?? 0, usd: r.langPaidUSD ?? 0 },
          pending: { lkr: r.langPendingLKR ?? 0, inr: r.langPendingINR ?? 0, usd: r.langPendingUSD ?? 0 },
          overdue: { lkr: r.langOverdueLKR ?? 0, inr: r.langOverdueINR ?? 0, usd: r.langOverdueUSD ?? 0 },
        };
      }
      case 'all_language': {
        if (r.allLanguageFees) return this.totalsFromSlot(r.allLanguageFees);
        const summed = this.sumLevelSlots(r);
        if (summed) return this.totalsFromSlot(summed);
        return {
          expected: z,
          received: { lkr: r.langPaidLKR ?? 0, inr: r.langPaidINR ?? 0, usd: r.langPaidUSD ?? 0 },
          pending: { lkr: r.langPendingLKR ?? 0, inr: r.langPendingINR ?? 0, usd: r.langPendingUSD ?? 0 },
          overdue: { lkr: r.langOverdueLKR ?? 0, inr: r.langOverdueINR ?? 0, usd: r.langOverdueUSD ?? 0 },
        };
      }
      case 'all_payment':
        return {
          expected: z,
          received: { lkr: r.totalPaidLKR ?? 0, inr: r.totalPaidINR ?? 0, usd: r.totalPaidUSD ?? 0 },
          pending: { lkr: r.pendingApprovalAmountLKR ?? 0, inr: r.pendingApprovalAmountINR ?? 0, usd: r.pendingApprovalAmountUSD ?? 0 },
          overdue: { lkr: r.overdueAmountLKR ?? 0, inr: r.overdueAmountINR ?? 0, usd: r.overdueAmountUSD ?? 0 },
        };
      case 'DOCS': {
        const docs = r.docsPaidByCurrency;
        return {
          expected: z,
          received: { lkr: docs?.LKR ?? 0, inr: docs?.INR ?? 0, usd: docs?.USD ?? 0 },
          pending: z,
          overdue: z,
        };
      }
      default: {
        const slot = r.levelSlots?.[this.paymentScope as LanguageLevelSlot];
        return slot ? this.totalsFromSlot(slot) : { expected: z, received: z, pending: z, overdue: z };
      }
    }
  }

  rowExpected(r: BatchStudentPaymentRow): BatchStudentCurrencyTotals {
    return this.scopeTotalsFromRow(r).expected;
  }

  rowReceived(r: BatchStudentPaymentRow): BatchStudentCurrencyTotals {
    return this.scopeTotalsFromRow(r).received;
  }

  rowPending(r: BatchStudentPaymentRow): BatchStudentCurrencyTotals {
    return this.scopeTotalsFromRow(r).pending;
  }

  rowOverdue(r: BatchStudentPaymentRow): BatchStudentCurrencyTotals {
    return this.scopeTotalsFromRow(r).overdue;
  }

  isStudentPendingExcluded(studentId: string): boolean {
    return this.excludedPendingStudents.has(studentId);
  }

  toggleStudentPendingExclusion(studentId: string): void {
    if (this.excludedPendingStudents.has(studentId)) {
      this.excludedPendingStudents.delete(studentId);
    } else {
      this.excludedPendingStudents.add(studentId);
    }
    this.excludedPendingStudents = new Set(this.excludedPendingStudents);
    try {
      localStorage.setItem(
        this.EXCL_STUDENTS_KEY_PREFIX + this.batch,
        JSON.stringify([...this.excludedPendingStudents]),
      );
    } catch {}
  }

  private loadExcludedPendingStudents(): void {
    try {
      const saved = localStorage.getItem(this.EXCL_STUDENTS_KEY_PREFIX + this.batch);
      if (saved) {
        this.excludedPendingStudents = new Set(JSON.parse(saved));
      }
    } catch {}
  }

  hasInsightAmount(key: string): boolean {
    const a = this.insightAmountsFor(key);
    return a.lkr > 0 || a.inr > 0 || a.usd > 0;
  }

  insightAmountLkr(key: string): number {
    return this.insightAmountsFor(key).lkr;
  }

  insightAmountInr(key: string): number {
    return this.insightAmountsFor(key).inr;
  }

  insightAmountUsd(key: string): number {
    return this.insightAmountsFor(key).usd;
  }

  private insightAmountsFor(key: string): { lkr: number; inr: number; usd: number } {
    const matched =
      key === 'all'
        ? this.rows
        : this.rows.filter((r) => this.rowMatchesInsight(r, key as StudentInsightFilter));

    return matched.reduce(
      (acc, r) => {
        const scoped = this.scopeTotalsFromRow(r);
        if (key === 'have_balance') {
          if (this.excludedPendingStudents.has(r.studentId)) return acc;
          return {
            lkr: acc.lkr + scoped.pending.lkr,
            inr: acc.inr + scoped.pending.inr,
            usd: acc.usd + scoped.pending.usd,
          };
        }
        if (key === 'overdue') {
          return {
            lkr: acc.lkr + scoped.overdue.lkr,
            inr: acc.inr + scoped.overdue.inr,
            usd: acc.usd + scoped.overdue.usd,
          };
        }
        if (key === 'paid_docs') {
          const d = this.bucketTotals(r.docsPaidByCurrency);
          return { lkr: acc.lkr + d.totalPaidLKR, inr: acc.inr + d.totalPaidINR, usd: acc.usd + d.totalPaidUSD };
        }
        if (key === 'paid_visa') {
          const v = this.bucketTotals(r.visaPaidByCurrency);
          return { lkr: acc.lkr + v.totalPaidLKR, inr: acc.inr + v.totalPaidINR, usd: acc.usd + v.totalPaidUSD };
        }
        if (key === 'all') {
          return {
            lkr: acc.lkr + scoped.expected.lkr,
            inr: acc.inr + scoped.expected.inr,
            usd: acc.usd + scoped.expected.usd,
          };
        }
        if (key === 'paid_full') {
          const owed = scoped.pending.lkr + scoped.pending.inr + scoped.overdue.lkr + scoped.overdue.inr;
          if (owed > 0) return acc;
        }
        return {
          lkr: acc.lkr + scoped.received.lkr,
          inr: acc.inr + scoped.received.inr,
          usd: acc.usd + scoped.received.usd,
        };
      },
      { lkr: 0, inr: 0, usd: 0 },
    );
  }

  private rowMatchesInsight(row: BatchStudentPaymentRow, insight: StudentInsightFilter): boolean {
    if (!insight) return true;
    const status = this.rowLanguageFeeStatus(row);
    switch (insight) {
      case 'paid_full':
        return status === 'FULL_PAID';
      case 'have_balance':
        return status === 'BALANCE' || this.pendingTotal(row) > 0;
      case 'overdue':
        return status === 'DUE' || this.overdueTotal(row) > 0 || row.overallStatus === 'OVERDUE';
      case 'paid_docs':
        return this.bucketPaidTotal(row.docsPaidByCurrency) > 0;
      case 'paid_visa':
        return this.bucketPaidTotal(row.visaPaidByCurrency) > 0;
      default:
        return true;
    }
  }

  private rowLanguageFeeStatus(row: BatchStudentPaymentRow): LanguageFeeStatus {
    const pending = this.pendingTotal(row);
    const overdue = this.overdueTotal(row);
    if (pending <= 0 && overdue <= 0 && ['FULLY_PAID', 'GOOD_STANDING'].includes(row.overallStatus)) {
      return 'FULL_PAID';
    }
    return computeLanguageFeeStatus(pending + overdue, row.currentJourneyDay);
  }

  private pendingTotal(row: BatchStudentPaymentRow): number {
    const p = this.scopeTotalsFromRow(row).pending;
    return p.lkr + p.inr + p.usd;
  }

  private overdueTotal(row: BatchStudentPaymentRow): number {
    const o = this.scopeTotalsFromRow(row).overdue;
    return o.lkr + o.inr + o.usd;
  }

  private bucketPaidTotal(bucket: CurrencyBucket | undefined): number {
    const t = paidTotalsFromBucket(bucket);
    return t.totalPaidLKR + t.totalPaidINR + t.totalPaidUSD;
  }

  bucketTotals(bucket: CurrencyBucket | undefined): CurrencyPaidTotals {
    return paidTotalsFromBucket(bucket);
  }

  journeyDayDisplay(row: BatchStudentPaymentRow): string {
    return formatJourneyDayCurrentTotal({ currentCourseDay: row.currentJourneyDay }, row.level);
  }

  languageFeeStatusLabel(row: BatchStudentPaymentRow): string {
    const key = this.rowLanguageFeeStatus(row);
    return LANGUAGE_FEE_STATUS_LABELS[key] || key;
  }

  languageFeePillClass(row: BatchStudentPaymentRow): string {
    return languageFeeStatusClass(this.rowLanguageFeeStatus(row));
  }

  openStudentDetail(row: BatchStudentPaymentRow): void {
    window.open(`/admin/payment-hub/student/${row.studentId}`, '_blank');
  }
}
