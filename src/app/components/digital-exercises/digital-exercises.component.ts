// src/app/components/digital-exercises/digital-exercises.component.ts

import { Component, OnInit, OnChanges, SimpleChanges, Input, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { BreakpointObserver } from '@angular/cdk/layout';
import { DigitalExerciseService, DigitalExercise, ExerciseAttempt } from '../../services/digital-exercise.service';
import { AuthService } from '../../services/auth.service';
import { parseAdminCourseDayOrNull, TRIAL_JOURNEY_DAY } from '../../utils/journey-day.util';
import { digitalExercisePlayCommands, exerciseIdForRoute } from '../../utils/digital-exercise-id.util';

type TabType = 'completed' | 'pending' | 'new' | 'all';

@Component({
  selector: 'app-digital-exercises',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './digital-exercises.component.html',
  styleUrls: ['./digital-exercises.component.css']
})
export class DigitalExercisesComponent implements OnInit, OnChanges {
  /** Hides the large page header when embedded (e.g. My Course). */
  @Input() embedded = false;
  /** When embedded in My Course: true while the Exercises tab is visible. */
  @Input() tabActive = false;

  exercises: DigitalExercise[] = [];
  filteredExercises: DigitalExercise[] = [];
  loading = false;
  userRole: string = '';
  isTeacherOrAdmin = false;
  accessDenied = false;
  accessReason: string | null = null;

  activeTab: TabType = 'pending';

  // Filters
  searchQuery = '';
  selectedLevel = '';
  selectedCategory = '';
  selectedDifficulty = '';
  levelFilterOpen = false;
  categoryFilterOpen = false;
  difficultyFilterOpen = false;

  /** @deprecated Server now returns the current journey week by default; kept for API compatibility. */
  todayOnly = false;

  /** Set from GET /digital-exercises for students. */
  studentCourseDay = 1;

  // Pagination
  currentPage = 1;
  totalPages = 1;
  totalExercises = 0;
  readonly pageSize = 12;
  /** Aligned with server submit `passed` rule */
  readonly passScorePercent = 60;

  readonly allLevels: string[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  /** Level filter dropdown options (students = only up to profile level). */
  levelFilterOptions: string[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  categories = ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'];
  difficulties = ['Beginner', 'Intermediate', 'Advanced'];

  /** Shorter on ≤640px so placeholder fits; full copy on larger viewports. */
  searchInputPlaceholder = 'Search exercises by title or topic...';

  private searchTimer: any;

  constructor(
    private exerciseService: DigitalExerciseService,
    private authService: AuthService,
    private router: Router,
    breakpointObserver: BreakpointObserver
  ) {
    breakpointObserver
      .observe('(max-width: 640px)')
      .pipe(
        map((r) => r.matches),
        takeUntilDestroyed()
      )
      .subscribe((compact) => {
        this.searchInputPlaceholder = compact
          ? 'Search by title or topic'
          : 'Search exercises by title or topic...';
      });
  }

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.userRole = user.role;
        this.isTeacherOrAdmin = ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'].includes(user.role);
      }
    });
    this.loadExercises();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const tabChange = changes['tabActive'];
    if (!this.embedded || !tabChange) return;
    const nowActive = !!this.tabActive;
    const wasActive = !!tabChange.previousValue;
    if (nowActive && !wasActive && !this.loading) {
      this.applyDefaultTab();
    }
  }

  loadExercises(): void {
    this.loading = true;
    const filters: any = {
      page: 1,
      limit: this.embedded ? 50 : 100
    };
    if (this.searchQuery.trim()) filters.search = this.searchQuery.trim();
    if (this.selectedLevel) filters.level = this.selectedLevel;
    if (this.selectedCategory) filters.category = this.selectedCategory;
    if (this.selectedDifficulty) filters.difficulty = this.selectedDifficulty;
    const role = this.authService.getSnapshotUser()?.role || this.userRole;
    if (role === 'STUDENT' && this.todayOnly) filters.todayOnly = true;

    this.exerciseService.getExercises(filters).subscribe({
      next: (res) => {
        this.exercises = res.exercises || [];
        this.accessDenied = !!res.accessDenied;
        this.accessReason = res.accessReason || null;
        const d = Number(res?.studentCourseDay);
        if (role === 'STUDENT' && Number.isFinite(d) && d >= 1) {
          this.studentCourseDay = Math.min(200, Math.floor(d));
        }
        this.applyDefaultTab();
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  setTab(tab: TabType): void {
    this.activeTab = tab;
    this.applyTabFilter();
  }

  /** Open New when today's exercises exist; otherwise Pending. */
  private applyDefaultTab(): void {
    this.activeTab = this.countExercisesForTab('new') > 0 ? 'new' : 'pending';
    this.currentPage = 1;
    this.applyTabFilter();
  }

  private countExercisesForTab(tab: TabType): number {
    const role = this.authService.getSnapshotUser()?.role || this.userRole;
    const isStudent = role === 'STUDENT';
    let list = isStudent
      ? this.exercises.filter(
          (ex) => this.isExerciseUnlockedForStudentDay(ex) && this.matchesStudentTab(ex, tab)
        )
      : this.applyTabFilterLegacy(this.exercises, tab);
    if (isStudent && this.isSilverGoStudent()) {
      list = list.filter((ex) => this.exerciseCourseDayNum(ex) !== TRIAL_JOURNEY_DAY);
    }
    return list.length;
  }

  private applyTabFilter(): void {
    const role = this.authService.getSnapshotUser()?.role || this.userRole;
    const isStudent = role === 'STUDENT';

    let list: DigitalExercise[];
    if (isStudent) {
      list = this.exercises.filter(
        (ex) => this.isExerciseUnlockedForStudentDay(ex) && this.matchesStudentTab(ex, this.activeTab)
      );
      if (this.isSilverGoStudent()) {
        list = list.filter((ex) => this.exerciseCourseDayNum(ex) !== TRIAL_JOURNEY_DAY);
      }
      // Sort: within the same courseDay, order by sequenceLetter (null last)
      list = [...list].sort((a, b) => {
        const dayA = a.courseDay ?? 9999;
        const dayB = b.courseDay ?? 9999;
        if (dayA !== dayB) return dayA - dayB;
        const la = a.sequenceLetter || '';
        const lb = b.sequenceLetter || '';
        if (!la && !lb) return 0;
        if (!la) return 1;
        if (!lb) return -1;
        return la.localeCompare(lb);
      });
    } else {
      list = this.applyTabFilterLegacy(this.exercises, this.activeTab);
    }

    this.filteredExercises = list;
    this.totalExercises = list.length;
    this.totalPages = Math.max(1, Math.ceil(list.length / this.pageSize));
  }

  /** Normalized journey day 0 (Trial)–200, or null if unassigned. */
  exerciseCourseDayNum(ex: DigitalExercise): number | null {
    return parseAdminCourseDayOrNull(ex.courseDay);
  }

  /**
   * Students:
   * - All: show everything (no filter).
   * - New: exercise day === current journey day, not yet passed.
   * - Pending: incomplete from past days (not current day).
   * - Completed: passed (≥ pass score), any day.
   */
  private matchesStudentTab(ex: DigitalExercise, tab: TabType): boolean {
    if (tab === 'all') return true;

    const passed = this.isAttemptPassing(ex.studentAttempt);
    const dayNum = this.exerciseCourseDayNum(ex);
    const cur = this.studentCourseDay;

    if (tab === 'completed') {
      return passed;
    }

    if (passed) {
      return false;
    }

    if (tab === 'new') {
      return dayNum != null && dayNum === cur;
    }

    /* pending: incomplete and not "new" */
    if (dayNum != null && dayNum === cur) {
      return false;
    }
    return true;
  }

  /** Teachers/admins: original 14-day new vs pending split; completed = any attempt. */
  private applyTabFilterLegacy(exercises: DigitalExercise[], tab: TabType): DigitalExercise[] {
    if (tab === 'all') return exercises;

    const now = Date.now();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

    let list = exercises;
    if (tab === 'completed') {
      list = list.filter((ex) => ex.studentAttempt != null);
    } else if (tab === 'pending') {
      list = list.filter((ex) => !ex.studentAttempt);
      list = list.filter((ex) => {
        const created = ex.createdAt ? new Date(ex.createdAt).getTime() : 0;
        return now - created > fourteenDaysMs;
      });
    } else {
      list = list.filter((ex) => !ex.studentAttempt);
      list = list.filter((ex) => {
        const created = ex.createdAt ? new Date(ex.createdAt).getTime() : 0;
        return now - created <= fourteenDaysMs;
      });
    }
    return list;
  }

  get paginatedExercises(): DigitalExercise[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredExercises.slice(start, start + this.pageSize);
  }

  onSearchChange(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.currentPage = 1;
      this.loadExercises();
    }, 400);
  }

  onFilterChange(): void {
    this.currentPage = 1;
    this.loadExercises();
  }

  onTodayOnlyChange(): void {
    this.currentPage = 1;
    this.loadExercises();
  }

  onTabChange(): void {
    this.currentPage = 1;
  }

  toggleFilter(filter: 'level' | 'category' | 'difficulty'): void {
    const wasOpen = filter === 'level' ? this.levelFilterOpen
      : filter === 'category' ? this.categoryFilterOpen
      : this.difficultyFilterOpen;
    this.levelFilterOpen = false;
    this.categoryFilterOpen = false;
    this.difficultyFilterOpen = false;
    if (!wasOpen) {
      if (filter === 'level') this.levelFilterOpen = true;
      else if (filter === 'category') this.categoryFilterOpen = true;
      else this.difficultyFilterOpen = true;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.dex-filter-wrap')) {
      this.levelFilterOpen = false;
      this.categoryFilterOpen = false;
      this.difficultyFilterOpen = false;
    }
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.selectedLevel = '';
    this.selectedCategory = '';
    this.selectedDifficulty = '';
    this.todayOnly = false;
    this.currentPage = 1;
    this.loadExercises();
  }

  startExercise(exercise: DigitalExercise): void {
    if (this.isExerciseJourneyLocked(exercise)) {
      return;
    }
    const commands = digitalExercisePlayCommands(exercise);
    if (commands.length === 2) return;
    this.router.navigate(commands);
  }

  navigateToCreate(): void {
    this.router.navigate(['/admin/digital-exercises/create']);
  }

  navigateToAdmin(): void {
    this.router.navigate(['/admin/digital-exercises']);
  }

  changePage(page: number): void {
    this.currentPage = page;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  getLevelColor(level: string): string {
    return this.exerciseService.getLevelColor(level);
  }

  getTypeSummary(exercise: DigitalExercise): string {
    const labels: Record<string, string> = { mcq: 'MCQ', matching: 'Match', 'fill-blank': 'Fill', pronunciation: 'Speak' };
    const counts = exercise.questionTypeSummary || {};
    return Object.entries(counts).map(([t, c]) => `${labels[t] || t}×${c}`).join(' · ');
  }

  getQuestionCount(ex: DigitalExercise): number {
    return Number(ex.questionCount ?? ex.questions?.length ?? 0) || 0;
  }

  isAttemptPassing(att: ExerciseAttempt | null | undefined): boolean {
    const s = att?.scorePercentage;
    if (s == null || !Number.isFinite(Number(s))) return false;
    return Number(s) >= this.passScorePercent;
  }

  attemptStatusLabel(att: ExerciseAttempt): string {
    const s = Number(att.scorePercentage);
    if (s >= this.passScorePercent) return 'Passed';
    if (s > 0) return 'Below pass';
    return 'No score yet';
  }

  attemptStatusClass(att: ExerciseAttempt): string {
    const s = Number(att.scorePercentage);
    if (s >= this.passScorePercent) return 'status-pass';
    if (s > 0) return 'status-warn';
    return 'status-muted';
  }

  hasActiveFilters(): boolean {
    return !!(this.searchQuery || this.selectedLevel || this.selectedCategory || this.selectedDifficulty || this.todayOnly);
  }

  private isSilverGoStudent(): boolean {
    const u = this.authService.getSnapshotUser();
    return (
      String(u?.goStatus || '').toUpperCase() === 'GO' &&
      String(u?.subscription || '').toUpperCase() === 'SILVER'
    );
  }

  isExerciseDayLocked(ex: DigitalExercise): boolean {
    const role = this.authService.getSnapshotUser()?.role || this.userRole;
    if (role !== 'STUDENT') return false;
    return !this.isExerciseUnlockedForStudentDay(ex);
  }

  /** Student may list/play exercises on or before their journey day (unassigned = always ok). */
  isExerciseUnlockedForStudentDay(ex: DigitalExercise): boolean {
    const role = this.authService.getSnapshotUser()?.role || this.userRole;
    if (role !== 'STUDENT') return true;
    const dayNum = this.exerciseCourseDayNum(ex);
    if (dayNum == null) return true;
    if (this.isSilverGoStudent() && dayNum === TRIAL_JOURNEY_DAY) return false;
    return dayNum <= this.studentCourseDay;
  }

  isExerciseSequenceLocked(ex: DigitalExercise): boolean {
    const role = this.authService.getSnapshotUser()?.role || this.userRole;
    if (role !== 'STUDENT') return false;
    return !!ex.sequenceLocked;
  }

  isExerciseJourneyLocked(ex: DigitalExercise): boolean {
    return this.isExerciseDayLocked(ex) || this.isExerciseSequenceLocked(ex);
  }

  private getPrerequisiteExercise(ex: DigitalExercise): DigitalExercise | null {
    if (!this.isExerciseSequenceLocked(ex) || !ex.previousSequenceLetter) return null;
    const prev = String(ex.previousSequenceLetter || '').trim().toLowerCase();
    if (!prev) return null;
    const day = this.exerciseCourseDayNum(ex);

    const match = this.exercises.find((item) => {
      const sameDay = this.exerciseCourseDayNum(item) === day;
      const sameSequence = String(item.sequenceLetter || '').trim().toLowerCase() === prev;
      return sameDay && sameSequence;
    });

    return match || null;
  }

  canOpenPrerequisiteExercise(ex: DigitalExercise): boolean {
    return !!this.getPrerequisiteExercise(ex)?._id;
  }

  openPrerequisiteExercise(ex: DigitalExercise): void {
    const prerequisite = this.getPrerequisiteExercise(ex);
    if (!prerequisite?._id) return;
    this.startExercise(prerequisite);
  }

  journeyDaySequenceLabel(ex: DigitalExercise): string {
    const day = this.exerciseCourseDayNum(ex);
    const seq = String(ex.sequenceLetter || '').trim().toUpperCase();
    if (day == null) {
      return seq ? `Any-${seq}` : 'Any';
    }
    return seq ? `${day}-${seq}` : String(day);
  }

  journeyUnlockButtonLabel(ex: DigitalExercise): string {
    if (this.isExerciseSequenceLocked(ex) && ex.previousSequenceLetter) {
      const previous = String(ex.previousSequenceLetter || '').trim().toUpperCase();
      const day = this.exerciseCourseDayNum(ex);
      const previousLabel = day != null ? `${day}-${previous}` : previous;
      return `First complete ${previousLabel}`;
    }
    const cd = ex.courseDay;
    return cd != null ? `Unlock on day ${cd}` : 'Locked';
  }

  get journeyWeekHint(): string {
    const cur = this.studentCourseDay;
    return `Unlocked through Day ${cur} — future days unlock as you progress`;
  }

  hasType(exercise: DigitalExercise, type: string): boolean {
    const summary = exercise.questionTypeSummary;
    if (summary) return (Number(summary[type]) || 0) > 0;
    return (exercise.questions || []).some(q => q.type === type);
  }

  /** Compact type labels for table "Types" column */
  typeSummaryShort(ex: DigitalExercise): string {
    const pairs: Array<[string, string]> = [
      ['mcq', 'MCQ'],
      ['matching', 'Match'],
      ['fill-blank', 'Fill'],
      ['pronunciation', 'Speak'],
      ['question-answer', 'Written'],
      ['listening', 'Listen']
    ];
    const parts = pairs.filter(([t]) => this.hasType(ex, t)).map(([, l]) => l);
    return parts.length ? parts.join(' · ') : '—';
  }

  exerciseMetaLine(ex: DigitalExercise): string {
    const n = this.getQuestionCount(ex);
    const m = ex.estimatedDuration || 15;
    const d = ex.difficulty || '—';
    return `${n} qs · ~${m} min · ${d}`;
  }

  clipDescription(text: string | undefined, max = 96): string {
    const t = (text || '').trim().replace(/\s+/g, ' ');
    if (t.length <= max) return t;
    return t.slice(0, max - 1).trimEnd() + '…';
  }

  tableActionLabel(ex: DigitalExercise): string {
    const att = ex.studentAttempt;
    if (!att) return 'Start';
    return this.isAttemptPassing(att) ? 'Again' : 'Retry';
  }

  getPageNumbers(): number[] {
    const pages = [];
    const start = Math.max(1, this.currentPage - 2);
    const end = Math.min(this.totalPages, this.currentPage + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  get currentProficiency(): number {
    const completed = this.exercises.filter(ex => ex.studentAttempt);
    if (completed.length === 0) return 0;
    const sum = completed.reduce((s, ex) => s + (ex.studentAttempt?.scorePercentage || 0), 0);
    return Math.round(sum / completed.length);
  }

  /** Full analytics page (overall + per-exercise table + links to question detail) */
  openStudentAnalyticsPage(): void {
    const extras =
      this.embedded
        ? { queryParams: { from: 'my-course' } }
        : {};
    this.router.navigate(['/digital-exercises', 'analytics'], extras);
  }

  openExerciseReview(exercise: DigitalExercise, ev?: Event): void {
    ev?.stopPropagation();
    const id = exerciseIdForRoute(exercise);
    if (!id || !exercise.studentAttempt) return;
    this.router.navigate(['/digital-exercises', id, 'review']);
  }

  getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      Grammar: 'menu_book',
      Vocabulary: 'translate',
      Conversation: 'forum',
      Reading: 'auto_stories',
      Writing: 'edit_note',
      Listening: 'headphones',
      Pronunciation: 'record_voice_over'
    };
    return icons[category] || 'quiz';
  }

  getPriorityLabel(ex: DigitalExercise): string {
    if (ex.studentAttempt) return 'NORMAL Review';
    if (this.activeTab === 'new') return 'PRIORITY New Addition';
    return 'NORMAL Pending';
  }

  getPriorityClass(ex: DigitalExercise): string {
    if (ex.studentAttempt) return 'priority-normal';
    if (this.activeTab === 'new') return 'priority-new';
    return 'priority-pending';
  }
}
