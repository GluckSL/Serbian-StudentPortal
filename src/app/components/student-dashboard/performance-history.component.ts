import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { DigitalExercise, DigitalExerciseService } from '../../services/digital-exercise.service';
import { LearningModule, LearningModulesService } from '../../services/learning-modules.service';
import { StudentProgressService } from '../../services/student-progress.service';
import { ZoomService } from '../../services/zoom.service';

type RangeMode = 'weekly' | 'overall';
type TrackTab = 'classes' | 'exercises' | 'modules';

interface SessionHistory {
  sessionId: string;
  sessionState: string;
  module?: { id?: string; title?: string; level?: string; category?: string };
  summary?: {
    totalScore?: number;
    accuracy?: number;
    conversationCount?: number;
    timeSpentMinutes?: number;
    vocabularyUsed?: string[];
  };
  createdAt: string;
}

@Component({
  selector: 'app-performance-history',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './performance-history.component.html',
  styleUrls: ['./performance-history.component.scss']
})
export class PerformanceHistoryComponent implements OnInit {
  isLoading = false;
  rangeMode: RangeMode = 'weekly';
  activeTab: TrackTab = 'classes';
  searchText = '';
  pageSize = 8;
  classPage = 1;
  exercisePage = 1;
  modulePage = 1;

  journeyCourseDay = 1;
  sessionHistory: SessionHistory[] = [];
  exercises: DigitalExercise[] = [];
  modules: LearningModule[] = [];
  meetings: any[] = [];
  totalVocabulary = 0;

  constructor(
    private http: HttpClient,
    private router: Router,
    private exerciseService: DigitalExerciseService,
    private moduleService: LearningModulesService,
    private progressService: StudentProgressService,
    private zoomService: ZoomService
  ) {}

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.isLoading = true;
    forkJoin({
      journey: this.progressService.getStudentJourney().pipe(catchError(() => of(null))),
      exercises: this.exerciseService.getExercises({ page: 1, limit: 500 }).pipe(catchError(() => of({ exercises: [] }))),
      modules: this.moduleService.getModules({ page: 1, limit: 500 }).pipe(catchError(() => of({ modules: [] }))),
      meetings: this.zoomService.getStudentMeetings().pipe(catchError(() => of({ success: false, data: [] }))),
      sessions: this.http.get<any>(`${environment.apiUrl}/session-records/my-history`, { withCredentials: true }).pipe(catchError(() => of({ sessionHistory: [] })))
    }).subscribe({
      next: ({ journey, exercises, modules, meetings, sessions }) => {
        this.journeyCourseDay = Number(journey?.profile?.currentCourseDay || 1);
        this.exercises = Array.isArray(exercises?.exercises) ? exercises.exercises : [];
        this.modules = Array.isArray(modules?.modules) ? modules.modules : [];
        this.meetings = meetings?.success && Array.isArray(meetings?.data) ? meetings.data : [];
        this.sessionHistory = Array.isArray(sessions?.sessionHistory) ? sessions.sessionHistory : [];
        this.totalVocabulary = new Set(
          this.sessionHistory.flatMap((s) => Array.isArray(s.summary?.vocabularyUsed) ? s.summary?.vocabularyUsed || [] : [])
        ).size;
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  setRange(mode: RangeMode): void {
    this.rangeMode = mode;
    this.resetPages();
  }

  setTab(tab: TrackTab): void {
    this.activeTab = tab;
    this.searchText = '';
    this.resetPages();
  }

  onSearchChange(): void {
    this.resetPages();
  }

  private resetPages(): void {
    this.classPage = 1;
    this.exercisePage = 1;
    this.modulePage = 1;
  }

  get skeletonRows(): number[] {
    return [1, 2, 3, 4, 5, 6];
  }

  get filteredMeetings(): any[] {
    const q = this.searchText.trim().toLowerCase();
    // Only ended classes should contribute to tracking and KPI counts.
    const items = this.meetings.filter((m) => m?.hasEnded && this.isInRangeByDay(this.getMeetingDay(m)));
    if (!q) return items;
    return items.filter((m) => {
      const text = `${m.topic || ''} ${m.teacher?.name || ''} ${this.getMeetingDay(m)}`.toLowerCase();
      return text.includes(q);
    });
  }

  get filteredModules(): LearningModule[] {
    const q = this.searchText.trim().toLowerCase();
    const items = this.modules.filter((m: any) => this.isInRangeByDay(Number(m.courseDay || 0)));
    if (!q) return items;
    return items.filter((m: any) => `${m.title || ''} ${m.level || ''} ${m.category || ''} ${m.courseDay || ''}`.toLowerCase().includes(q));
  }

  get filteredExercises(): DigitalExercise[] {
    const q = this.searchText.trim().toLowerCase();
    const items = this.exercises.filter((e) => this.isInRangeByDay(Number(e.courseDay || 0)));
    if (!q) return items;
    return items.filter((e) => `${e.title || ''} ${e.level || ''} ${e.category || ''} ${e.courseDay || ''}`.toLowerCase().includes(q));
  }

  get filteredSessions(): SessionHistory[] {
    if (this.rangeMode === 'overall') return this.sessionHistory;
    const from = new Date();
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    return this.sessionHistory.filter((s) => new Date(s.createdAt).getTime() >= from.getTime());
  }

  get overallDone(): number {
    return this.classAttended + this.moduleCompleted + this.exerciseCompleted;
  }

  get overallTotal(): number {
    return this.classTotal + this.moduleTotal + this.exerciseTotal;
  }

  get overallPct(): number {
    return this.ratio(this.overallDone, this.overallTotal);
  }

  get classAttended(): number {
    return this.filteredMeetings.filter((m) => this.getAttendancePercent(m) >= 75).length;
  }

  get classTotal(): number {
    return this.filteredMeetings.length;
  }

  get classPct(): number {
    return this.ratio(this.classAttended, this.classTotal);
  }

  get moduleCompleted(): number {
    return this.filteredModules.filter((m: any) => m.studentProgress?.status === 'completed').length;
  }

  get moduleTotal(): number {
    return this.filteredModules.length;
  }

  get modulePct(): number {
    return this.ratio(this.moduleCompleted, this.moduleTotal);
  }

  get exerciseCompleted(): number {
    return this.filteredExercises.filter((e) => !!e.studentAttempt).length;
  }

  get exerciseTotal(): number {
    return this.filteredExercises.length;
  }

  get exercisePct(): number {
    return this.ratio(this.exerciseCompleted, this.exerciseTotal);
  }

  get sessionCount(): number {
    return this.filteredSessions.length;
  }

  get avgScore(): number {
    const scores = [
      ...this.filteredSessions.map((s) => Number(s.summary?.totalScore || 0)).filter((n) => n > 0),
      ...this.filteredExercises.map((e) => Number(e.studentAttempt?.scorePercentage || 0)).filter((n) => n > 0)
    ];
    if (!scores.length) return 0;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  get totalStudyMinutes(): number {
    const sessionMinutes = this.filteredSessions.reduce((sum, s) => sum + Number(s.summary?.timeSpentMinutes || 0), 0);
    const exerciseMinutes = this.filteredExercises.reduce((sum, e) => sum + Math.round(Number(e.studentAttempt?.timeSpentSeconds || 0) / 60), 0);
    const classMinutes = this.filteredMeetings.reduce((sum, m) => sum + Number(m.attendedDurationMinutes || 0), 0);
    return sessionMinutes + exerciseMinutes + classMinutes;
  }

  get pagedMeetings(): any[] {
    return this.paginate(this.filteredMeetings, this.classPage);
  }

  get pagedExercises(): DigitalExercise[] {
    return this.paginate(this.filteredExercises, this.exercisePage);
  }

  get pagedModules(): LearningModule[] {
    return this.paginate(this.filteredModules, this.modulePage);
  }

  get classPages(): number {
    return this.totalPages(this.filteredMeetings.length);
  }

  get exercisePages(): number {
    return this.totalPages(this.filteredExercises.length);
  }

  get modulePages(): number {
    return this.totalPages(this.filteredModules.length);
  }

  get currentPage(): number {
    if (this.activeTab === 'classes') return this.classPage;
    if (this.activeTab === 'exercises') return this.exercisePage;
    return this.modulePage;
  }

  get totalPagesForActiveTab(): number {
    if (this.activeTab === 'classes') return this.classPages;
    if (this.activeTab === 'exercises') return this.exercisePages;
    return this.modulePages;
  }

  get totalRowsForActiveTab(): number {
    if (this.activeTab === 'classes') return this.filteredMeetings.length;
    if (this.activeTab === 'exercises') return this.filteredExercises.length;
    return this.filteredModules.length;
  }

  get showingFromForActiveTab(): number {
    if (!this.totalRowsForActiveTab) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get showingToForActiveTab(): number {
    if (!this.totalRowsForActiveTab) return 0;
    return Math.min(this.totalRowsForActiveTab, this.currentPage * this.pageSize);
  }

  get activeTabLabel(): string {
    if (this.activeTab === 'classes') return 'classes';
    if (this.activeTab === 'exercises') return 'exercises';
    return 'modules';
  }

  canGoPrev(): boolean {
    return this.currentPage > 1;
  }

  canGoNext(): boolean {
    return this.currentPage < this.totalPagesForActiveTab;
  }

  changeActivePage(dir: -1 | 1): void {
    this.changePage(this.activeTab, dir);
  }

  changePage(tab: TrackTab, dir: -1 | 1): void {
    if (tab === 'classes') {
      this.classPage = Math.min(this.classPages, Math.max(1, this.classPage + dir));
      return;
    }
    if (tab === 'exercises') {
      this.exercisePage = Math.min(this.exercisePages, Math.max(1, this.exercisePage + dir));
      return;
    }
    this.modulePage = Math.min(this.modulePages, Math.max(1, this.modulePage + dir));
  }

  getMeetingStatus(meeting: any): string {
    if (meeting?.hasEnded) {
      const pct = this.getAttendancePercent(meeting);
      if (pct >= 75) return 'Completed';
      if (pct > 0) return 'Partial';
      return 'Missed';
    }
    if (meeting?.isOngoing) return 'Live';
    return 'Upcoming';
  }

  getMeetingStatusClass(meeting: any): string {
    const s = this.getMeetingStatus(meeting).toLowerCase();
    if (s === 'completed') return 'ok';
    if (s === 'partial') return 'partial';
    if (s === 'missed') return 'bad';
    if (s === 'live') return 'live';
    return 'upcoming';
  }

  getModuleStatus(module: any): string {
    return module?.studentProgress?.status === 'completed' ? 'Completed' : 'Pending';
  }

  getExerciseStatus(ex: any): string {
    return ex?.studentAttempt ? 'Completed' : 'Pending';
  }

  getExerciseStatusClass(ex: any): string {
    return ex?.studentAttempt ? 'ok' : 'pending';
  }

  formatExerciseScore(ex: any): string {
    if (!ex?.studentAttempt) return '---';
    const earned = Number(ex.studentAttempt?.earnedPoints ?? NaN);
    const total = Number(ex.studentAttempt?.totalPoints ?? NaN);
    if (Number.isFinite(earned) && Number.isFinite(total) && total > 0) {
      return `${Math.round(earned)}/${Math.round(total)}`;
    }
    const pct = Number(ex.studentAttempt?.scorePercentage ?? NaN);
    return Number.isFinite(pct) ? `${Math.round(pct)}/100` : '---';
  }

  classRowCountText(): string {
    return `${this.filteredMeetings.length} classes`;
  }

  exerciseRowCountText(): string {
    return `${this.filteredExercises.length} exercises`;
  }

  moduleRowCountText(): string {
    return `${this.filteredModules.length} modules`;
  }

  openJourney(): void {
    this.router.navigate(['/student/my-course'], { queryParams: { tab: 'journey' } });
  }

  private ratio(done: number, total: number): number {
    if (!total) return 0;
    return Math.round((done / total) * 100);
  }

  private paginate<T>(arr: T[], page: number): T[] {
    const start = (page - 1) * this.pageSize;
    return arr.slice(start, start + this.pageSize);
  }

  private totalPages(totalItems: number): number {
    return Math.max(1, Math.ceil(totalItems / this.pageSize));
  }

  private isInRangeByDay(day: number): boolean {
    if (!Number.isFinite(day) || day <= 0) return this.rangeMode === 'overall';
    if (this.rangeMode === 'overall') return day >= 1 && day <= this.journeyCourseDay;
    const min = Math.max(1, this.journeyCourseDay - 6);
    return day >= min && day <= this.journeyCourseDay;
  }

  getMeetingDay(meeting: any): number {
    const direct = Number(meeting?.courseDay || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const topic = String(meeting?.topic || '');
    const matched = topic.match(/\bday\s*[:\-]?\s*(\d{1,3})\b/i);
    return matched ? Number(matched[1]) : 0;
  }

  getAttendancePercent(meeting: any): number {
    if (!meeting?.hasEnded) return 0;
    const total = Number(meeting?.duration || 0);
    if (total <= 0) return 0;
    const attended = Number(meeting?.attendedDurationMinutes ?? meeting?.durationMinutes ?? 0);
    if (meeting?.attended === true && attended <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round((attended / total) * 100)));
  }

  getAttendanceColor(meeting: any): string {
    const pct = this.getAttendancePercent(meeting);
    if (pct >= 75) return 'good';
    if (pct > 0) return 'warn';
    return 'bad';
  }

  getClassCode(meeting: any): string {
    const topic = String(meeting?.topic || 'CL').trim();
    const words = topic.split(/\s+/).filter(Boolean);
    const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
    return letters || 'CL';
  }

  getClassSubTitle(meeting: any): string {
    const batch = String(meeting?.batch || '').trim();
    const level = String(meeting?.level || '').trim();
    return [batch, level].filter(Boolean).join(' · ') || 'Live class';
  }

  getMeetingWeekday(meeting: any): string {
    return new Date(meeting?.startTime).toLocaleDateString('en-US', { weekday: 'long' });
  }

  formatMeetingTimeRange(meeting: any): string {
    const start = new Date(meeting?.startTime);
    const end = new Date(start.getTime() + (Number(meeting?.duration || 0) * 60000));
    const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `${fmt(start)} - ${fmt(end)}`;
  }

  formatMinutes(mins: number): string {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const r = mins % 60;
    return `${h}h ${r}m`;
  }

  formatSecondsAsMinutes(seconds: number | undefined): string {
    const mins = Math.round(Number(seconds || 0) / 60);
    return this.formatMinutes(mins);
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  formatDateTime(date: any): string {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}