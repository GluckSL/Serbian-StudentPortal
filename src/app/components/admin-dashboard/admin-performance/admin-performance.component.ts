import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration, ChartType } from 'chart.js';
import {
  AdminPerformanceApiService,
  AdminPerformanceBatchPayload,
  AdminPerformanceRange,
  AdminPerformanceStudentPayload
} from '../../../services/admin-performance-api.service';
import { formatPortalDuration } from '../../../pages/portal-analytics/portal-analytics-format';
import { environment } from '../../../../environments/environment';

/** Row from `GET /api/batch-journey` — `batches` are journey-active only. */
interface JourneyActiveBatch {
  batchName: string;
  batchCurrentDay: number;
  journeyLength: number;
  studentCount: number;
  teacherName: string | null;
  journeyActive?: boolean;
  batchType?: 'new' | 'old';
}

interface OverviewStudent {
  _id: string;
  name: string;
  email: string;
  regNo?: string;
  batch?: string;
  overallPct?: number;
  learningPct?: number;
  classPct?: number;
  exercisePct?: number;
  dgPct?: number;
  classProgressText?: string;
  exerciseTopScore?: number;
  exerciseProgressText?: string;
  dgTopMinutes?: number;
  level?: string;
}

@Component({
  selector: 'app-admin-performance',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatPaginatorModule,
    MatIconModule,
    NgChartsModule
  ],
  templateUrl: './admin-performance.component.html',
  styleUrls: ['./admin-performance.component.css']
})
export class AdminPerformanceComponent implements OnInit {
  mainTabIndex = 0;
  detailTabIndex = 0;
  studentDetailsMode = false;
  activeChartRangePicker: 'classes' | 'exercises' | 'dg' | null = null;

  dateFrom = '';
  dateTo = '';
  selectedDatePreset: 'today' | 'yesterday' | 'weekly' | 'overall' = 'weekly';

  overviewStudents: OverviewStudent[] = [];
  studentSearch = '';
  selectedOverviewBatch = '';
  selectedStudent: OverviewStudent | null = null;
  filteredStudents: OverviewStudent[] = [];

  readonly topSpotlightCount = 15;
  directoryPageSize = 15;
  dirPageIndex = 0;

  batchList: string[] = [];
  /** Distinct batch names from students API; merged with journey-active names for the dropdown. */
  private distinctBatchValues: string[] = [];
  selectedBatch = '';

  /** Batches with `journeyActive` (e.g. Platinum); same source as Journey management. */
  journeyActiveBatches: JourneyActiveBatch[] = [];
  loadingJourneyBatches = false;
  batchGridPageSize = 9;
  batchGridPageIndex = 0;

  loadingOverview = false;
  loadingPerformance = false;
  errorMsg = '';

  studentPayload: AdminPerformanceStudentPayload | null = null;
  batchPayload: AdminPerformanceBatchPayload | null = null;

  /** Mixed bar + line charts read a dimensional, dashboard-style look. */
  chartBaseType: ChartType = 'bar';
  chartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 400, easing: 'easeOutQuad' },
    plugins: {
      legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 12, boxWidth: 10 } },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.86)',
        padding: 10,
        cornerRadius: 8,
        displayColors: true
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, color: '#64748b' }
      },
      y: {
        position: 'left',
        beginAtZero: true,
        grid: { color: 'rgba(148, 163, 184, 0.16)' },
        ticks: { color: '#64748b' },
        title: { display: true, text: 'Count / rate', color: '#94a3b8', font: { size: 11 } }
      },
      y1: {
        position: 'right',
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        ticks: { color: '#64748b' },
        title: { display: true, text: 'Minutes / score', color: '#94a3b8', font: { size: 11 } }
      }
    }
  };

  classesChart: ChartConfiguration['data'] = { labels: [], datasets: [] };
  exercisesChart: ChartConfiguration['data'] = { labels: [], datasets: [] };
  dgChart: ChartConfiguration['data'] = { labels: [], datasets: [] };

  formatDuration = formatPortalDuration;

  trackByStudentId(_i: number, s: OverviewStudent): string {
    return s._id;
  }

  /** Students ranked by overall progress (all batches). */
  private studentsAfterBatchFilter(): OverviewStudent[] {
    const selected = String(this.selectedOverviewBatch || '').trim();
    if (!selected) return this.overviewStudents;
    return this.overviewStudents.filter((s) => String(s.batch || '').trim() === selected);
  }

  private studentsRanked(): OverviewStudent[] {
    return [...this.studentsAfterBatchFilter()].sort(
      (a, b) => (b.overallPct ?? 0) - (a.overallPct ?? 0) || (a.name || '').localeCompare(b.name || '')
    );
  }

  get overviewBatchOptions(): string[] {
    const set = new Set<string>();
    for (const s of this.overviewStudents) {
      const b = String(s.batch || '').trim();
      if (b) set.add(b);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  get top15Students(): OverviewStudent[] {
    return this.studentsRanked().slice(0, this.topSpotlightCount);
  }

  get directoryAfterTop(): OverviewStudent[] {
    return this.studentsRanked();
  }

  get directorySlice(): OverviewStudent[] {
    const start = this.dirPageIndex * this.directoryPageSize;
    return this.directoryAfterTop.slice(start, start + this.directoryPageSize);
  }

  get directoryTotal(): number {
    return this.directoryAfterTop.length;
  }

  get journeyBatchSlice(): JourneyActiveBatch[] {
    const start = this.batchGridPageIndex * this.batchGridPageSize;
    return this.journeyActiveBatches.slice(start, start + this.batchGridPageSize);
  }

  get journeyBatchTotal(): number {
    return this.journeyActiveBatches.length;
  }

  onJourneyBatchPage(ev: PageEvent): void {
    this.batchGridPageIndex = ev.pageIndex;
    this.batchGridPageSize = ev.pageSize;
  }

  trackByBatchName(_i: number, b: JourneyActiveBatch): string {
    return b.batchName;
  }

  /** Opens Journey management with this batch selected (new tab). */
  openJourneyForBatch(batchName: string, ev?: Event): void {
    ev?.stopPropagation();
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/admin/journey'], {
        queryParams: { batch: batchName, tab: 'progress', progressOnly: '1' }
      })
    );
    window.open(url, '_blank', 'noopener');
  }

  batchCompletionPct(b: JourneyActiveBatch): number {
    const len = Number(b?.journeyLength || 0);
    const day = Number(b?.batchCurrentDay || 0);
    if (!len) return 0;
    return Math.max(0, Math.min(100, Math.round((day / len) * 100)));
  }

  onDirectoryPage(ev: PageEvent): void {
    this.dirPageIndex = ev.pageIndex;
    this.directoryPageSize = ev.pageSize;
  }

  onOverviewBatchChange(): void {
    this.dirPageIndex = 0;
    this.applyStudentFilter();
  }

  isRowSelected(s: OverviewStudent): boolean {
    return !!this.selectedStudent && this.selectedStudent._id === s._id;
  }

  selectStudentRow(s: OverviewStudent): void {
    this.selectedStudent = s;
    this.studentSearch = this.displayStudent(s);
    this.errorMsg = '';
    this.refreshStudentPerformance();
  }

  constructor(
    private http: HttpClient,
    private api: AdminPerformanceApiService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.onDatePresetChange();
    const studentId = this.route.snapshot.paramMap.get('studentId');
    const qFrom = this.route.snapshot.queryParamMap.get('from');
    const qTo = this.route.snapshot.queryParamMap.get('to');
    if (qFrom) this.dateFrom = qFrom;
    if (qTo) this.dateTo = qTo;

    if (studentId) {
      this.studentDetailsMode = true;
      this.selectedStudent = { _id: studentId, name: 'Student', email: '' };
      this.refreshStudentPerformance();
      return;
    }

    this.loadOverviewStudents();
  }

  onDatePresetChange(): void {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (this.selectedDatePreset === 'today') {
      this.dateFrom = today;
      this.dateTo = today;
      return;
    }
    if (this.selectedDatePreset === 'yesterday') {
      const y = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
      this.dateFrom = y;
      this.dateTo = y;
      return;
    }
    if (this.selectedDatePreset === 'weekly') {
      const from = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
      this.dateFrom = from;
      this.dateTo = today;
      return;
    }
    const overallFrom = new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10);
    this.dateFrom = overallFrom;
    this.dateTo = today;
  }

  private rangePayload(): AdminPerformanceRange | null {
    if (!this.dateFrom || !this.dateTo) return null;
    return { from: this.dateFrom, to: this.dateTo };
  }

  loadOverviewStudents(): void {
    this.loadingOverview = true;
    this.http.get<OverviewStudent[]>('/api/student-progress/admin/overview', { withCredentials: true }).subscribe({
      next: (rows) => {
        this.overviewStudents = rows || [];
        this.dirPageIndex = 0;
        this.applyStudentFilter();
        this.loadingOverview = false;
      },
      error: () => {
        this.loadingOverview = false;
        this.errorMsg = 'Could not load student list.';
      }
    });
  }

  onStudentSearchInput(): void {
    this.applyStudentFilter();
  }

  private applyStudentFilter(): void {
    const baseRows = this.studentsAfterBatchFilter();
    const q = this.studentSearch.toLowerCase().trim();
    if (!q) {
      this.filteredStudents = baseRows.slice(0, 80);
      return;
    }
    this.filteredStudents = baseRows
      .filter(
        (s) =>
          (s.name || '').toLowerCase().includes(q) ||
          (s.email || '').toLowerCase().includes(q) ||
          (s.regNo || '').toLowerCase().includes(q)
      )
      .slice(0, 50);
  }

  /** Prevents [object Object] in the input when the model is an OverviewStudent. */
  displayWithStudent = (v: OverviewStudent | string | null): string => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    return this.displayStudent(v);
  };

  displayStudent(s: OverviewStudent | null): string {
    return s ? `${s.name}${s.regNo ? ` · ${s.regNo}` : ''}` : '';
  }

  onStudentOption(ev: MatAutocompleteSelectedEvent): void {
    const s = ev.option.value as OverviewStudent;
    if (!this.studentDetailsMode) {
      this.openStudentDetails(s);
      return;
    }
    this.selectedStudent = s;
    this.studentSearch = this.displayStudent(s);
    this.errorMsg = '';
    this.refreshStudentPerformance();
  }

  refreshStudentPerformance(): void {
    const range = this.rangePayload();
    if (!this.selectedStudent || !range) return;
    this.loadingPerformance = true;
    this.errorMsg = '';
    this.api.getStudent(this.selectedStudent._id, range).subscribe({
      next: (p) => {
        this.selectedStudent = {
          _id: p.student._id,
          name: p.student.name,
          email: p.student.email,
          regNo: p.student.regNo,
          batch: p.student.batch
        };
        this.studentPayload = p;
        this.batchPayload = null;
        this.buildCharts(p.series, 'student');
        this.loadingPerformance = false;
      },
      error: () => {
        this.loadingPerformance = false;
        this.errorMsg = 'Failed to load student performance.';
      }
    });
  }

  onMainTabChange(index: number): void {
    this.mainTabIndex = index;
    this.detailTabIndex = 0;
    this.errorMsg = '';
    if (index === 1) {
      this.loadBatchList();
    }
  }

  loadBatchList(): void {
    this.http
      .get<{ success: boolean; values: string[] }>('/api/admin/students/distinct/batch', { withCredentials: true })
      .subscribe({
        next: (res) => {
          this.distinctBatchValues = res?.values || [];
          this.rebuildBatchDropdown();
        },
        error: () => {
          this.distinctBatchValues = [];
          this.rebuildBatchDropdown();
        }
      });

    this.loadingJourneyBatches = true;
    this.http
      .get<{ batches: JourneyActiveBatch[] }>(`${environment.apiUrl}/batch-journey`, { withCredentials: true })
      .subscribe({
        next: (r) => {
          this.journeyActiveBatches = (r?.batches || []).sort((a, b) =>
            String(a.batchName || '').localeCompare(String(b.batchName || ''), undefined, { numeric: true })
          );
          this.loadingJourneyBatches = false;
          const maxIdx = Math.max(0, Math.ceil(this.journeyActiveBatches.length / this.batchGridPageSize) - 1);
          if (this.batchGridPageIndex > maxIdx) this.batchGridPageIndex = maxIdx;
          this.rebuildBatchDropdown();
        },
        error: () => {
          this.journeyActiveBatches = [];
          this.loadingJourneyBatches = false;
          this.rebuildBatchDropdown();
        }
      });
  }

  private rebuildBatchDropdown(): void {
    const set = new Set<string>();
    for (const v of this.distinctBatchValues) {
      if (v) set.add(String(v).trim());
    }
    for (const b of this.journeyActiveBatches) {
      const n = String(b.batchName || '').trim();
      if (n) set.add(n);
    }
    this.batchList = Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  refreshBatchPerformance(): void {
    const range = this.rangePayload();
    if (!this.selectedBatch || !range) return;
    this.loadingPerformance = true;
    this.errorMsg = '';
    this.api.getBatch(this.selectedBatch, range).subscribe({
      next: (p) => {
        this.batchPayload = p;
        this.studentPayload = null;
        this.buildCharts(p.series, 'batch');
        this.loadingPerformance = false;
      },
      error: (err) => {
        this.loadingPerformance = false;
        const msg = err?.error?.message;
        this.errorMsg = typeof msg === 'string' ? msg : 'Failed to load batch performance.';
      }
    });
  }

  applyDateRange(): void {
    if (this.studentDetailsMode && this.selectedStudent) {
      this.refreshStudentPerformance();
      return;
    }
    if (this.mainTabIndex === 0 && this.selectedStudent) this.refreshStudentPerformance();
    if (this.mainTabIndex === 1 && this.selectedBatch) this.refreshBatchPerformance();
  }

  toggleChartRangePicker(target: 'classes' | 'exercises' | 'dg'): void {
    this.activeChartRangePicker = this.activeChartRangePicker === target ? null : target;
  }

  applyChartRange(target: 'classes' | 'exercises' | 'dg', ev?: Event): void {
    ev?.stopPropagation();
    this.activeChartRangePicker = null;
    this.applyDateRange();
  }

  openStudentDetails(s: OverviewStudent, ev?: Event): void {
    ev?.stopPropagation();
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/admin/performance/student', s._id], {
        queryParams: { from: this.dateFrom, to: this.dateTo }
      })
    );
    window.open(url, '_blank', 'noopener');
  }

  private buildCharts(series: AdminPerformanceStudentPayload['series'], mode: 'student' | 'batch'): void {
    const scopedSeries = this.filterSeriesByRange(series);
    const labels = this.buildTimelineLabels(scopedSeries.classes.map((d) => d.date));
    const bar3d = {
      borderRadius: 8,
      borderSkipped: false,
      maxBarThickness: 24,
      borderWidth: 0
    };

    if (mode === 'student') {
      this.classesChart = {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Classes attended',
            data: scopedSeries.classes.map((d) => d.attendedCount),
            yAxisID: 'y',
            backgroundColor: (ctx) => this.areaGradient(ctx, '#3b82f6', '#1d4ed8'),
            ...bar3d
          },
          {
            type: 'line',
            label: 'Minutes present',
            data: scopedSeries.classes.map((d) => d.minutesPresent),
            yAxisID: 'y1',
            borderColor: '#a855f7',
            backgroundColor: 'rgba(168,85,247,0.12)',
            borderWidth: 3,
            tension: 0.35,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#a855f7',
            pointBorderWidth: 2,
            pointHoverRadius: 6
          }
        ]
      };
    } else {
      this.classesChart = {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Attendance rate %',
            data: scopedSeries.classes.map((d) => d.attendanceRatePct ?? 0),
            yAxisID: 'y',
            backgroundColor: (ctx) => this.areaGradient(ctx, '#0ea5e9', '#0369a1'),
            ...bar3d
          },
          {
            type: 'line',
            label: 'Total minutes (batch)',
            data: scopedSeries.classes.map((d) => d.minutesPresent ?? 0),
            yAxisID: 'y1',
            borderColor: '#14b8a6',
            backgroundColor: 'rgba(20,184,166,0.12)',
            borderWidth: 3,
            tension: 0.35,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#14b8a6',
            pointBorderWidth: 2
          }
        ]
      };
    }

    this.exercisesChart = {
      labels: this.buildTimelineLabels(scopedSeries.exercises.map((d) => d.date)),
      datasets: [
        {
          type: 'bar',
          label: 'Completed attempts',
          data: scopedSeries.exercises.map((d) => d.completedCount),
          yAxisID: 'y',
          backgroundColor: (ctx) => this.areaGradient(ctx, '#f97316', '#c2410c'),
          ...bar3d
        },
        {
          type: 'line',
          label: 'Avg score %',
          data: scopedSeries.exercises.map((d) => d.avgScore),
          yAxisID: 'y1',
          borderColor: '#eab308',
          backgroundColor: 'rgba(234,179,8,0.15)',
          borderWidth: 3,
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#ca8a04',
          pointBorderWidth: 2
        }
      ]
    };

    this.dgChart = {
      labels: this.buildTimelineLabels(scopedSeries.dg.map((d) => d.date)),
      datasets: [
        {
          type: 'bar',
          label: 'DG sessions',
          data: scopedSeries.dg.map((d) => d.sessionCount),
          yAxisID: 'y',
          backgroundColor: (ctx) => this.areaGradient(ctx, '#ec4899', '#be185d'),
          ...bar3d
        },
        {
          type: 'line',
          label: 'Practice minutes',
          data: scopedSeries.dg.map((d) => d.practiceMinutes),
          yAxisID: 'y1',
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.12)',
          borderWidth: 3,
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#6366f1',
          pointBorderWidth: 2
        }
      ]
    };
  }

  private filterSeriesByRange(series: AdminPerformanceStudentPayload['series']): AdminPerformanceStudentPayload['series'] {
    const from = (this.dateFrom || '').slice(0, 10);
    const to = (this.dateTo || '').slice(0, 10);
    if (!from || !to) return series;

    const inRange = (dateValue: string): boolean => {
      const d = String(dateValue || '').slice(0, 10);
      return d >= from && d <= to;
    };

    return {
      classes: (series.classes || []).filter((r) => inRange(r.date)),
      exercises: (series.exercises || []).filter((r) => inRange(r.date)),
      dg: (series.dg || []).filter((r) => inRange(r.date))
    };
  }

  private buildTimelineLabels(rawDates: string[]): string[] {
    const from = (this.dateFrom || '').slice(0, 10);
    const to = (this.dateTo || '').slice(0, 10);
    const daySpan = from && to ? this.daysBetweenInclusive(from, to) : 999;
    const shortRange = daySpan <= 10;

    return rawDates.map((d) => {
      const iso = String(d || '').slice(0, 10);
      const dt = new Date(iso);
      if (Number.isNaN(dt.getTime())) return iso;
      const dd = String(dt.getDate()).padStart(2, '0');
      if (shortRange) return dd;
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      return `${mm}-${dd}`;
    });
  }

  private daysBetweenInclusive(fromIso: string, toIso: string): number {
    const from = new Date(`${fromIso}T00:00:00`);
    const to = new Date(`${toIso}T00:00:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 999;
    const diff = Math.floor((to.getTime() - from.getTime()) / 86400000);
    return Math.max(1, diff + 1);
  }

  /** Vertical gradient for bars (depth-style fill). */
  private areaGradient(context: unknown, topColor: string, bottomColor: string): CanvasGradient | string {
    const c = context as { chart?: { ctx?: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } };
    const chart = c.chart;
    const { ctx, chartArea } = chart || {};
    if (!ctx || !chartArea) return topColor;
    const g = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    g.addColorStop(0, this.hexA(bottomColor, 0.95));
    g.addColorStop(0.45, this.hexA(topColor, 0.88));
    g.addColorStop(1, this.hexA(topColor, 0.55));
    return g;
  }

  private hexA(hex: string, alpha: number): string {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
