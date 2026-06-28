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
  BatchStudentPaymentRow,
  CohortStudentsPaymentDetail,
  CurrencyBucket,
  CurrencyPaidTotals,
  InsightCurrencyTotals,
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
import { isDocsFullPaidByReceived } from './payment-hub-docs-full-paid.util';

interface StudentCurrencyTotals {
  lkr: number;
  inr: number;
  usd: number;
}

interface TableFilterOption {
  value: string;
  label: string;
  total: number;
}

type TableColumnFilter = 'level' | 'batch' | 'status';

type StudentInsightFilter = '' | 'paid_full' | 'have_balance' | 'overdue';
type DocsInsightAmountKind = 'expected' | 'received' | 'pending';
type FinanceStudentPaymentScope = 'current_level' | 'all_language' | 'all_payment' | LanguageLevelSlot | 'DOCS';

interface FinanceStudentInsightOption {
  value: StudentInsightFilter;
  key: string;
  label: string;
  icon: string;
  color: string;
  hint: string;
  amountKind?: DocsInsightAmountKind;
}

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
  paymentScope: FinanceStudentPaymentScope = 'current_level';
  tableFilterOpen: TableColumnFilter | null = null;
  tableFilterSearch = '';
  selectedLevels: string[] = [];
  selectedBatches: string[] = [];
  selectedStatuses: string[] = [];
  draftSelectedLevels: string[] = [];
  draftSelectedBatches: string[] = [];
  draftSelectedStatuses: string[] = [];
  levelOptions: TableFilterOption[] = [];
  batchOptions: TableFilterOption[] = [];
  statusOptions: TableFilterOption[] = [];

  readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8];

  readonly scopeButtons: ReadonlyArray<{ value: FinanceStudentPaymentScope; label: string }> = [
    { value: 'current_level', label: 'Current Level' },
    { value: 'all_language', label: 'All Language Fees' },
    { value: 'all_payment', label: 'All Payment' },
  ];

  readonly slotScopeOptions: ReadonlyArray<{ value: FinanceStudentPaymentScope; label: string }> = [
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

  setPaymentScope(scope: FinanceStudentPaymentScope): void {
    this.paymentScope = scope;
  }

  readonly studentInsightOptions: FinanceStudentInsightOption[] = [
    { value: '', key: 'all', label: 'Total students', icon: 'groups', color: 'slate', hint: 'Show all students' },
    { value: 'paid_full', key: 'paid_full', label: 'Paid full', icon: 'check_circle', color: 'green', hint: 'Language fee fully paid' },
    { value: 'have_balance', key: 'have_balance', label: 'Have balance', icon: 'account_balance_wallet', color: 'amber', hint: 'Outstanding balance' },
    { value: 'overdue', key: 'overdue', label: 'Overdue', icon: 'warning_amber', color: 'red', hint: 'Past due payments' },
  ];

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
      this.paymentScope = this.cohort === 'docs_payment' ? 'DOCS' : 'current_level';
      this.page = 1;
      this.studentInsight = '';
      this.selectedLevels = [];
      this.selectedBatches = [];
      this.selectedStatuses = [];
      this.draftSelectedLevels = [];
      this.draftSelectedBatches = [];
      this.draftSelectedStatuses = [];
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

  get isDocsPaymentCohort(): boolean {
    return this.cohort === 'docs_payment';
  }

  readonly docsInsightOptions: FinanceStudentInsightOption[] = [
    { value: '', key: 'all', label: 'Total students', icon: 'groups', color: 'slate', hint: 'Show all students', amountKind: 'expected' },
    { value: 'paid_full', key: 'paid_full', label: 'Payment clear', icon: 'check_circle', color: 'green', hint: 'Paid LKR 3,00,000 or 3,54,000 (INR 1,06,200)', amountKind: 'received' },
    { value: 'have_balance', key: 'have_balance', label: 'Remaining', icon: 'pending_actions', color: 'amber', hint: 'Outstanding documentation balance', amountKind: 'pending' },
  ];

  get activeInsightOptions(): FinanceStudentInsightOption[] {
    return this.isDocsPaymentCohort ? [...this.docsInsightOptions] : [...this.studentInsightOptions];
  }

  load(): void {
    this.loading = true;
    this.api.getCohortStudentsPaymentDetail(this.cohort, this.cohortStatus || undefined, {
      page: this.page,
      limit: this.pageSize,
      search: this.searchQuery.trim(),
      levels: this.selectedLevels.join(','),
      batches: this.selectedBatches.join(','),
      studentStatuses: this.selectedStatuses.join(','),
      insight: this.studentInsight,
    }).subscribe({
      next: (res) => {
        const data = res.data;
        this.rows = data?.students || [];
        this.levelOptions = data?.levelOptions || [];
        this.batchOptions = data?.batchOptions || [];
        this.statusOptions = (data?.statusOptions || []).map((opt) => ({
          ...opt,
          label: formatStudentStatusLabel(opt.label),
        }));
        const { students: _s, ...rest } = data || { students: [], cohort: this.cohort, status: this.cohortStatus, totalStudents: 0, page: 1, limit: this.pageSize, totalPages: 1, levelOptions: [], insightCounts: { all: 0, paid_full: 0, have_balance: 0, overdue: 0 }, levelSummaries: [], totalPaidLKR: 0, totalPaidINR: 0, totalPaidUSD: 0, totalPendingLKR: 0, totalPendingINR: 0, totalPendingUSD: 0 };
        this.summary = rest;
        this.page = rest.page || this.page;
        this.loading = false;
      },
      error: () => {
        this.rows = [];
        this.levelOptions = [];
        this.batchOptions = [];
        this.statusOptions = [];
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

  studentPct(count: number, total: number): string {
    if (!total) return '0%';
    return `${Math.round((count / total) * 100)}%`;
  }

  private hasMoney(totals: InsightCurrencyTotals | undefined): boolean {
    if (!totals) return false;
    return totals.lkr > 0 || totals.inr > 0 || totals.usd > 0;
  }

  hasInsightMoney(totals: InsightCurrencyTotals): boolean {
    return this.hasMoney(totals);
  }

  summaryExpectedTotals(): InsightCurrencyTotals {
    const s = this.summary;
    if (!s) return { lkr: 0, inr: 0, usd: 0 };
    const fromApi = this.summary?.insightAmounts?.all?.expected;
    if (this.hasMoney(fromApi)) return fromApi!;
    return {
      lkr: (s.totalExpectedLKR || 0) || ((s.totalPaidLKR || 0) + (s.totalPendingLKR || 0)),
      inr: (s.totalExpectedINR || 0) || ((s.totalPaidINR || 0) + (s.totalPendingINR || 0)),
      usd: (s.totalExpectedUSD || 0) || ((s.totalPaidUSD || 0) + (s.totalPendingUSD || 0)),
    };
  }

  summaryReceivedTotals(): InsightCurrencyTotals {
    const s = this.summary;
    return { lkr: s?.totalPaidLKR || 0, inr: s?.totalPaidINR || 0, usd: s?.totalPaidUSD || 0 };
  }

  summaryPendingTotals(): InsightCurrencyTotals {
    const s = this.summary;
    return { lkr: s?.totalPendingLKR || 0, inr: s?.totalPendingINR || 0, usd: s?.totalPendingUSD || 0 };
  }

  hasInsightAmount(key: string): boolean {
    if (!this.isDocsPaymentCohort) return false;
    return this.hasMoney(this.docsInsightAmountsFor(key));
  }

  private docsInsightAmountsFor(key: string): InsightCurrencyTotals {
    if (key === 'all') return this.insightAllExpected();
    if (key === 'paid_full') return this.insightReceivedFor('paid_full');
    if (key === 'have_balance') return this.insightPendingFor('have_balance');
    return { lkr: 0, inr: 0, usd: 0 };
  }

  insightExpectedFor(key: string): InsightCurrencyTotals {
    if (key === 'all') return this.insightAllExpected();
    return this.summary?.insightAmounts?.[key as 'paid_full' | 'have_balance']?.expected ?? { lkr: 0, inr: 0, usd: 0 };
  }

  insightReceivedFor(key: string): InsightCurrencyTotals {
    if (key === 'all') return this.insightAllReceived();
    return this.summary?.insightAmounts?.[key as 'paid_full' | 'have_balance']?.received ?? { lkr: 0, inr: 0, usd: 0 };
  }

  insightPendingFor(key: string): InsightCurrencyTotals {
    if (key === 'all') return this.insightAllPending();
    return this.summary?.insightAmounts?.[key as 'paid_full' | 'have_balance']?.pending ?? { lkr: 0, inr: 0, usd: 0 };
  }

  insightAllExpected(): InsightCurrencyTotals {
    return this.summary?.insightAmounts?.all?.expected ?? this.summaryExpectedTotals();
  }

  insightAllReceived(): InsightCurrencyTotals {
    return this.summary?.insightAmounts?.all?.received ?? this.summaryReceivedTotals();
  }

  insightAllPending(): InsightCurrencyTotals {
    return this.summary?.insightAmounts?.all?.pending ?? this.summaryPendingTotals();
  }

  insightAmountLkr(key: string): number {
    return this.docsInsightAmountsFor(key).lkr;
  }

  insightAmountInr(key: string): number {
    return this.docsInsightAmountsFor(key).inr;
  }

  insightAmountUsd(key: string): number {
    return this.docsInsightAmountsFor(key).usd;
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
    return this.activeInsightOptions.find((o) => o.value === this.studentInsight)?.label || '';
  }

  openTableFilter(kind: TableColumnFilter): void {
    this.tableFilterOpen = kind;
    this.tableFilterSearch = '';
    if (kind === 'level') this.draftSelectedLevels = [...this.selectedLevels];
    if (kind === 'batch') this.draftSelectedBatches = [...this.selectedBatches];
    if (kind === 'status') this.draftSelectedStatuses = [...this.selectedStatuses];
  }

  closeTableFilter(): void {
    this.tableFilterOpen = null;
  }

  activeTableFilterOptions(): TableFilterOption[] {
    if (this.tableFilterOpen === 'batch') return this.batchOptions;
    if (this.tableFilterOpen === 'status') return this.statusOptions;
    return this.levelOptions;
  }

  filteredTableFilterOptions(): TableFilterOption[] {
    const q = this.tableFilterSearch.trim().toLowerCase();
    const options = this.activeTableFilterOptions();
    if (!q) return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(q));
  }

  isDraftTableFilterSelected(value: string): boolean {
    if (this.tableFilterOpen === 'batch') return this.draftSelectedBatches.includes(value);
    if (this.tableFilterOpen === 'status') return this.draftSelectedStatuses.includes(value);
    return this.draftSelectedLevels.includes(value);
  }

  toggleDraftTableFilter(value: string): void {
    if (this.tableFilterOpen === 'batch') {
      this.draftSelectedBatches = this.isDraftTableFilterSelected(value)
        ? this.draftSelectedBatches.filter((v) => v !== value)
        : [...this.draftSelectedBatches, value];
      return;
    }
    if (this.tableFilterOpen === 'status') {
      this.draftSelectedStatuses = this.isDraftTableFilterSelected(value)
        ? this.draftSelectedStatuses.filter((v) => v !== value)
        : [...this.draftSelectedStatuses, value];
      return;
    }
    this.draftSelectedLevels = this.isDraftTableFilterSelected(value)
      ? this.draftSelectedLevels.filter((v) => v !== value)
      : [...this.draftSelectedLevels, value];
  }

  selectAllTableFilter(): void {
    const values = this.activeTableFilterOptions().map((opt) => opt.value);
    if (this.tableFilterOpen === 'batch') this.draftSelectedBatches = [...values];
    else if (this.tableFilterOpen === 'status') this.draftSelectedStatuses = [...values];
    else this.draftSelectedLevels = [...values];
  }

  clearTableFilterDraft(): void {
    if (this.tableFilterOpen === 'batch') this.draftSelectedBatches = [];
    else if (this.tableFilterOpen === 'status') this.draftSelectedStatuses = [];
    else this.draftSelectedLevels = [];
  }

  applyTableFilter(): void {
    if (this.tableFilterOpen === 'batch') this.selectedBatches = [...this.draftSelectedBatches];
    else if (this.tableFilterOpen === 'status') this.selectedStatuses = [...this.draftSelectedStatuses];
    else this.selectedLevels = [...this.draftSelectedLevels];
    this.page = 1;
    this.studentInsight = '';
    this.tableFilterOpen = null;
    this.load();
  }

  clearAppliedTableFilter(kind: TableColumnFilter): void {
    if (kind === 'batch') {
      this.selectedBatches = [];
      this.draftSelectedBatches = [];
    } else if (kind === 'status') {
      this.selectedStatuses = [];
      this.draftSelectedStatuses = [];
    } else {
      this.selectedLevels = [];
      this.draftSelectedLevels = [];
    }
    this.page = 1;
    this.studentInsight = '';
    this.load();
  }

  tableFilterLabel(kind: TableColumnFilter): string {
    const selected = kind === 'batch'
      ? this.selectedBatches
      : kind === 'status'
        ? this.selectedStatuses
        : this.selectedLevels;
    if (!selected.length) return '';
    const options = kind === 'batch'
      ? this.batchOptions
      : kind === 'status'
        ? this.statusOptions
        : this.levelOptions;
    const byValue = new Map(options.map((opt) => [opt.value, opt.label]));
    if (selected.length === 1) return byValue.get(selected[0]) || selected[0];
    return `${selected.length} selected`;
  }

  tableFilterTitle(): string {
    if (this.tableFilterOpen === 'batch') return 'Filter by Batch';
    if (this.tableFilterOpen === 'status') return 'Filter by Status';
    return 'Filter by Language Level';
  }

  tableFilterSubtitle(): string {
    return 'Select one or more values, then click Apply';
  }

  openLevelFilter(): void {
    this.openTableFilter('level');
  }

  closeLevelFilter(): void {
    this.closeTableFilter();
  }

  filteredLevelOptions(): TableFilterOption[] {
    return this.filteredTableFilterOptions();
  }

  isDraftLevelSelected(value: string): boolean {
    return this.isDraftTableFilterSelected(value);
  }

  toggleDraftLevel(value: string): void {
    this.toggleDraftTableFilter(value);
  }

  selectAllLevelFilter(): void {
    this.selectAllTableFilter();
  }

  clearLevelFilterDraft(): void {
    this.clearTableFilterDraft();
  }

  applyLevelFilter(): void {
    this.applyTableFilter();
  }

  clearAppliedLevelFilter(): void {
    this.clearAppliedTableFilter('level');
  }

  levelFilterLabel(): string {
    return this.tableFilterLabel('level');
  }

  trackLevelOption(_index: number, opt: TableFilterOption): string {
    return opt.value;
  }

  trackTableFilterOption(_index: number, opt: TableFilterOption): string {
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
        const pending = {
          lkr: r.docsPendingLKR ?? 0,
          inr: r.docsPendingINR ?? 0,
          usd: r.docsPendingUSD ?? 0,
        };
        const overdue = {
          lkr: r.docsOverdueLKR ?? 0,
          inr: r.docsOverdueINR ?? 0,
          usd: r.docsOverdueUSD ?? 0,
        };
        const balance = {
          lkr: r.docsBalanceLKR ?? 0,
          inr: r.docsBalanceINR ?? 0,
          usd: r.docsBalanceUSD ?? 0,
        };
        return {
          expected: z,
          received: { lkr: docs?.LKR ?? 0, inr: docs?.INR ?? 0, usd: docs?.USD ?? 0 },
          pending: {
            lkr: pending.lkr + balance.lkr,
            inr: pending.inr + balance.inr,
            usd: pending.usd + balance.usd,
          },
          overdue,
        };
      }
      default: {
        const slot = r.levelSlots?.[this.paymentScope as LanguageLevelSlot];
        return slot ? this.totalsFromSlot(slot) : { expected: z, received: z, pending: z, overdue: z };
      }
    }
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
    if (this.isDocsPaymentCohort) {
      if (isDocsFullPaidByReceived(row)) return 'FULL_PAID';
      const remaining =
        (row.docsBalanceLKR ?? 0) + (row.docsBalanceINR ?? 0) + (row.docsBalanceUSD ?? 0)
        + (row.docsOverdueLKR ?? 0) + (row.docsOverdueINR ?? 0) + (row.docsOverdueUSD ?? 0);
      if ((row.docsOverdueLKR ?? 0) + (row.docsOverdueINR ?? 0) + (row.docsOverdueUSD ?? 0) > 0) return 'DUE';
      if (remaining > 0) return 'BALANCE';
      return 'BALANCE';
    }
    const pending = this.pendingTotal(row);
    const overdue = this.overdueTotal(row);
    if (pending <= 0 && overdue <= 0 && ['FULLY_PAID', 'GOOD_STANDING'].includes(row.overallStatus)) {
      return 'FULL_PAID';
    }
    return computeLanguageFeeStatus(pending + overdue, row.currentJourneyDay);
  }

  private rowMatchesInsight(row: BatchStudentPaymentRow, insight: StudentInsightFilter): boolean {
    if (!insight) return true;
    if (this.isDocsPaymentCohort) {
      const remaining =
        (row.docsBalanceLKR ?? 0) + (row.docsBalanceINR ?? 0) + (row.docsBalanceUSD ?? 0)
        + (row.docsOverdueLKR ?? 0) + (row.docsOverdueINR ?? 0) + (row.docsOverdueUSD ?? 0);
      const overdue = (row.docsOverdueLKR ?? 0) + (row.docsOverdueINR ?? 0) + (row.docsOverdueUSD ?? 0);
      switch (insight) {
        case 'paid_full':
          return isDocsFullPaidByReceived(row);
        case 'have_balance':
          return !isDocsFullPaidByReceived(row);
        case 'overdue':
          return overdue > 0;
        default:
          return true;
      }
    }
    const status = this.rowLanguageFeeStatus(row);
    switch (insight) {
      case 'paid_full': return status === 'FULL_PAID';
      case 'have_balance': return status === 'BALANCE' || this.pendingTotal(row) > 0;
      case 'overdue': return status === 'DUE' || this.overdueTotal(row) > 0 || row.overallStatus === 'OVERDUE';
      default: return true;
    }
  }

  feeStatusColumnLabel(): string {
    return this.isDocsPaymentCohort ? 'Document fee' : 'Language fee';
  }

  feeStatusLabel(row: BatchStudentPaymentRow): string {
    if (this.isDocsPaymentCohort) {
      const status = this.rowLanguageFeeStatus(row);
      if (status === 'FULL_PAID') return 'Full paid';
      if (status === 'DUE') return 'Overdue';
      if (status === 'BALANCE') return 'Balance';
      return LANGUAGE_FEE_STATUS_LABELS[status] || status;
    }
    return this.languageFeeStatusLabel(row);
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
