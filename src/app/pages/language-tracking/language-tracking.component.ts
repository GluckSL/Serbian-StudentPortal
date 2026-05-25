import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';

import {
  LanguageTrackingApiService,
  LtCohort,
  LtKpis,
  LtOverviewResponse,
  LtSendRemindersResponse,
  LtStudentRow,
  LtTrendDay,
} from './language-tracking-api.service';
import { LanguageTrackingDrawerComponent } from './language-tracking-drawer.component';

function formatDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

@Component({
  selector: 'app-language-tracking',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSnackBarModule,
    NgChartsModule,
    LanguageTrackingDrawerComponent,
  ],
  templateUrl: './language-tracking.component.html',
  styleUrls: ['./language-tracking.component.scss'],
})
export class LanguageTrackingComponent implements OnInit, OnDestroy {
  // ── Filter state ────────────────────────────────────────────────────────────
  cohort: LtCohort = 'overall';
  draftFrom = todayIso();
  draftTo = todayIso();
  from = todayIso();
  to = todayIso();
  batch = '';
  level = '';
  searchRaw = '';
  quickRange: 'today' | '7d' | '30d' | 'custom' = 'today';

  availableBatches: string[] = [];
  availableLevels: string[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  // ── Data ────────────────────────────────────────────────────────────────────
  loading = false;
  /** Used for skeletons only on first load. */
  hasLoadedOnce = false;
  error = '';
  kpis: LtKpis | null = null;
  students: LtStudentRow[] = [];
  total = 0;
  page = 1;
  readonly PAGE_SIZE = 25;

  sort: 'totalSeconds' | 'name' | 'currentCourseDay' = 'totalSeconds';

  // ── Chart state ─────────────────────────────────────────────────────────────
  trendChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  trendChartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 350, easing: 'easeOutQuart' },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { usePointStyle: true, padding: 8, boxWidth: 8, font: { size: 9 }, color: '#64748b' },
      },
      tooltip: {
        backgroundColor: 'rgba(15,23,42,0.88)',
        padding: 11,
        cornerRadius: 10,
        displayColors: true,
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${formatDuration(ctx.parsed.y * 60)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6, color: '#94a3b8', font: { size: 9 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(148,163,184,0.1)' },
        ticks: { color: '#94a3b8', font: { size: 9 }, maxTicksLimit: 5 },
        title: { display: false },
      },
    },
  };

  doughnutChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  doughnutChartOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '58%',
    plugins: {
      legend: {
        position: 'bottom',
        labels: { usePointStyle: true, padding: 6, boxWidth: 8, font: { size: 9 }, color: '#64748b' },
      },
      tooltip: {
        backgroundColor: 'rgba(15,23,42,0.88)',
        padding: 11,
        cornerRadius: 10,
        callbacks: {
          label: (ctx) => {
            const sec = ctx.parsed as unknown as number;
            return ` ${ctx.label}: ${formatDuration(sec)}`;
          },
        },
      },
    },
  };

  topBarChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  topBarChartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { usePointStyle: true, boxWidth: 6, padding: 6, font: { size: 8 }, color: '#64748b' },
      },
      tooltip: {
        backgroundColor: 'rgba(15,23,42,0.88)',
        padding: 8,
        cornerRadius: 8,
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${formatDuration((ctx.parsed.x as number) * 60)}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        beginAtZero: true,
        grid: { color: 'rgba(148,163,184,0.1)' },
        ticks: { color: '#94a3b8', font: { size: 8 }, maxTicksLimit: 5 },
        title: { display: false },
      },
      y: {
        stacked: true,
        grid: { display: false },
        ticks: { color: '#475569', font: { size: 9, weight: 500 }, padding: 2 },
      },
    },
  };

  // ── Detail drawer ────────────────────────────────────────────────────────────
  drawerStudent: LtStudentRow | null = null;

  // ── Reminder selection ───────────────────────────────────────────────────────
  readonly selectedStudentIds = new Set<string>();
  sendingReminders = false;

  // ── Source colour tokens ─────────────────────────────────────────────────────
  readonly SRC = {
    exercises: { label: 'Exercises', color: '#06b6d4', bg: '#cffafe' },
    digibot: { label: 'DG Bot', color: '#a78bfa', bg: '#f3e8ff' },
    arena: { label: 'Arena', color: '#fbbf24', bg: '#fffbeb' },
  };

  formatDuration = formatDuration;
  readonly Math = Math;

  private readonly destroy$ = new Subject<void>();
  private readonly searchInput$ = new Subject<string>();

  constructor(
    private readonly api: LanguageTrackingApiService,
    private readonly snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.loadFilterOptions();
    this.load();

    this.searchInput$
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.load();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Public actions ───────────────────────────────────────────────────────────

  setCohort(c: LtCohort): void {
    this.cohort = c;
    this.page = 1;
    this.load();
  }

  setQuickRange(q: 'today' | '7d' | '30d'): void {
    this.quickRange = q;
    if (q === 'today') {
      this.from = todayIso();
      this.to = todayIso();
    } else if (q === '7d') {
      this.from = daysAgoIso(6);
      this.to = todayIso();
    } else {
      this.from = daysAgoIso(29);
      this.to = todayIso();
    }
    this.draftFrom = this.from;
    this.draftTo = this.to;
    this.page = 1;
    this.load();
  }

  applyCustomRange(): void {
    if (!this.draftFrom || !this.draftTo) return;
    this.from = this.draftFrom;
    this.to = this.draftTo;
    this.quickRange = 'custom';
    this.page = 1;
    this.load();
  }

  resetFilters(): void {
    this.batch = '';
    this.level = '';
    this.searchRaw = '';
    this.setQuickRange('today');
  }

  get hasAnyFilter(): boolean {
    return !!(this.batch || this.level || (this.searchRaw || '').trim());
  }

  get canApplyCustomRange(): boolean {
    if (!this.draftFrom || !this.draftTo) return false;
    return this.draftFrom !== this.from || this.draftTo !== this.to;
  }

  onBatchChange(): void {
    this.page = 1;
    this.load();
  }

  onLevelChange(): void {
    this.page = 1;
    this.load();
  }

  onSearchChange(): void {
    this.searchInput$.next(this.searchRaw);
  }

  onSortChange(): void {
    this.page = 1;
    this.load();
  }

  goToPage(p: number): void {
    this.page = p;
    this.load();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.PAGE_SIZE));
  }

  openDrawer(s: LtStudentRow): void {
    this.drawerStudent = s;
  }

  closeDrawer(): void {
    this.drawerStudent = null;
  }

  get selectedCount(): number {
    return this.selectedStudentIds.size;
  }

  get allOnPageSelected(): boolean {
    return (
      this.students.length > 0 &&
      this.students.every((s) => this.selectedStudentIds.has(s.studentId))
    );
  }

  isSelected(studentId: string): boolean {
    return this.selectedStudentIds.has(studentId);
  }

  toggleSelect(studentId: string, event?: Event): void {
    event?.stopPropagation();
    if (this.selectedStudentIds.has(studentId)) {
      this.selectedStudentIds.delete(studentId);
    } else {
      this.selectedStudentIds.add(studentId);
    }
  }

  toggleSelectAllOnPage(): void {
    if (this.allOnPageSelected) {
      for (const s of this.students) this.selectedStudentIds.delete(s.studentId);
    } else {
      for (const s of this.students) this.selectedStudentIds.add(s.studentId);
    }
  }

  sendReminderForStudent(student: LtStudentRow, event: Event): void {
    event.stopPropagation();
    this.dispatchReminders([student.studentId], student.name);
  }

  sendBulkReminders(): void {
    if (!this.selectedCount) return;
    this.dispatchReminders([...this.selectedStudentIds]);
  }

  private dispatchReminders(studentIds: string[], singleName?: string): void {
    if (this.sendingReminders || !studentIds.length) return;
    this.sendingReminders = true;
    this.api.sendReminders(studentIds).subscribe({
      next: (res: LtSendRemindersResponse) => {
        this.sendingReminders = false;
        this.showReminderSummary(res, singleName);
        if (res.sent > 0) {
          for (const r of res.results) {
            if (r.ok) this.selectedStudentIds.delete(r.studentId);
          }
        }
      },
      error: () => {
        this.sendingReminders = false;
        this.snackBar.open('Failed to send reminder emails. Please try again.', 'Dismiss', {
          duration: 5000,
        });
      },
    });
  }

  private showReminderSummary(res: LtSendRemindersResponse, singleName?: string): void {
    if (singleName) {
      const one = res.results[0];
      if (res.sent) {
        this.snackBar.open(`Reminder sent to ${singleName}`, 'OK', { duration: 5000 });
        return;
      }
      const why =
        one?.reason === 'all_complete'
          ? 'day already complete'
          : one?.reason === 'no_email'
            ? 'no email on file'
            : 'could not send';
      this.snackBar.open(`No reminder sent for ${singleName} (${why})`, 'OK', { duration: 6000 });
      return;
    }
    const parts: string[] = [];
    if (res.sent) parts.push(`${res.sent} sent`);
    if (res.skipped) parts.push(`${res.skipped} skipped`);
    if (res.failed) parts.push(`${res.failed} failed`);
    this.snackBar.open(parts.join(' · ') || 'No emails sent', 'OK', { duration: 6000 });
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  private loadFilterOptions(): void {
    this.api.getFilterOptions().subscribe({
      next: (r) => {
        this.availableBatches = r.batches || [];
        if (r.levels?.length) this.availableLevels = r.levels;
      },
    });
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api
      .getOverview({
        from: this.from,
        to: this.to,
        cohort: this.cohort,
        batch: this.batch || undefined,
        level: this.level || undefined,
        search: this.searchRaw.trim() || undefined,
        page: this.page,
        limit: this.PAGE_SIZE,
        sort: this.sort,
      })
      .subscribe({
        next: (res: LtOverviewResponse) => {
          this.loading = false;
          this.hasLoadedOnce = true;
          this.kpis = res.kpis;
          this.students = res.students;
          this.total = res.total;
          this.buildCharts(res.students, res.trend, res.kpis);
        },
        error: () => {
          this.loading = false;
          this.hasLoadedOnce = true;
          this.error = 'Failed to load language tracking data. Please try again.';
        },
      });
  }

  // ── Chart builders ────────────────────────────────────────────────────────────

  private buildCharts(students: LtStudentRow[], trend: LtTrendDay[], kpis: LtKpis): void {
    this.buildTrendChart(trend);
    this.buildDoughnutChart(kpis);
    this.buildTopBarChart(students);
  }

  private buildTrendChart(trend: LtTrendDay[]): void {
    const labels = trend.map((d) => {
      const [, m, day] = d.date.split('-');
      return `${parseInt(day)}/${parseInt(m)}`;
    });
    this.trendChartData = {
      labels,
      datasets: [
        {
          label: 'Exercises',
          data: trend.map((d) => Math.round(d.exercises / 60)),
          borderColor: this.SRC.exercises.color,
          backgroundColor: this.SRC.exercises.color + '11',
          borderWidth: 2.5,
          pointRadius: trend.length > 20 ? 0 : 3,
          fill: false,
          tension: 0.35,
        },
        {
          label: 'DG Bot',
          data: trend.map((d) => Math.round(d.digibot / 60)),
          borderColor: this.SRC.digibot.color,
          backgroundColor: this.SRC.digibot.color + '11',
          borderWidth: 2.5,
          pointRadius: trend.length > 20 ? 0 : 3,
          fill: false,
          tension: 0.35,
        },
        {
          label: 'Arena',
          data: trend.map((d) => Math.round(d.arena / 60)),
          borderColor: this.SRC.arena.color,
          backgroundColor: this.SRC.arena.color + '11',
          borderWidth: 2.5,
          pointRadius: trend.length > 20 ? 0 : 3,
          fill: false,
          tension: 0.35,
        },
      ],
    };
  }

  private buildDoughnutChart(kpis: LtKpis): void {
    const exS = Math.round((kpis.exercisesHours || 0) * 3600);
    const dgS = Math.round((kpis.digibotHours || 0) * 3600);
    const arS = Math.round((kpis.arenaHours || 0) * 3600);
    this.doughnutChartData = {
      labels: ['Exercises', 'DG Bot', 'Arena'],
      datasets: [
        {
          data: [exS, dgS, arS],
          backgroundColor: [this.SRC.exercises.color, this.SRC.digibot.color, this.SRC.arena.color],
          borderColor: ['#fff', '#fff', '#fff'],
          borderWidth: 2,
          hoverOffset: 4,
          borderRadius: 4,
        },
      ],
    };
  }

  private buildTopBarChart(students: LtStudentRow[]): void {
    const top = [...students]
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
      .slice(0, 10)
      .reverse();
    this.topBarChartData = {
      labels: top.map((s) => {
        const first = (s.name || '').split(' ')[0] || s.name;
        return s.batch ? `${first} (${s.batch})` : first;
      }),
      datasets: [
        {
          label: 'Exercises',
          data: top.map((s) => Math.round(s.exercisesSeconds / 60)),
          backgroundColor: this.SRC.exercises.color,
          borderRadius: { topRight: 0, bottomRight: 0, topLeft: 4, bottomLeft: 4 },
          barThickness: 10,
          maxBarThickness: 12,
        },
        {
          label: 'DG Bot',
          data: top.map((s) => Math.round(s.digibotSeconds / 60)),
          backgroundColor: this.SRC.digibot.color,
          borderRadius: 0,
          barThickness: 10,
          maxBarThickness: 12,
        },
        {
          label: 'Arena',
          data: top.map((s) => Math.round(s.arenaSeconds / 60)),
          backgroundColor: this.SRC.arena.color,
          borderRadius: { topRight: 4, bottomRight: 4, topLeft: 0, bottomLeft: 0 },
          barThickness: 10,
          maxBarThickness: 12,
        },
      ],
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  completionBarWidth(pct: number): number {
    return Math.max(0, Math.min(100, pct || 0));
  }

  sourceLabel(src: string): string {
    return (this.SRC as Record<string, { label: string }>)[src]?.label ?? src;
  }

  get pages(): number[] {
    const p = this.totalPages;
    if (p <= 7) return Array.from({ length: p }, (_, i) => i + 1);
    const arr: number[] = [1];
    if (this.page > 3) arr.push(-1);
    for (let i = Math.max(2, this.page - 1); i <= Math.min(p - 1, this.page + 1); i++) arr.push(i);
    if (this.page < p - 2) arr.push(-1);
    arr.push(p);
    return arr;
  }
}
