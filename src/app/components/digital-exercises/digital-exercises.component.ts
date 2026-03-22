// src/app/components/digital-exercises/digital-exercises.component.ts

import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DigitalExerciseService, DigitalExercise, ExerciseAttempt } from '../../services/digital-exercise.service';
import { AuthService } from '../../services/auth.service';

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
  loading = false;
  userRole: string = '';
  isTeacherOrAdmin = false;

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
      page: this.currentPage,
      limit: this.pageSize
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
        this.totalExercises = res.total || 0;
        this.totalPages = res.pages || 1;
        const r = this.authService.getSnapshotUser()?.role || this.userRole;
        if (r === 'STUDENT') {
          if (Array.isArray(res.accessibleLevels) && res.accessibleLevels.length) {
            this.levelFilterOptions = [...res.accessibleLevels];
            if (this.selectedLevel && !this.levelFilterOptions.includes(this.selectedLevel)) {
              this.selectedLevel = '';
            }
          }
        } else {
          this.levelFilterOptions = [...this.allLevels];
        }
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
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
    this.loadExercises();
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
}
