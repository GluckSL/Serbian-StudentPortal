import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { PaymentHubApiService, StudentTableRow } from './payment-hub-api.service';
import {
  currentJourneyDayFromEnrollment,
  totalJourneyDaysForLevel,
} from './payment-journey-metrics.util';

export interface BatchPaymentRow {
  batch: string;
  studentCount: number;
  totalPaid: number;
  avgCurrentJourneyDay: number;
  avgTotalJourneyDays: number;
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

  readonly levels = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly levelLabels = ['All levels', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

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

  constructor(private readonly api: PaymentHubApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    const params: Record<string, string | number> = { page: 1, limit: 9999, sort: '-paid' };
    if (this.filterLevel) params['level'] = this.filterLevel;
    this.api.getStudentTable(params).subscribe({
      next: (res) => {
        this.rows = res.data || [];
        this.rebuild();
        this.loading = false;
      },
      error: () => {
        this.rows = [];
        this.rebuild();
        this.loading = false;
      },
    });
  }

  private rebuild(): void {
    const byBatch = new Map<
      string,
      { totalPaid: number; count: number; journeySum: number; journeyTotalSum: number; journeyN: number }
    >();

    for (const r of this.rows) {
      const b = (r.studentId?.batch || '—').trim() || '—';
      if (!byBatch.has(b)) {
        byBatch.set(b, { totalPaid: 0, count: 0, journeySum: 0, journeyTotalSum: 0, journeyN: 0 });
      }
      const agg = byBatch.get(b)!;
      agg.totalPaid += r.totalPaid || 0;
      agg.count += 1;
      const cur = currentJourneyDayFromEnrollment(r.studentId);
      const tot = totalJourneyDaysForLevel(r.studentId?.level);
      if (cur != null) {
        agg.journeySum += cur;
        agg.journeyN += 1;
      }
      agg.journeyTotalSum += tot;
    }

    this.batchRows = [...byBatch.entries()]
      .map(([batch, a]) => ({
        batch,
        studentCount: a.count,
        totalPaid: a.totalPaid,
        avgCurrentJourneyDay: a.journeyN ? Math.round(a.journeySum / a.journeyN) : 0,
        avgTotalJourneyDays: a.count ? Math.round(a.journeyTotalSum / a.count) : 0,
      }))
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

  applyFilter(): void {
    this.load();
  }

  fmt(n: number): string {
    return (n ?? 0).toLocaleString('en-IN');
  }

  get cardBatches(): number {
    return this.batchRows.length;
  }

  get cardStudents(): number {
    return this.rows.length;
  }

  get cardTotalPaid(): number {
    return this.batchRows.reduce((s, r) => s + r.totalPaid, 0);
  }

  get cardLargestBatch(): string {
    if (!this.batchRows.length) return '—';
    return this.batchRows[0].batch;
  }
}
