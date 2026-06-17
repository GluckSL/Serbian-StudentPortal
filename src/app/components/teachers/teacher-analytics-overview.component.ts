import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
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
  detailTeacher: TeacherSummaryRow | null = null;
  expandedBatchIds = new Set<string>();

  readonly batchPreviewCount = 5;

  filterTutor = '';
  filterBatch = '';
  filterLevel = '';
  filterMedium = '';
  dateFrom = '';
  dateTo = '';

  readonly skeletonKpis = [1, 2, 3, 4];
  readonly skeletonRows = Array.from({ length: 8 });

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeDetail();
  }

  ngOnInit(): void {
    this.loadOverview();
  }

  private authHeaders(): HttpHeaders | undefined {
    const token = getAuthToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
  }

  loadOverview(): void {
    this.loading = true;
    this.error = '';
    this.closeDetail();

    let url = `${apiUrl}/admin/teachers/analytics-overview`;
    const params: string[] = [];
    if (this.dateFrom) params.push(`from=${encodeURIComponent(this.dateFrom)}`);
    if (this.dateTo) params.push(`to=${encodeURIComponent(this.dateTo)}`);
    if (params.length) url += `?${params.join('&')}`;

    this.http
      .get<{ success: boolean; data: OverviewData }>(url, {
        withCredentials: true,
        headers: this.authHeaders(),
      })
      .subscribe({
        next: (res) => {
          if (res?.success && res.data) {
            this.teachers = res.data.teachers || res.data.rows || [];
            this.totals = res.data.totals || null;
            this.generatedAt = res.data.generatedAt || '';
            this.applyFilters();
          } else {
            this.error = 'Unable to load teacher analytics.';
          }
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Unable to load teacher analytics.';
          this.loading = false;
        },
      });
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
    this.dateFrom = '';
    this.dateTo = '';
    this.loadOverview();
  }

  applyDateFilter(): void {
    this.loadOverview();
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

  openTeacherReport(teacher: TeacherSummaryRow): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/teachers', teacher.teacherId, 'analytics']),
    );
    window.open(url, '_blank');
  }

  exportCsv(): void {
    if (!this.filteredTeachers.length) return;
    const header = [
      'Tutor', 'Reg No', 'Email', 'Medium', 'Batches', 'Levels',
      'Students', 'Classes', 'Total Tutor Hours', 'Attendance %',
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
}
