import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';
import {
  BatchLevelSlotTotals,
  BatchPaymentSummaryRow,
  BatchPaymentSummaryTotals,
  LanguageLevelSlot,
  PaymentHubApiService,
} from './payment-hub-api.service';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentCurrencyPendingTotalsComponent } from './payment-currency-pending-totals.component';
import { PaymentCurrencyOverdueTotalsComponent } from './payment-currency-overdue-totals.component';
import { totalJourneyDaysForLevel } from './payment-journey-metrics.util';
import { BatchPaymentRow } from './payment-hub-batch-insights.component';
import {
  batchRowsToCsv,
  downloadBatchInsightsCsv,
  downloadBatchInsightsXlsx,
} from './payment-hub-batch-export.util';
import { sumBatchPaymentRows } from './payment-hub-batch-totals.util';
import {
  deleteFinanceBatchPreset,
  FinanceBatchPreset,
  loadFinanceBatchPresets,
  saveFinanceBatchPreset,
} from './payment-hub-finance-batch-presets.util';

interface BatchJourneySummary {
  batchName: string;
  batchCurrentDay: number;
  batchType?: 'new' | 'old';
}

type BatchInsightFilter = '' | 'paid_full' | 'have_balance' | 'overdue' | 'paid_docs' | 'paid_visa';
type FinancePaymentFilter = LanguageLevelSlot | 'all_language' | 'all_payment';

interface FinanceCurrencyTotals {
  lkr: number;
  inr: number;
  usd: number;
}

function normBatchKey(name: string): string {
  return String(name || '').trim().toLowerCase();
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
  apiTotals: BatchPaymentSummaryTotals | null = null;
  filterLevel = '';
  tableSearch = '';
  batchInsight: BatchInsightFilter = '';
  /** Default: all language fee slots combined (A1–B2). */
  paymentFilter: FinancePaymentFilter = 'all_language';
  readonly paymentFilterOptions: ReadonlyArray<{ value: FinancePaymentFilter; label: string; group?: 'level' | 'summary' }> = [
    { value: 'A1', label: 'A1', group: 'level' },
    { value: 'A2', label: 'A2', group: 'level' },
    { value: 'B1', label: 'B1', group: 'level' },
    { value: 'B2', label: 'B2', group: 'level' },
    { value: 'all_language', label: 'All language fees', group: 'summary' },
    { value: 'all_payment', label: 'All payment', group: 'summary' },
  ];
  selectedBatches: string[] = [];
  savedPresets: FinanceBatchPreset[] = [];
  activePresetName = '';
  presetNameInput = '';
  showPresetSaveInput = false;
  exporting = false;

  readonly levels = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly levelLabels = ['All levels', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  readonly studentInsightOptions = [
    { value: '' as BatchInsightFilter, key: 'all', label: 'Total students', icon: 'groups', hint: 'Show all batches', color: 'slate', amountKind: 'expected' as const },
    { value: 'paid_full' as BatchInsightFilter, key: 'paid_full', label: 'Paid full', icon: 'check_circle', hint: 'Batches with fully paid students', color: 'green', amountKind: 'received' as const },
    { value: 'have_balance' as BatchInsightFilter, key: 'have_balance', label: 'Have balance', icon: 'account_balance_wallet', hint: 'Batches with balance students', color: 'amber', amountKind: 'pending' as const },
    { value: 'overdue' as BatchInsightFilter, key: 'overdue', label: 'Overdue', icon: 'warning_amber', hint: 'Batches with overdue students', color: 'red', amountKind: 'overdue' as const },
    { value: 'paid_docs' as BatchInsightFilter, key: 'paid_docs', label: 'Paid docs', icon: 'description', hint: 'Batches with docs payment', color: 'teal', amountKind: 'docs' as const },
    { value: 'paid_visa' as BatchInsightFilter, key: 'paid_visa', label: 'Paid visa', icon: 'flight', hint: 'Batches with visa payment', color: 'indigo', amountKind: 'visa' as const },
  ] as const;

  private summaryRows: BatchPaymentSummaryRow[] = [];
  private batchDayByKey = new Map<string, number>();
  private batchTypeByKey = new Map<string, 'new' | 'old'>();

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly http: HttpClient,
    private readonly router: Router,
    private readonly snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.savedPresets = loadFinanceBatchPresets();
    this.load();
  }

  load(): void {
    this.loading = true;
    const params: Record<string, string> = {};
    if (this.filterLevel) params['level'] = this.filterLevel;

    this.api.getBatchPaymentSummary(params).subscribe({
      next: (summary) => {
        this.summaryRows = summary.data?.batches || [];
        this.apiTotals = summary.data?.totals ?? null;
        this.applySummaryToView();
        this.loading = false;
        this.loadJourneyMeta();
      },
      error: () => {
        this.summaryRows = [];
        this.apiTotals = null;
        this.batchRows = [];
        this.loading = false;
      },
    });
  }

  private loadJourneyMeta(): void {
    this.http
      .get<{ batches: BatchJourneySummary[]; upcomingBatches?: BatchJourneySummary[] }>(
        `${environment.apiUrl}/batch-journey`,
        { withCredentials: true },
      )
      .subscribe({
        next: (journey) => {
          this.ingestJourneyBatches([...(journey.batches || []), ...(journey.upcomingBatches || [])]);
          this.applySummaryToView();
        },
        error: () => {},
      });
  }

  private ingestJourneyBatches(list: BatchJourneySummary[]): void {
    this.batchDayByKey.clear();
    this.batchTypeByKey.clear();
    for (const b of list) {
      const label = (b.batchName || '').trim();
      if (!label) continue;
      const key = normBatchKey(label);
      this.batchDayByKey.set(key, b.batchCurrentDay);
      this.batchTypeByKey.set(key, String(b.batchType || '').toLowerCase() === 'old' ? 'old' : 'new');
    }
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
    rows.sort((a, b) => b.totalPaidLKR - a.totalPaidLKR || b.totalPaidINR - a.totalPaidINR);
    this.batchRows = rows;
    this.pruneSelectedBatches();
  }

  private formatLevelSummary(counts: Map<string, number>): string {
    const parts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([lv, n]) => `${lv}: ${n}`);
    return parts.length ? parts.join(', ') : '—';
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
    return this.batchRows.map((r) => r.batch).filter((b) => b && b !== '—');
  }

  get hasBatchSelection(): boolean {
    return this.selectedBatches.length > 0;
  }

  get filteredBatchRows(): BatchPaymentRow[] {
    if (!this.selectedBatches.length) return this.batchRows;
    const selected = new Set(this.selectedBatches);
    return this.batchRows.filter((r) => selected.has(r.batch));
  }

  get displayBatchRows(): BatchPaymentRow[] {
    let rows = this.filteredBatchRows;

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

  /** Summary numbers for top cards — reflects level + batch selection, not insight/search. */
  get cardTotals(): BatchPaymentSummaryTotals {
    if (this.hasBatchSelection) return sumBatchPaymentRows(this.filteredBatchRows);
    if (this.apiTotals) return this.apiTotals;
    return sumBatchPaymentRows(this.batchRows);
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
    return this.hasBatchSelection ? this.filteredBatchRows : this.batchRows;
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
        return this.paymentFilter === 'all_payment'
          ? {
              lkr: t.insightPaidFullLKR ?? 0,
              inr: t.insightPaidFullINR ?? 0,
              usd: t.insightPaidFullUSD ?? 0,
            }
          : this.scopedReceivedForSettledRows();
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

  setPaymentFilter(filter: FinancePaymentFilter): void {
    this.paymentFilter = filter;
  }

  paymentFilterLabel(): string {
    return this.paymentFilterOptions.find((o) => o.value === this.paymentFilter)?.label ?? 'All language fees';
  }

  paymentFilterHint(): string {
    switch (this.paymentFilter) {
      case 'all_payment':
        return 'All payment types — language, docs, visa, etc.';
      case 'all_language':
        return 'All language fees (A1–B2). Received + Pending = Total payment per batch.';
      default:
        return `${this.paymentFilter} fee only. Received is capped at catalog fee; Pending is still owed.`;
    }
  }

  isPaymentFilterActive(value: FinancePaymentFilter): boolean {
    return this.paymentFilter === value;
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
    if (this.paymentFilter === 'all_payment') {
      return {
        expected: {
          lkr: r.fullExpectedLKR,
          inr: r.fullExpectedINR,
          usd: r.fullExpectedUSD,
        },
        received: { lkr: r.totalPaidLKR, inr: r.totalPaidINR, usd: r.totalPaidUSD },
        pending: { lkr: r.fullPendingLKR, inr: r.fullPendingINR, usd: r.fullPendingUSD },
        overdue: { lkr: r.fullOverdueLKR, inr: r.fullOverdueINR, usd: r.fullOverdueUSD },
      };
    }
    if (this.paymentFilter === 'all_language') {
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
    const slot = this.totalsFromSlot(r.levelSlots?.[this.paymentFilter]);
    if (this.slotTotalsEmpty(slot) && this.batchRowMatchesLevel(r, this.paymentFilter)) {
      return {
        expected: { lkr: r.totalExpectedLKR, inr: r.totalExpectedINR, usd: r.totalExpectedUSD },
        received: { lkr: r.langPaidLKR, inr: r.langPaidINR, usd: r.langPaidUSD },
        pending: { lkr: r.totalPendingLKR, inr: r.totalPendingINR, usd: r.totalPendingUSD },
        overdue: { lkr: r.totalOverdueLKR, inr: r.totalOverdueINR, usd: r.totalOverdueUSD },
      };
    }
    return slot;
  }

  private batchRowMatchesLevel(r: BatchPaymentRow, level: LanguageLevelSlot): boolean {
    if (r.level === level) return true;
    const summary = (r.levelSummary || '').toUpperCase();
    return summary.includes(`${level}:`) || summary.startsWith(level);
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

  private slotTotalsEmpty(t: {
    expected: FinanceCurrencyTotals;
    received: FinanceCurrencyTotals;
    pending: FinanceCurrencyTotals;
    overdue: FinanceCurrencyTotals;
  }): boolean {
    const sum = (c: FinanceCurrencyTotals) => c.lkr + c.inr + c.usd;
    return sum(t.expected) + sum(t.received) + sum(t.pending) + sum(t.overdue) <= 0;
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

  applyLevelFilter(): void {
    this.pruneSelectedBatches();
    this.load();
  }

  onBatchSelectionChange(): void {
    this.activePresetName = '';
    this.pruneSelectedBatches();
  }

  clearBatchSelection(): void {
    this.selectedBatches = [];
    this.activePresetName = '';
    this.presetNameInput = '';
    this.showPresetSaveInput = false;
  }

  openSavePreset(): void {
    if (!this.selectedBatches.length) {
      this.snack.open('Select at least one batch to save.', 'Dismiss', { duration: 3500 });
      return;
    }
    this.showPresetSaveInput = true;
    this.presetNameInput = this.activePresetName || '';
  }

  cancelSavePreset(): void {
    this.showPresetSaveInput = false;
    this.presetNameInput = '';
  }

  confirmSavePreset(): void {
    const name = this.presetNameInput.trim();
    if (!name) {
      this.snack.open('Enter a name for this batch view.', 'Dismiss', { duration: 3500 });
      return;
    }
    if (!this.selectedBatches.length) {
      this.snack.open('Select at least one batch to save.', 'Dismiss', { duration: 3500 });
      return;
    }
    this.savedPresets = saveFinanceBatchPreset(name, this.selectedBatches);
    this.activePresetName = name;
    this.showPresetSaveInput = false;
    this.snack.open(`Saved "${name}" (${this.selectedBatches.length} batches)`, 'OK', { duration: 4000 });
  }

  applySavedPreset(name: string): void {
    if (!name) {
      this.activePresetName = '';
      return;
    }
    const preset = this.savedPresets.find((p) => p.name === name);
    if (!preset) {
      this.activePresetName = '';
      return;
    }
    this.activePresetName = name;
    this.selectedBatches = this.batchOptions.filter((b) => preset.batches.includes(b));
    if (!this.selectedBatches.length) {
      this.snack.open(`Preset "${name}" has no matching batches in the current data.`, 'Dismiss', {
        duration: 4500,
      });
    }
  }

  deleteActivePreset(): void {
    if (!this.activePresetName) return;
    const name = this.activePresetName;
    this.savedPresets = deleteFinanceBatchPreset(name);
    this.activePresetName = '';
    this.snack.open(`Deleted preset "${name}"`, 'OK', { duration: 3500 });
  }

  private pruneSelectedBatches(): void {
    const available = new Set(this.batchOptions);
    this.selectedBatches = this.selectedBatches.filter((b) => available.has(b));
    if (this.activePresetName) {
      const preset = this.savedPresets.find((p) => p.name === this.activePresetName);
      if (!preset) {
        this.activePresetName = '';
        return;
      }
      this.selectedBatches = this.batchOptions.filter((b) => preset.batches.includes(b));
    }
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

  exportBatches(format: 'xlsx' | 'csv', scope: 'all' | 'selected' | 'visible'): void {
    if (this.exporting) return;
    let rows: BatchPaymentRow[];
    if (scope === 'selected') {
      if (!this.selectedBatches.length) {
        this.snack.open('Select at least one batch to export.', 'Dismiss', { duration: 3500 });
        return;
      }
      const selected = new Set(this.selectedBatches);
      rows = this.batchRows.filter((r) => selected.has(r.batch));
    } else if (scope === 'visible') {
      rows = this.displayBatchRows;
    } else {
      rows = this.batchRows;
    }
    if (!rows.length) {
      this.snack.open('No batches to export.', 'Dismiss', { duration: 3500 });
      return;
    }
    rows = this.rowsForExport(rows);
    const formatters = {
      journeyDay: (r: BatchPaymentRow) => this.journeyDayRatio(r),
      batchType: (t: 'new' | 'old') => this.batchTypeLabel(t),
    };
    const date = new Date().toISOString().slice(0, 10);
    const slug = [this.filterLevel, this.activePresetName].filter(Boolean).join('-') || 'all';
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
