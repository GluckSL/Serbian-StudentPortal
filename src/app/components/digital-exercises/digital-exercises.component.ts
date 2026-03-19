// src/app/components/digital-exercises/digital-exercises.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DigitalExerciseService, DigitalExercise } from '../../services/digital-exercise.service';
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

  // Pagination
  currentPage = 1;
  totalPages = 1;
  totalExercises = 0;
  readonly pageSize = 12;

  levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
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

  onTabChange(): void {
    this.currentPage = 1;
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.selectedLevel = '';
    this.selectedCategory = '';
    this.selectedDifficulty = '';
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

  getScoreClass(score: number): string {
    if (score >= 80) return 'score-excellent';
    if (score >= 60) return 'score-good';
    return 'score-needs-work';
  }

  hasActiveFilters(): boolean {
    return !!(this.searchQuery || this.selectedLevel || this.selectedCategory || this.selectedDifficulty);
  }

  hasType(exercise: DigitalExercise, type: string): boolean {
    return (exercise.questions || []).some(q => q.type === type);
  }

  getPageNumbers(): number[] {
    const pages = [];
    const start = Math.max(1, this.currentPage - 2);
    const end = Math.min(this.totalPages, this.currentPage + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }
}
