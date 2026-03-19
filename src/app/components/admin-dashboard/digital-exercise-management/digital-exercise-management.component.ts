// src/app/components/admin-dashboard/digital-exercise-management/digital-exercise-management.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DigitalExerciseService, DigitalExercise } from '../../../services/digital-exercise.service';
import { AuthService } from '../../../services/auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../../shared/material.module';

@Component({
  selector: 'app-digital-exercise-management',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  template: `
<div class="dem-container">
  <!-- Header -->
  <div class="dem-header">
    <div class="dem-title-area">
      <h1><span class="material-icons">edit_note</span> Digital Exercises</h1>
      <p>Create and manage interactive digital exercises for students</p>
    </div>
    <div class="header-actions">
      <button class="btn-generate-ai" (click)="navigateToAiGenerator()">
        <span class="material-icons">auto_awesome</span> Generate with AI
      </button>
      <button class="btn-generate-ai" (click)="navigateToListeningWorksheetGenerator()">
        <span class="material-icons">headphones</span> Import Listening Worksheet
      </button>
      <button class="btn-create" (click)="navigateToCreate()">
        <span class="material-icons">add</span> Create Exercise
      </button>
    </div>
  </div>

  <!-- Stats Bar -->
  <div class="stats-bar" *ngIf="!loading">
    <div class="stat-card">
      <span class="stat-number">{{ totalExercises }}</span>
      <span class="stat-label">Total Exercises</span>
    </div>
    <div class="stat-card">
      <span class="stat-number">{{ publishedCount }}</span>
      <span class="stat-label">Published to Students</span>
    </div>
    <div class="stat-card">
      <span class="stat-number">{{ totalCompletions }}</span>
      <span class="stat-label">Total Completions</span>
    </div>
  </div>

  <!-- Filters -->
  <div class="filters-bar">
    <div class="filter-group">
      <input
        type="text"
        placeholder="Search exercises..."
        [(ngModel)]="filters.search"
        (input)="onSearchChange()"
        class="filter-input search-input"
      />
      <span class="material-icons search-icon">search</span>
    </div>
    <select [(ngModel)]="filters.level" (change)="loadExercises()" class="filter-select">
      <option value="">All Levels</option>
      <option *ngFor="let l of levels" [value]="l">{{ l }}</option>
    </select>
    <select [(ngModel)]="filters.category" (change)="loadExercises()" class="filter-select">
      <option value="">All Categories</option>
      <option *ngFor="let c of categories" [value]="c">{{ c }}</option>
    </select>
  </div>

  <!-- Loading State -->
  <div class="loading-state" *ngIf="loading">
    <div class="spinner"></div>
    <p>Loading exercises...</p>
  </div>

  <!-- Exercise Table -->
  <div class="table-container" *ngIf="!loading">
    <table class="exercise-table" *ngIf="exercises.length > 0">
      <thead>
        <tr>
          <th>Exercise</th>
          <th>Type Mix</th>
          <th>Level</th>
          <th>Category</th>
          <th>Questions</th>
          <th>Completions</th>
          <th>Avg Score</th>
          <th>Students</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let ex of exercises">
          <td class="title-cell">
            <div class="exercise-title">{{ ex.title }}</div>
            <div class="exercise-meta">{{ ex.targetLanguage }} · {{ ex.difficulty }}</div>
          </td>
          <td>
            <div class="type-chips">
              <span *ngFor="let t of getQuestionTypeSummary(ex)" class="type-chip" [class]="'chip-' + t.type">
                {{ t.icon }} {{ t.count }}
              </span>
            </div>
          </td>
          <td>
            <span class="level-badge" [style.background]="getLevelColor(ex.level)">{{ ex.level }}</span>
          </td>
          <td>{{ ex.category }}</td>
          <td class="center">{{ ex.questions?.length || 0 }}</td>
          <td class="center">{{ ex.stats?.completions || 0 }}</td>
          <td class="center">
            <span *ngIf="ex.stats?.avgScore" class="score-badge" [class.good]="ex.stats!.avgScore >= 70">
              {{ ex.stats!.avgScore }}%
            </span>
            <span *ngIf="!ex.stats?.avgScore" class="text-muted">—</span>
          </td>
          <td>
            <button
              type="button"
              class="visibility-btn"
              [class.visible]="ex.visibleToStudents"
              (click)="toggleVisibility(ex)"
              [matTooltip]="ex.visibleToStudents ? 'Hide from students' : 'Show to students'"
            >
              <span class="material-icons">{{ ex.visibleToStudents ? 'visibility' : 'visibility_off' }}</span>
            </button>
          </td>
          <td class="actions-cell">
            <button class="btn-icon btn-view" (click)="viewCompletions(ex)" matTooltip="View completions">
              <span class="material-icons">bar_chart</span>
            </button>
            <button class="btn-icon btn-edit" (click)="navigateToEdit(ex._id!)" matTooltip="Edit">
              <span class="material-icons">edit</span>
            </button>
            <button class="btn-icon btn-delete" (click)="deleteExercise(ex)" matTooltip="Delete" *ngIf="isAdminUser">
              <span class="material-icons">delete</span>
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="empty-state" *ngIf="exercises.length === 0">
      <span class="material-icons empty-icon">edit_note</span>
      <h3>No exercises yet</h3>
      <p>Create your first interactive digital exercise manually or generate one automatically from a PDF.</p>
      <div class="empty-actions">
        <button class="btn-generate-ai" (click)="navigateToAiGenerator()">
          <span class="material-icons">auto_awesome</span> Generate from PDF with AI
        </button>
        <button class="btn-generate-ai" (click)="navigateToListeningWorksheetGenerator()">
          <span class="material-icons">headphones</span> Import Listening Worksheet
        </button>
        <button class="btn-create" (click)="navigateToCreate()">
          <span class="material-icons">add</span> Create Manually
        </button>
      </div>
    </div>

    <!-- Pagination -->
    <div class="pagination" *ngIf="totalPages > 1">
      <button [disabled]="currentPage === 1" (click)="changePage(currentPage - 1)" class="page-btn">
        <span class="material-icons">chevron_left</span>
      </button>
      <span class="page-info">Page {{ currentPage }} of {{ totalPages }}</span>
      <button [disabled]="currentPage === totalPages" (click)="changePage(currentPage + 1)" class="page-btn">
        <span class="material-icons">chevron_right</span>
      </button>
    </div>
  </div>

  <!-- Completions Panel -->
  <div class="completions-panel" *ngIf="selectedExercise">
    <div class="panel-header">
      <h2><span class="material-icons">bar_chart</span> Completions: {{ selectedExercise.title }}</h2>
      <div class="panel-controls">
        <input type="date" [(ngModel)]="selectedDate" (change)="loadCompletions()" class="date-input" />
        <button class="btn-close" (click)="selectedExercise = null">
          <span class="material-icons">close</span>
        </button>
      </div>
    </div>
    <div class="completions-loading" *ngIf="completionsLoading">
      <div class="spinner small"></div> Loading completions...
    </div>
    <div class="completions-table-wrap" *ngIf="!completionsLoading">
      <table class="completions-table" *ngIf="completions.length > 0">
        <thead>
          <tr>
            <th>Student</th>
            <th>Batch</th>
            <th>Level</th>
            <th>Score</th>
            <th>Time</th>
            <th>Attempt #</th>
            <th>Completed At</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let c of completions">
            <td>{{ c.studentId?.name || c.studentName || '—' }}</td>
            <td>{{ c.studentId?.batch || c.studentBatch || '—' }}</td>
            <td>
              <span class="level-badge sm" [style.background]="getLevelColor(c.studentId?.level || '')">
                {{ c.studentId?.level || '—' }}
              </span>
            </td>
            <td>
              <span class="score-badge sm" [class.good]="c.scorePercentage >= 70">
                {{ c.scorePercentage }}%
              </span>
            </td>
            <td>{{ formatTime(c.timeSpentSeconds) }}</td>
            <td class="center">#{{ c.attemptNumber }}</td>
            <td>{{ c.completedAt | date:'MMM d, y h:mm a' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="no-completions" *ngIf="completions.length === 0">
        <span class="material-icons">inbox</span>
        <p>No completions {{ selectedDate ? 'on ' + selectedDate : 'yet' }}</p>
      </div>
    </div>
  </div>
</div>
  `,
  styles: [`
    .dem-container {
      padding: 32px 24px 48px;
      max-width: 1320px;
      margin: 0 auto;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      background: #fafbfc;
      min-height: 100vh;
    }
    .dem-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 28px;
      flex-wrap: wrap;
      gap: 20px;
    }
    .dem-title-area h1 {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0 0 6px;
      font-size: 1.75rem;
      font-weight: 700;
      color: #111827;
      letter-spacing: -0.02em;
    }
    .dem-title-area h1 .material-icons { font-size: 28px; color: #6366f1; }
    .dem-title-area p { margin: 0; color: #6b7280; font-size: 0.95rem; }
    .header-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .btn-generate-ai {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
      color: white;
      border: none;
      border-radius: 10px;
      padding: 11px 20px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.2s;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
    }
    .btn-generate-ai:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(99, 102, 241, 0.45); }
    .btn-generate-ai .material-icons { font-size: 20px; }
    .btn-create {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: white;
      border: none;
      border-radius: 10px;
      padding: 11px 22px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.2s;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.3);
    }
    .btn-create:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4); }
    .btn-create .material-icons { font-size: 20px; }
    .empty-actions { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; margin-top: 8px; }
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: white;
      border-radius: 16px;
      padding: 24px;
      text-align: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.06);
      border: 1px solid #e5e7eb;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: box-shadow 0.2s, transform 0.15s;
    }
    .stat-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.08); transform: translateY(-2px); }
    .stat-number { font-size: 2.25rem; font-weight: 800; color: #6366f1; letter-spacing: -0.02em; line-height: 1; }
    .stat-label { font-size: 0.75rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
    .filters-bar {
      display: flex;
      gap: 14px;
      margin-bottom: 24px;
      flex-wrap: wrap;
      align-items: center;
      padding: 18px 22px;
      background: white;
      border-radius: 14px;
      border: 1px solid #e5e7eb;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .filter-group { position: relative; flex: 1; min-width: 240px; }
    .filter-input {
      width: 100%;
      padding: 12px 16px 12px 44px;
      border: 1.5px solid #e5e7eb;
      border-radius: 10px;
      font-size: 0.95rem;
      outline: none;
      background: #f9fafb;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .filter-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12); background: white; }
    .search-input { padding-left: 44px; }
    .search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #9ca3af; font-size: 22px; }
    .filter-select {
      padding: 11px 16px;
      border: 1.5px solid #e5e7eb;
      border-radius: 10px;
      font-size: 0.9rem;
      min-width: 140px;
      background: white;
      color: #374151;
      font-weight: 500;
      cursor: pointer;
    }
    .filter-select:focus { border-color: #6366f1; outline: none; }
    .loading-state { text-align: center; padding: 64px; color: #6b7280; }
    .spinner { width: 44px; height: 44px; border: 3px solid #e5e7eb; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
    .spinner.small { width: 20px; height: 20px; border-width: 2px; display: inline-block; vertical-align: middle; margin: 0 8px 0 0; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .table-container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.06);
      border: 1px solid #e5e7eb;
      overflow: hidden;
    }
    .exercise-table { width: 100%; border-collapse: collapse; }
    .exercise-table th {
      background: #f9fafb;
      padding: 14px 20px;
      text-align: left;
      font-size: 0.78rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      border-bottom: 1.5px solid #e5e7eb;
    }
    .exercise-table td { padding: 16px 20px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
    .exercise-table tr:last-child td { border-bottom: none; }
    .exercise-table tr:hover td { background: #fafbfc; }
    .title-cell .exercise-title { font-weight: 600; color: #111827; }
    .title-cell .exercise-meta { font-size: 0.8rem; color: #6b7280; margin-top: 4px; }
    .type-chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .type-chip { padding: 4px 10px; border-radius: 8px; font-size: 0.75rem; font-weight: 600; }
    .chip-mcq { background: #dbeafe; color: #1d4ed8; }
    .chip-matching { background: #ede9fe; color: #5b21b6; }
    .chip-fill-blank { background: #d1fae5; color: #047857; }
    .chip-pronunciation { background: #ffedd5; color: #c2410c; }
    .level-badge { display: inline-block; padding: 4px 12px; border-radius: 8px; color: white; font-size: 0.78rem; font-weight: 600; }
    .level-badge.sm { padding: 3px 8px; font-size: 0.72rem; }
    .score-badge { display: inline-block; padding: 4px 10px; border-radius: 8px; font-size: 0.82rem; font-weight: 600; background: #fef3c7; color: #92400e; }
    .score-badge.good { background: #d1fae5; color: #065f46; }
    .score-badge.sm { padding: 3px 8px; font-size: 0.78rem; }
    .status-badge { padding: 5px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 600; }
    .status-badge.active { background: #d1fae5; color: #065f46; }
    .status-badge.inactive { background: #fee2e2; color: #991b1b; }
    .visibility-btn {
      background: #f3f4f6;
      border: none;
      cursor: pointer;
      padding: 8px;
      border-radius: 10px;
      color: #9ca3af;
      transition: color 0.2s, background 0.2s;
    }
    .visibility-btn.visible { color: #6366f1; background: #eef2ff; }
    .visibility-btn:hover { color: #6366f1; background: #e5e7eb; }
    .center { text-align: center; }
    .text-muted { color: #6b7280; }
    .actions-cell { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .btn-icon {
      background: white;
      border: 1.5px solid #e5e7eb;
      cursor: pointer;
      padding: 8px 10px;
      border-radius: 10px;
      color: #6b7280;
      font-size: 0.85rem;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .btn-icon:hover { border-color: #6366f1; color: #6366f1; }
    .btn-edit:hover { border-color: #6366f1; color: #6366f1; }
    .btn-delete:hover { border-color: #dc2626; color: #dc2626; }
    .btn-view:hover { border-color: #059669; color: #059669; }
    .empty-state {
      padding: 64px 32px;
      text-align: center;
      color: #6b7280;
    }
    .empty-icon { font-size: 64px; color: #d1d5db; }
    .empty-state h3 { margin: 16px 0 8px; font-weight: 700; color: #111827; font-size: 1.2rem; }
    .pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      padding: 20px;
      border-top: 1px solid #f3f4f6;
    }
    .page-btn {
      background: white;
      border: 1.5px solid #e5e7eb;
      border-radius: 10px;
      padding: 10px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      font-weight: 500;
      color: #374151;
      transition: all 0.2s;
    }
    .page-btn:hover:not(:disabled) { border-color: #6366f1; color: #6366f1; background: #fafbfc; }
    .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .page-info { font-size: 0.9rem; color: #6b7280; font-weight: 500; }
    .completions-panel {
      margin-top: 28px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.06);
      border: 1px solid #e5e7eb;
      overflow: hidden;
    }
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 22px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      flex-wrap: wrap;
      gap: 12px;
    }
    .panel-header h2 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 1.1rem; font-weight: 700; color: #111827; }
    .panel-controls { display: flex; align-items: center; gap: 12px; }
    .date-input {
      padding: 10px 14px;
      border: 1.5px solid #e5e7eb;
      border-radius: 10px;
      font-size: 0.9rem;
      background: white;
    }
    .date-input:focus { border-color: #6366f1; outline: none; }
    .btn-close {
      background: white;
      border: 1.5px solid #e5e7eb;
      border-radius: 10px;
      padding: 8px 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      transition: all 0.2s;
    }
    .btn-close:hover { border-color: #dc2626; color: #dc2626; }
    .completions-loading { padding: 32px; text-align: center; color: #6b7280; }
    .completions-table-wrap { padding: 0; }
    .completions-table { width: 100%; border-collapse: collapse; }
    .completions-table th {
      background: #f9fafb;
      padding: 12px 18px;
      text-align: left;
      font-size: 0.78rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      border-bottom: 1px solid #e5e7eb;
    }
    .completions-table td { padding: 14px 18px; border-bottom: 1px solid #f3f4f6; font-size: 0.9rem; }
    .completions-table tr:hover td { background: #fafbfc; }
    .no-completions { padding: 48px; text-align: center; color: #9ca3af; }
    .no-completions .material-icons { font-size: 48px; color: #d1d5db; }
    .no-completions p { margin: 10px 0 0; font-size: 0.95rem; }
    @media (max-width: 768px) {
      .exercise-table { display: block; overflow-x: auto; }
      .stats-bar { grid-template-columns: 1fr; }
    }
  `]
})
export class DigitalExerciseManagementComponent implements OnInit {
  exercises: DigitalExercise[] = [];
  loading = false;
  totalExercises = 0;
  publishedCount = 0;
  totalCompletions = 0;
  totalPages = 1;
  currentPage = 1;
  isAdminUser = false;

  filters: any = {
    search: '',
    level: '',
    category: ''
  };

  levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  categories = ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'];

  // Completions panel
  selectedExercise: DigitalExercise | null = null;
  completions: any[] = [];
  completionsLoading = false;
  selectedDate = '';

  private searchTimer: any;

  constructor(
    private exerciseService: DigitalExerciseService,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.isAdminUser = user.role === 'ADMIN' || user.role === 'TEACHER_ADMIN';
      }
    });
    this.loadExercises();
  }

  loadExercises(): void {
    this.loading = true;
    const params = {
      ...this.filters,
      page: this.currentPage,
      limit: 20
    };
    this.exerciseService.getExercisesForAdmin(params).subscribe({
      next: (res) => {
        this.exercises = res.exercises || [];
        this.totalExercises = res.total || 0;
        this.totalPages = res.pages || 1;
        this.publishedCount = this.exercises.filter(e => e.visibleToStudents).length;
        this.totalCompletions = this.exercises.reduce((sum, e) => sum + (e.stats?.completions || 0), 0);
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.showError('Failed to load exercises');
      }
    });
  }

  onSearchChange(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadExercises(), 400);
  }

  navigateToCreate(): void {
    this.router.navigate(['/admin/digital-exercises/create']);
  }

  navigateToAiGenerator(): void {
    this.router.navigate(['/admin/digital-exercises/generate-ai']);
  }

  navigateToListeningWorksheetGenerator(): void {
    this.router.navigate(['/admin/digital-exercises/generate-listening-manual']);
  }

  navigateToEdit(id: string): void {
    this.router.navigate(['/admin/digital-exercises', id, 'edit']);
  }

  toggleVisibility(exercise: DigitalExercise): void {
    const id = exercise._id ?? (exercise as any).id;
    if (!id) {
      this.showError('Cannot update: exercise id missing');
      return;
    }
    const newVisibility = !exercise.visibleToStudents;
    this.exerciseService.toggleVisibility(String(id), newVisibility).subscribe({
      next: (res) => {
        exercise.visibleToStudents = res?.visibleToStudents ?? newVisibility;
        this.publishedCount = this.exercises.filter(e => e.visibleToStudents).length;
        this.showSuccess(newVisibility ? 'Exercise published to students' : 'Exercise hidden from students');
      },
      error: (err) => {
        const msg = err?.error?.error || err?.error?.message || err?.message || 'Failed to update visibility';
        this.showError(msg);
      }
    });
  }

  deleteExercise(exercise: DigitalExercise): void {
    if (!confirm(`Delete "${exercise.title}"? This action cannot be undone.`)) return;
    this.exerciseService.deleteExercise(exercise._id!).subscribe({
      next: () => {
        this.exercises = this.exercises.filter(e => e._id !== exercise._id);
        this.totalExercises--;
        this.showSuccess('Exercise deleted');
      },
      error: () => this.showError('Failed to delete exercise')
    });
  }

  viewCompletions(exercise: DigitalExercise): void {
    this.selectedExercise = exercise;
    this.selectedDate = new Date().toISOString().split('T')[0];
    this.loadCompletions();
  }

  loadCompletions(): void {
    if (!this.selectedExercise) return;
    this.completionsLoading = true;
    const filters: any = {};
    if (this.selectedDate) filters.date = this.selectedDate;
    this.exerciseService.getExerciseCompletions(this.selectedExercise._id!, filters).subscribe({
      next: (res) => {
        this.completions = res.attempts || [];
        this.completionsLoading = false;
      },
      error: () => {
        this.completionsLoading = false;
        this.showError('Failed to load completions');
      }
    });
  }

  changePage(page: number): void {
    this.currentPage = page;
    this.loadExercises();
  }

  getQuestionTypeSummary(exercise: DigitalExercise): Array<{ type: string; count: number; icon: string }> {
    const counts: Record<string, number> = {};
    (exercise.questions || []).forEach(q => {
      counts[q.type] = (counts[q.type] || 0) + 1;
    });
    const icons: Record<string, string> = { mcq: '❓', matching: '🔗', 'fill-blank': '📝', pronunciation: '🎤' };
    return Object.entries(counts).map(([type, count]) => ({ type, count, icon: icons[type] || '•' }));
  }

  getLevelColor(level: string): string {
    return this.exerciseService.getLevelColor(level);
  }

  formatTime(seconds: number): string {
    if (!seconds) return '—';
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  private showSuccess(msg: string): void {
    this.snackBar.open(msg, 'Close', { duration: 3000, panelClass: ['success-snack'] });
  }

  private showError(msg: string): void {
    this.snackBar.open(msg, 'Close', { duration: 4000, panelClass: ['error-snack'] });
  }
}
