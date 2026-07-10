import { Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ZoomService } from '../../services/zoom.service';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { environment } from '../../../environments/environment';

interface ClassAttendanceRow {
  meetingId: string;
  topic: string;
  batch: string;
  startTime: string;
  duration: number;
  teacherName: string;
  attended: boolean;
  attendancePercent: number;
  attendedMinutes: number;
  status: string;
}

interface StudentAttendanceRow {
  studentId: string;
  name: string;
  email: string;
  batch: string;
  totalClasses: number;
  attendedClasses: number;
  absentClasses: number;
  attendanceScore: number;
  avgAttendancePercent: number;
  progressText: string;
  attendedMinutes: number;
  totalMinutes: number;
  classes?: ClassAttendanceRow[];
}

interface MeetingSummaryRow {
  _id: string;
  topic: string;
  batch: string;
  startTime: string;
  duration: number;
  teacherName: string;
  totalStudents: number;
  attended: number;
  absent: number;
  attendanceRate: number;
}

@Component({
  selector: 'app-attendance-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './attendance-dashboard.component.html',
  styleUrls: ['./attendance-dashboard.component.css'],
})
export class AttendanceDashboardComponent implements OnInit {
  loading = true;
  loadingPage = false;
  detailLoading = false;
  error = '';

  students: StudentAttendanceRow[] = [];
  meetings: MeetingSummaryRow[] = [];
  selectedStudent: StudentAttendanceRow | null = null;

  summary = {
    totalMeetings: 0,
    totalStudents: 0,
    totalClassSlots: 0,
    totalAttendedSlots: 0,
    avgAttendanceRate: 0,
    avgStudentScore: 0,
    studentsBelow75: 0,
  };

  teacherFilter = 'all';
  allBatchesSelected = true;
  selectedBatches: string[] = [];
  batchDropdownOpen = false;
  dateFilter = 'all';
  customDateFrom = '';
  customDateTo = '';
  searchQuery = '';
  studentSearch = '';

  currentPage = 1;
  pageSize = 25;
  pageSizeOptions = [25, 50, 100];
  totalItems = 0;
  totalPages = 1;

  teacherOptions: string[] = [];
  journeyBatchNames: string[] = [];
  isTeacherRole = false;

  viewTab: 'students' | 'classes' = 'students';
  scoreFilter: 'all' | 'below75' | 'above75' = 'all';
  levelFilter = 'all';
  statusFilter: 'all' | 'UNCERTAIN' | 'ONGOING' | 'COMPLETED' | 'WITHDREW' = 'ONGOING';

  readonly levelOptions = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  readonly skeletonStatCount = [0, 1, 2, 3, 4];
  readonly skeletonRowCount = [0, 1, 2, 3, 4, 5, 6, 7];

  private readonly destroyRef = inject(DestroyRef);
  private readonly searchDebounced = new Subject<string>();
  private readonly studentSearchDebounced = new Subject<string>();

  constructor(
    private zoomService: ZoomService,
    private authService: AuthService,
    private router: Router,
    private notify: NotificationService,
    private http: HttpClient,
  ) {}

  ngOnInit(): void {
    this.searchDebounced.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => {
      this.currentPage = 1;
      this.loadDashboard();
    });

    this.studentSearchDebounced.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => {
      this.currentPage = 1;
      this.loadDashboard();
    });

    this.authService.currentUser$.subscribe((user) => {
      if (!user) return;
      this.isTeacherRole = user.role === 'TEACHER';
      this.loadReferenceData();
      this.loadDashboard();
    });
  }

  trackStudent(_index: number, s: StudentAttendanceRow): string {
    return s.studentId || s.email || s.name;
  }

  trackMeeting(_index: number, m: MeetingSummaryRow): string {
    return m._id;
  }

  trackClass(_index: number, c: ClassAttendanceRow): string {
    return c.meetingId;
  }

  private loadReferenceData(): void {
    this.http.get<{ batches: { batchName: string }[]; upcomingBatches?: { batchName: string }[] }>(
      `${environment.apiUrl}/batch-journey`,
      { withCredentials: true },
    ).subscribe({
      next: (res) => {
        const rows = [...(res?.batches || []), ...(res?.upcomingBatches || [])];
        const names: string[] = [];
        for (const b of rows) {
          const bn = b?.batchName;
          if (typeof bn === 'string' && bn.trim()) names.push(bn.trim());
        }
        this.journeyBatchNames = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
      },
      error: () => {
        this.journeyBatchNames = [];
      },
    });

    if (!this.isTeacherRole) {
      this.zoomService.getTeachers().subscribe({
        next: (res) => {
          const raw = res?.data;
          const rows: unknown[] = Array.isArray(raw) ? raw : [];
          const names: string[] = [];
          for (const item of rows) {
            if (item && typeof item === 'object' && 'name' in item) {
              const n = (item as { name?: unknown }).name;
              if (typeof n === 'string' && n.trim().length > 0) names.push(n.trim());
            }
          }
          this.teacherOptions = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
        },
        error: () => {
          this.teacherOptions = [];
        },
      });
    }
  }

  private buildFilters(includeStudentDetail = false): Parameters<ZoomService['getAttendanceDashboard']>[0] {
    const filters: NonNullable<Parameters<ZoomService['getAttendanceDashboard']>[0]> = {
      page: this.currentPage,
      limit: this.pageSize,
    };

    const q = this.searchQuery.trim();
    if (q) filters.search = q;

    const sq = this.studentSearch.trim();
    if (sq) filters.studentSearch = sq;

    if (!this.isTeacherRole && this.teacherFilter !== 'all') {
      filters.teacherName = this.teacherFilter;
    }

    if (!this.allBatchesSelected && this.selectedBatches.length) {
      filters.batch = this.selectedBatches.join(',');
    }

    if (this.dateFilter !== 'all') {
      filters.datePreset = this.dateFilter;
      if (this.dateFilter === 'custom') {
        if (this.customDateFrom) filters.dateFrom = this.customDateFrom;
        if (this.customDateTo) filters.dateTo = this.customDateTo;
      }
    }

    if (includeStudentDetail && this.selectedStudent?.studentId) {
      filters.studentId = this.selectedStudent.studentId;
    }

    if (this.scoreFilter !== 'all') {
      filters.scoreFilter = this.scoreFilter;
    }

    if (this.levelFilter !== 'all') {
      filters.level = this.levelFilter;
    }

    if (this.statusFilter !== 'all') {
      filters.studentStatus = this.statusFilter;
    }

    return filters;
  }

  loadDashboard(opts?: { quiet?: boolean; keepDetail?: boolean }): void {
    const quiet = !!opts?.quiet;
    if (!quiet) {
      this.loadingPage = this.students.length > 0;
      this.loading = this.students.length === 0;
    }
    this.error = '';

    const selectedId = opts?.keepDetail ? this.selectedStudent?.studentId : undefined;

    this.zoomService.getAttendanceDashboard(this.buildFilters(!!selectedId)).subscribe({
      next: (res) => {
        if (!res?.success) {
          this.error = res?.message || 'Failed to load attendance dashboard';
          this.loading = false;
          this.loadingPage = false;
          return;
        }

        this.students = res.students || [];
        this.meetings = res.meetings || [];
        this.summary = res.summary || this.summary;
        this.totalItems = res.pagination?.totalItems ?? this.students.length;
        this.totalPages = Math.max(res.pagination?.totalPages || 1, 1);

        if (res.selectedStudent) {
          this.selectedStudent = res.selectedStudent;
        } else if (
          this.selectedStudent &&
          !this.students.some((s) => s.studentId === this.selectedStudent?.studentId)
        ) {
          this.selectedStudent = null;
        }

        this.loading = false;
        this.loadingPage = false;
        this.detailLoading = false;
      },
      error: () => {
        this.error = 'Failed to load attendance dashboard';
        this.loading = false;
        this.loadingPage = false;
        this.detailLoading = false;
      },
    });
  }

  private loadStudentDetail(student: StudentAttendanceRow): void {
    this.detailLoading = true;
    this.selectedStudent = { ...student };

    this.zoomService.getAttendanceDashboard({
      ...this.buildFilters(),
      studentId: student.studentId,
      page: this.currentPage,
      limit: this.pageSize,
    }).subscribe({
      next: (res) => {
        this.detailLoading = false;
        if (res?.success && res.selectedStudent) {
          this.selectedStudent = res.selectedStudent;
        }
      },
      error: () => {
        this.detailLoading = false;
      },
    });
  }

  onSearchChange(): void {
    this.searchDebounced.next(this.searchQuery.trim());
  }

  onStudentSearchChange(): void {
    this.studentSearchDebounced.next(this.studentSearch.trim());
  }

  onFilterChange(): void {
    this.currentPage = 1;
    this.selectedStudent = null;
    this.loadDashboard();
  }

  onScoreFilterChange(): void {
    this.currentPage = 1;
    this.selectedStudent = null;
    this.loadDashboard();
  }

  selectStudent(student: StudentAttendanceRow): void {
    if (this.selectedStudent?.studentId === student.studentId) {
      this.selectedStudent = null;
      return;
    }
    this.loadStudentDetail(student);
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.studentSearch = '';
    this.teacherFilter = 'all';
    this.allBatchesSelected = true;
    this.selectedBatches = [];
    this.dateFilter = 'all';
    this.customDateFrom = '';
    this.customDateTo = '';
    this.scoreFilter = 'all';
    this.levelFilter = 'all';
    this.statusFilter = 'ONGOING';
    this.currentPage = 1;
    this.selectedStudent = null;
    this.loadDashboard();
  }

  goBack(): void {
    this.router.navigate(['/admin/zoom-reports']);
  }

  goToPrevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadDashboard({ quiet: true, keepDetail: true });
    }
  }

  goToNextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.loadDashboard({ quiet: true, keepDetail: true });
    }
  }

  onPageSizeChange(): void {
    this.currentPage = 1;
    this.loadDashboard({ quiet: true, keepDetail: true });
  }

  get pageStartIndex(): number {
    if (!this.totalItems) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEndIndex(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalItems);
  }

  formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString('sr-Latn-RS', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  }

  formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
  }

  scoreClass(score: number): string {
    if (score >= 75) return 'ad-pill ad-pill--good';
    if (score >= 50) return 'ad-pill ad-pill--mid';
    return 'ad-pill ad-pill--low';
  }

  exportStudentsCsv(): void {
    if (!this.students.length) {
      this.notify.warning('No student data to export.');
      return;
    }
    const header = [
      'Student Name',
      'Email',
      'Batch',
      'Classes Attended',
      'Total Classes',
      'Attendance Score %',
      'Avg Class %',
      'Minutes Attended',
      'Total Minutes',
    ];
    const rows = this.students.map((s) => [
      this.csvEscape(s.name),
      this.csvEscape(s.email),
      this.csvEscape(s.batch),
      s.attendedClasses,
      s.totalClasses,
      s.attendanceScore,
      s.avgAttendancePercent,
      s.attendedMinutes,
      s.totalMinutes,
    ]);
    this.downloadCsv('attendance-dashboard-students.csv', [header, ...rows]);
  }

  exportDetailCsv(): void {
    const student = this.selectedStudent;
    if (!student?.classes?.length) {
      this.notify.warning('Select a student with class history to export details.');
      return;
    }
    const header = [
      'Student Name',
      'Email',
      'Batch',
      'Date',
      'Class Topic',
      'Teacher',
      'Status',
      'Class %',
      'Minutes Attended',
      'Class Duration (min)',
    ];
    const rows = student.classes.map((c) => [
      this.csvEscape(student.name),
      this.csvEscape(student.email),
      this.csvEscape(student.batch),
      this.csvEscape(this.formatDateTime(c.startTime)),
      this.csvEscape(c.topic),
      this.csvEscape(c.teacherName),
      c.status,
      c.attendancePercent,
      c.attendedMinutes,
      c.duration,
    ]);
    const safeName = student.name.replace(/[^\w-]+/g, '_').slice(0, 40);
    this.downloadCsv(`attendance-${safeName}.csv`, [header, ...rows]);
  }

  exportMeetingsCsv(): void {
    if (!this.meetings.length) {
      this.notify.warning('No class data to export.');
      return;
    }
    const header = [
      'Date',
      'Topic',
      'Batch',
      'Teacher',
      'Duration (min)',
      'Attended',
      'Absent',
      'Rate %',
    ];
    const rows = this.meetings.map((m) => [
      this.csvEscape(this.formatDateTime(m.startTime)),
      this.csvEscape(m.topic),
      this.csvEscape(String(m.batch)),
      this.csvEscape(m.teacherName),
      m.duration,
      m.attended,
      m.absent,
      m.attendanceRate,
    ]);
    this.downloadCsv('attendance-dashboard-classes.csv', [header, ...rows]);
  }

  private csvEscape(val: string): string {
    const s = String(val ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  private downloadCsv(filename: string, rows: (string | number)[][]): void {
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    this.notify.success('CSV exported.');
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.batchDropdownOpen = false;
  }

  get batchFilterLabel(): string {
    if (this.allBatchesSelected) return 'All Batches';
    if (this.selectedBatches.length === 1) return this.selectedBatches[0];
    if (!this.selectedBatches.length) return 'Select batches…';
    return `${this.selectedBatches.length} batches`;
  }

  toggleBatchDropdown(event: Event): void {
    event.stopPropagation();
    this.batchDropdownOpen = !this.batchDropdownOpen;
  }

  isBatchChecked(batch: string): boolean {
    return this.allBatchesSelected || this.selectedBatches.includes(batch);
  }

  selectAllBatches(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.allBatchesSelected = checked;
    if (checked) this.selectedBatches = [];
    this.onFilterChange();
  }

  toggleBatchSelection(batch: string, event: Event): void {
    event.stopPropagation();
    this.allBatchesSelected = false;
    const idx = this.selectedBatches.indexOf(batch);
    if (idx >= 0) this.selectedBatches.splice(idx, 1);
    else this.selectedBatches.push(batch);
    if (!this.selectedBatches.length) this.allBatchesSelected = true;
    this.onFilterChange();
  }
}
