import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration, ChartType } from 'chart.js';
import { PortalAnalyticsApiService, PortalAnalyticsRange } from '../../../services/portal-analytics-api.service';
import { formatPortalDuration } from '../portal-analytics-format';

export interface PortalDashboardPayload {
  kpis: {
    totalTime: number;
    activeStudents: number;
    avgTimePerStudent: number;
    topPage: { page: string; seconds: number } | null;
    topStudent: { studentId: string; name: string; seconds: number } | null;
  };
  timeSeries: { date: string; seconds: number }[];
  donut: { labels: string[]; values: number[] };
  activeStudents: { name: string; email: string; lastHeartbeatAt: string; sessionId: string }[];
  recentActivity: {
    time: string;
    studentName: string;
    page: string;
    type: string;
    durationSeconds: number;
    sessionId: string;
  }[];
  peakHour: { label: string; seconds: number } | null;
  peakDay: { label: string; seconds: number } | null;
  engagement: { name: string; engagementScore: number; activeSeconds: number }[];
  dropoffs: { page: string; sessionsEnded: number; avgLastSegmentSec: number }[];
  insights: { id: string; tone: string; title: string; body: string }[];
  historical: {
    label: string;
    estimatedSeconds: number;
    disclaimer: string;
    comparisonNote: string | null;
    pairedSessions: number;
    studentLogEventsCount?: number;
    studentLogNote?: string;
  } | null;
}

@Component({
  selector: 'app-portal-analytics-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    NgChartsModule
  ],
  templateUrl: './portal-analytics-dashboard.component.html',
  styleUrls: ['./portal-analytics-dashboard.component.scss']
})
export class PortalAnalyticsDashboardComponent implements OnChanges {
  @Input({ required: true }) range!: PortalAnalyticsRange;
  @Input() includeHistorical = false;

  loading = false;
  error = '';
  dashboard: PortalDashboardPayload | null = null;

  lineChartType: ChartType = 'line';
  lineChartData: ChartConfiguration['data'] = { labels: [], datasets: [] };
  lineChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0 } },
      y: { beginAtZero: true, title: { display: true, text: 'Minutes' } }
    }
  };

  donutChartType: ChartType = 'doughnut';
  donutChartData: ChartConfiguration['data'] = { labels: [], datasets: [] };
  donutChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'right' } }
  };

  formatDuration = formatPortalDuration;

  constructor(private api: PortalAnalyticsApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['range'] || changes['includeHistorical']) && this.range?.from && this.range?.to) {
      this.load();
    }
  }

  /** Called from parent toolbar via template ref. */
  exportCsv(): void {
    const d = this.dashboard;
    if (!d) return;
    const lines: string[] = [];
    lines.push('Portal Analytics export (tracked heartbeat data)');
    lines.push(`Range,${this.range.from},${this.range.to}`);
    lines.push(`Total portal seconds,${d.kpis.totalTime}`);
    lines.push(`Active students (5m),${d.kpis.activeStudents}`);
    lines.push(`Avg seconds per student,${d.kpis.avgTimePerStudent}`);
    lines.push('');
    lines.push('Recent activity');
    lines.push('Time,Student,Page,Type,Duration sec,SessionId');
    for (const r of d.recentActivity || []) {
      lines.push(
        [new Date(r.time).toISOString(), this.csvEscape(r.studentName), this.csvEscape(r.page), r.type, r.durationSeconds, r.sessionId].join(',')
      );
    }
    if (d.historical) {
      lines.push('');
      lines.push('Historical (estimated)');
      lines.push(`Estimated seconds,${d.historical.estimatedSeconds}`);
      lines.push(this.csvEscape(d.historical.disclaimer));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `portal-analytics-${this.range.from}-${this.range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private csvEscape(s: string): string {
    const v = String(s ?? '');
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }

  private load(): void {
    this.loading = true;
    this.error = '';
    this.api.getDashboard(this.range, this.includeHistorical).subscribe({
      next: (raw: unknown) => {
        this.dashboard = raw as PortalDashboardPayload;
        this.buildCharts(this.dashboard);
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load dashboard.';
        this.loading = false;
      }
    });
  }

  private buildCharts(d: PortalDashboardPayload): void {
    const ts = d.timeSeries || [];
    if (!ts.length) {
      this.lineChartData = {
        labels: ['—'],
        datasets: [
          {
            data: [0],
            label: 'Portal minutes',
            borderColor: '#cbd5e1',
            backgroundColor: 'rgba(148, 163, 184, 0.15)',
            fill: true,
            tension: 0.35,
            pointRadius: 0
          }
        ]
      };
    } else {
      this.lineChartData = {
        labels: ts.map((x) => x.date),
        datasets: [
          {
            data: ts.map((x) => Math.round(x.seconds / 60)),
            label: 'Portal minutes',
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.12)',
            fill: true,
            tension: 0.35,
            pointRadius: 2
          }
        ]
      };
    }

    const labels = d.donut?.labels || [];
    const values = d.donut?.values || [];
    const palette = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#4f46e5', '#64748b', '#94a3b8'];
    this.donutChartData = {
      labels: labels.length ? labels : ['—'],
      datasets: [
        {
          data: values.length ? values : [1],
          backgroundColor: (labels.length ? labels : ['—']).map((_, i) => palette[i % palette.length]),
          borderWidth: 0
        }
      ]
    };
  }

  insightIcon(tone: string): string {
    if (tone === 'positive') return 'trending_up';
    if (tone === 'negative') return 'trending_down';
    if (tone === 'warn') return 'warning_amber';
    return 'insights';
  }
}
