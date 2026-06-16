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
  currentJourneyDayFromStudent,
  journeyDayRemaining,
  journeyProgressRatio,
  totalJourneyDaysForLevel,
} from './payment-journey-metrics.util';

export interface JourneyRowView {
  row: StudentTableRow;
  totalDays: number;
  currentDay: number | null;
  remaining: number | null;
  progress: number | null;
}

@Component({
  selector: 'app-payment-hub-journey-insights',
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
  templateUrl: './payment-hub-journey-insights.component.html',
  styleUrls: ['./payment-hub-insights-page.scss', './payment-hub-journey-insights.component.scss'],
})
export class PaymentHubJourneyInsightsComponent implements OnInit {
  loading = true;
  rawRows: StudentTableRow[] = [];
  views: JourneyRowView[] = [];
  filterLevel = '';
  filterBatch = '';
  batchOptions: string[] = [];

  readonly levels = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly levelLabels = ['All levels', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  barData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  barOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        grid: { color: 'rgba(148,163,184,0.2)' },
        max: 100,
        ticks: { callback: (v) => `${v}%` },
      },
    },
  };

  constructor(private readonly api: PaymentHubApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    const params: Record<string, string | number> = { page: 1, limit: 9999, sort: 'name' };
    this.api.getStudentTable(params).subscribe({
      next: (res) => {
        this.rawRows = res.data || [];
        const batches = new Set<string>();
        for (const r of this.rawRows) {
          const b = (r.studentId?.batch || '').trim();
          if (b) batches.add(b);
        }
        this.batchOptions = [...batches].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        this.applyFilters();
        this.loading = false;
      },
      error: () => {
        this.rawRows = [];
        this.views = [];
        this.loading = false;
      },
    });
  }

  applyFilters(): void {
    let list = this.rawRows;
    if (this.filterLevel) {
      list = list.filter((r) => (r.studentId?.level || '').toUpperCase() === this.filterLevel.toUpperCase());
    }
    if (this.filterBatch) {
      list = list.filter((r) => (r.studentId?.batch || '') === this.filterBatch);
    }
    this.views = list.map((row) => {
      const totalDays = totalJourneyDaysForLevel(row.studentId?.level);
      const currentDay = currentJourneyDayFromStudent(row.studentId);
      const remaining = journeyDayRemaining(currentDay, totalDays);
      const progress = journeyProgressRatio(currentDay, totalDays);
      return { row, totalDays, currentDay, remaining, progress };
    });
    this.buildHistogram();
  }

  private buildHistogram(): void {
    const buckets = ['0–25%', '25–50%', '50–75%', '75–100%', '100%+'];
    const counts = [0, 0, 0, 0, 0];
    for (const v of this.views) {
      const p = (v.progress ?? 0) * 100;
      if (p >= 100) counts[4]++;
      else if (p >= 75) counts[3]++;
      else if (p >= 50) counts[2]++;
      else if (p >= 25) counts[1]++;
      else counts[0]++;
    }
    this.barData = {
      labels: buckets,
      datasets: [
        {
          data: counts,
          backgroundColor: ['#c4b5fd', '#a78bfa', '#818cf8', '#6366f1', '#4f46e5'],
          borderRadius: 12,
          borderSkipped: false,
        },
      ],
    };
  }

  studentName(v: JourneyRowView): string {
    return v.row.studentId?.name || '—';
  }

  studentBatch(v: JourneyRowView): string {
    return v.row.studentId?.batch || '—';
  }

  studentLevel(v: JourneyRowView): string {
    return v.row.studentId?.level || '—';
  }

  journeyDayRatio(v: JourneyRowView): string {
    if (v.currentDay == null) return `—/${v.totalDays}`;
    return `${v.currentDay}/${v.totalDays}`;
  }

  fmtPct(p: number | null): string {
    if (p == null) return '—';
    return `${Math.round(p * 100)}%`;
  }

  get avgProgressPercent(): number | null {
    const withP = this.views.filter((v) => v.progress != null);
    if (!withP.length) return null;
    const s = withP.reduce((a, v) => a + (v.progress as number), 0);
    return Math.round((s / withP.length) * 100);
  }

  get studentsPastJourney(): number {
    return this.views.filter((v) => v.currentDay != null && v.currentDay > v.totalDays).length;
  }

  get missingEnrollment(): number {
    return this.views.filter((v) => v.currentDay == null).length;
  }
}
