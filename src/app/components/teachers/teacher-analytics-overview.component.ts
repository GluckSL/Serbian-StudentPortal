import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { getAuthToken } from '../../services/auth.service';

const apiUrl = environment.apiUrl;

export interface TeacherBatchRow {
  batch: string;
  level: string;
  studentCount: number;
  meetingCount: number;
  tutorHours: number;
  attendance: number | null;
}

export interface LevelRate {
  level: string;
  rate: number | null;
}

const RATES_STORAGE_KEY = 'ta_teacher_level_rates';
const TDS_PERCENT = 10;

export interface TeacherSummaryRow {
  teacherId: string;
  tutor: string;
  regNo: string;
  email: string;
  medium: string;
  batches: string[];
  levels: string;
  batchCount: number;
  studentCount: number;
  meetingCount: number;
  tutorHours: number;
  tutorMinutes: number;
  attendance: number | null;
  batchBreakdown: TeacherBatchRow[];
  levelHourlyRates?: Record<string, number>;
  noTds?: boolean;
}

interface OverviewTotals {
  teachers: number;
  rows: number;
  totalTutorHours: number;
  totalStudents: number;
  avgAttendance: number | null;
}

interface OverviewData {
  teachers: TeacherSummaryRow[];
  rows: TeacherSummaryRow[];
  totals: OverviewTotals;
  generatedAt: string;
  filters?: {
    month?: string;
    monthLabel?: string;
  };
}

@Component({
  selector: 'app-teacher-analytics-overview',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './teacher-analytics-overview.component.html',
  styleUrls: ['./teacher-analytics-overview.component.css'],
})
export class TeacherAnalyticsOverviewComponent implements OnInit {
  loading = true;
  error = '';
  teachers: TeacherSummaryRow[] = [];
  filteredTeachers: TeacherSummaryRow[] = [];
  totals: OverviewTotals | null = null;
  generatedAt = '';
  overviewMonthLabel = '';
  detailTeacher: TeacherSummaryRow | null = null;
  expandedBatchIds = new Set<string>();

  readonly batchPreviewCount = 5;

  filterTutor = '';
  filterBatch = '';
  filterLevel = '';
  filterMedium = '';
  selectedMonth = this.getCurrentMonth();

  readonly skeletonKpis = [1, 2, 3, 4];
  readonly skeletonRows = Array.from({ length: 8 });

  managerTeacher: TeacherSummaryRow | null = null;
  managerRates: LevelRate[] = [];
  savingRates = false;
  ratesError = '';
  private allLevelRates: Record<string, Record<string, number>> = {};
  togglingTdsId: string | null = null;

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.managerTeacher) { this.closeManager(); return; }
    this.closeDetail();
  }

  ngOnInit(): void {
    this.loadOverview();
  }

  private authHeaders(): HttpHeaders | undefined {
    const token = getAuthToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
  }

  loadOverview(forceRefresh = false): void {
    this.error = '';
    this.closeDetail();
    this.loading = true;

    const month = this.selectedMonth;
    let url = `${apiUrl}/admin/teachers/analytics-overview`;
    const params: string[] = [];
    if (month) params.push(`month=${encodeURIComponent(month)}`);
    if (forceRefresh) params.push('refresh=1');
    if (params.length) url += `?${params.join('&')}`;

    this.http
      .get<{ success: boolean; data: OverviewData }>(url, {
        withCredentials: true,
        headers: this.authHeaders(),
      })
      .pipe(timeout(60_000))
      .subscribe({
        next: (res) => {
          if (res?.success && res.data) {
            this.applyOverviewData(res.data);
            this.syncLocalRatesToServerIfNeeded();
          } else {
            this.error = 'Unable to load teacher analytics.';
          }
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.name === 'TimeoutError'
            ? 'Analytics took too long to load. Please try again.'
            : (err?.error?.message || 'Unable to load teacher analytics.');
          this.loading = false;
        },
      });
  }

  trackTeacher(_index: number, teacher: TeacherSummaryRow): string {
    return teacher.teacherId;
  }

  private applyOverviewData(data: OverviewData): void {
    this.teachers = data.teachers || data.rows || [];
    this.totals = data.totals || null;
    this.generatedAt = data.generatedAt || '';
    this.selectedMonth = data.filters?.month || this.selectedMonth;
    this.overviewMonthLabel = data.filters?.monthLabel || this.formatMonthLabel(this.selectedMonth);
    this.hydrateRatesFromTeachers();
    this.applyFilters();
  }

  private hydrateRatesFromTeachers(): void {
    for (const teacher of this.teachers) {
      if (teacher.levelHourlyRates && Object.keys(teacher.levelHourlyRates).length) {
        this.allLevelRates[teacher.teacherId] = { ...teacher.levelHourlyRates };
      }
    }
  }

  private readLegacyLocalRates(): Record<string, Record<string, number>> {
    try {
      const raw = localStorage.getItem(RATES_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private syncLocalRatesToServerIfNeeded(): void {
    const legacy = this.readLegacyLocalRates();
    for (const teacher of this.teachers) {
      const local = legacy[teacher.teacherId];
      const hasServer = teacher.levelHourlyRates && Object.keys(teacher.levelHourlyRates).length;
      if (!local || !Object.keys(local).length || hasServer) continue;
      this.http
        .put<{ success: boolean; data: { levelHourlyRates: Record<string, number> } }>(
          `${apiUrl}/admin/teachers/${teacher.teacherId}/level-rates`,
          { rates: local },
          { withCredentials: true, headers: this.authHeaders() },
        )
        .subscribe({
          next: (res) => {
            if (res?.success && res.data?.levelHourlyRates) {
              teacher.levelHourlyRates = res.data.levelHourlyRates;
              this.allLevelRates[teacher.teacherId] = { ...res.data.levelHourlyRates };
            }
          },
        });
    }
    if (Object.keys(legacy).length) {
      localStorage.removeItem(RATES_STORAGE_KEY);
    }
  }

  applyFilters(): void {
    const tutorQ = this.filterTutor.trim().toLowerCase();
    const batchQ = this.filterBatch.trim().toLowerCase();
    const levelQ = this.filterLevel.trim().toUpperCase();
    const mediumQ = this.filterMedium.trim().toLowerCase();

    this.filteredTeachers = this.teachers.filter((t) => {
      if (tutorQ && !t.tutor.toLowerCase().includes(tutorQ)) return false;
      if (batchQ && !t.batches.some((b) => String(b).toLowerCase().includes(batchQ))) return false;
      if (levelQ && !String(t.levels).toUpperCase().includes(levelQ)) return false;
      if (mediumQ && !String(t.medium).toLowerCase().includes(mediumQ)) return false;
      return true;
    });
  }

  clearFilters(): void {
    this.filterTutor = '';
    this.filterBatch = '';
    this.filterLevel = '';
    this.filterMedium = '';
    this.selectedMonth = this.getCurrentMonth();
    this.loadOverview();
  }

  applyMonthFilter(): void {
    this.loadOverview(true);
  }

  openDetail(teacher: TeacherSummaryRow): void {
    this.detailTeacher = teacher;
    document.body.style.overflow = 'hidden';
  }

  closeDetail(): void {
    this.detailTeacher = null;
    document.body.style.overflow = '';
  }

  hasMoreBatches(teacher: TeacherSummaryRow): boolean {
    return (teacher.batches?.length || 0) > this.batchPreviewCount;
  }

  isBatchesExpanded(teacher: TeacherSummaryRow): boolean {
    return this.expandedBatchIds.has(teacher.teacherId);
  }

  toggleBatches(teacher: TeacherSummaryRow, event: Event): void {
    event.stopPropagation();
    const next = new Set(this.expandedBatchIds);
    if (next.has(teacher.teacherId)) {
      next.delete(teacher.teacherId);
    } else {
      next.add(teacher.teacherId);
    }
    this.expandedBatchIds = next;
  }

  displayedBatches(teacher: TeacherSummaryRow): string[] {
    const batches = teacher.batches || [];
    if (!batches.length) return [];
    if (this.isBatchesExpanded(teacher) || batches.length <= this.batchPreviewCount) {
      return batches;
    }
    return batches.slice(0, this.batchPreviewCount);
  }

  hiddenBatchCount(teacher: TeacherSummaryRow): number {
    return Math.max(0, (teacher.batches?.length || 0) - this.batchPreviewCount);
  }

  formatHours(hours: number): string {
    return (hours || 0).toFixed(2);
  }

  formatAttendance(pct: number | null): string {
    if (pct == null) return '—';
    return `${pct.toFixed(2)}%`;
  }

  attendanceClass(pct: number | null): string {
    if (pct == null) return '';
    if (pct >= 80) return 'att-good';
    if (pct >= 60) return 'att-warn';
    return 'att-bad';
  }

  openManager(teacher: TeacherSummaryRow): void {
    this.managerTeacher = teacher;
    const levels = this.getTeacherLevels(teacher);
    const saved = this.allLevelRates[teacher.teacherId] || {};
    this.managerRates = levels.map((lvl) => ({ level: lvl, rate: saved[lvl] ?? null }));
    document.body.style.overflow = 'hidden';
  }

  closeManager(): void {
    this.managerTeacher = null;
    this.managerRates = [];
    document.body.style.overflow = '';
  }

  saveManagerRates(): void {
    if (!this.managerTeacher || this.savingRates) return;
    const rateMap: Record<string, number> = {};
    for (const lr of this.managerRates) {
      const rate = Number(lr.rate);
      if (Number.isFinite(rate) && rate >= 0) rateMap[lr.level] = rate;
    }

    this.savingRates = true;
    this.ratesError = '';
    const teacherId = this.managerTeacher.teacherId;

    this.http
      .put<{ success: boolean; data: { levelHourlyRates: Record<string, number> } }>(
        `${apiUrl}/admin/teachers/${teacherId}/level-rates`,
        { rates: rateMap },
        { withCredentials: true, headers: this.authHeaders() },
      )
      .subscribe({
        next: (res) => {
          this.savingRates = false;
          if (res?.success && res.data?.levelHourlyRates) {
            this.allLevelRates[teacherId] = { ...res.data.levelHourlyRates };
            const row = this.teachers.find((t) => t.teacherId === teacherId);
            if (row) row.levelHourlyRates = { ...res.data.levelHourlyRates };
            this.closeManager();
          } else {
            this.ratesError = 'Unable to save rates. Please try again.';
          }
        },
        error: (err) => {
          this.savingRates = false;
          this.ratesError = err?.error?.message || 'Unable to save rates. Please try again.';
        },
      });
  }

  private getTeacherLevels(_teacher: TeacherSummaryRow): string[] {
    return ['A1', 'A2', 'B1', 'B2'];
  }

  computeTotal(teacher: TeacherSummaryRow): number {
    const rates = this.allLevelRates[teacher.teacherId] || {};
    if (teacher.batchBreakdown?.length) {
      return teacher.batchBreakdown.reduce((sum, b) => {
        const r = this.getRateForLevelText(b.level, rates) || this.getFallbackRateForTeacher(teacher, rates);
        return sum + (b.tutorHours || 0) * r;
      }, 0);
    }
    return (teacher.tutorHours || 0) * this.getFallbackRateForTeacher(teacher, rates);
  }

  computeTDS(teacher: TeacherSummaryRow): number {
    if (teacher.noTds) return 0;
    return this.computeTotal(teacher) * TDS_PERCENT / 100;
  }

  computeFinal(teacher: TeacherSummaryRow): number {
    return this.computeTotal(teacher) - this.computeTDS(teacher);
  }

  toggleNoTds(teacher: TeacherSummaryRow, event: Event): void {
    event.stopPropagation();
    if (this.togglingTdsId === teacher.teacherId) return;
    this.togglingTdsId = teacher.teacherId;
    this.http
      .put<{ success: boolean; data: { teacherId: string; noTds: boolean } }>(
        `${apiUrl}/admin/teachers/${teacher.teacherId}/toggle-tds`,
        {},
        { withCredentials: true, headers: this.authHeaders() },
      )
      .subscribe({
        next: (res) => {
          this.togglingTdsId = null;
          if (res?.success) {
            teacher.noTds = res.data.noTds;
            const inFiltered = this.filteredTeachers.find(t => t.teacherId === teacher.teacherId);
            if (inFiltered) inFiltered.noTds = res.data.noTds;
          }
        },
        error: () => { this.togglingTdsId = null; },
      });
  }

  getRateDisplay(teacher: TeacherSummaryRow): string {
    const rates = this.allLevelRates[teacher.teacherId];
    if (!rates || !Object.keys(rates).length) return '—';
    return Object.entries(rates).map(([l, r]) => `${l}:${r}`).join(', ');
  }

  hasRates(teacher: TeacherSummaryRow): boolean {
    const rates = this.allLevelRates[teacher.teacherId];
    return !!rates && Object.keys(rates).length > 0;
  }

  private getRateForLevelText(levelText: string, rates: Record<string, number>): number {
    const levels = this.extractKnownLevels(levelText);
    if (!levels.length) return 0;
    if (levels.length === 1) return Number(rates[levels[0]] ?? 0);
    const matchingRates = levels
      .map((level) => Number(rates[level] ?? 0))
      .filter((rate) => Number.isFinite(rate) && rate > 0);
    if (matchingRates.length === 1) return matchingRates[0];
    return 0;
  }

  private getFallbackRateForTeacher(teacher: TeacherSummaryRow, rates: Record<string, number>): number {
    const levels = this.extractKnownLevels(teacher.levels);
    const matchingRates = levels
      .map((level) => Number(rates[level] ?? 0))
      .filter((rate) => Number.isFinite(rate) && rate > 0);
    if (matchingRates.length) {
      return matchingRates.reduce((sum, rate) => sum + rate, 0) / matchingRates.length;
    }
    const allRates = Object.values(rates)
      .map((rate) => Number(rate))
      .filter((rate) => Number.isFinite(rate) && rate > 0);
    return allRates.length ? allRates.reduce((sum, rate) => sum + rate, 0) / allRates.length : 0;
  }

  private extractKnownLevels(levelText: string): string[] {
    const matches = String(levelText || '').toUpperCase().match(/\b(A1|A2|B1|B2)\b/g) || [];
    return [...new Set(matches)];
  }

  openTeacherReport(teacher: TeacherSummaryRow): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/teachers', teacher.teacherId, 'analytics']),
    );
    window.open(url, '_blank');
  }

  openMonthlyHours(teacher: TeacherSummaryRow): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/teachers', teacher.teacherId, 'monthly-hours'], {
        queryParams: { month: this.selectedMonth },
      }),
    );
    window.open(url, '_blank');
  }

  exportCsv(): void {
    if (!this.filteredTeachers.length) return;
    const header = [
      'Tutor', 'Reg No', 'Email', 'Medium', 'Batches', 'Levels',
      'Students', 'Classes', 'Monthly Tutor Hours', 'Attendance %',
    ];
    const lines = this.filteredTeachers.map((t) => [
      t.tutor,
      t.regNo,
      t.email,
      t.medium,
      t.batches.join('; '),
      t.levels,
      t.studentCount,
      t.meetingCount,
      this.formatHours(t.tutorHours),
      t.attendance != null ? t.attendance.toFixed(2) : '',
    ]);
    const csv = [header, ...lines]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    this.downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      `teacher-analytics-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  printReport(): void {
    window.print();
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private formatMonthLabel(month: string): string {
    const [year, monthNumber] = month.split('-').map(Number);
    if (!year || !monthNumber) return month;
    return new Date(year, monthNumber - 1, 1).toLocaleString('sr-Latn-RS', {
      month: 'long',
      year: 'numeric',
    });
  }
}
