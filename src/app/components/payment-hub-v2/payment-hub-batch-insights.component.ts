import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { environment } from '../../../environments/environment';
import {
  BatchLevelSlotTotals,
  BatchPaymentSummaryRow,
  BatchPaymentSummaryTotals,
  CurrencyPaidTotals,
  LanguageLevelSlot,
  PaymentHubApiService,
} from './payment-hub-api.service';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentCurrencyPendingTotalsComponent } from './payment-currency-pending-totals.component';
import { PaymentCurrencyOverdueTotalsComponent } from './payment-currency-overdue-totals.component';
import { fmtPaymentAmountCompact } from './payment-currency.util';
import { totalJourneyDaysForLevel } from './payment-journey-metrics.util';
import {
  batchRowsToCsv,
  downloadBatchInsightsCsv,
  downloadBatchInsightsXlsx,
} from './payment-hub-batch-export.util';

interface BatchJourneySummary {
  batchName: string;
  batchCurrentDay: number;
  batchType?: 'new' | 'old';
  hasSavedConfig?: boolean;
}

export interface BatchPaymentRow extends CurrencyPaidTotals {
  batch: string;
  batchType: 'new' | 'old';
  level: string | null;
  levelSummary: string;
  studentCount: number;
  totalPaid: number;
  totalPendingLKR: number;
  totalPendingINR: number;
  totalPendingUSD: number;
  totalOverdueLKR: number;
  totalOverdueINR: number;
  totalOverdueUSD: number;
  totalExpectedLKR: number;
  totalExpectedINR: number;
  totalExpectedUSD: number;
  langPaidLKR: number;
  langPaidINR: number;
  langPaidUSD: number;
  fullPendingLKR: number;
  fullPendingINR: number;
  fullPendingUSD: number;
  fullOverdueLKR: number;
  fullOverdueINR: number;
  fullOverdueUSD: number;
  fullExpectedLKR: number;
  fullExpectedINR: number;
  fullExpectedUSD: number;
  levelSlots: Partial<Record<LanguageLevelSlot, BatchLevelSlotTotals>>;
  allLanguageFees: BatchLevelSlotTotals | null;
  totalDueLKR: number;
  totalDueINR: number;
  totalDueUSD: number;
  fullyPaidStudents: number;
  balanceStudents: number;
  overdueStudents: number;
  docsPaidStudents: number;
  visaPaidStudents: number;
  insightPaidFullLKR: number;
  insightPaidFullINR: number;
  insightPaidFullUSD: number;
  insightBalanceLKR: number;
  insightBalanceINR: number;
  insightBalanceUSD: number;
  insightOverdueLKR: number;
  insightOverdueINR: number;
  insightOverdueUSD: number;
  insightDocsLKR: number;
  insightDocsINR: number;
  insightDocsUSD: number;
  insightVisaLKR: number;
  insightVisaINR: number;
  insightVisaUSD: number;
  currentJourneyDay: number | null;
  avgJourneyDay: number | null;
  totalJourneyDays: number | null;
  collectionRateLKR: number | null;
  overdueSince: string | null;
}

function normBatchKey(name: string): string {
  return String(name || '').trim().toLowerCase();
}

@Component({
  selector: 'app-payment-hub-batch-insights',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButtonModule,
    MatMenuModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatInputModule,
    NgChartsModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyPendingTotalsComponent,
    PaymentCurrencyOverdueTotalsComponent,
  ],
  templateUrl: './payment-hub-batch-insights.component.html',
  styleUrls: ['./payment-hub-insights-page.scss', './payment-hub-batch-insights.component.scss'],
})
export class PaymentHubBatchInsightsComponent implements OnInit {
  loading = true;
  totalStudents = 0;
  batchRows: BatchPaymentRow[] = [];
  apiTotals: BatchPaymentSummaryTotals | null = null;
  filterLevel = '';
  filterBatch = '';
  filterBatchType = '';
  includeTestAccounts = false;
  tableSearch = '';
  exporting = false;
  batchOptions: string[] = [];
  selectedBatches = new Set<string>();
  showDetailsPanel = false;

  readonly skeletonCards = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly skeletonTableRows = [1, 2, 3, 4, 5, 6, 7, 8];

  private summaryRows: BatchPaymentSummaryRow[] = [];
  private batchDayByKey = new Map<string, number>();
  private batchTypeByKey = new Map<string, 'new' | 'old'>();

  readonly levels = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly levelLabels = ['All levels', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly batchTypeOptions: { value: string; label: string }[] = [
    { value: '', label: 'All batch types' },
    { value: 'new', label: 'New batch (modular)' },
    { value: 'old', label: 'Old batch (classes only)' },
  ];

  barChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  barChartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'bottom' },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { stacked: false, grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0 } },
      y: {
        stacked: false,
        grid: { color: 'rgba(148,163,184,0.2)' },
        ticks: { callback: (v) => Number(v).toLocaleString('sr-Latn-RS') },
      },
    },
  };

  healthChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  healthChartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: { legend: { display: true, position: 'bottom' } },
    scales: {
      x: { stacked: true, grid: { color: 'rgba(148,163,184,0.15)' } },
      y: { stacked: true, grid: { display: false } },
    },
  };

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly http: HttpClient,
    private readonly router: Router,
    private readonly snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    const params: Record<string, string> = {};
    if (this.filterLevel) params['level'] = this.filterLevel;
    if (this.filterBatch) params['batch'] = this.filterBatch;
    if (this.includeTestAccounts) params['includeTestAccounts'] = 'true';

    this.api.getBatchPaymentSummary(params).subscribe({
      next: (summary) => {
        this.summaryRows = summary.data?.batches || [];
        this.totalStudents = summary.data?.totalStudents ?? 0;
        this.apiTotals = summary.data?.totals ?? null;
        this.applySummaryToView();
        this.pruneSelection();
        this.loading = false;
        this.loadJourneyMeta();
      },
      error: () => {
        this.summaryRows = [];
        this.totalStudents = 0;
        this.apiTotals = null;
        this.batchRows = [];
        this.batchOptions = [];
        this.batchDayByKey.clear();
        this.batchTypeByKey.clear();
        this.selectedBatches.clear();
        this.showDetailsPanel = false;
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
          this.pruneSelection();
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
      this.batchTypeByKey.set(key, this.normalizeBatchTypeValue(b.batchType));
    }
  }

  private normalizeBatchTypeValue(type?: string | null): 'new' | 'old' {
    return String(type || '').toLowerCase() === 'old' ? 'old' : 'new';
  }

  private batchMatchesTypeFilter(batchLabel: string): boolean {
    if (!this.filterBatchType) return true;
    return this.batchTypeByKey.get(normBatchKey(batchLabel)) === this.filterBatchType;
  }

  journeyDayRatio(r: {
    currentJourneyDay?: number | null;
    avgJourneyDay?: number | null;
    totalJourneyDays?: number | null;
  }): string {
    const cur = r.currentJourneyDay ?? r.avgJourneyDay;
    const total = r.totalJourneyDays;
    if (cur == null && (total == null || total === undefined)) return '—';
    return `${cur ?? '—'}/${total ?? '—'}`;
  }

  batchTypeLabel(type: 'new' | 'old'): string {
    return type === 'old' ? 'Old' : 'New';
  }

  collectionLabel(rate: number | null | undefined): string {
    if (rate == null || !Number.isFinite(rate)) return '—';
    return `${rate}%`;
  }

  collectionClass(rate: number | null | undefined): string {
    if (rate == null) return 'ph-collection--na';
    if (rate >= 80) return 'ph-collection--good';
    if (rate >= 50) return 'ph-collection--mid';
    return 'ph-collection--low';
  }

  collectedPctClass(rate: number | null | undefined): string {
    if (rate == null) return 'ph-pct--na';
    if (rate >= 80) return 'ph-pct--good';
    if (rate >= 50) return 'ph-pct--mid';
    return 'ph-pct--low';
  }

  outstandingPctClass(rate: number | null | undefined): string {
    if (rate == null) return 'ph-pct--na';
    if (rate <= 20) return 'ph-pct--good';
    if (rate <= 50) return 'ph-pct--mid';
    return 'ph-pct--low';
  }

  studentPct(count: number, total: number): string {
    if (!total) return '0%';
    return `${Math.round((count / total) * 100)}%`;
  }

  private rowFromSummary(row: BatchPaymentSummaryRow): BatchPaymentRow {
    const batch = (row.batch || '—').trim() || '—';
    const levelCounts = new Map<string, number>(
      Object.entries(row.levelCounts || {}).filter(([k]) => k),
    );
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
    const optionSet = new Set<string>();
    const rows: BatchPaymentRow[] = [];

    for (const row of this.summaryRows) {
      const batch = (row.batch || '—').trim() || '—';
      if (!this.batchMatchesTypeFilter(batch)) continue;
      if (batch !== '—') optionSet.add(batch);
      rows.push(this.rowFromSummary(row));
    }

    rows.sort((a, b) => b.totalPaidLKR - a.totalPaidLKR || b.totalPaidINR - a.totalPaidINR);
    this.batchRows = rows;
    this.batchOptions = [...optionSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (this.filterBatch && !this.batchOptions.includes(this.filterBatch)) {
      this.filterBatch = '';
    }
    this.buildCharts(rows);
  }

  private buildCharts(rows: BatchPaymentRow[]): void {
    const top = rows.slice(0, 12);
    this.barChartData = {
      labels: top.map((t) => t.batch),
      datasets: [
        {
          label: 'Received (LKR)',
          data: top.map((t) => t.totalPaidLKR),
          backgroundColor: 'rgba(16, 185, 129, 0.85)',
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Outstanding (LKR)',
          data: top.map((t) => t.totalDueLKR),
          backgroundColor: 'rgba(245, 158, 11, 0.75)',
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    };

    const healthTop = rows.slice(0, 10);
    this.healthChartData = {
      labels: healthTop.map((t) => t.batch),
      datasets: [
        {
          label: 'Paid full',
          data: healthTop.map((t) => t.fullyPaidStudents),
          backgroundColor: 'rgba(16, 185, 129, 0.9)',
        },
        {
          label: 'Have balance',
          data: healthTop.map((t) => t.balanceStudents),
          backgroundColor: 'rgba(245, 158, 11, 0.85)',
        },
        {
          label: 'Overdue',
          data: healthTop.map((t) => t.overdueStudents),
          backgroundColor: 'rgba(244, 63, 94, 0.85)',
        },
      ],
    };
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

  private pruneSelection(): void {
    const visible = new Set(this.batchRows.map((r) => r.batch));
    for (const b of [...this.selectedBatches]) {
      if (!visible.has(b)) this.selectedBatches.delete(b);
    }
    if (!this.selectedBatches.size) this.showDetailsPanel = false;
  }

  get activeRows(): BatchPaymentRow[] {
    return this.showDetailsPanel ? this.selectedBatchRows : this.batchRows;
  }

  /** Rows shown in the table (local search on batch name / levels). */
  get displayBatchRows(): BatchPaymentRow[] {
    const q = this.tableSearch.trim().toLowerCase();
    if (!q) return this.batchRows;
    return this.batchRows.filter(
      (r) =>
        r.batch.toLowerCase().includes(q) ||
        (r.levelSummary || '').toLowerCase().includes(q) ||
        (r.level || '').toLowerCase().includes(q),
    );
  }

  batchRank(row: BatchPaymentRow): number {
    return this.batchRows.indexOf(row) + 1;
  }

  get selectedBatchRows(): BatchPaymentRow[] {
    return this.batchRows.filter((r) => this.selectedBatches.has(r.batch));
  }

  get allVisibleSelected(): boolean {
    const rows = this.displayBatchRows;
    return rows.length > 0 && rows.every((r) => this.selectedBatches.has(r.batch));
  }

  get someVisibleSelected(): boolean {
    const rows = this.displayBatchRows;
    const n = rows.filter((r) => this.selectedBatches.has(r.batch)).length;
    return n > 0 && n < rows.length;
  }

  isBatchSelected(batch: string): boolean {
    return this.selectedBatches.has(batch);
  }

  toggleBatch(batch: string, checked: boolean): void {
    if (checked) this.selectedBatches.add(batch);
    else this.selectedBatches.delete(batch);
    if (!this.selectedBatches.size) this.showDetailsPanel = false;
  }

  toggleSelectAllVisible(checked: boolean): void {
    if (checked) {
      for (const r of this.displayBatchRows) this.selectedBatches.add(r.batch);
    } else {
      for (const r of this.displayBatchRows) this.selectedBatches.delete(r.batch);
      if (!this.selectedBatches.size) this.showDetailsPanel = false;
    }
  }

  exportBatches(format: 'xlsx' | 'csv', scope: 'all' | 'selected' | 'visible'): void {
    if (this.exporting) return;
    let rows: BatchPaymentRow[];
    if (scope === 'selected') {
      if (!this.selectedBatches.size) {
        this.snack.open('Select at least one batch to export.', 'Dismiss', { duration: 3500 });
        return;
      }
      rows = this.batchRows.filter((r) => this.selectedBatches.has(r.batch));
    } else if (scope === 'visible') {
      rows = this.displayBatchRows;
    } else {
      rows = this.batchRows;
    }
    if (!rows.length) {
      this.snack.open('No batches to export.', 'Dismiss', { duration: 3500 });
      return;
    }
    const formatters = {
      journeyDay: (r: BatchPaymentRow) => this.journeyDayRatio(r),
      batchType: (t: 'new' | 'old') => this.batchTypeLabel(t),
    };
    const date = new Date().toISOString().slice(0, 10);
    const slug = [this.filterBatch, this.filterLevel].filter(Boolean).join('-') || 'all';
    const base = `batch-insights-${scope}-${slug}-${date}`;
    if (format === 'xlsx') {
      downloadBatchInsightsXlsx(base, rows, formatters);
    } else {
      downloadBatchInsightsCsv(base, batchRowsToCsv(rows, formatters));
    }
    this.snack.open(`Exported ${rows.length} batch(es)`, 'OK', { duration: 4000 });
  }

  showSelectedDetails(): void {
    if (!this.selectedBatches.size) return;
    this.showDetailsPanel = true;
    this.buildCharts(this.selectedBatchRows);
  }

  clearSelection(): void {
    this.selectedBatches.clear();
    this.showDetailsPanel = false;
    this.buildCharts(this.batchRows);
  }

  openBatchStudents(batch: string): void {
    this.router.navigate(['/admin/payment-hub/insights/batches', encodeURIComponent(batch), 'students']);
  }

  applyFilter(): void {
    this.load();
  }

  applyBatchTypeFilter(): void {
    this.applySummaryToView();
    this.pruneSelection();
  }

  fmt(n: number): string {
    return (n ?? 0).toLocaleString('sr-Latn-RS');
  }

  fmtCompact = fmtPaymentAmountCompact;

  private sumRows(rows: BatchPaymentRow[]): BatchPaymentSummaryTotals {
    const acc = rows.reduce(
      (a, r) => ({
        studentCount: a.studentCount + r.studentCount,
        totalPaid: a.totalPaid + r.totalPaid,
        totalPaidLKR: a.totalPaidLKR + r.totalPaidLKR,
        totalPaidINR: a.totalPaidINR + r.totalPaidINR,
        totalPaidUSD: a.totalPaidUSD + r.totalPaidUSD,
        totalPendingLKR: a.totalPendingLKR + r.totalPendingLKR,
        totalPendingINR: a.totalPendingINR + r.totalPendingINR,
        totalPendingUSD: a.totalPendingUSD + r.totalPendingUSD,
        totalOverdueLKR: a.totalOverdueLKR + r.totalOverdueLKR,
        totalOverdueINR: a.totalOverdueINR + r.totalOverdueINR,
        totalOverdueUSD: a.totalOverdueUSD + r.totalOverdueUSD,
        totalExpectedLKR: a.totalExpectedLKR + r.totalExpectedLKR,
        totalExpectedINR: a.totalExpectedINR + r.totalExpectedINR,
        totalExpectedUSD: a.totalExpectedUSD + r.totalExpectedUSD,
        langPaidLKR: a.langPaidLKR + r.langPaidLKR,
        langPaidINR: a.langPaidINR + r.langPaidINR,
        langPaidUSD: a.langPaidUSD + r.langPaidUSD,
        fullPendingLKR: a.fullPendingLKR + r.fullPendingLKR,
        fullPendingINR: a.fullPendingINR + r.fullPendingINR,
        fullPendingUSD: a.fullPendingUSD + r.fullPendingUSD,
        fullOverdueLKR: a.fullOverdueLKR + r.fullOverdueLKR,
        fullOverdueINR: a.fullOverdueINR + r.fullOverdueINR,
        fullOverdueUSD: a.fullOverdueUSD + r.fullOverdueUSD,
        fullExpectedLKR: a.fullExpectedLKR + r.fullExpectedLKR,
        fullExpectedINR: a.fullExpectedINR + r.fullExpectedINR,
        fullExpectedUSD: a.fullExpectedUSD + r.fullExpectedUSD,
        totalDueLKR: a.totalDueLKR + r.totalDueLKR,
        totalDueINR: a.totalDueINR + r.totalDueINR,
        totalDueUSD: a.totalDueUSD + r.totalDueUSD,
        fullyPaidStudents: a.fullyPaidStudents + r.fullyPaidStudents,
        balanceStudents: a.balanceStudents + r.balanceStudents,
        overdueStudents: a.overdueStudents + r.overdueStudents,
        docsPaidStudents: a.docsPaidStudents + r.docsPaidStudents,
        visaPaidStudents: a.visaPaidStudents + r.visaPaidStudents,
        maxStudentDay: null,
        avgJourneyDay: null,
      }),
      {
        studentCount: 0,
        totalPaid: 0,
        totalPaidLKR: 0,
        totalPaidINR: 0,
        totalPaidUSD: 0,
        totalPendingLKR: 0,
        totalPendingINR: 0,
        totalPendingUSD: 0,
        totalOverdueLKR: 0,
        totalOverdueINR: 0,
        totalOverdueUSD: 0,
        totalExpectedLKR: 0,
        totalExpectedINR: 0,
        totalExpectedUSD: 0,
        langPaidLKR: 0,
        langPaidINR: 0,
        langPaidUSD: 0,
        fullPendingLKR: 0,
        fullPendingINR: 0,
        fullPendingUSD: 0,
        fullOverdueLKR: 0,
        fullOverdueINR: 0,
        fullOverdueUSD: 0,
        fullExpectedLKR: 0,
        fullExpectedINR: 0,
        fullExpectedUSD: 0,
        totalDueLKR: 0,
        totalDueINR: 0,
        totalDueUSD: 0,
        fullyPaidStudents: 0,
        balanceStudents: 0,
        overdueStudents: 0,
        docsPaidStudents: 0,
        visaPaidStudents: 0,
        maxStudentDay: null,
        avgJourneyDay: null,
      },
    );
    return {
      ...acc,
      collectionRateLKR:
        acc.totalExpectedLKR > 0
          ? Math.min(100, Math.round((acc.totalPaidLKR / acc.totalExpectedLKR) * 100))
          : null,
    };
  }

  get viewTotals(): BatchPaymentSummaryTotals {
    if (this.showDetailsPanel) return this.sumRows(this.selectedBatchRows);
    if (this.apiTotals && !this.filterBatchType) return this.apiTotals;
    return this.sumRows(this.batchRows);
  }

  get cardBatches(): number {
    return this.activeRows.length;
  }

  get cardStudents(): number {
    return this.viewTotals.studentCount;
  }

  get cardReceived(): CurrencyPaidTotals {
    const t = this.viewTotals;
    return {
      totalPaidLKR: t.totalPaidLKR,
      totalPaidINR: t.totalPaidINR,
      totalPaidUSD: t.totalPaidUSD,
    };
  }

  get cardExpected(): CurrencyPaidTotals {
    const t = this.viewTotals;
    return {
      totalPaidLKR: t.totalExpectedLKR ?? 0,
      totalPaidINR: t.totalExpectedINR ?? 0,
      totalPaidUSD: t.totalExpectedUSD ?? 0,
    };
  }

  get cardPending(): { pendingApprovalAmountLKR: number; pendingApprovalAmountINR: number; pendingApprovalAmountUSD: number } {
    const t = this.viewTotals;
    return {
      pendingApprovalAmountLKR: t.totalPendingLKR ?? 0,
      pendingApprovalAmountINR: t.totalPendingINR ?? 0,
      pendingApprovalAmountUSD: t.totalPendingUSD ?? 0,
    };
  }

  get cardOverdue(): { overdueAmountLKR: number; overdueAmountINR: number; overdueAmountUSD: number } {
    const t = this.viewTotals;
    return {
      overdueAmountLKR: t.totalOverdueLKR ?? 0,
      overdueAmountINR: t.totalOverdueINR ?? 0,
      overdueAmountUSD: t.totalOverdueUSD ?? 0,
    };
  }

  /** Received LKR ÷ expected LKR for the current view. */
  get cardAmountCollectedPct(): number | null {
    const t = this.viewTotals;
    if (t.collectionRateLKR != null && Number.isFinite(t.collectionRateLKR)) {
      return t.collectionRateLKR;
    }
    const expected = t.totalExpectedLKR ?? 0;
    if (expected <= 0) return null;
    return Math.min(100, Math.round(((t.totalPaidLKR ?? 0) / expected) * 100));
  }

  /** (Pending + overdue) LKR ÷ expected LKR for the current view. */
  get cardAmountOutstandingPct(): number | null {
    const t = this.viewTotals;
    const expected = t.totalExpectedLKR ?? 0;
    if (expected <= 0) return null;
    const outstanding = (t.totalPendingLKR ?? 0) + (t.totalOverdueLKR ?? 0);
    return Math.min(100, Math.round((outstanding / expected) * 100));
  }

  get cardLargestBatch(): string {
    if (!this.activeRows.length) return '—';
    return this.activeRows[0].batch;
  }
}
