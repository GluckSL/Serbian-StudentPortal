import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  BatchLevelSlotTotals,
  BatchPaymentSummaryRow,
  BatchPaymentSummaryTotals,
  LanguageLevelSlot,
  PaymentHubApiService,
} from './payment-hub-api.service';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentCurrencyPendingTotalsComponent } from './payment-currency-pending-totals.component';
import { fmtPaymentAmount, fmtPaymentAmountCompact } from './payment-currency.util';
import { PaymentCurrencyOverdueTotalsComponent } from './payment-currency-overdue-totals.component';
import { levelForJourneyDay, totalJourneyDaysForLevel } from './payment-journey-metrics.util';
import { BatchPaymentRow } from './payment-hub-batch-insights.component';
import {
  batchRowsToCsv,
  downloadBatchInsightsCsv,
  downloadBatchInsightsXlsx,
} from './payment-hub-batch-export.util';
import { sumBatchPaymentRows } from './payment-hub-batch-totals.util';
import {
  FinanceCohort,
  financeCohortLabel,
  formatStudentStatusLabel,
  parseFinanceCohortQuery,
} from './payment-hub-finance-cohort.util';

type BatchInsightFilter = '' | 'paid_full' | 'have_balance' | 'overdue' | 'paid_docs' | 'paid_visa';
type FinancePaymentScope = 'current_level' | 'all_language' | 'all_payment' | LanguageLevelSlot | 'DOCS';

interface FinanceCurrencyTotals {
  lkr: number;
  inr: number;
  usd: number;
}

function normBatchKey(name: string): string {
  return String(name || '').trim().toLowerCase();
}

function batchSortValue(batch: string): { numeric: number | null; label: string } {
  const label = String(batch || '').trim();
  const match = label.match(/\d+/);
  return {
    numeric: match ? Number(match[0]) : null,
    label: label.toLowerCase(),
  };
}

function compareBatchAscending(a: BatchPaymentRow, b: BatchPaymentRow): number {
  const left = batchSortValue(a.batch);
  const right = batchSortValue(b.batch);
  if (left.numeric != null && right.numeric != null && left.numeric !== right.numeric) {
    return left.numeric - right.numeric;
  }
  if (left.numeric != null && right.numeric == null) return -1;
  if (left.numeric == null && right.numeric != null) return 1;
  return left.label.localeCompare(right.label);
}

@Component({
  selector: 'app-payment-hub-finance-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyPendingTotalsComponent,
    PaymentCurrencyOverdueTotalsComponent,
  ],
  templateUrl: './payment-hub-finance-dashboard.component.html',
  styleUrls: [
    './payment-hub-insights-page.scss',
    './payment-hub-batch-insights.component.scss',
    './payment-hub-finance-dashboard.component.scss',
  ],
})
export class PaymentHubFinanceDashboardComponent implements OnInit {
  loading = true;
  batchRows: BatchPaymentRow[] = [];
  filterLevel = '';
  tableSearch = '';
  batchInsight: BatchInsightFilter = '';
  paymentScope: FinancePaymentScope = 'current_level';

  readonly scopeButtons: ReadonlyArray<{ value: FinancePaymentScope; label: string }> = [
    { value: 'current_level', label: 'Current Level' },
    { value: 'all_language', label: 'All Language Fees' },
    { value: 'all_payment', label: 'All Payment' },
  ];

  readonly slotScopeOptions: ReadonlyArray<{ value: FinancePaymentScope; label: string }> = [
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

  setPaymentScope(scope: FinancePaymentScope): void {
    this.paymentScope = scope;
  }
  /** Shared across all admins — only these batches appear on the finance dashboard. */
  visibleBatches: string[] = [];
  visibleBatchLevelStatuses: Record<string, string> = {};
  /** All batch names for cohort filters (from API — used by add-batch dropdown). */
  allBatchNames: string[] = [];
  batchesToAdd: string[] = [];
  savingVisibleBatches = false;
  triggeringReport: 'morning' | 'evening' | null = null;
  exporting = false;
  cohort: FinanceCohort = 'all';
  cohortStatus = '';
  /** Combined level + student status (e.g. `A1:ONGOING`). Empty = all levels. */
  levelStatusFilter = '';
  private urlCohortStatus = '';

  readonly levelStatusFilterOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: '', label: 'All levels' },
    ...(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).flatMap((level) =>
      (['ONGOING', 'COMPLETED'] as const).map((status) => ({
        value: `${level}:${status}`,
        label: `${level} ${formatStudentStatusLabel(status).toLowerCase()}`,
      })),
    ),
  ];

  readonly studentInsightOptions = [
    { value: '' as BatchInsightFilter, key: 'all', label: 'Total students', icon: 'groups', hint: 'Show all batches', color: 'slate', amountKind: 'expected' as const },
    { value: 'paid_full' as BatchInsightFilter, key: 'paid_full', label: 'Payment clear', icon: 'check_circle', hint: 'Batches with fully paid students', color: 'green', amountKind: 'received' as const },
    { value: 'have_balance' as BatchInsightFilter, key: 'have_balance', label: 'Remaining', icon: 'account_balance_wallet', hint: 'Batches with balance students', color: 'amber', amountKind: 'pending' as const },
    { value: 'overdue' as BatchInsightFilter, key: 'overdue', label: 'Overdue', icon: 'warning_amber', hint: 'Batches with overdue students', color: 'red', amountKind: 'overdue' as const },
    { value: 'paid_docs' as BatchInsightFilter, key: 'paid_docs', label: 'Paid docs', icon: 'description', hint: 'Batches with docs payment', color: 'teal', amountKind: 'docs' as const },
    { value: 'paid_visa' as BatchInsightFilter, key: 'paid_visa', label: 'Paid visa', icon: 'flight', hint: 'Batches with visa payment', color: 'indigo', amountKind: 'visa' as const },
  ] as const;

  private summaryRows: BatchPaymentSummaryRow[] = [];
  private batchDayByKey = new Map<string, number>();
  private batchTypeByKey = new Map<string, 'new' | 'old'>();

  private readonly PAYMENT_DATE_STORAGE_KEY = 'ph_finance_next_payment_dates';
  manualNextPaymentDates = new Map<string, string>();
  editingPaymentDateBatch: string | null = null;
  editingPaymentDateValue = '';
  /** Admin remarks per batch — shared across finance admins. */
  batchRemarks: Record<string, string> = {};
  private batchRemarkDrafts: Record<string, string> = {};
  savingRemarkBatch: string | null = null;
  remarkEditingBatch: string | null = null;
  manualCommencementAmounts: Record<string, { lkr?: number; inr?: number }> = {};
  editingCommencementAmountBatch: string | null = null;
  editingCommencementAmountLkr = '';
  editingCommencementAmountInr = '';
  savingCommencementAmountBatch: string | null = null;
  /** Catalog per-level fees (LKR/INR) for projected next-level collection. */
  private catalogFeesByLevel = new Map<string, { lkr: number; inr: number }>();

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.loadCatalogFees();
    this.route.queryParamMap.subscribe((params) => {
      const parsed = parseFinanceCohortQuery({
        cohort: params.get('cohort') ?? undefined,
        status: params.get('status') ?? undefined,
      });
      this.cohort = parsed.cohort;
      this.urlCohortStatus = parsed.status;
      if (!this.levelStatusFilter) {
        this.cohortStatus = parsed.status;
      }
      this.syncLevelStatusFilterFromState();
      this.load();
    });
  }

  private load(): void {
    this.loading = true;
    this.api.getFinanceVisibleBatches().subscribe({
      next: (res) => {
        this.visibleBatches = [...(res.data?.visibleBatches || [])];
        this.visibleBatchLevelStatuses = { ...(res.data?.visibleBatchLevelStatuses || {}) };
        this.applyManualPaymentDatesFromServer(res.data?.manualNextPaymentDates || {});
        this.applyBatchRemarksFromServer(res.data?.batchRemarks || {});
        this.manualCommencementAmounts = { ...(res.data?.manualCommencementAmounts || {}) };
        this.fetchBatchSummary();
      },
      error: () => {
        this.visibleBatches = [];
        this.visibleBatchLevelStatuses = {};
        this.loadManualPaymentDatesFromLocalStorage();
        this.fetchBatchSummary();
      },
    });
  }

  private fetchBatchSummary(): void {
    const params: Record<string, string> = {};
    if (this.filterLevel) params['level'] = this.filterLevel;
    if (this.cohort !== 'all') params['cohort'] = this.cohort;
    if (this.cohortStatus) params['studentStatus'] = this.cohortStatus;
    if (this.visibleBatches.length) {
      params['batches'] = this.visibleBatches.join(',');
    }

    this.api.getBatchPaymentSummary(params).subscribe({
      next: (summary) => {
        this.summaryRows = summary.data?.batches || [];
        this.allBatchNames = [...(summary.data?.batchNames || [])];
        this.ingestSummaryBatchMeta(this.summaryRows);
        this.applySummaryToView();
        this.loading = false;
      },
      error: () => {
        this.summaryRows = [];
        this.batchRows = [];
        this.allBatchNames = [];
        this.loading = false;
      },
    });
  }

  private ingestSummaryBatchMeta(rows: BatchPaymentSummaryRow[]): void {
    this.batchDayByKey.clear();
    this.batchTypeByKey.clear();
    for (const row of rows) {
      const label = (row.batch || '').trim();
      if (!label || label === '—') continue;
      const key = normBatchKey(label);
      if (row.batchCurrentDay != null && Number.isFinite(row.batchCurrentDay)) {
        this.batchDayByKey.set(key, row.batchCurrentDay);
      }
      if (row.batchType) {
        this.batchTypeByKey.set(key, row.batchType === 'old' ? 'old' : 'new');
      }
    }
  }

  get hasCohortFilter(): boolean {
    return this.cohort !== 'all' || !!this.cohortStatus;
  }

  get showPlanPaymentSummary(): boolean {
    return this.cohort !== 'all';
  }

  get pageTitle(): string {
    if (!this.hasCohortFilter && !this.filterLevel) return 'Finance Dashboard';
    if (this.filterLevel && this.cohortStatus) {
      return `${this.filterLevel} · ${formatStudentStatusLabel(this.cohortStatus)}`;
    }
    const parts = [financeCohortLabel(this.cohort)];
    if (this.cohortStatus) parts.push(formatStudentStatusLabel(this.cohortStatus));
    return parts.join(' · ');
  }

  get pageSubtitle(): string {
    if (!this.hasCohortFilter) {
      return 'Add batches to control what appears here for all admins and sub-admins. Payment totals and the table only include batches you add.';
    }
    return `Payment breakdown for ${this.cardTotals.studentCount} student(s) across added batches.`;
  }

  get paymentSummaryTotals(): {
    expected: FinanceCurrencyTotals;
    received: FinanceCurrencyTotals;
    pending: FinanceCurrencyTotals;
  } {
    const scoped = this.scopedMoneyAggregate();
    return {
      expected: scoped.expected,
      received: scoped.received,
      pending: scoped.pending,
    };
  }

  private rowFromSummary(row: BatchPaymentSummaryRow): BatchPaymentRow {
    const batch = (row.batch || '—').trim() || '—';
    const levelCounts = new Map<string, number>(Object.entries(row.levelCounts || {}).filter(([k]) => k));
    const batchLevel = this.dominantLevel(levelCounts);
    const key = normBatchKey(batch);
    const batchDay = this.batchDayByKey.get(key);
    const currentJourneyDay =
      batchDay != null && Number.isFinite(batchDay)
        ? Math.min(200, Math.max(1, Math.floor(batchDay)))
        : row.maxStudentDay ?? row.avgJourneyDay ?? null;

    return {
      batch,
      batchType: this.batchTypeByKey.get(key) ?? 'new',
      level: batchLevel,
      levelSummary: this.formatLevelSummary(levelCounts),
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
      currentJourneyDay,
      avgJourneyDay: row.avgJourneyDay ?? null,
      totalJourneyDays: batchLevel ? totalJourneyDaysForLevel(batchLevel) : null,
      collectionRateLKR: row.collectionRateLKR ?? null,
      overdueSince: row.overdueSince ?? null,
    };
  }

  private applySummaryToView(): void {
    const rows = this.summaryRows.map((row) => this.rowFromSummary(row));
    rows.sort(compareBatchAscending);
    this.batchRows = rows;
    this.pruneVisibleBatches();
  }

  private formatLevelSummary(counts: Map<string, number>): string {
    const parts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([lv, n]) => `${lv}: ${n}`);
    return parts.length ? parts.join(', ') : '—';
  }

  selectedLevelForBatch(batch: string): string {
    const [level] = String(this.visibleBatchLevelStatuses[batch] || '').split(':');
    return level || '';
  }

  selectedStatusForBatch(batch: string): string {
    const [, status] = String(this.visibleBatchLevelStatuses[batch] || '').split(':');
    return status ? formatStudentStatusLabel(status) : '';
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

  get batchOptions(): string[] {
    const fromSummary = this.allBatchNames.length
      ? this.allBatchNames
      : this.batchRows.map((r) => r.batch).filter((b) => b && b !== '—');
    return fromSummary;
  }

  get hasVisibleBatches(): boolean {
    return this.visibleBatches.length > 0;
  }

  get availableBatchesToAdd(): string[] {
    const visible = new Set(this.visibleBatches);
    return this.batchOptions.filter((b) => !visible.has(b));
  }

  get rowsInDashboard(): BatchPaymentRow[] {
    if (!this.visibleBatches.length) return [];
    const visible = new Set(this.visibleBatches);
    return this.batchRows.filter((r) => visible.has(r.batch));
  }

  get displayBatchRows(): BatchPaymentRow[] {
    let rows = this.rowsInDashboard;

    if (this.batchInsight) {
      rows = rows.filter((r) => this.batchMatchesInsight(r, this.batchInsight));
    }

    const q = this.tableSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.batch.toLowerCase().includes(q) ||
        (r.levelSummary || '').toLowerCase().includes(q) ||
        (r.level || '').toLowerCase().includes(q),
    );
  }

  private batchMatchesInsight(row: BatchPaymentRow, insight: BatchInsightFilter): boolean {
    switch (insight) {
      case 'paid_full':
        return row.fullyPaidStudents > 0;
      case 'have_balance':
        return row.balanceStudents > 0;
      case 'overdue':
        return row.overdueStudents > 0;
      case 'paid_docs':
        return row.docsPaidStudents > 0;
      case 'paid_visa':
        return row.visaPaidStudents > 0;
      default:
        return true;
    }
  }

  /** Summary numbers for top cards — only configured visible batches. */
  get cardTotals(): BatchPaymentSummaryTotals {
    return sumBatchPaymentRows(this.rowsInDashboard);
  }

  get totals(): BatchPaymentSummaryTotals {
    if (!this.batchInsight && !this.tableSearch.trim()) return this.cardTotals;
    return sumBatchPaymentRows(this.displayBatchRows);
  }

  insightCount(key: string): number {
    const t = this.cardTotals;
    switch (key) {
      case 'all':
        return t.studentCount;
      case 'paid_full':
        return t.fullyPaidStudents ?? 0;
      case 'have_balance':
        return t.balanceStudents ?? 0;
      case 'overdue':
        return t.overdueStudents ?? 0;
      case 'paid_docs':
        return t.docsPaidStudents ?? 0;
      case 'paid_visa':
        return t.visaPaidStudents ?? 0;
      default:
        return 0;
    }
  }

  studentPct(count: number, total: number): string {
    if (!total) return '0%';
    return `${Math.round((count / total) * 100)}%`;
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

  hasInsightAmount(key: string): boolean {
    const a = this.insightAmountsFor(key);
    return a.lkr > 0 || a.inr > 0 || a.usd > 0;
  }

  private rowsForCardTotals(): BatchPaymentRow[] {
    return this.rowsInDashboard;
  }

  private scopedMoneyAggregate(): {
    expected: FinanceCurrencyTotals;
    received: FinanceCurrencyTotals;
    pending: FinanceCurrencyTotals;
    overdue: FinanceCurrencyTotals;
  } {
    return this.rowsForCardTotals().reduce(
      (acc, r) => {
        const s = this.scopeTotalsFromRow(r);
        return {
          expected: {
            lkr: acc.expected.lkr + s.expected.lkr,
            inr: acc.expected.inr + s.expected.inr,
            usd: acc.expected.usd + s.expected.usd,
          },
          received: {
            lkr: acc.received.lkr + s.received.lkr,
            inr: acc.received.inr + s.received.inr,
            usd: acc.received.usd + s.received.usd,
          },
          pending: {
            lkr: acc.pending.lkr + s.pending.lkr,
            inr: acc.pending.inr + s.pending.inr,
            usd: acc.pending.usd + s.pending.usd,
          },
          overdue: {
            lkr: acc.overdue.lkr + s.overdue.lkr,
            inr: acc.overdue.inr + s.overdue.inr,
            usd: acc.overdue.usd + s.overdue.usd,
          },
        };
      },
      {
        expected: { lkr: 0, inr: 0, usd: 0 },
        received: { lkr: 0, inr: 0, usd: 0 },
        pending: { lkr: 0, inr: 0, usd: 0 },
        overdue: { lkr: 0, inr: 0, usd: 0 },
      },
    );
  }

  private insightAmountsFor(key: string): { lkr: number; inr: number; usd: number } {
    const scoped = this.scopedMoneyAggregate();
    const t = this.cardTotals;
    switch (key) {
      case 'all':
        return scoped.expected;
      case 'paid_full':
        return this.scopedReceivedForSettledRows();
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

  /** Sum received for rows with no outstanding balance in the active payment filter. */
  private scopedReceivedForSettledRows(): FinanceCurrencyTotals {
    return this.rowsForCardTotals().reduce(
      (acc, r) => {
        const s = this.scopeTotalsFromRow(r);
        const owed = s.pending.lkr + s.pending.inr + s.pending.usd + s.overdue.lkr + s.overdue.inr + s.overdue.usd;
        if (owed > 0) return acc;
        return {
          lkr: acc.lkr + s.received.lkr,
          inr: acc.inr + s.received.inr,
          usd: acc.usd + s.received.usd,
        };
      },
      { lkr: 0, inr: 0, usd: 0 },
    );
  }

  applyInsightFilter(insight: BatchInsightFilter): void {
    this.batchInsight = this.batchInsight === insight ? '' : insight;
  }

  private emptyCurrencyTotals(): FinanceCurrencyTotals {
    return { lkr: 0, inr: 0, usd: 0 };
  }

  private totalsFromSlot(slot: BatchLevelSlotTotals | null | undefined): {
    expected: FinanceCurrencyTotals;
    received: FinanceCurrencyTotals;
    pending: FinanceCurrencyTotals;
    overdue: FinanceCurrencyTotals;
  } {
    if (!slot) {
      const z = this.emptyCurrencyTotals();
      return { expected: z, received: z, pending: z, overdue: z };
    }
    return {
      expected: { lkr: slot.expectedLKR, inr: slot.expectedINR, usd: slot.expectedUSD },
      received: { lkr: slot.receivedLKR, inr: slot.receivedINR, usd: slot.receivedUSD },
      pending: { lkr: slot.pendingLKR, inr: slot.pendingINR, usd: slot.pendingUSD },
      overdue: { lkr: slot.overdueLKR, inr: slot.overdueINR, usd: slot.overdueUSD },
    };
  }

  private scopeTotalsFromRow(r: BatchPaymentRow): {
    expected: FinanceCurrencyTotals;
    received: FinanceCurrencyTotals;
    pending: FinanceCurrencyTotals;
    overdue: FinanceCurrencyTotals;
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
        const summed = this.sumLevelSlots(r);
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

  private sumLevelSlots(r: BatchPaymentRow): BatchLevelSlotTotals | null {
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

  rowExpected(r: BatchPaymentRow): FinanceCurrencyTotals {
    return this.scopeTotalsFromRow(r).expected;
  }

  rowReceived(r: BatchPaymentRow): FinanceCurrencyTotals {
    return this.scopeTotalsFromRow(r).received;
  }

  rowPending(r: BatchPaymentRow): FinanceCurrencyTotals {
    return this.scopeTotalsFromRow(r).pending;
  }

  rowOverdue(r: BatchPaymentRow): FinanceCurrencyTotals {
    return this.scopeTotalsFromRow(r).overdue;
  }

  /** Sum of pending amounts from all levels that came BEFORE the batch's current level. */
  rowPrevLevelsPending(r: BatchPaymentRow): FinanceCurrencyTotals {
    const levelOrder: LanguageLevelSlot[] = ['A1', 'A2', 'B1', 'B2'];
    const currentLevel = (r.level ?? '') as LanguageLevelSlot;
    const currentIdx = levelOrder.indexOf(currentLevel);
    if (currentIdx <= 0) return this.emptyCurrencyTotals();
    const prevLevels = levelOrder.slice(0, currentIdx);
    let lkr = 0, inr = 0, usd = 0;
    for (const lvl of prevLevels) {
      const slot = r.levelSlots?.[lvl];
      if (!slot) continue;
      lkr += slot.pendingLKR ?? 0;
      inr += slot.pendingINR ?? 0;
      usd += slot.pendingUSD ?? 0;
    }
    return { lkr, inr, usd };
  }

  isInsightActive(value: BatchInsightFilter): boolean {
    return this.batchInsight === value;
  }

  activeInsightLabel(): string {
    const opt = this.studentInsightOptions.find((o) => o.value === this.batchInsight);
    return opt?.label || '';
  }

  batchTypeLabel(type: 'new' | 'old'): string {
    return type === 'old' ? 'Old' : 'New';
  }

  journeyDayRatio(r: {
    currentJourneyDay?: number | null;
    avgJourneyDay?: number | null;
    totalJourneyDays?: number | null;
    level?: string | null;
  }): string {
    const cur = r.currentJourneyDay ?? r.avgJourneyDay;
    const total = r.totalJourneyDays;
    if (cur == null && (total == null || total === undefined)) return '—';
    return `${cur ?? '—'}/${total ?? '—'}`;
  }

  fmtPayment(n: number | null | undefined): string {
    return fmtPaymentAmount(n);
  }

  fmtCompact(n: number | null | undefined): string {
    return fmtPaymentAmountCompact(n);
  }

  commencementAmountLabels(info: { amountLKR: number; amountINR: number; amountUSD?: number }): string[] {
    const lines: string[] = [];
    if (info.amountLKR > 0) lines.push(`${this.fmtCompact(info.amountLKR)} LKR`);
    if (info.amountINR > 0) lines.push(`${this.fmtCompact(info.amountINR)} INR`);
    if ((info.amountUSD ?? 0) > 0) lines.push(`${this.fmtCompact(info.amountUSD!)} USD`);
    return lines;
  }

  rowHasOverdue(r: BatchPaymentRow): boolean {
    const o = this.rowOverdue(r);
    return o.lkr + o.inr + o.usd > 0 || !!r.overdueSince;
  }

  overdueDaysSince(iso?: string | null): number | null {
    if (!iso) return null;
    const since = new Date(iso);
    if (Number.isNaN(since.getTime())) return null;
    const today = new Date();
    const sinceUtc = Date.UTC(since.getFullYear(), since.getMonth(), since.getDate());
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.max(0, Math.floor((todayUtc - sinceUtc) / 86_400_000));
  }

  overdueDaysLabel(r: BatchPaymentRow): string {
    const days = this.overdueDaysSince(r.overdueSince);
    if (days == null) return '—';
    if (days === 0) return 'Today';
    if (days === 1) return '1 day';
    return `${days} days`;
  }

  formatOverdueSince(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  private loadCatalogFees(): void {
    this.api.getCatalogSettings().subscribe({
      next: (res) => {
        this.catalogFeesByLevel.clear();
        for (const row of res.data?.cefrRows || []) {
          const code = String(row.code || '').trim().toUpperCase();
          this.catalogFeesByLevel.set(code, {
            lkr: Number(row.lkr) || 0,
            inr: Number(row.inr) || 0,
          });
        }
      },
      error: () => {
        this.catalogFeesByLevel.clear();
      },
    });
  }

  /**
   * Projected collection for the next level:
   * (LKR students at current level × next-level LKR fee) + (INR students × next-level INR fee).
   * Per-currency student counts come from the CURRENT level slot only — never sum all historical levels.
   */
  private projectedNextLevelAmount(
    r: BatchPaymentRow,
    nextLevel: string | null,
  ): { lkr: number; inr: number; usd: number } {
    const students = r.studentCount || 0;
    if (!nextLevel || students <= 0) return { lkr: 0, inr: 0, usd: 0 };

    const nextFee = this.catalogFeesByLevel.get(nextLevel.toUpperCase());
    const currentLevel = (r.level ?? levelForJourneyDay(r.currentJourneyDay)) as string | null;
    const currentFee = currentLevel ? this.catalogFeesByLevel.get(currentLevel.toUpperCase()) : null;
    const currentSlot = currentLevel
      ? r.levelSlots?.[currentLevel.toUpperCase() as LanguageLevelSlot]
      : null;

    const currentExpectedLkr = currentSlot
      ? (currentSlot.expectedLKR ?? 0) ||
        (currentSlot.receivedLKR ?? 0) + (currentSlot.pendingLKR ?? 0) + (currentSlot.overdueLKR ?? 0)
      : 0;
    const currentExpectedInr = currentSlot
      ? (currentSlot.expectedINR ?? 0) ||
        (currentSlot.receivedINR ?? 0) + (currentSlot.pendingINR ?? 0) + (currentSlot.overdueINR ?? 0)
      : 0;

    let lkrStudents = 0;
    let inrStudents = 0;
    if (currentFee && currentFee.lkr > 0 && currentExpectedLkr > 0) {
      lkrStudents = Math.round(currentExpectedLkr / currentFee.lkr);
    }
    if (currentFee && currentFee.inr > 0 && currentExpectedInr > 0) {
      inrStudents = Math.round(currentExpectedInr / currentFee.inr);
    }

    if (nextFee) {
      let lkr = lkrStudents > 0 ? nextFee.lkr * lkrStudents : 0;
      let inr = inrStudents > 0 ? nextFee.inr * inrStudents : 0;

      // Last resort when slot/fee data is incomplete but batch clearly uses a currency
      if (lkr === 0 && inr === 0 && students > 0) {
        if (currentExpectedLkr > 0 && nextFee.lkr > 0) {
          lkr = nextFee.lkr * students;
        } else if (currentExpectedInr > 0 && nextFee.inr > 0) {
          inr = nextFee.inr * students;
        }
      }

      return { lkr, inr, usd: 0 };
    }

    // Catalog not loaded — scale from current-level slot per-student amounts
    if (currentSlot && students > 0) {
      const perLkr = (currentSlot.expectedLKR || 0) / students;
      const perInr = (currentSlot.expectedINR || 0) / students;
      return {
        lkr: currentExpectedLkr > 0 ? perLkr * lkrStudents : 0,
        inr: currentExpectedInr > 0 ? perInr * inrStudents : 0,
        usd: 0,
      };
    }

    return { lkr: 0, inr: 0, usd: 0 };
  }

  // ── Next Payment Date ──────────────────────────────────────────────────────

  private loadManualPaymentDatesFromLocalStorage(): void {
    try {
      const raw = localStorage.getItem(this.PAYMENT_DATE_STORAGE_KEY);
      if (raw) {
        const entries = Object.entries(JSON.parse(raw) as Record<string, string>);
        this.manualNextPaymentDates = new Map(entries);
      }
    } catch { /* ignore */ }
  }

  private applyManualPaymentDatesFromServer(dates: Record<string, string>): void {
    const serverEntries = Object.entries(dates || {}).filter(([, v]) => !!v);
    if (serverEntries.length) {
      this.manualNextPaymentDates = new Map(serverEntries);
      return;
    }
    this.loadManualPaymentDatesFromLocalStorage();
    if (this.manualNextPaymentDates.size) {
      this.migrateLocalManualDatesToServer();
    }
  }

  private migrateLocalManualDatesToServer(): void {
    for (const [batch, date] of this.manualNextPaymentDates.entries()) {
      this.api.updateFinanceBatchCommencementDate(batch, date).subscribe({ error: () => {} });
    }
  }

  startEditPaymentDate(batch: string, r?: BatchPaymentRow): void {
    this.editingPaymentDateBatch = batch;
    const manual = this.manualNextPaymentDates.get(batch);
    if (manual) {
      this.editingPaymentDateValue = manual;
      return;
    }
    this.editingPaymentDateValue = r ? (this.autoCommencementDateIso(r) ?? '') : '';
  }

  hasManualCommencementDate(batch: string): boolean {
    return this.manualNextPaymentDates.has(batch);
  }

  private autoCommencementDateIso(r: BatchPaymentRow): string | null {
    const currentDay = r.currentJourneyDay;
    const levelEndDay = r.totalJourneyDays;
    if (
      currentDay == null || !Number.isFinite(currentDay) || currentDay <= 0 ||
      levelEndDay == null || !Number.isFinite(levelEndDay)
    ) {
      return null;
    }

    const daysUntil = levelEndDay - currentDay;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + daysUntil);
    return d.toISOString().slice(0, 10);
  }

  saveManualPaymentDate(batch: string): void {
    if (!this.editingPaymentDateValue) return;
    const date = this.editingPaymentDateValue;
    this.api.updateFinanceBatchCommencementDate(batch, date).subscribe({
      next: (res) => {
        const dates = res.data?.manualNextPaymentDates || {};
        this.manualNextPaymentDates = new Map(Object.entries(dates));
        this.editingPaymentDateBatch = null;
        this.editingPaymentDateValue = '';
        this.snack.open('Commencement date saved.', 'OK', { duration: 2500 });
      },
      error: (err) => {
        this.snack.open(err?.error?.message || 'Could not save commencement date.', 'Dismiss', { duration: 4000 });
      },
    });
  }

  clearManualPaymentDate(batch: string): void {
    const row = this.displayBatchRows.find((r) => r.batch === batch);
    const isNew = row?.batchType === 'new';
    this.api.updateFinanceBatchCommencementDate(batch, null).subscribe({
      next: (res) => {
        const dates = res.data?.manualNextPaymentDates || {};
        this.manualNextPaymentDates = new Map(Object.entries(dates));
        this.snack.open(
          isNew ? 'Commencement date reset to auto-calculated.' : 'Commencement date removed.',
          'OK',
          { duration: 2500 },
        );
      },
      error: (err) => {
        this.snack.open(err?.error?.message || 'Could not remove commencement date.', 'Dismiss', { duration: 4000 });
      },
    });
  }

  cancelEditPaymentDate(): void {
    this.editingPaymentDateBatch = null;
    this.editingPaymentDateValue = '';
  }

  private applyBatchRemarksFromServer(remarks: Record<string, string>): void {
    this.batchRemarks = { ...(remarks || {}) };
    this.batchRemarkDrafts = { ...this.batchRemarks };
  }

  getBatchRemarkDraft(batch: string): string {
    return this.batchRemarkDrafts[batch] ?? this.batchRemarks[batch] ?? '';
  }

  hasBatchRemark(batch: string): boolean {
    return !!this.getBatchRemarkDisplay(batch);
  }

  getBatchRemarkDisplay(batch: string): string {
    return (this.batchRemarks[batch] ?? '').trim();
  }

  startEditBatchRemark(batch: string): void {
    if (this.remarkEditingBatch && this.remarkEditingBatch !== batch) {
      this.batchRemarkDrafts[this.remarkEditingBatch] = this.batchRemarks[this.remarkEditingBatch] ?? '';
    }
    this.remarkEditingBatch = batch;
    this.batchRemarkDrafts[batch] = this.batchRemarks[batch] ?? '';
  }

  cancelEditBatchRemark(batch: string): void {
    if (this.remarkEditingBatch !== batch) return;
    this.remarkEditingBatch = null;
    this.batchRemarkDrafts[batch] = this.batchRemarks[batch] ?? '';
  }

  onBatchRemarkInput(batch: string, value: string): void {
    this.batchRemarkDrafts[batch] = value;
  }

  saveBatchRemark(batch: string): void {
    const draft = (this.batchRemarkDrafts[batch] ?? '').trim();
    const saved = (this.batchRemarks[batch] ?? '').trim();
    if (draft === saved) {
      this.remarkEditingBatch = null;
      return;
    }
    if (this.savingRemarkBatch === batch) return;

    this.savingRemarkBatch = batch;
    this.api.updateFinanceBatchRemark(batch, draft || null).subscribe({
      next: (res) => {
        this.batchRemarks = { ...(res.data?.batchRemarks || {}) };
        this.batchRemarkDrafts = { ...this.batchRemarks };
        this.savingRemarkBatch = null;
        this.remarkEditingBatch = null;
      },
      error: (err) => {
        this.savingRemarkBatch = null;
        this.batchRemarkDrafts[batch] = this.batchRemarks[batch] ?? '';
        this.snack.open(err?.error?.message || 'Could not save remark.', 'Dismiss', { duration: 4000 });
      },
    });
  }

  startEditCommencementAmount(batch: string, info: { amountLKR: number; amountINR: number }): void {
    this.editingCommencementAmountBatch = batch;
    const manual = this.manualCommencementAmounts[batch];
    this.editingCommencementAmountLkr = manual?.lkr != null ? String(manual.lkr) : String(info.amountLKR || '');
    this.editingCommencementAmountInr = manual?.inr != null ? String(manual.inr) : String(info.amountINR || '');
  }

  cancelEditCommencementAmount(): void {
    this.editingCommencementAmountBatch = null;
    this.editingCommencementAmountLkr = '';
    this.editingCommencementAmountInr = '';
  }

  private parseAmountInput(raw: string): number | null {
    const cleaned = String(raw || '').replace(/,/g, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n);
  }

  saveCommencementAmount(batch: string): void {
    if (this.savingCommencementAmountBatch === batch) return;
    const lkr = this.parseAmountInput(this.editingCommencementAmountLkr);
    const inr = this.parseAmountInput(this.editingCommencementAmountInr);
    if (lkr == null && inr == null) {
      this.snack.open('Enter at least one amount (LKR or INR).', 'Dismiss', { duration: 3500 });
      return;
    }

    this.savingCommencementAmountBatch = batch;
    this.api.updateFinanceBatchCommencementAmount(batch, { lkr, inr }).subscribe({
      next: (res) => {
        this.manualCommencementAmounts = { ...(res.data?.manualCommencementAmounts || {}) };
        this.cancelEditCommencementAmount();
        this.savingCommencementAmountBatch = null;
        this.snack.open('Projected amount saved.', 'OK', { duration: 2500 });
      },
      error: (err) => {
        this.savingCommencementAmountBatch = null;
        this.snack.open(err?.error?.message || 'Could not save projected amount.', 'Dismiss', { duration: 4000 });
      },
    });
  }

  clearCommencementAmount(batch: string): void {
    if (this.savingCommencementAmountBatch === batch) return;
    this.savingCommencementAmountBatch = batch;
    this.api.updateFinanceBatchCommencementAmount(batch, null).subscribe({
      next: (res) => {
        this.manualCommencementAmounts = { ...(res.data?.manualCommencementAmounts || {}) };
        this.cancelEditCommencementAmount();
        this.savingCommencementAmountBatch = null;
        this.snack.open('Reset to auto-calculated amount.', 'OK', { duration: 2500 });
      },
      error: (err) => {
        this.savingCommencementAmountBatch = null;
        this.snack.open(err?.error?.message || 'Could not reset amount.', 'Dismiss', { duration: 4000 });
      },
    });
  }

  hasManualCommencementAmount(batch: string): boolean {
    const manual = this.manualCommencementAmounts[batch];
    return manual?.lkr != null || manual?.inr != null;
  }

  /**
   * Returns the level name that comes after the current level (A1→A2, A2→B1, B1→B2).
   * Returns null if already at B2 or beyond.
   */
  private nextLevelAfter(currentLevel: string | null | undefined): string | null {
    const map: Record<string, string> = { A1: 'A2', A2: 'B1', B1: 'B2' };
    return map[(currentLevel || '').toUpperCase()] ?? null;
  }

  /**
   * Commencement date: manual override if set; otherwise auto-calculated for new batches
   * (today + levelEndDay − currentJourneyDay) or manual-only for old batches.
   */
  getNextPaymentInfo(r: BatchPaymentRow): {
    dateStr: string;
    daysUntil: number;
    isPast: boolean;
    isNear: boolean;
    nextLevel: string | null;
    amountLKR: number;
    amountINR: number;
    amountUSD: number;
    isManualAmount: boolean;
    isManualDate: boolean;
    tooltip: string;
  } | null {
    let d: Date | null = null;
    const manualIso = this.manualNextPaymentDates.get(r.batch);
    const isManualDate = !!manualIso;

    if (manualIso) {
      d = new Date(manualIso);
      if (Number.isNaN(d.getTime())) return null;
    } else if (r.batchType === 'new') {
      const autoIso = this.autoCommencementDateIso(r);
      if (!autoIso) return null;
      d = new Date(autoIso);
    } else {
      return null;
    }

    const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const today = new Date();
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const dUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const daysUntil = Math.floor((dUtc - todayUtc) / 86_400_000);
    const isPast = daysUntil < 0;
    const isNear = !isPast && daysUntil < 5;

    const currentLevelResolved = r.level ?? levelForJourneyDay(r.currentJourneyDay);
    const nextLevel = this.nextLevelAfter(currentLevelResolved);

    const projected = this.projectedNextLevelAmount(r, nextLevel);
    const manual = this.manualCommencementAmounts[r.batch];
    const hasManualLkr = manual?.lkr != null;
    const hasManualInr = manual?.inr != null;
    const amountLKR = hasManualLkr ? manual!.lkr! : projected.lkr;
    const amountINR = hasManualInr ? manual!.inr! : projected.inr;
    const amountUSD = projected.usd;
    const isManualAmount = hasManualLkr || hasManualInr;

    const nextSlot = nextLevel ? r.levelSlots?.[nextLevel.toUpperCase() as LanguageLevelSlot] : null;
    const preCollectedLkr = nextSlot?.receivedLKR ?? 0;
    const preCollectedInr = nextSlot?.receivedINR ?? 0;
    const hasNextLevelRecords = nextSlot &&
      (preCollectedLkr + preCollectedInr +
       (nextSlot.pendingLKR ?? 0) + (nextSlot.pendingINR ?? 0) +
       (nextSlot.overdueLKR ?? 0) + (nextSlot.overdueINR ?? 0)) > 0;

    const tooltipParts: string[] = [];
    if (isManualDate) tooltipParts.push('Manual commencement date');
    if (nextLevel) tooltipParts.push(`Next level: ${nextLevel}`);
    if (isPast) {
      tooltipParts.push(`${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} ago`);
    } else if (daysUntil === 0) {
      tooltipParts.push('Due today');
    } else {
      tooltipParts.push(`${daysUntil} day${daysUntil === 1 ? '' : 's'} away`);
    }
    if (isManualAmount) {
      tooltipParts.push('Manual projected amount');
      if (!hasManualLkr || !hasManualInr) {
        const auto = projected;
        const autoParts: string[] = [];
        if (!hasManualLkr && auto.lkr > 0) autoParts.push(`LKR ${this.fmtPayment(auto.lkr)} auto`);
        if (!hasManualInr && auto.inr > 0) autoParts.push(`INR ${this.fmtPayment(auto.inr)} auto`);
        if (autoParts.length) tooltipParts.push(`Auto: ${autoParts.join(' · ')}`);
      }
    } else if (r.studentCount) {
      if (hasNextLevelRecords) {
        // Actual records exist — show collected vs total
        const parts: string[] = [];
        if (preCollectedLkr > 0 || (nextSlot?.pendingLKR ?? 0) > 0 || (nextSlot?.overdueLKR ?? 0) > 0) {
          const totalLkr = preCollectedLkr + (nextSlot?.pendingLKR ?? 0) + (nextSlot?.overdueLKR ?? 0);
          parts.push(`LKR ${this.fmtPayment(preCollectedLkr)} collected of ${this.fmtPayment(totalLkr)}`);
        }
        if (preCollectedInr > 0 || (nextSlot?.pendingINR ?? 0) > 0 || (nextSlot?.overdueINR ?? 0) > 0) {
          const totalInr = preCollectedInr + (nextSlot?.pendingINR ?? 0) + (nextSlot?.overdueINR ?? 0);
          parts.push(`INR ${this.fmtPayment(preCollectedInr)} collected of ${this.fmtPayment(totalInr)}`);
        }
        if (parts.length) tooltipParts.push(parts.join(' · '));
      } else {
        const fee = nextLevel ? this.catalogFeesByLevel.get(nextLevel.toUpperCase()) : null;
        if (fee && (fee.lkr > 0 || fee.inr > 0)) {
          const parts: string[] = [];
          if (fee.lkr > 0) parts.push(`LKR ${this.fmtPayment(fee.lkr)} each`);
          if (fee.inr > 0) parts.push(`INR ${this.fmtPayment(fee.inr)} each`);
          tooltipParts.push(`${r.studentCount} students × ${parts.join(' / ')} (est.)`);
        } else {
          tooltipParts.push(`${r.studentCount} students`);
        }
      }
    }
    const tooltip = tooltipParts.join(' · ');

    return { dateStr, daysUntil, isPast, isNear, nextLevel, amountLKR, amountINR, amountUSD, isManualAmount, isManualDate, tooltip };
  }

  private syncLevelStatusFilterFromState(): void {
    if (!this.filterLevel) {
      this.levelStatusFilter = '';
      return;
    }
    const status = this.cohortStatus || this.urlCohortStatus || 'ONGOING';
    const candidate = `${this.filterLevel}:${status}`;
    this.levelStatusFilter = this.levelStatusFilterOptions.some((o) => o.value === candidate)
      ? candidate
      : '';
  }

  activeLevelStatusLabel(): string {
    return this.levelStatusFilterOptions.find((o) => o.value === this.levelStatusFilter)?.label || '';
  }

  applyLevelStatusFilter(): void {
    if (!this.levelStatusFilter) {
      this.filterLevel = '';
      this.cohortStatus = this.urlCohortStatus;
    } else {
      const [level, status] = this.levelStatusFilter.split(':');
      this.filterLevel = level;
      this.cohortStatus = status;
    }
    this.pruneVisibleBatches();
    this.load();
  }

  addBatchesToDashboard(): void {
    if (!this.batchesToAdd.length || this.savingVisibleBatches) return;
    const next = [...new Set([...this.visibleBatches, ...this.batchesToAdd])];
    this.persistVisibleBatches(next, `Added ${this.batchesToAdd.length} batch(es) to the dashboard.`);
    this.batchesToAdd = [];
  }

  removeVisibleBatch(batch: string): void {
    if (this.savingVisibleBatches) return;
    const next = this.visibleBatches.filter((b) => b !== batch);
    this.persistVisibleBatches(next, `Removed "${batch}" from the dashboard.`);
  }

  private persistVisibleBatches(batches: string[], successMessage: string): void {
    this.savingVisibleBatches = true;
    this.api.updateFinanceVisibleBatches(batches).subscribe({
      next: (res) => {
        this.savingVisibleBatches = false;
        this.visibleBatches = [...(res.data?.visibleBatches || batches)];
        this.visibleBatchLevelStatuses = { ...(res.data?.visibleBatchLevelStatuses || this.visibleBatchLevelStatuses) };
        this.snack.open(successMessage, 'OK', { duration: 3500 });
      },
      error: (err) => {
        this.savingVisibleBatches = false;
        this.snack.open(err?.error?.message || 'Could not update dashboard batches.', 'Dismiss', { duration: 4500 });
      },
    });
  }

  private pruneVisibleBatches(): void {
    this.batchesToAdd = this.batchesToAdd.filter((b) => this.availableBatchesToAdd.includes(b));
  }

  private rowsForExport(rows: BatchPaymentRow[]): BatchPaymentRow[] {
    return rows.map((r) => {
      const scoped = this.scopeTotalsFromRow(r);
      return {
        ...r,
        totalExpectedLKR: scoped.expected.lkr,
        totalExpectedINR: scoped.expected.inr,
        totalExpectedUSD: scoped.expected.usd,
        totalPaidLKR: scoped.received.lkr,
        totalPaidINR: scoped.received.inr,
        totalPaidUSD: scoped.received.usd,
        totalPendingLKR: scoped.pending.lkr,
        totalPendingINR: scoped.pending.inr,
        totalPendingUSD: scoped.pending.usd,
        totalOverdueLKR: scoped.overdue.lkr,
        totalOverdueINR: scoped.overdue.inr,
        totalOverdueUSD: scoped.overdue.usd,
      };
    });
  }

  triggerEmailReport(type: 'morning' | 'evening'): void {
    if (this.triggeringReport) return;
    this.triggeringReport = type;
    this.api.triggerFinanceReport(type).subscribe({
      next: () => {
        this.triggeringReport = null;
        const label = type === 'morning' ? '10 AM morning' : '6 PM evening';
        this.snack.open(`✅ ${label} report sent to finance team!`, 'OK', { duration: 5000 });
      },
      error: (err) => {
        this.triggeringReport = null;
        const msg = err?.error?.message || err?.message || 'Failed to send report.';
        this.snack.open(`Report failed: ${msg}`, 'Dismiss', { duration: 5000 });
      },
    });
  }

  exportBatches(format: 'xlsx' | 'csv', scope: 'all' | 'visible'): void {
    if (this.exporting) return;
    let rows: BatchPaymentRow[];
    if (scope === 'visible') {
      rows = this.displayBatchRows;
    } else {
      rows = this.rowsInDashboard;
    }
    if (!rows.length) {
      this.snack.open('No batches to export. Add batches to the dashboard first.', 'Dismiss', { duration: 3500 });
      return;
    }
    rows = this.rowsForExport(rows);
    const formatters = {
      journeyDay: (r: BatchPaymentRow) => this.journeyDayRatio(r),
      batchType: (t: 'new' | 'old') => this.batchTypeLabel(t),
    };
    const date = new Date().toISOString().slice(0, 10);
    const slug = [this.filterLevel, this.cohort, this.cohortStatus].filter(Boolean).join('-') || 'dashboard';
    const base = `finance-dashboard-${scope}-${slug}-${date}`;
    if (format === 'xlsx') {
      downloadBatchInsightsXlsx(base, rows, formatters);
    } else {
      downloadBatchInsightsCsv(base, batchRowsToCsv(rows, formatters));
    }
    this.snack.open(`Exported ${rows.length} batch(es)`, 'OK', { duration: 4000 });
  }

  openBatchStudents(batch: string): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree([
        '/admin/payment-hub/insights/batches',
        encodeURIComponent(batch),
        'students',
      ]),
    );
    window.open(url, '_blank');
  }
}
