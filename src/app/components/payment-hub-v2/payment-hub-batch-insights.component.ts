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
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { environment } from '../../../environments/environment';
import { BatchPaymentSummaryRow, CurrencyPaidTotals, PaymentHubApiService } from './payment-hub-api.service';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { totalJourneyDaysForLevel } from './payment-journey-metrics.util';

interface BatchJourneySummary {
  batchName: string;
  batchCurrentDay: number;
  batchType?: 'general' | 'old' | 'new';
  hasSavedConfig?: boolean;
}

export interface BatchPaymentRow extends CurrencyPaidTotals {
  batch: string;
  batchType: 'general' | 'new' | 'old';
  level: string | null;
  levelSummary: string;
  studentCount: number;
  totalPaid: number;
  currentJourneyDay: number | null;
  totalJourneyDays: number | null;
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
    NgChartsModule,
    PaymentCurrencyTotalsComponent,
  ],
  templateUrl: './payment-hub-batch-insights.component.html',
  styleUrls: ['./payment-hub-insights-page.scss', './payment-hub-batch-insights.component.scss'],
})
export class PaymentHubBatchInsightsComponent implements OnInit {
  loading = true;
  totalStudents = 0;
  batchRows: BatchPaymentRow[] = [];
  filterLevel = '';
  filterBatch = '';
  filterBatchType = '';
  batchOptions: string[] = [];
  selectedBatches = new Set<string>();
  showDetailsPanel = false;

  readonly skeletonCards = [1, 2, 3, 4];
  readonly skeletonTableRows = [1, 2, 3, 4, 5, 6, 7, 8];

  private summaryRows: BatchPaymentSummaryRow[] = [];
  private batchDayByKey = new Map<string, number>();
  private batchTypeByKey = new Map<string, 'general' | 'new' | 'old'>();
  private batchLabelByKey = new Map<string, string>();

  readonly levels = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly levelLabels = ['All levels', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly batchTypeOptions: { value: string; label: string }[] = [
    { value: '', label: 'All types' },
    { value: 'general', label: 'General' },
    { value: 'new', label: 'New' },
    { value: 'old', label: 'Old' },
  ];

  barChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  barChartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: true, position: 'bottom' } },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0 } },
      y: {
        stacked: true,
        grid: { color: 'rgba(148,163,184,0.2)' },
        ticks: { callback: (v) => Number(v).toLocaleString('en-IN') },
      },
    },
  };

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly http: HttpClient,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    const params: Record<string, string> = {};
    if (this.filterLevel) params['level'] = this.filterLevel;
    if (this.filterBatch) params['batch'] = this.filterBatch;

    this.api.getBatchPaymentSummary(params).subscribe({
      next: (summary) => {
        this.summaryRows = summary.data?.batches || [];
        this.totalStudents = summary.data?.totalStudents ?? 0;
        this.applySummaryToView();
        this.pruneSelection();
        this.loading = false;
        this.loadJourneyMeta();
      },
      error: () => {
        this.summaryRows = [];
        this.totalStudents = 0;
        this.batchRows = [];
        this.batchOptions = [];
        this.batchDayByKey.clear();
        this.batchTypeByKey.clear();
        this.batchLabelByKey.clear();
        this.selectedBatches.clear();
        this.showDetailsPanel = false;
        this.loading = false;
      },
    });
  }

  /** Journey config loads after the table — updates batch day + type without blocking UI. */
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
        error: () => {
          /* Table still usable from payment summary alone */
        },
      });
  }

  private ingestJourneyBatches(list: BatchJourneySummary[]): void {
    this.batchDayByKey.clear();
    this.batchTypeByKey.clear();
    this.batchLabelByKey.clear();
    for (const b of list) {
      const label = (b.batchName || '').trim();
      if (!label) continue;
      const key = normBatchKey(label);
      this.batchLabelByKey.set(key, label);
      this.batchDayByKey.set(key, b.batchCurrentDay);
      this.batchTypeByKey.set(key, this.normalizeBatchTypeValue(b.batchType));
    }
  }

  private normalizeBatchTypeValue(type?: string | null): 'general' | 'new' | 'old' {
    const t = String(type || '').toLowerCase();
    if (t === 'old') return 'old';
    if (t === 'new') return 'new';
    if (t === 'general') return 'general';
    return 'old';
  }

  private batchMatchesTypeFilter(batchLabel: string): boolean {
    if (!this.filterBatchType) return true;
    const type = this.batchTypeByKey.get(normBatchKey(batchLabel)) ?? 'old';
    return type === this.filterBatchType;
  }

  batchTypeLabel(type: 'general' | 'new' | 'old'): string {
    if (type === 'new') return 'New';
    if (type === 'general') return 'General';
    return 'Old';
  }

  private applySummaryToView(): void {
    const optionSet = new Set<string>();
    let rows: BatchPaymentRow[] = [];

    for (const row of this.summaryRows) {
      const batch = (row.batch || '—').trim() || '—';
      if (!this.batchMatchesTypeFilter(batch)) continue;
      if (batch !== '—') optionSet.add(batch);

      const levelCounts = new Map<string, number>(
        Object.entries(row.levelCounts || {}).filter(([k]) => k),
      );
      const batchLevel = this.dominantLevel(levelCounts);
      const key = normBatchKey(batch);
      const currentJourneyDay = this.batchDayByKey.get(key) ?? row.maxStudentDay;
      const batchType: 'general' | 'new' | 'old' = this.batchTypeByKey.get(key) ?? 'old';
      rows.push({
        batch,
        batchType,
        level: batchLevel,
        levelSummary: this.formatLevelSummary(levelCounts),
        studentCount: row.studentCount,
        totalPaid: row.totalPaid,
        totalPaidLKR: row.totalPaidLKR ?? 0,
        totalPaidINR: row.totalPaidINR ?? 0,
        totalPaidUSD: row.totalPaidUSD ?? 0,
        currentJourneyDay,
        totalJourneyDays: batchLevel ? totalJourneyDaysForLevel(batchLevel) : null,
      });
    }

    rows.sort((a, b) => b.totalPaidLKR - a.totalPaidLKR || b.totalPaidINR - a.totalPaidINR);
    this.batchRows = rows;
    this.batchOptions = [...optionSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (this.filterBatch && !this.batchOptions.includes(this.filterBatch)) {
      this.filterBatch = '';
    }

    const top = this.batchRows.slice(0, 14);
    this.barChartData = {
      labels: top.map((t) => t.batch),
      datasets: [
        {
          label: 'LKR',
          data: top.map((t) => t.totalPaidLKR),
          backgroundColor: 'rgba(16, 185, 129, 0.85)',
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'INR',
          data: top.map((t) => t.totalPaidINR),
          backgroundColor: 'rgba(59, 130, 246, 0.85)',
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Euro',
          data: top.map((t) => t.totalPaidUSD),
          backgroundColor: 'rgba(139, 92, 246, 0.85)',
          borderRadius: 6,
          borderSkipped: false,
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

  get selectedBatchRows(): BatchPaymentRow[] {
    return this.batchRows.filter((r) => this.selectedBatches.has(r.batch));
  }

  get allVisibleSelected(): boolean {
    return this.batchRows.length > 0 && this.batchRows.every((r) => this.selectedBatches.has(r.batch));
  }

  get someVisibleSelected(): boolean {
    const n = this.batchRows.filter((r) => this.selectedBatches.has(r.batch)).length;
    return n > 0 && n < this.batchRows.length;
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
      for (const r of this.batchRows) this.selectedBatches.add(r.batch);
    } else {
      this.selectedBatches.clear();
      this.showDetailsPanel = false;
    }
  }

  showSelectedDetails(): void {
    if (!this.selectedBatches.size) return;
    this.showDetailsPanel = true;
  }

  clearSelection(): void {
    this.selectedBatches.clear();
    this.showDetailsPanel = false;
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
    return (n ?? 0).toLocaleString('en-IN');
  }

  get cardBatches(): number {
    return this.showDetailsPanel ? this.selectedBatchRows.length : this.batchRows.length;
  }

  get cardStudents(): number {
    if (this.showDetailsPanel) {
      return this.selectedBatchRows.reduce((s, r) => s + r.studentCount, 0);
    }
    return this.totalStudents;
  }

  get cardTotals(): CurrencyPaidTotals {
    const rows = this.showDetailsPanel ? this.selectedBatchRows : this.batchRows;
    return rows.reduce(
      (acc, r) => ({
        totalPaidLKR: acc.totalPaidLKR + (r.totalPaidLKR || 0),
        totalPaidINR: acc.totalPaidINR + (r.totalPaidINR || 0),
        totalPaidUSD: acc.totalPaidUSD + (r.totalPaidUSD || 0),
      }),
      { totalPaidLKR: 0, totalPaidINR: 0, totalPaidUSD: 0 },
    );
  }

  get cardLargestBatch(): string {
    const rows = this.showDetailsPanel ? this.selectedBatchRows : this.batchRows;
    if (!rows.length) return '—';
    return rows[0].batch;
  }
}
