// src/app/components/admin-dashboard/correction/correction.component.ts

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { debounceTime, catchError, takeUntil } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../services/notification.service';

interface Student {
  _id: string;
  name: string;
  email: string;
  regNo: string;
  batch: string;
  level: string;
  subscription?: string;
  currentCourseDay: number;
  studentStatus?: string;
}

interface CorrectionStats {
  totalStudents: number;
  onJourney: number;
  a1: number;
  a2Plus: number;
}

interface DayCard {
  day: number;
  exerciseCount: number;
  dgCount: number;
  gameCount: number;
  recordingCount?: number;
}

interface ResourceItem {
  _id: string;
  title: string;
  courseDay: number;
  type: 'exercise' | 'dg' | 'game' | 'recording';
  attempted: boolean;
  completed: boolean;
  scorePercentage?: number | null;
  earnedPoints?: number | null;
  totalPoints?: number | null;
  attemptId?: string | null;
  sequenceLetter?: string;
  completionPercent?: number | null;
  sessionId?: string | null;
  accuracy?: number | null;
  score?: number | null;
  gameType?: string;
  completedAt?: string | null;
  recordingKind?: 'manual' | 'zoom';
  watchPercent?: number | null;
  watchSeconds?: number | null;
  durationSeconds?: number | null;
}

interface DayResources {
  day: number;
  isSilverStudent?: boolean;
  exercises: ResourceItem[];
  dgModules: ResourceItem[];
  games: ResourceItem[];
  recordings: ResourceItem[];
}

interface StudentListResponse {
  success: boolean;
  data: Student[];
  pagination?: { total: number; page: number; limit: number; pages: number };
}

interface FilterOptionsResponse {
  success: boolean;
  batches: string[];
}

@Component({
  selector: 'app-correction',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './correction.component.html',
  styleUrls: ['./correction.component.css']
})
export class CorrectionComponent implements OnInit, OnDestroy {

  private readonly apiBase = environment.apiUrl;
  private destroy$ = new Subject<void>();
  private filterChange$ = new Subject<void>();

  // ─── Dashboard stats ─────────────────────────────────────────────────────
  stats: CorrectionStats = { totalStudents: 0, onJourney: 0, a1: 0, a2Plus: 0 };
  statsLoading = true;

  // ─── Student list ──────────────────────────────────────────────────────────
  students: Student[] = [];
  listLoading = false;
  listError = '';

  filterSearch = '';
  filterBatch = '';
  filterLevel = '';
  filterPlan = '';

  batchOptions: string[] = [];
  readonly levelOptions = ['A1', 'A2', 'B1', 'B2'];
  readonly planOptions = ['PLATINUM', 'SILVER'];
  readonly pageSizeOptions = [10, 20, 50];
  pageSize = 20;
  currentPage = 1;
  totalStudents = 0;
  totalPages = 1;

  readonly skeletonKpis = Array.from({ length: 4 }, (_, i) => i);
  readonly skeletonRows = Array.from({ length: 10 }, (_, i) => i);
  readonly skeletonDayCards = Array.from({ length: 12 }, (_, i) => i);
  readonly skeletonResources = Array.from({ length: 5 }, (_, i) => i);
  readonly skeletonFilters = Array.from({ length: 4 }, (_, i) => i);

  // ─── Student detail view ───────────────────────────────────────────────────
  viewMode: 'list' | 'detail' = 'list';
  selectedStudent: Student | null = null;
  isSilverStudent = false;
  dayCards: DayCard[] = [];
  loadingDays = false;
  selectedDay: number | null = null;
  dayResources: DayResources | null = null;
  loadingResources = false;

  correctionItem: ResourceItem | null = null;
  correctionScore = 100;
  correctionLoading = false;
  actionLoading: Record<string, boolean> = {};

  constructor(
    private http: HttpClient,
    private notif: NotificationService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.loadStats();
    this.loadFilterOptions();
    this.loadStudents();

    this.filterChange$.pipe(
      debounceTime(350),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.currentPage = 1;
      this.loadStudents();
    });

    this.restoreFromQueryParams();
  }

  private restoreFromQueryParams(): void {
    const studentId = this.route.snapshot.queryParamMap.get('studentId');
    const dayStr = this.route.snapshot.queryParamMap.get('day');
    if (!studentId) return;

    this.loadingDays = true;
    this.viewMode = 'detail';
    this.http.get<{ student: Partial<Student>; days: DayCard[]; currentCourseDay: number }>(
      `${this.apiBase}/correction/student/${studentId}/journey-days`,
      { withCredentials: true }
    ).pipe(
      catchError(() => { this.notif.error('Could not restore student view'); return of(null); }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      if (!res?.student) {
        this.loadingDays = false;
        return;
      }
      this.selectedStudent = {
        _id: studentId,
        name: res.student.name || '',
        email: res.student.email || '',
        regNo: (res.student as { regNo?: string }).regNo || '',
        batch: res.student.batch || '',
        level: res.student.level || '',
        currentCourseDay: res.currentCourseDay || 0
      };
      this.dayCards = res.days || [];
      this.loadingDays = false;
      if (dayStr) {
        const day = parseInt(dayStr, 10);
        if (!isNaN(day)) this.selectDay(day);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadStats(): void {
    this.statsLoading = true;
    this.http.get<CorrectionStats>(`${this.apiBase}/correction/stats`, { withCredentials: true }).pipe(
      catchError(() => of({ totalStudents: 0, onJourney: 0, a1: 0, a2Plus: 0 })),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.stats = res;
      this.statsLoading = false;
    });
  }

  loadFilterOptions(): void {
    this.http.get<FilterOptionsResponse>(`${this.apiBase}/admin/students/filter-options`, { withCredentials: true }).pipe(
      catchError(() => of({ success: false, batches: [] })),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.batchOptions = res.batches || [];
    });
  }

  onFilterChange(): void {
    this.filterChange$.next();
  }

  buildListParams(): HttpParams {
    let params = new HttpParams()
      .set('page', String(this.currentPage))
      .set('limit', String(this.pageSize));
    if (this.filterSearch.trim()) params = params.set('studentName', this.filterSearch.trim());
    if (this.filterBatch) params = params.set('batch', this.filterBatch);
    if (this.filterLevel) params = params.set('level', this.filterLevel);
    if (this.filterPlan) params = params.set('plan', this.filterPlan);
    return params;
  }

  loadStudents(): void {
    this.listLoading = true;
    this.listError = '';
    this.http.get<StudentListResponse>(`${this.apiBase}/admin/students`, {
      params: this.buildListParams(),
      withCredentials: true
    }).pipe(
      catchError(err => {
        this.listError = err?.error?.message || 'Failed to load students';
        return of({ success: false, data: [], pagination: { total: 0, page: 1, limit: this.pageSize, pages: 1 } });
      }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.listLoading = false;
      if (res.success !== false) {
        this.students = (res.data || []).map(s => ({
          ...s,
          currentCourseDay: s.currentCourseDay ?? 0
        }));
        this.totalStudents = res.pagination?.total ?? this.students.length;
        this.currentPage = res.pagination?.page ?? this.currentPage;
        this.pageSize = res.pagination?.limit ?? this.pageSize;
        this.totalPages = res.pagination?.pages ?? 1;
      }
    });
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 1;
    this.loadStudents();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.currentPage = page;
    this.loadStudents();
  }

  get pageNumbers(): number[] {
    const pages: number[] = [];
    const start = Math.max(1, this.currentPage - 2);
    const end = Math.min(this.totalPages, this.currentPage + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  openStudent(student: Student): void {
    this.selectedStudent = student;
    this.viewMode = 'detail';
    this.selectedDay = null;
    this.dayResources = null;
    this.dayCards = [];
    this.loadingDays = true;

    this.http.get<{ days: DayCard[]; currentCourseDay: number; student: Student }>(
      `${this.apiBase}/correction/student/${student._id}/journey-days`,
      { withCredentials: true }
    ).pipe(
      catchError(() => { this.notif.error('Failed to load journey days'); return of({ days: [], currentCourseDay: 0, student }); }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.loadingDays = false;
      this.dayCards = res.days || [];
      this.isSilverStudent = String(res.student?.subscription || student.subscription || '').toUpperCase() === 'SILVER';
      if (res.student) {
        this.selectedStudent = { ...student, ...res.student, currentCourseDay: res.currentCourseDay || student.currentCourseDay };
      }
    });
  }

  backToList(): void {
    this.viewMode = 'list';
    this.selectedStudent = null;
    this.dayCards = [];
    this.selectedDay = null;
    this.dayResources = null;
    this.correctionItem = null;
  }

  selectDay(day: number): void {
    if (this.selectedDay === day && this.dayResources) return;
    this.selectedDay = day;
    this.dayResources = null;
    this.loadingResources = true;
    this.actionLoading = {};

    this.http.get<DayResources>(
      `${this.apiBase}/correction/student/${this.selectedStudent!._id}/day/${day}/resources`,
      { withCredentials: true }
    ).pipe(
      catchError(() => { this.notif.error('Failed to load resources'); return of(null); }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.loadingResources = false;
      this.dayResources = res;
    });
  }

  markComplete(item: ResourceItem): void {
    const key = `${item.type}-${item._id}`;
    if (this.actionLoading[key]) return;

    if (item.type === 'recording') {
      this.markRecordingWatched(item);
      return;
    }

    this.actionLoading[key] = true;

    const studentId = this.selectedStudent!._id;
    let url = '';
    if (item.type === 'exercise') url = `${this.apiBase}/correction/student/${studentId}/exercise/${item._id}/mark-complete`;
    else if (item.type === 'dg') url = `${this.apiBase}/correction/student/${studentId}/dg/${item._id}/mark-complete`;
    else if (item.type === 'game') url = `${this.apiBase}/correction/student/${studentId}/game/${item._id}/mark-complete`;
    else return;

    this.http.post<{ success: boolean }>(url, {}, { withCredentials: true }).pipe(
      catchError(() => { this.notif.error('Action failed. Please try again.'); return of(null); }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.actionLoading[key] = false;
      if (res?.success) {
        this.notif.success('Marked as complete!');
        this.applyCompleteLocally(item);
      }
    });
  }

  markRecordingWatched(item: ResourceItem): void {
    const key = `${item.type}-${item._id}`;
    if (this.actionLoading[key]) return;
    this.actionLoading[key] = true;

    const studentId = this.selectedStudent!._id;
    const url = `${this.apiBase}/correction/student/${studentId}/recording/${item._id}/mark-watched`;

    this.http.post<{
      success: boolean;
      watched?: boolean;
      journeyAdvanced?: boolean;
      newCourseDay?: number;
    }>(url, { kind: item.recordingKind || 'manual' }, { withCredentials: true }).pipe(
      catchError(() => { this.notif.error('Failed to mark recording as watched.'); return of(null); }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.actionLoading[key] = false;
      if (res?.success) {
        this.notif.success(res.journeyAdvanced && res.newCourseDay
          ? `Recording marked watched — student advanced to Day ${res.newCourseDay}`
          : 'Recording marked as watched!');
        this.applyRecordingWatchedLocally(item);
        if (res.journeyAdvanced && res.newCourseDay && this.selectedStudent) {
          this.selectedStudent = { ...this.selectedStudent, currentCourseDay: res.newCourseDay };
        }
      }
    });
  }

  private applyRecordingWatchedLocally(item: ResourceItem): void {
    item.completed = true;
    item.attempted = true;
    item.watchPercent = 100;
    if (item.durationSeconds) item.watchSeconds = item.durationSeconds;
  }

  private applyCompleteLocally(item: ResourceItem): void {
    item.completed = true;
    item.attempted = true;
    if (item.type === 'exercise') { item.scorePercentage = 100; item.earnedPoints = item.totalPoints || 1; }
    if (item.type === 'dg') item.completionPercent = 100;
    if (item.type === 'game') item.accuracy = 100;
  }

  canReviewExercise(item: ResourceItem): boolean {
    return item.type === 'exercise' && !!item.attemptId && item.completed;
  }

  openReview(item: ResourceItem): void {
    if (!this.canReviewExercise(item) || !item.attemptId || !this.selectedStudent) return;
    const day = this.selectedDay ?? item.courseDay;
    const tree = this.router.createUrlTree(
      ['/admin/correction/review', this.selectedStudent._id, item._id, item.attemptId],
      { queryParams: { day } }
    );
    const url = window.location.origin + this.router.serializeUrl(tree);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  openCorrection(item: ResourceItem): void {
    this.correctionItem = item;
    this.correctionScore = item.scorePercentage ?? 0;
  }

  closeCorrection(): void {
    this.correctionItem = null;
    this.correctionLoading = false;
  }

  submitCorrection(): void {
    if (!this.correctionItem || this.correctionLoading) return;
    const item = this.correctionItem;
    const studentId = this.selectedStudent!._id;

    if (item.type !== 'exercise') {
      this.markComplete(item);
      this.closeCorrection();
      return;
    }

    const score = Math.min(100, Math.max(0, this.correctionScore));
    this.correctionLoading = true;

    this.http.patch<{ success: boolean; attempt: { scorePercentage: number; earnedPoints: number; totalPoints: number } }>(
      `${this.apiBase}/correction/student/${studentId}/exercise/${item._id}/correct`,
      { scorePercentage: score },
      { withCredentials: true }
    ).pipe(
      catchError(() => { this.notif.error('Correction failed.'); return of(null); }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.correctionLoading = false;
      if (res?.success) {
        this.notif.success(`Score updated to ${score}%`);
        item.scorePercentage = res.attempt.scorePercentage;
        item.earnedPoints = res.attempt.earnedPoints;
        item.totalPoints = res.attempt.totalPoints;
        item.completed = true;
        item.attempted = true;
        this.closeCorrection();
      }
    });
  }

  getStatusClass(item: ResourceItem): string {
    if (item.completed) return 'status-completed';
    if (item.attempted) return 'status-partial';
    return 'status-not-attempted';
  }

  getStatusLabel(item: ResourceItem): string {
    if (item.type === 'recording') {
      if (item.completed) return 'Watched';
      if (item.attempted) return 'Partial';
      return 'Not Watched';
    }
    if (item.completed) return 'Completed';
    if (item.attempted) return 'In Progress';
    return 'Not Attempted';
  }

  getScoreDisplay(item: ResourceItem): string {
    if (!item.attempted && item.type !== 'recording') return '—';
    if (item.type === 'recording') {
      if (!item.attempted) return '—';
      return item.watchPercent != null ? `${Math.round(item.watchPercent)}%` : '—';
    }
    if (item.type === 'exercise') return item.scorePercentage != null ? `${Math.round(item.scorePercentage)}%` : '—';
    if (item.type === 'dg') return item.completionPercent != null ? `${Math.round(item.completionPercent)}%` : item.completed ? '100%' : '—';
    if (item.type === 'game') return item.accuracy != null ? `${Math.round(item.accuracy)}%` : '—';
    return '—';
  }

  getTypeIcon(type: string): string {
    if (type === 'exercise') return 'fitness_center';
    if (type === 'dg') return 'pets';
    if (type === 'game') return 'sports_esports';
    if (type === 'recording') return 'videocam';
    return 'help';
  }

  getTypeLabel(type: string): string {
    if (type === 'exercise') return 'Exercise';
    if (type === 'dg') return 'DG Bot';
    if (type === 'game') return 'Glück Arena';
    if (type === 'recording') return 'Class Recording';
    return type;
  }

  getActionLabel(item: ResourceItem): string {
    if (item.type === 'recording') return item.completed ? 'Watched' : 'Mark Watched';
    return item.completed ? 'Done' : 'Mark Complete';
  }

  isActionLoading(item: ResourceItem): boolean {
    return !!this.actionLoading[`${item.type}-${item._id}`];
  }

  allResources(): ResourceItem[] {
    if (!this.dayResources) return [];
    return [
      ...this.dayResources.exercises,
      ...this.dayResources.dgModules,
      ...this.dayResources.games,
      ...(this.dayResources.recordings || [])
    ];
  }

  trackStudent(_: number, s: Student): string {
    return s._id;
  }

  get showInitialSkeleton(): boolean {
    return this.listLoading && this.students.length === 0;
  }

  get showTableRefreshing(): boolean {
    return this.listLoading && this.students.length > 0;
  }
}
