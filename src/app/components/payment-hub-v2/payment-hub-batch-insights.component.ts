import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { forkJoin } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PaymentHubApiService, StudentTableRow } from './payment-hub-api.service';
import {
  currentJourneyDayFromStudent,
  totalJourneyDaysForLevel,
} from './payment-journey-metrics.util';

interface BatchJourneySummary {
  batchName: string;
  batchCurrentDay: number;
  batchType?: 'new' | 'old';
  hasSavedConfig?: boolean;
}

export interface BatchPaymentRow {
  batch: string;
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
    MatProgressSpinnerModule,
    NgChartsModule,
  ],
  templateUrl: './payment-hub-batch-insights.component.html',
  styleUrls: ['./payment-hub-insights-page.scss', './payment-hub-batch-insights.component.scss'],
})
export class PaymentHubBatchInsightsComponent implements OnInit {
  loading = true;
  rows: StudentTableRow[] = [];
  batchRows: BatchPaymentRow[] = [];
  filterLevel = '';
  filterBatch = '';
  filterBatchType = '';
  batchOptions: string[] = [];
  private batchDayByKey = new Map<string, number>();
  private batchTypeByKey = new Map<string, 'new' | 'old'>();
  /** Canonical batch label from Journey (for display / lookup). */
  private batchLabelByKey = new Map<string, string>();

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
      legend: { display: false },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0 } },
      y: { grid: { color: 'rgba(148,163,184,0.2)' }, ticks: { callback: (v) => Number(v).toLocaleString('en-IN') } },
    },
  };

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly http: HttpClient,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    const params: Record<string, string | number> = { page: 1, limit: 9999, sort: '-paid' };
    if (this.filterLevel) params['level'] = this.filterLevel;
    if (this.filterBatch) params['batch'] = this.filterBatch;

    forkJoin({
      students: this.api.getStudentTable(params),
      journey: this.http.get<{ batches: BatchJourneySummary[]; upcomingBatches?: BatchJourneySummary[] }>(
        `${environment.apiUrl}/batch-journey`,
        { withCredentials: true },
      ),
    }).subscribe({
      next: ({ students, journey }) => {
        this.rows = students.data || [];
        this.ingestJourneyBatches([...(journey.batches || []), ...(journey.upcomingBatches || [])]);
        this.refreshBatchOptions();
        this.rebuild();
        this.loading = false;
      },
      error: () => {
        this.rows = [];
        this.batchDayByKey.clear();
        this.batchTypeByKey.clear();
        this.batchLabelByKey.clear();
        this.batchOptions = [];
        this.rebuild();
        this.loading = false;
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
      if (b.hasSavedConfig) {
        this.batchTypeByKey.set(key, b.batchType === 'old' ? 'old' : 'new');
      }
    }
  }

  private refreshBatchOptions(): void {
    const keys = new Set<string>();
    for (const r of this.rows) {
      const label = (r.studentId?.batch || '').trim();
      if (label) keys.add(normBatchKey(label));
    }
    const labels: string[] = [];
    for (const key of keys) {
      if (this.filterBatchType && this.batchTypeByKey.get(key) !== this.filterBatchType) {
        continue;
      }
      labels.push(this.batchLabelByKey.get(key) || this.findRowBatchLabel(key) || key);
    }
    this.batchOptions = [...new Set(labels)].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    if (this.filterBatch && !this.batchOptions.includes(this.filterBatch)) {
      this.filterBatch = '';
    }
  }

  private findRowBatchLabel(key: string): string | null {
    for (const r of this.rows) {
      const label = (r.studentId?.batch || '').trim();
      if (label && normBatchKey(label) === key) return label;
    }
    return null;
  }

  /** Students whose batch matches the Journey batch-type filter. */
  private rowsForView(): StudentTableRow[] {
    if (!this.filterBatchType) return this.rows;
    return this.rows.filter((r) => {
      const key = normBatchKey(r.studentId?.batch || '');
      return this.batchTypeByKey.get(key) === this.filterBatchType;
    });
  }

  private batchMatchesTypeFilter(batchLabel: string): boolean {
    if (!this.filterBatchType) return true;
    const key = normBatchKey(batchLabel);
    return this.batchTypeByKey.get(key) === this.filterBatchType;
  }

  private rebuild(): void {
    const sourceRows = this.rowsForView();
    const byBatch = new Map<
      string,
      { totalPaid: number; count: number; levelCounts: Map<string, number>; maxStudentDay: number | null }
    >();

    for (const r of sourceRows) {
      const b = (r.studentId?.batch || '—').trim() || '—';
      if (!this.batchMatchesTypeFilter(b)) continue;
      if (!byBatch.has(b)) {
        byBatch.set(b, { totalPaid: 0, count: 0, levelCounts: new Map(), maxStudentDay: null });
      }
      const agg = byBatch.get(b)!;
      agg.totalPaid += r.totalPaid || 0;
      agg.count += 1;
      const lv = (r.studentId?.level || '').toUpperCase().trim();
      if (lv) agg.levelCounts.set(lv, (agg.levelCounts.get(lv) || 0) + 1);
      const day = currentJourneyDayFromStudent(r.studentId);
      if (day != null) {
        agg.maxStudentDay = agg.maxStudentDay == null ? day : Math.max(agg.maxStudentDay, day);
      }
    }

    this.batchRows = [...byBatch.entries()]
      .map(([batch, a]) => {
        const key = normBatchKey(batch);
        const batchLevel = this.dominantLevel(a.levelCounts);
        const currentJourneyDay = this.batchDayByKey.get(key) ?? a.maxStudentDay;
        const totalJourneyDays = batchLevel ? totalJourneyDaysForLevel(batchLevel) : null;
        return {
          batch,
          studentCount: a.count,
          totalPaid: a.totalPaid,
          currentJourneyDay,
          totalJourneyDays,
        };
      })
      .sort((x, y) => y.totalPaid - x.totalPaid);

    const top = this.batchRows.slice(0, 14);
    this.barChartData = {
      labels: top.map((t) => t.batch),
      datasets: [
        {
          data: top.map((t) => t.totalPaid),
          backgroundColor: top.map((_, i) => `hsl(${250 - i * 8}, 72%, ${52 - i}%)`),
          borderRadius: 10,
          borderSkipped: false,
        },
      ],
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

  applyFilter(): void {
    this.load();
  }

  applyBatchTypeFilter(): void {
    this.refreshBatchOptions();
    this.rebuild();
  }

  fmt(n: number): string {
    return (n ?? 0).toLocaleString('en-IN');
  }

  get cardBatches(): number {
    return this.batchRows.length;
  }

  get cardStudents(): number {
    return this.rowsForView().length;
  }

  get cardTotalPaid(): number {
    return this.batchRows.reduce((s, r) => s + r.totalPaid, 0);
  }

  get cardLargestBatch(): string {
    if (!this.batchRows.length) return '—';
    return this.batchRows[0].batch;
  }
}
