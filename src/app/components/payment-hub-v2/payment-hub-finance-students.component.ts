import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  BatchLevelSlotTotals,
  BatchStudentPaymentFilter,
  BatchStudentPaymentRow,
  CohortStudentsPaymentDetail,
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
import {
  FinanceCohort,
  financeCohortLabel,
  formatStudentStatusLabel,
  parseFinanceCohortQuery,
} from './payment-hub-finance-cohort.util';

interface StudentCurrencyTotals {
  lkr: number;
  inr: number;
  usd: number;
}

interface LevelFilterOption {
  value: string;
  label: string;
  total: number;
}

type StudentInsightFilter = '' | 'paid_full' | 'have_balance' | 'overdue';

@Component({
  selector: 'app-payment-hub-finance-students',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyPendingTotalsComponent,
    PaymentCurrencyOverdueTotalsComponent,
  ],
  templateUrl: './payment-hub-finance-students.component.html',
  styleUrls: [
    './payment-hub-insights-page.scss',
    './payment-hub-batch-students.component.scss',
    './payment-hub-finance-students.component.scss',
  ],
})
export class PaymentHubFinanceStudentsComponent implements OnInit, OnDestroy {
  loading = true;
  cohort: FinanceCohort = 'all';
  cohortStatus = '';
  rows: BatchStudentPaymentRow[] = [];
  summary: Omit<CohortStudentsPaymentDetail, 'students'> | null = null;

  searchQuery = '';
  page = 1;
  pageSize = 50;
  readonly pageSizeOptions = [10, 50, 100, 150, 200, 300];
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  studentInsight: StudentInsightFilter = '';
  paymentFilter: BatchStudentPaymentFilter = 'all_language';
  levelFilterOpen = false;
  selectedLevels: string[] = [];
  draftSelectedLevels: string[] = [];
  levelFilterSearch = '';
  levelOptions: LevelFilterOption[] = [];

  readonly paymentFilterOptions: ReadonlyArray<{ value: BatchStudentPaymentFilter; label: string }> = [
    { value: 'A1', label: 'A1' },
    { value: 'A2', label: 'A2' },
    { value: 'B1', label: 'B1' },
    { value: 'B2', label: 'B2' },
    { value: 'all_language', label: 'All language fees' },
    { value: 'all_payment', label: 'All payment' },
  ];

  readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8];

  readonly studentInsightOptions = [
    { value: '' as StudentInsightFilter, key: 'all', label: 'Total students', icon: 'groups', color: 'slate', hint: 'Show all students' },
    { value: 'paid_full' as StudentInsightFilter, key: 'paid_full', label: 'Paid full', icon: 'check_circle', color: 'green', hint: 'Language fee fully paid' },
    { value: 'have_balance' as StudentInsightFilter, key: 'have_balance', label: 'Have balance', icon: 'account_balance_wallet', color: 'amber', hint: 'Outstanding balance' },
    { value: 'overdue' as StudentInsightFilter, key: 'overdue', label: 'Overdue', icon: 'warning_amber', color: 'red', hint: 'Past due payments' },
  ] as const;

  formatStudentStatus = formatStudentStatusLabel;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: PaymentHubApiService,
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const parsed = parseFinanceCohortQuery({
        cohort: params.get('cohort') ?? undefined,
        status: params.get('status') ?? undefined,
      });
      this.cohort = parsed.cohort;
      this.cohortStatus = parsed.status;
      this.page = 1;
      this.studentInsight = '';
      this.selectedLevels = [];
      this.draftSelectedLevels = [];
      this.load();
    });
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  get cohortLabel(): string {
    return financeCohortLabel(this.cohort);
  }

  get statusLabel(): string {
    if (!this.cohortStatus) return '';
    return formatStudentStatusLabel(this.cohortStatus);
  }

  load(): void {
    this.loading = true;
    this.api.getCohortStudentsPaymentDetail(this.cohort, this.cohortStatus || undefined, {
      page: this.page,
      limit: this.pageSize,
      search: this.searchQuery.trim(),
      levels: this.selectedLevels.join(','),
      insight: this.studentInsight,
    }).subscribe({
      next: (res) => {
        const data = res.data;
        this.rows = data?.students || [];
        this.levelOptions = data?.levelOptions || [];
        const { students: _s, ...rest } = data || { students: [], cohort: this.cohort, status: this.cohortStatus, totalStudents: 0, page: 1, limit: this.pageSize, totalPages: 1, levelOptions: [], insightCounts: { all: 0, paid_full: 0, have_balance: 0, overdue: 0 }, levelSummaries: [], totalPaidLKR: 0, totalPaidINR: 0, totalPaidUSD: 0, totalPendingLKR: 0, totalPendingINR: 0, totalPendingUSD: 0 };
        this.summary = rest;
        this.page = rest.page || this.page;
        this.loading = false;
      },
      error: () => {
        this.rows = [];
        this.levelOptions = [];
        this.summary = { cohort: this.cohort, status: this.cohortStatus, totalStudents: 0, page: 1, limit: this.pageSize, totalPages: 1, levelOptions: [], insightCounts: { all: 0, paid_full: 0, have_balance: 0, overdue: 0 }, levelSummaries: [], totalPaidLKR: 0, totalPaidINR: 0, totalPaidUSD: 0, totalPendingLKR: 0, totalPendingINR: 0, totalPendingUSD: 0 };
        this.loading = false;
      },
    });
  }

  get totalPages(): number {
    return Math.max(1, this.summary?.totalPages || 1);
  }

  get totalStudents(): number {
    return this.summary?.totalStudents || 0;
  }

  get pageStart(): number {
    if (!this.totalStudents) return 0;
    return (this.page - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.page * this.pageSize, this.totalStudents);
  }

  rowNumber(index: number): number {
    return (this.page - 1) * this.pageSize + index + 1;
  }

  onSearchChange(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page = 1;
      this.studentInsight = '';
      this.load();
    }, 300);
  }

  goToPage(nextPage: number): void {
    const clamped = Math.min(this.totalPages, Math.max(1, nextPage));
    if (clamped === this.page) return;
    this.page = clamped;
    this.studentInsight = '';
    this.load();
  }

  onPageSizeChange(size: number | string): void {
    const nextSize = Number(size) || this.pageSize;
    if (nextSize === this.pageSize) return;
    this.pageSize = nextSize;
    this.page = 1;
    this.studentInsight = '';
    this.load();
  }

  get displayRows(): BatchStudentPaymentRow[] {
    let list = this.rows;
    if (this.studentInsight) {
      list = list.filter((r) => this.rowMatchesInsight(r, this.studentInsight));
    }
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.email || '').toLowerCase().includes(q) ||
        (r.batch || '').toLowerCase().includes(q),
    );
  }

  insightCount(key: string): number {
    const counts = this.summary?.insightCounts;
    if (key === 'all') return counts?.all ?? this.totalStudents;
    return counts?.[key as keyof NonNullable<CohortStudentsPaymentDetail['insightCounts']>] ?? 0;
  }

  applyInsightFilter(insight: StudentInsightFilter): void {
    this.studentInsight = this.studentInsight === insight ? '' : insight;
    this.page = 1;
    this.load();
  }

  isInsightActive(value: StudentInsightFilter): boolean {
    return this.studentInsight === value;
  }

  activeInsightLabel(): string {
    return this.studentInsightOptions.find((o) => o.value === this.studentInsight)?.label || '';
  }

  setPaymentFilter(filter: BatchStudentPaymentFilter): void {
    this.paymentFilter = filter;
  }

  paymentFilterLabel(): string {
    return this.paymentFilterOptions.find((o) => o.value === this.paymentFilter)?.label ?? 'All language fees';
  }

  paymentFilterHint(): string {
    switch (this.paymentFilter) {
      case 'all_payment': return 'All payment types — language, docs, visa, etc.';
      case 'all_language': return 'All language fees (A1–B2).';
      default: return `${this.paymentFilter} fee only.`;
    }
  }

  isPaymentFilterActive(value: BatchStudentPaymentFilter): boolean {
    return this.paymentFilter === value;
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
    this.load();
  }

  clearAppliedLevelFilter(): void {
    this.selectedLevels = [];
    this.draftSelectedLevels = [];
    this.page = 1;
    this.studentInsight = '';
    this.load();
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

  levelSummaryRows(): NonNullable<CohortStudentsPaymentDetail['levelSummaries']> {
    return this.summary?.levelSummaries || [];
  }

  applyLevelReceivedFilter(level: string): void {
    this.selectedLevels = [level];
    this.draftSelectedLevels = [level];
    this.studentInsight = '';
    this.page = 1;
    this.load();
  }

  applyLevelRemainingFilter(level: string): void {
    this.selectedLevels = [level];
    this.draftSelectedLevels = [level];
    this.studentInsight = 'have_balance';
    this.page = 1;
    this.load();
  }

  hasLevelReceived(row: NonNullable<CohortStudentsPaymentDetail['levelSummaries']>[number]): boolean {
    return row.receivedLKR > 0 || row.receivedINR > 0 || row.receivedUSD > 0;
  }

  hasLevelRemaining(row: NonNullable<CohortStudentsPaymentDetail['levelSummaries']>[number]): boolean {
    return row.remainingLKR > 0 || row.remainingINR > 0 || row.remainingUSD > 0;
  }

  private emptyCurrencyTotals(): StudentCurrencyTotals {
    return { lkr: 0, inr: 0, usd: 0 };
  }

  private totalsFromSlot(slot: BatchLevelSlotTotals | null | undefined): {
    expected: StudentCurrencyTotals;
    received: StudentCurrencyTotals;
    pending: StudentCurrencyTotals;
    overdue: StudentCurrencyTotals;
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
    const acc: BatchLevelSlotTotals = { receivedLKR: 0, receivedINR: 0, receivedUSD: 0, pendingLKR: 0, pendingINR: 0, pendingUSD: 0, overdueLKR: 0, overdueINR: 0, overdueUSD: 0, expectedLKR: 0, expectedINR: 0, expectedUSD: 0 };
    for (const key of keys) {
      const s = r.levelSlots?.[key];
      if (!s) continue;
      hasAny = true;
      acc.receivedLKR += s.receivedLKR ?? 0; acc.receivedINR += s.receivedINR ?? 0; acc.receivedUSD += s.receivedUSD ?? 0;
      acc.pendingLKR += s.pendingLKR ?? 0; acc.pendingINR += s.pendingINR ?? 0; acc.pendingUSD += s.pendingUSD ?? 0;
      acc.overdueLKR += s.overdueLKR ?? 0; acc.overdueINR += s.overdueINR ?? 0; acc.overdueUSD += s.overdueUSD ?? 0;
      acc.expectedLKR += s.expectedLKR ?? 0; acc.expectedINR += s.expectedINR ?? 0; acc.expectedUSD += s.expectedUSD ?? 0;
    }
    return hasAny ? acc : null;
  }

  private scopeTotalsFromRow(r: BatchStudentPaymentRow): { expected: StudentCurrencyTotals; received: StudentCurrencyTotals; pending: StudentCurrencyTotals; overdue: StudentCurrencyTotals } {
    if (this.paymentFilter === 'all_payment') {
      return {
        expected: this.emptyCurrencyTotals(),
        received: { lkr: r.totalPaidLKR ?? 0, inr: r.totalPaidINR ?? 0, usd: r.totalPaidUSD ?? 0 },
        pending: { lkr: r.pendingApprovalAmountLKR ?? 0, inr: r.pendingApprovalAmountINR ?? 0, usd: r.pendingApprovalAmountUSD ?? 0 },
        overdue: { lkr: r.overdueAmountLKR ?? 0, inr: r.overdueAmountINR ?? 0, usd: r.overdueAmountUSD ?? 0 },
      };
    }
    if (this.paymentFilter === 'all_language') {
      if (r.allLanguageFees) return this.totalsFromSlot(r.allLanguageFees);
      const summed = this.sumLevelSlots(r);
      if (summed) return this.totalsFromSlot(summed);
      const z = this.emptyCurrencyTotals();
      return {
        expected: z,
        received: { lkr: r.langPaidLKR ?? 0, inr: r.langPaidINR ?? 0, usd: r.langPaidUSD ?? 0 },
        pending: { lkr: r.langPendingLKR ?? 0, inr: r.langPendingINR ?? 0, usd: r.langPendingUSD ?? 0 },
        overdue: { lkr: r.langOverdueLKR ?? 0, inr: r.langOverdueINR ?? 0, usd: r.langOverdueUSD ?? 0 },
      };
    }
    return this.totalsFromSlot(r.levelSlots?.[this.paymentFilter]);
  }

  rowReceived(r: BatchStudentPaymentRow): StudentCurrencyTotals {
    return this.scopeTotalsFromRow(r).received;
  }

  rowPending(r: BatchStudentPaymentRow): StudentCurrencyTotals {
    return this.scopeTotalsFromRow(r).pending;
  }

  rowOverdue(r: BatchStudentPaymentRow): StudentCurrencyTotals {
    return this.scopeTotalsFromRow(r).overdue;
  }

  private pendingTotal(row: BatchStudentPaymentRow): number {
    const p = this.scopeTotalsFromRow(row).pending;
    return p.lkr + p.inr + p.usd;
  }

  private overdueTotal(row: BatchStudentPaymentRow): number {
    const o = this.scopeTotalsFromRow(row).overdue;
    return o.lkr + o.inr + o.usd;
  }

  private rowLanguageFeeStatus(row: BatchStudentPaymentRow): LanguageFeeStatus {
    const pending = this.pendingTotal(row);
    const overdue = this.overdueTotal(row);
    if (pending <= 0 && overdue <= 0 && ['FULLY_PAID', 'GOOD_STANDING'].includes(row.overallStatus)) {
      return 'FULL_PAID';
    }
    return computeLanguageFeeStatus(pending + overdue, row.currentJourneyDay);
  }

  private rowMatchesInsight(row: BatchStudentPaymentRow, insight: StudentInsightFilter): boolean {
    if (!insight) return true;
    const status = this.rowLanguageFeeStatus(row);
    switch (insight) {
      case 'paid_full': return status === 'FULL_PAID';
      case 'have_balance': return status === 'BALANCE' || this.pendingTotal(row) > 0;
      case 'overdue': return status === 'DUE' || this.overdueTotal(row) > 0 || row.overallStatus === 'OVERDUE';
      default: return true;
    }
  }

  languageFeeStatusLabel(row: BatchStudentPaymentRow): string {
    return LANGUAGE_FEE_STATUS_LABELS[this.rowLanguageFeeStatus(row)] || this.rowLanguageFeeStatus(row);
  }

  languageFeePillClass(row: BatchStudentPaymentRow): string {
    return languageFeeStatusClass(this.rowLanguageFeeStatus(row));
  }

  journeyDayDisplay(row: BatchStudentPaymentRow): string {
    return formatJourneyDayCurrentTotal({ currentCourseDay: row.currentJourneyDay }, row.level);
  }

  openStudentDetail(row: BatchStudentPaymentRow): void {
    window.open(`/admin/payment-hub/student/${row.studentId}`, '_blank');
  }

  bucketTotals(bucket: CurrencyBucket | undefined): CurrencyPaidTotals {
    return paidTotalsFromBucket(bucket);
  }
}
