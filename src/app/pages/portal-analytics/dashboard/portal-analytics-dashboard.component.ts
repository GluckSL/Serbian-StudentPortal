import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration, ChartType } from 'chart.js';
import { PortalAnalyticsApiService, PortalAnalyticsRange } from '../../../services/portal-analytics-api.service';
import { formatPortalDuration } from '../portal-analytics-format';
import { Subscription, interval } from 'rxjs';

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

interface DashboardViewModel extends PortalDashboardPayload {
  activeStudents: { name: string; email: string; lastHeartbeatAt: string; sessionId: string }[];
  recentActivity: {
    time: string;
    studentName: string;
    page: string;
    type: string;
    durationSeconds: number;
    sessionId: string;
  }[];
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
export class PortalAnalyticsDashboardComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) range!: PortalAnalyticsRange;
  @Input() includeHistorical = false;

  loading = false;
  error = '';
  dashboard: DashboardViewModel | null = null;
  private refreshSub: Subscription | null = null;
  private readonly AUTO_REFRESH_MS = 10_000;
  pageSize = 8;
  pageIndex = 0;
  private readonly sessionLabelMap = new Map<string, number>();

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

  ngOnDestroy(): void {
    this.refreshSub?.unsubscribe();
    this.refreshSub = null;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['range'] || changes['includeHistorical']) && this.range?.from && this.range?.to) {
      this.pageIndex = 0;
      this.load();
      this.startAutoRefresh();
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

  private load(showLoader = true): void {
    if (showLoader) this.loading = true;
    this.error = '';
    this.api.getDashboard(this.range, this.includeHistorical).subscribe({
      next: (raw: unknown) => {
        console.log('Dashboard API:', raw);
        this.dashboard = this.normalizeDashboard(raw);
        this.rebuildSessionLabels(this.dashboard);
        this.buildCharts(this.dashboard);
        if (this.pageIndex > this.recentActivityPageCount - 1) {
          this.pageIndex = Math.max(0, this.recentActivityPageCount - 1);
        }
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

  sessionLabel(sessionId: string): string {
    const id = String(sessionId || '').trim();
    if (!id) return 'Session -';
    const idx = this.sessionLabelMap.get(id);
    return `Session ${idx || '?'}`;
  }

  private rebuildSessionLabels(d: DashboardViewModel | null): void {
    this.sessionLabelMap.clear();
    if (!d) return;
    const add = (idRaw: string): void => {
      const id = String(idRaw || '').trim();
      if (!id || this.sessionLabelMap.has(id)) return;
      this.sessionLabelMap.set(id, this.sessionLabelMap.size + 1);
    };
    for (const s of d.activeStudents || []) add(s.sessionId);
    for (const r of d.recentActivity || []) add(r.sessionId);
  }

  get recentActivityTotal(): number {
    return this.dashboard?.recentActivity?.length || 0;
  }

  get recentActivityPageCount(): number {
    return Math.max(1, Math.ceil(this.recentActivityTotal / this.pageSize));
  }

  get pagedRecentActivity(): DashboardViewModel['recentActivity'] {
    const rows = this.dashboard?.recentActivity || [];
    const start = this.pageIndex * this.pageSize;
    return rows.slice(start, start + this.pageSize);
  }

  get recentFrom(): number {
    if (!this.recentActivityTotal) return 0;
    return this.pageIndex * this.pageSize + 1;
  }

  get recentTo(): number {
    return Math.min((this.pageIndex + 1) * this.pageSize, this.recentActivityTotal);
  }

  prevRecentPage(): void {
    if (this.pageIndex <= 0) return;
    this.pageIndex -= 1;
  }

  nextRecentPage(): void {
    if (this.pageIndex >= this.recentActivityPageCount - 1) return;
    this.pageIndex += 1;
  }

  private startAutoRefresh(): void {
    this.refreshSub?.unsubscribe();
    this.refreshSub = interval(this.AUTO_REFRESH_MS).subscribe(() => {
      if (!this.range?.from || !this.range?.to) return;
      this.load(false);
    });
  }

  private normalizeDashboard(raw: unknown): DashboardViewModel {
    const src = (raw || {}) as Partial<PortalDashboardPayload>;
    const kpis = src.kpis || ({} as PortalDashboardPayload['kpis']);
    const normalizeNum = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const activeStudents = Array.isArray(src.activeStudents) ? src.activeStudents : [];
    const recentActivity = Array.isArray(src.recentActivity) ? src.recentActivity : [];

    return {
      kpis: {
        totalTime: normalizeNum(kpis?.totalTime),
        activeStudents: normalizeNum(kpis?.activeStudents),
        avgTimePerStudent: normalizeNum(kpis?.avgTimePerStudent),
        topPage: kpis?.topPage
          ? { page: String(kpis.topPage.page || '—'), seconds: normalizeNum(kpis.topPage.seconds) }
          : null,
        topStudent: kpis?.topStudent
          ? {
              studentId: String(kpis.topStudent.studentId || ''),
              name: String(kpis.topStudent.name || '—'),
              seconds: normalizeNum(kpis.topStudent.seconds)
            }
          : null
      },
      timeSeries: Array.isArray(src.timeSeries)
        ? src.timeSeries.map((x) => ({
            date: String(x.date || ''),
            seconds: normalizeNum(x.seconds)
          }))
        : [],
      donut: {
        labels: Array.isArray(src.donut?.labels) ? src.donut.labels.map((x) => String(x || '—')) : [],
        values: Array.isArray(src.donut?.values) ? src.donut.values.map((x) => normalizeNum(x)) : []
      },
      activeStudents: activeStudents
        .map((x) => ({
          name: String(x?.name || 'Unknown'),
          email: String(x?.email || ''),
          lastHeartbeatAt: String(x?.lastHeartbeatAt || ''),
          sessionId: String(x?.sessionId || '')
        }))
        .sort((a, b) => new Date(b.lastHeartbeatAt || 0).getTime() - new Date(a.lastHeartbeatAt || 0).getTime()),
      recentActivity: recentActivity
        .map((x) => ({
          time: String(x?.time || ''),
          studentName: String(x?.studentName || 'Unknown'),
          page: String(x?.page || '/'),
          type: String(x?.type || 'PAGE'),
          durationSeconds: normalizeNum(x?.durationSeconds),
          sessionId: String(x?.sessionId || '')
        }))
        .sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime()),
      peakHour: src.peakHour
        ? { label: String(src.peakHour.label || ''), seconds: normalizeNum(src.peakHour.seconds) }
        : null,
      peakDay: src.peakDay ? { label: String(src.peakDay.label || ''), seconds: normalizeNum(src.peakDay.seconds) } : null,
      engagement: Array.isArray(src.engagement)
        ? src.engagement.map((x) => ({
            name: String(x?.name || 'Unknown'),
            engagementScore: normalizeNum(x?.engagementScore),
            activeSeconds: normalizeNum(x?.activeSeconds)
          }))
        : [],
      dropoffs: Array.isArray(src.dropoffs)
        ? src.dropoffs.map((x) => ({
            page: String(x?.page || '/'),
            sessionsEnded: normalizeNum(x?.sessionsEnded),
            avgLastSegmentSec: normalizeNum(x?.avgLastSegmentSec)
          }))
        : [],
      insights: Array.isArray(src.insights)
        ? src.insights.map((x) => ({
            id: String(x?.id || ''),
            tone: String(x?.tone || 'neutral'),
            title: String(x?.title || ''),
            body: String(x?.body || '')
          }))
        : [],
      historical: src.historical
        ? {
            label: String(src.historical.label || ''),
            estimatedSeconds: normalizeNum(src.historical.estimatedSeconds),
            disclaimer: String(src.historical.disclaimer || ''),
            comparisonNote: src.historical.comparisonNote ? String(src.historical.comparisonNote) : null,
            pairedSessions: normalizeNum(src.historical.pairedSessions),
            studentLogEventsCount: normalizeNum(src.historical.studentLogEventsCount),
            studentLogNote: src.historical.studentLogNote ? String(src.historical.studentLogNote) : ''
          }
        : null
    };
  }

  insightIcon(tone: string): string {
    if (tone === 'positive') return 'trending_up';
    if (tone === 'negative') return 'trending_down';
    if (tone === 'warn') return 'warning_amber';
    return 'insights';
  }
}
