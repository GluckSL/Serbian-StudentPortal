// src/app/components/digital-exercises/digital-exercises.component.ts

import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DigitalExerciseService, DigitalExercise, ExerciseAttempt } from '../../services/digital-exercise.service';
import { AuthService } from '../../services/auth.service';

type TabType = 'completed' | 'pending' | 'new';

@Component({
  selector: 'app-digital-exercises',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './digital-exercises.component.html',
  styleUrls: ['./digital-exercises.component.css']
})
export class DigitalExercisesComponent implements OnInit {
  /** Hides the large page header when embedded (e.g. My Course). */
  @Input() embedded = false;

  exercises: DigitalExercise[] = [];
  filteredExercises: DigitalExercise[] = [];
  loading = false;
  userRole: string = '';
  isTeacherOrAdmin = false;

  activeTab: TabType = 'new';

  // Filters
  searchQuery = '';
  selectedLevel = '';
  selectedCategory = '';
  selectedDifficulty = '';

  /** Students: show only exercises tagged for the current journey day. */
  todayOnly = false;

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

  private searchTimer: any;

  constructor(
    private exerciseService: DigitalExerciseService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.userRole = user.role;
        this.isTeacherOrAdmin = ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'].includes(user.role);
      }
    });
    this.loadExercises();
  }

  loadExercises(): void {
    this.loading = true;
    const filters: any = {
      page: 1,
      limit: 100
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
        this.applyTabFilter();
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  setTab(tab: TabType): void {
    this.activeTab = tab;
    this.applyTabFilter();
  }

  private applyTabFilter(): void {
    const now = Date.now();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

    let list = this.exercises;
    if (this.activeTab === 'completed') {
      list = list.filter(ex => ex.studentAttempt != null);
    } else if (this.activeTab === 'pending') {
      list = list.filter(ex => !ex.studentAttempt);
      list = list.filter(ex => {
        const created = ex.createdAt ? new Date(ex.createdAt).getTime() : 0;
        return now - created > fourteenDaysMs;
      });
    } else {
      list = list.filter(ex => !ex.studentAttempt);
      list = list.filter(ex => {
        const created = ex.createdAt ? new Date(ex.createdAt).getTime() : 0;
        return now - created <= fourteenDaysMs;
      });
    }
    this.filteredExercises = list;
    this.totalExercises = list.length;
    this.totalPages = Math.max(1, Math.ceil(list.length / this.pageSize));
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
    this.router.navigate(['/digital-exercises', exercise._id, 'play']);
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
    const counts: Record<string, number> = {};
    const labels: Record<string, string> = { mcq: 'MCQ', matching: 'Match', 'fill-blank': 'Fill', pronunciation: 'Speak' };
    (exercise.questions || []).forEach(q => { counts[q.type] = (counts[q.type] || 0) + 1; });
    return Object.entries(counts).map(([t, c]) => `${labels[t] || t}×${c}`).join(' · ');
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

  hasType(exercise: DigitalExercise, type: string): boolean {
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
    const n = ex.questions?.length || 0;
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
