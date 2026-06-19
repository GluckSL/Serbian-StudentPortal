import { Component, OnInit, OnDestroy, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
import { Subject, debounceTime, distinctUntilChanged, forkJoin, takeUntil } from 'rxjs';
import * as XLSX from 'xlsx';

import {
  LanguageTrackingApiService,
  LtCohort,
  LtKpis,
  LtOverviewResponse,
  LtSendRemindersResponse,
  LtStudentRow,
  LtTrendDay,
} from './language-tracking-api.service';
import { TestAccountBadgeComponent } from '../../shared/test-account-badge/test-account-badge.component';

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
    TestAccountBadgeComponent,
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
  selectedBatches: string[] = [];
  isBatchDropdownOpen = false;
  level = '';
  searchRaw = '';
  includeTestAccounts = false;
  quickRange: 'today' | 'lastday' | '7d' | '30d' | 'custom' = 'today';

  availableBatches: string[] = [];
  availableLevels: string[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  // ── Data ────────────────────────────────────────────────────────────────────
  loading = false;
  /** Used for skeletons only on first load. */
  hasLoadedOnce = false;
  error = '';
  kpis: LtKpis | null = null;
  students: LtStudentRow[] = [];
  trend: LtTrendDay[] = [];
  topStudents: LtStudentRow[] = [];
  total = 0;
  page = 1;
  readonly PAGE_SIZE = 25;
  exporting = false;

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
    private readonly router: Router,
    private readonly elementRef: ElementRef,
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

  setQuickRange(q: 'today' | 'lastday' | '7d' | '30d'): void {
    this.quickRange = q;
    if (q === 'today') {
      this.from = todayIso();
      this.to = todayIso();
    } else if (q === 'lastday') {
      this.from = daysAgoIso(1);
      this.to = daysAgoIso(1);
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
    this.selectedBatches = [];
    this.level = '';
    this.searchRaw = '';
    this.includeTestAccounts = false;
    this.setQuickRange('today');
  }

  onIncludeTestAccountsChange(): void {
    this.page = 1;
    this.load();
  }

  get hasAnyFilter(): boolean {
    return !!(
      this.selectedBatches.length ||
      this.level ||
      (this.searchRaw || '').trim() ||
      this.includeTestAccounts
    );
  }

  get batchFilterLabel(): string {
    if (!this.selectedBatches.length) return 'All batches';
    if (this.selectedBatches.length === 1) return this.selectedBatches[0];
    return `${this.selectedBatches.length} selected`;
  }

  toggleBatchDropdown(event?: Event): void {
    event?.stopPropagation();
    this.isBatchDropdownOpen = !this.isBatchDropdownOpen;
  }

  isBatchSelected(batch: string): boolean {
    return this.selectedBatches.includes(batch);
  }

  toggleBatch(batch: string, event?: Event): void {
    event?.stopPropagation();
    if (this.selectedBatches.includes(batch)) {
      this.selectedBatches = this.selectedBatches.filter((b) => b !== batch);
    } else {
      this.selectedBatches = [...this.selectedBatches, batch];
    }
    this.onBatchChange();
  }

  clearBatchSelection(event?: Event): void {
    event?.stopPropagation();
    if (!this.selectedBatches.length) return;
    this.selectedBatches = [];
    this.onBatchChange();
  }

  selectAllBatches(event?: Event): void {
    event?.stopPropagation();
    this.selectedBatches = [...this.availableBatches];
    this.onBatchChange();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isBatchDropdownOpen = false;
    }
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

  openStudentDetail(s: LtStudentRow, event?: Event): void {
    event?.stopPropagation();
    const tree = this.router.createUrlTree(
      ['/admin/language-tracking/student', s.studentId],
      {
        queryParams: {
          from: this.from,
          to: this.to,
          week: Math.ceil((s.currentCourseDay || 1) / 7),
          day: s.currentCourseDay || 1,
        },
      },
    );
    const url = this.router.serializeUrl(tree);
    window.open(url, '_blank', 'noopener');
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

  exportReport(): void {
    if (this.exporting) return;

    const exportLimit = 100;
    const totalRows = Math.max(0, this.total || 0);
    const pages = Math.max(1, Math.ceil(totalRows / exportLimit));
    this.exporting = true;

    const requests = Array.from({ length: pages }, (_, i) =>
      this.api.getOverview({
        ...this.currentOverviewParams(),
        includeProgress: true,
        page: i + 1,
        limit: exportLimit,
      }),
    );

    forkJoin(requests).subscribe({
      next: (responses) => {
        const first = responses[0];
        const rows = responses.flatMap((r) => r.students || []);
        this.downloadLanguageTrackingWorkbook(
          first?.kpis || this.kpis,
          first?.trend || this.trend,
          first?.topStudents || this.topStudents,
          rows,
        );
        this.exporting = false;
        this.snackBar.open(`Exported ${rows.length} student(s)`, 'OK', { duration: 4000 });
      },
      error: () => {
        this.exporting = false;
        this.snackBar.open('Failed to export language tracking report. Please try again.', 'Dismiss', {
          duration: 5000,
        });
      },
    });
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
        ...this.currentOverviewParams(),
        page: this.page,
        limit: this.PAGE_SIZE,
      })
      .subscribe({
        next: (res: LtOverviewResponse) => {
          this.loading = false;
          this.hasLoadedOnce = true;
          this.kpis = res.kpis;
          this.students = res.students;
          this.trend = res.trend || [];
          this.topStudents = res.topStudents ?? res.students;
          this.total = res.total;
          this.buildCharts(res.topStudents ?? res.students, res.trend, res.kpis);
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

  private currentOverviewParams() {
    return {
      from: this.from,
      to: this.to,
      cohort: this.cohort,
      batches: this.selectedBatches.length ? this.selectedBatches : undefined,
      level: this.level || undefined,
      search: this.searchRaw.trim() || undefined,
      includeTestAccounts: this.includeTestAccounts,
      sort: this.sort,
    };
  }

  private downloadLanguageTrackingWorkbook(
    kpis: LtKpis | null,
    trend: LtTrendDay[],
    topStudents: LtStudentRow[],
    students: LtStudentRow[],
  ): void {
    const wb = XLSX.utils.book_new();
    const generatedAt = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const summaryRows = [
      ['Language Tracking Report'],
      ['Generated At', generatedAt],
      ['Date Range', `${this.from} to ${this.to}`],
      ['Cohort', this.cohortLabel(this.cohort)],
      ['Batches', this.selectedBatches.length ? this.selectedBatches.join(', ') : 'All batches'],
      ['Level', this.level || 'All levels'],
      ['Search', this.searchRaw.trim() || 'None'],
      ['Test Accounts', this.includeTestAccounts ? 'Included' : 'Excluded'],
      ['Sort', this.sortLabel(this.sort)],
      [],
      ['Card', 'Value'],
      ['Total Learning Time', `${kpis?.totalLearningHours ?? 0}h`],
      ['Active Students', `${kpis?.activeStudents ?? 0} / ${kpis?.totalStudents ?? 0}`],
      ['Avg / Active Student', `${kpis?.avgMinutesPerStudent ?? 0}m`],
      ['Top Source This Period', this.sourceLabel(kpis?.topSource || 'exercises')],
      ['Exercises', `${kpis?.exercisesHours ?? 0}h`],
      ['DG Bot', `${kpis?.digibotHours ?? 0}h`],
      ['GluckArena', `${kpis?.arenaHours ?? 0}h`],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary Cards');

    const studentRows = students.map((s) => ({
      Student: s.name || '',
      'Reg No': s.regNo || '',
      Email: s.email || '',
      Batch: s.batch || '',
      Level: s.level || '',
      Subscription: s.subscription || '',
      'GO Status': s.goStatus || '',
      'Journey Day': s.currentCourseDay || '',
      Exercises: this.formatDuration(s.exercisesSeconds),
      'DG Bot': this.formatDuration(s.digibotSeconds),
      Arena: this.formatDuration(s.arenaSeconds),
      Total: this.formatDuration(s.totalSeconds),
      'Exercises Seconds': s.exercisesSeconds || 0,
      'DG Bot Seconds': s.digibotSeconds || 0,
      'Arena Seconds': s.arenaSeconds || 0,
      'Total Seconds': s.totalSeconds || 0,
      'Last Learning At': this.formatExportDateTime(s.lastLearningAt),
      'Test Account': s.isTestAccount ? 'Yes' : 'No',
      'Day Progress': this.progressLabel(s),
      'Day Completion %': s.journeyProgress?.completionPercent ?? '',
      'Exercises Progress': this.sourceProgressLabel(s, 'exercises'),
      'DG Bot Progress': this.sourceProgressLabel(s, 'dg'),
      'GluckArena Progress': this.sourceProgressLabel(s, 'arena'),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(studentRows), 'Student Details');

    const sourceProgressRows = students.flatMap((s) => [
      this.studentSourceProgressRow(s, 'Exercises', 'exercises', s.exercisesSeconds),
      this.studentSourceProgressRow(s, 'DG Bot', 'dg', s.digibotSeconds),
      this.studentSourceProgressRow(s, 'GluckArena', 'arena', s.arenaSeconds),
    ]);
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(sourceProgressRows),
      'Source Progress',
    );

    const trendRows = trend.map((d) => ({
      Date: d.date,
      Exercises: this.formatDuration(d.exercises),
      'DG Bot': this.formatDuration(d.digibot),
      Arena: this.formatDuration(d.arena),
      Total: this.formatDuration(d.total),
      'Exercises Seconds': d.exercises,
      'DG Bot Seconds': d.digibot,
      'Arena Seconds': d.arena,
      'Total Seconds': d.total,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trendRows), 'Daily Trend');

    const topRows = topStudents.map((s, index) => ({
      Rank: index + 1,
      Student: s.name || '',
      'Reg No': s.regNo || '',
      Batch: s.batch || '',
      Exercises: this.formatDuration(s.exercisesSeconds),
      'DG Bot': this.formatDuration(s.digibotSeconds),
      Arena: this.formatDuration(s.arenaSeconds),
      Total: this.formatDuration(s.totalSeconds),
      'Total Seconds': s.totalSeconds || 0,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topRows), 'Top 10 Students');

    XLSX.writeFile(wb, `language_tracking_${this.from}_to_${this.to}.xlsx`);
  }

  private studentSourceProgressRow(
    student: LtStudentRow,
    source: string,
    key: 'exercises' | 'dg' | 'arena',
    seconds: number,
  ): Record<string, string | number> {
    const progress = student.journeyProgress?.sources?.[key];
    const total = progress?.total ?? 0;
    const done = progress?.done ?? 0;
    return {
      Student: student.name || '',
      'Reg No': student.regNo || '',
      Email: student.email || '',
      Batch: student.batch || '',
      Level: student.level || '',
      'Journey Day': student.journeyProgress?.day || student.currentCourseDay || '',
      Source: source,
      Progress: `${done}/${total}`,
      Completed: done,
      Total: total,
      'Completion %': total > 0 ? Math.floor((done / total) * 100) : 0,
      Time: this.formatDuration(seconds),
      Seconds: seconds || 0,
    };
  }

  private progressLabel(student: LtStudentRow): string {
    const progress = student.journeyProgress;
    if (!progress) return '';
    return `${progress.doneTasks || 0}/${progress.totalTasks || 0}`;
  }

  private sourceProgressLabel(
    student: LtStudentRow,
    source: 'exercises' | 'dg' | 'arena',
  ): string {
    const progress = student.journeyProgress?.sources?.[source];
    return progress?.label || '0/0';
  }

  private formatExportDateTime(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  private cohortLabel(c: LtCohort): string {
    if (c === 'platinum') return 'Platinum';
    if (c === 'go') return 'Silver (GO)';
    return 'All Students';
  }

  private sortLabel(sort: 'totalSeconds' | 'name' | 'currentCourseDay'): string {
    if (sort === 'name') return 'Name';
    if (sort === 'currentCourseDay') return 'Journey Day';
    return 'Total Time';
  }

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
