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
  BatchPaymentSummaryRow,
  BatchStudentPaymentRow,
  CurrencyBucket,
  CurrencyPaidTotals,
  LanguageLevelSlot,
  PaymentHubApiService,
} from './payment-hub-api.service';
import { BatchPaymentRow } from './payment-hub-batch-insights.component';
import { sumBatchPaymentRows } from './payment-hub-batch-totals.util';
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
import {
  currentLevelPendingFromStudentRow,
  subtractExcludedPending,
} from './payment-hub-pending-exclusion.util';
import { PaymentHubPendingExclusionService } from './payment-hub-pending-exclusion.service';
import { formatStudentStatusLabel } from './payment-hub-finance-cohort.util';

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
  batchSummary: BatchPaymentSummaryRow | null = null;
  insightCounts: Record<string, number> = {
    all: 0,
    paid_full: 0,
    have_balance: 0,
    overdue: 0,
    paid_docs: 0,
    paid_visa: 0,
  };
  searchQuery = '';
  studentInsight: StudentInsightFilter = '';
  /** Defaults to ongoing students only. */
  studentStatus = 'ONGOING';
  paymentScope: BatchStudentPaymentScope = 'current_level';
  readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8];

  readonly studentStatusOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: '', label: 'All statuses' },
    { value: 'ONGOING', label: 'Ongoing' },
    { value: 'COMPLETED', label: 'Completed' },
    { value: 'UNCERTAIN', label: 'Uncertain' },
    { value: 'WITHDREW', label: 'Withdrew' },
    { value: 'DROPPED', label: 'Dropped' },
  ];

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

  studentStatusLabel(status: string): string {
    if (!status) return 'All statuses';
    return formatStudentStatusLabel(status);
  }

  setStudentStatus(status: string): void {
    this.studentStatus = status;
    this.load();
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
    private readonly pendingExclusion: PaymentHubPendingExclusionService,
  ) {}

  ngOnInit(): void {
    this.batch = decodeURIComponent(this.route.snapshot.paramMap.get('batch') || '');
    const statusFromUrl = (this.route.snapshot.queryParamMap.get('status') || '').trim().toUpperCase();
    this.studentStatus = statusFromUrl || 'ONGOING';
    this.pendingExclusion.ensureLoaded().subscribe({
      next: () => this.load(),
      error: () => this.load(),
    });
  }

  load(): void {
    this.loading = true;
    const params: Record<string, string> = {};
    if (this.studentStatus) params['studentStatus'] = this.studentStatus;
    this.api.getBatchStudentsPaymentDetail(this.batch, params).subscribe({
      next: (res) => {
        this.rows = res.data?.students || [];
        this.batchSummary = res.data?.batchSummary ?? null;
        this.insightCounts = {
          all: res.data?.insightCounts?.all ?? this.rows.length,
          paid_full: res.data?.insightCounts?.paid_full ?? 0,
          have_balance: res.data?.insightCounts?.have_balance ?? 0,
          overdue: res.data?.insightCounts?.overdue ?? 0,
          paid_docs: res.data?.insightCounts?.paid_docs ?? 0,
          paid_visa: res.data?.insightCounts?.paid_visa ?? 0,
        };
        this.loading = false;
      },
      error: () => {
        this.rows = [];
        this.batchSummary = null;
        this.insightCounts = { all: 0, paid_full: 0, have_balance: 0, overdue: 0, paid_docs: 0, paid_visa: 0 };
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
    return this.insightCounts[key] ?? 0;
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
    const pending = this.scopeTotalsFromRow(r).pending;
    if (this.paymentScope !== 'current_level') return pending;
    if (this.isStudentPendingExcluded(r.studentId)) {
      return { lkr: 0, inr: 0, usd: 0 };
    }
    return pending;
  }

  rowOverdue(r: BatchStudentPaymentRow): BatchStudentCurrencyTotals {
    return this.scopeTotalsFromRow(r).overdue;
  }

  isStudentPendingExcluded(studentId: string): boolean {
    return this.pendingExclusion.isStudentPendingExcluded(this.batch, studentId);
  }

  toggleStudentPendingExclusion(r: BatchStudentPaymentRow): void {
    const pending = currentLevelPendingFromStudentRow(r);
    this.pendingExclusion.toggleStudentPendingExclusion(this.batch, r.studentId, pending).subscribe();
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
    const batchRow = this.batchRowFromSummary();
    if (!batchRow) return { lkr: 0, inr: 0, usd: 0 };

    const scoped = this.scopedMoneyAggregateForBatch(batchRow);
    const t = sumBatchPaymentRows([batchRow]);
    switch (key) {
      case 'all':
        return scoped.expected;
      case 'paid_full':
        return this.scopedReceivedForSettledBatch(batchRow);
      case 'have_balance':
        return scoped.pending;
      case 'overdue':
        return scoped.overdue;
      case 'paid_docs':
        return {
          lkr: t.insightDocsLKR ?? 0,
          inr: t.insightDocsINR ?? 0,
          usd: t.insightDocsUSD ?? 0,
        };
      case 'paid_visa':
        return {
          lkr: t.insightVisaLKR ?? 0,
          inr: t.insightVisaINR ?? 0,
          usd: t.insightVisaUSD ?? 0,
        };
      default:
        return { lkr: 0, inr: 0, usd: 0 };
    }
  }

  private batchRowFromSummary(): BatchPaymentRow | null {
    const row = this.batchSummary;
    if (!row) return null;
    const levelCounts = new Map<string, number>(Object.entries(row.levelCounts || {}).filter(([k]) => k));
    const batchLevel = this.dominantLevel(levelCounts);
    return {
      batch: row.batch,
      batchType: row.batchType === 'old' ? 'old' : 'new',
      level: batchLevel,
      levelSummary: '',
      studentCount: row.studentCount,
      totalPaid: row.totalPaid,
      totalPaidLKR: row.totalPaidLKR ?? 0,
      totalPaidINR: row.totalPaidINR ?? 0,
      totalPaidUSD: row.totalPaidUSD ?? 0,
      totalPendingLKR: row.totalPendingLKR ?? 0,
      totalPendingINR: row.totalPendingINR ?? 0,
      totalPendingUSD: row.totalPendingUSD ?? 0,
      totalOverdueLKR: row.totalOverdueLKR ?? 0,
      totalOverdueINR: row.totalOverdueINR ?? 0,
      totalOverdueUSD: row.totalOverdueUSD ?? 0,
      totalExpectedLKR: row.totalExpectedLKR ?? 0,
      totalExpectedINR: row.totalExpectedINR ?? 0,
      totalExpectedUSD: row.totalExpectedUSD ?? 0,
      langPaidLKR: row.langPaidLKR ?? 0,
      langPaidINR: row.langPaidINR ?? 0,
      langPaidUSD: row.langPaidUSD ?? 0,
      fullPendingLKR: row.fullPendingLKR ?? 0,
      fullPendingINR: row.fullPendingINR ?? 0,
      fullPendingUSD: row.fullPendingUSD ?? 0,
      fullOverdueLKR: row.fullOverdueLKR ?? 0,
      fullOverdueINR: row.fullOverdueINR ?? 0,
      fullOverdueUSD: row.fullOverdueUSD ?? 0,
      fullExpectedLKR: row.fullExpectedLKR ?? 0,
      fullExpectedINR: row.fullExpectedINR ?? 0,
      fullExpectedUSD: row.fullExpectedUSD ?? 0,
      levelSlots: row.levelSlots ?? {},
      allLanguageFees: row.allLanguageFees ?? null,
      totalDueLKR: row.totalDueLKR ?? 0,
      totalDueINR: row.totalDueINR ?? 0,
      totalDueUSD: row.totalDueUSD ?? 0,
      fullyPaidStudents: row.fullyPaidStudents ?? 0,
      balanceStudents: row.balanceStudents ?? 0,
      overdueStudents: row.overdueStudents ?? 0,
      docsPaidStudents: row.docsPaidStudents ?? 0,
      visaPaidStudents: row.visaPaidStudents ?? 0,
      insightPaidFullLKR: row.insightPaidFullLKR ?? 0,
      insightPaidFullINR: row.insightPaidFullINR ?? 0,
      insightPaidFullUSD: row.insightPaidFullUSD ?? 0,
      insightBalanceLKR: row.insightBalanceLKR ?? 0,
      insightBalanceINR: row.insightBalanceINR ?? 0,
      insightBalanceUSD: row.insightBalanceUSD ?? 0,
      insightOverdueLKR: row.insightOverdueLKR ?? 0,
      insightOverdueINR: row.insightOverdueINR ?? 0,
      insightOverdueUSD: row.insightOverdueUSD ?? 0,
      insightDocsLKR: row.insightDocsLKR ?? 0,
      insightDocsINR: row.insightDocsINR ?? 0,
      insightDocsUSD: row.insightDocsUSD ?? 0,
      insightVisaLKR: row.insightVisaLKR ?? 0,
      insightVisaINR: row.insightVisaINR ?? 0,
      insightVisaUSD: row.insightVisaUSD ?? 0,
      currentJourneyDay: row.batchCurrentDay ?? null,
      avgJourneyDay: null,
      totalJourneyDays: null,
      collectionRateLKR: row.collectionRateLKR ?? null,
      overdueSince: row.overdueSince ?? null,
    };
  }

  private dominantLevel(counts: Map<string, number>): string | null {
    let best: string | null = null;
    let max = 0;
    for (const [lv, n] of counts) {
      if (n > max) {
        max = n;
        best = lv;
      }
    }
    return best;
  }

  private scopedMoneyAggregateForBatch(r: BatchPaymentRow): {
    expected: BatchStudentCurrencyTotals;
    received: BatchStudentCurrencyTotals;
    pending: BatchStudentCurrencyTotals;
    overdue: BatchStudentCurrencyTotals;
  } {
    const s = this.scopeTotalsFromBatchRow(r);
    return {
      expected: s.expected,
      received: s.received,
      pending: subtractExcludedPending(this.batch, s.pending, this.pendingExclusion.getExcludedPendingByBatch()),
      overdue: s.overdue,
    };
  }

  private scopedReceivedForSettledBatch(r: BatchPaymentRow): BatchStudentCurrencyTotals {
    const s = this.scopeTotalsFromBatchRow(r);
    const owed =
      s.pending.lkr + s.pending.inr + s.pending.usd + s.overdue.lkr + s.overdue.inr + s.overdue.usd;
    if (owed > 0) return this.emptyCurrencyTotals();
    return s.received;
  }

  private scopeTotalsFromBatchRow(r: BatchPaymentRow): {
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
          expected: { lkr: r.totalExpectedLKR, inr: r.totalExpectedINR, usd: r.totalExpectedUSD },
          received: { lkr: r.langPaidLKR, inr: r.langPaidINR, usd: r.langPaidUSD },
          pending: { lkr: r.totalPendingLKR, inr: r.totalPendingINR, usd: r.totalPendingUSD },
          overdue: { lkr: r.totalOverdueLKR, inr: r.totalOverdueINR, usd: r.totalOverdueUSD },
        };
      }
      case 'all_language': {
        if (r.allLanguageFees) return this.totalsFromSlot(r.allLanguageFees);
        const summed = this.sumLevelSlotsFromBatchRow(r);
        if (summed) return this.totalsFromSlot(summed);
        return {
          expected: { lkr: r.totalExpectedLKR, inr: r.totalExpectedINR, usd: r.totalExpectedUSD },
          received: { lkr: r.langPaidLKR, inr: r.langPaidINR, usd: r.langPaidUSD },
          pending: { lkr: r.totalPendingLKR, inr: r.totalPendingINR, usd: r.totalPendingUSD },
          overdue: { lkr: r.totalOverdueLKR, inr: r.totalOverdueINR, usd: r.totalOverdueUSD },
        };
      }
      case 'all_payment':
        return {
          expected: { lkr: r.fullExpectedLKR, inr: r.fullExpectedINR, usd: r.fullExpectedUSD },
          received: { lkr: r.totalPaidLKR, inr: r.totalPaidINR, usd: r.totalPaidUSD },
          pending: { lkr: r.fullPendingLKR, inr: r.fullPendingINR, usd: r.fullPendingUSD },
          overdue: { lkr: r.fullOverdueLKR, inr: r.fullOverdueINR, usd: r.fullOverdueUSD },
        };
      case 'DOCS':
        return {
          expected: z,
          received: { lkr: r.insightDocsLKR, inr: r.insightDocsINR, usd: r.insightDocsUSD },
          pending: z,
          overdue: z,
        };
      default: {
        const slot = r.levelSlots?.[this.paymentScope as LanguageLevelSlot];
        return slot ? this.totalsFromSlot(slot) : { expected: z, received: z, pending: z, overdue: z };
      }
    }
  }

  private sumLevelSlotsFromBatchRow(r: BatchPaymentRow): BatchLevelSlotTotals | null {
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

  private rowMatchesInsight(row: BatchStudentPaymentRow, insight: StudentInsightFilter): boolean {
    if (!insight) return true;
    return !!row.insightFlags?.[insight];
  }

  private rowLanguageFeeStatus(row: BatchStudentPaymentRow): LanguageFeeStatus {
    const pending = this.pendingTotal(row);
    const overdue = this.overdueTotal(row);
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
