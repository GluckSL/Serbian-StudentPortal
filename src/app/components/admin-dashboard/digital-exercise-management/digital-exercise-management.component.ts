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
    :host {
      display: block;
      min-height: calc(100vh - 80px);
      font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
    }

    .dem-container {
      padding: 14px;
      min-height: calc(100vh - 80px);
    }

    /* ── Header ── */
    .dem-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #b3cde0;
      color: #011f4b;
      padding: 14px 18px;
      border-radius: 14px;
      margin-bottom: 10px;
      flex-wrap: wrap;
      gap: 10px;
    }

    .dem-title-area h1 {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      color: #011f4b;
    }

    .dem-title-area h1 .material-icons { font-size: 16px; color: #011f4b; }
    .dem-title-area p { margin: 2px 0 0; font-size: 11px; opacity: 0.65; }

    .header-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

    .btn-generate-ai {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #6497b1;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }

    .btn-generate-ai:hover { background: #005b96; }
    .btn-generate-ai .material-icons { font-size: 14px; }

    .btn-create {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #005b96;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }

    .btn-create:hover { background: #03396c; }
    .btn-create .material-icons { font-size: 14px; }

    .empty-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 8px; }

    /* ── Stats Bar ── */
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 10px;
    }

    .stat-card {
      background: #fff;
      border-radius: 12px;
      padding: 12px;
      text-align: center;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
      border: 1px solid #e8ecf4;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .stat-number { font-size: 18px; font-weight: 700; color: #005b96; line-height: 1; }
    .stat-label { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }

    /* ── Filters ── */
    .filters-bar {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
      flex-wrap: wrap;
      align-items: center;
      padding: 10px 14px;
      background: #fff;
      border-radius: 14px;
      border: 1px solid #e8ecf4;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
    }

    .filter-group { position: relative; flex: 1; min-width: 180px; }

    .filter-input {
      width: 100%;
      padding: 6px 10px 6px 32px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 12px;
      outline: none;
      background: #f8fafc;
      color: #1e293b;
      font-family: inherit;
      transition: border-color 0.15s;
    }

    .filter-input:focus { border-color: #005b96; box-shadow: 0 0 0 2px rgba(0,91,150,0.08); background: #fff; }
    .search-input { padding-left: 32px; }
    .search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 16px; }

    .filter-select {
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 12px;
      min-width: 120px;
      background: #f8fafc;
      color: #1e293b;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
    }

    .filter-select:focus { border-color: #005b96; outline: none; box-shadow: 0 0 0 2px rgba(0,91,150,0.08); }

    /* ── Loading ── */
    .loading-state { text-align: center; padding: 40px; color: #64748b; font-size: 12px; }
    .spinner { width: 28px; height: 28px; border: 3px solid #e2e8f0; border-top-color: #005b96; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 10px; }
    .spinner.small { width: 16px; height: 16px; border-width: 2px; display: inline-block; vertical-align: middle; margin: 0 6px 0 0; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Table ── */
    .table-container {
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
      border: 1px solid #e8ecf4;
      overflow: hidden;
    }

    .exercise-table { width: 100%; border-collapse: collapse; }

    .exercise-table th {
      background: #03396c;
      color: #fff;
      padding: 8px 10px;
      text-align: left;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border: none;
    }

    .exercise-table td {
      padding: 8px 10px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
      font-size: 12px;
    }

    .exercise-table tr:last-child td { border-bottom: none; }
    .exercise-table tr:hover td { background: #f8fafc; }
    .exercise-table tr { transition: background 0.15s; }

    .title-cell .exercise-title { font-weight: 600; color: #0f172a; font-size: 12px; }
    .title-cell .exercise-meta { font-size: 10px; color: #94a3b8; margin-top: 2px; }

    /* ── Type Chips ── */
    .type-chips { display: flex; gap: 4px; flex-wrap: wrap; }
    .type-chip { padding: 2px 6px; border-radius: 6px; font-size: 10px; font-weight: 600; }
    .chip-mcq { background: #dbeafe; color: #005b96; }
    .chip-matching { background: #e0f2fe; color: #0369a1; }
    .chip-fill-blank { background: #dcfce7; color: #166534; }
    .chip-pronunciation { background: #fef3c7; color: #92400e; }

    /* ── Badges ── */
    .level-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; color: #fff; font-size: 10px; font-weight: 600; }
    .level-badge.sm { padding: 2px 6px; font-size: 9px; }

    .score-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; background: #fef3c7; color: #92400e; }
    .score-badge.good { background: #dcfce7; color: #166534; }
    .score-badge.sm { padding: 2px 6px; font-size: 9px; }

    .status-badge { padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; }
    .status-badge.active { background: #dcfce7; color: #166534; }
    .status-badge.inactive { background: #ffe0e6; color: #e11d48; }

    /* ── Visibility Button ── */
    .visibility-btn {
      background: #f1f5f9;
      border: none;
      cursor: pointer;
      padding: 5px;
      border-radius: 8px;
      color: #94a3b8;
      transition: color 0.15s, background 0.15s;
    }

    .visibility-btn .material-icons { font-size: 18px; }
    .visibility-btn.visible { color: #005b96; background: #dbeafe; }
    .visibility-btn:hover { color: #005b96; background: #e2e8f0; }

    .center { text-align: center; }
    .text-muted { color: #94a3b8; }

    /* ── Action Buttons ── */
    .actions-cell { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }

    .btn-icon {
      background: #fff;
      border: 1px solid #e2e8f0;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 6px;
      color: #64748b;
      transition: all 0.15s;
      display: inline-flex;
      align-items: center;
    }

    .btn-icon .material-icons { font-size: 16px; }
    .btn-icon:hover { border-color: #005b96; color: #005b96; }
    .btn-edit:hover { border-color: #005b96; color: #005b96; }
    .btn-delete:hover { border-color: #e11d48; color: #e11d48; }
    .btn-view:hover { border-color: #28a745; color: #28a745; }

    /* ── Empty State ── */
    .empty-state { padding: 40px 20px; text-align: center; color: #94a3b8; }
    .empty-icon { font-size: 40px; color: #cbd5e1; }
    .empty-state h3 { margin: 10px 0 4px; font-weight: 700; color: #011f4b; font-size: 14px; }
    .empty-state p { font-size: 11px; }

    /* ── Pagination ── */
    .pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #f1f5f9;
    }

    .page-btn {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 4px 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      font-weight: 500;
      color: #475569;
      font-size: 11px;
      transition: all 0.15s;
    }

    .page-btn .material-icons { font-size: 16px; }
    .page-btn:hover:not(:disabled) { border-color: #005b96; color: #005b96; background: #f8fafc; }
    .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .page-info { font-size: 11px; color: #64748b; font-weight: 500; }

    /* ── Completions Panel ── */
    .completions-panel {
      margin-top: 14px;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
      border: 1px solid #e8ecf4;
      overflow: hidden;
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: #b3cde0;
      flex-wrap: wrap;
      gap: 8px;
    }

    .panel-header h2 {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      color: #011f4b;
    }

    .panel-header h2 .material-icons { font-size: 16px; }
    .panel-controls { display: flex; align-items: center; gap: 8px; }

    .date-input {
      padding: 5px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 11px;
      background: #fff;
      font-family: inherit;
    }

    .date-input:focus { border-color: #005b96; outline: none; }

    .btn-close {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 4px 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      transition: all 0.15s;
    }

    .btn-close .material-icons { font-size: 16px; }
    .btn-close:hover { border-color: #e11d48; color: #e11d48; }

    .completions-loading { padding: 20px; text-align: center; color: #64748b; font-size: 12px; }
    .completions-table-wrap { padding: 0; }

    .completions-table { width: 100%; border-collapse: collapse; }

    .completions-table th {
      background: #03396c;
      color: #fff;
      padding: 8px 10px;
      text-align: left;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border: none;
    }

    .completions-table td {
      padding: 8px 10px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 12px;
    }

    .completions-table tr:hover td { background: #f8fafc; }

    .no-completions { padding: 30px; text-align: center; color: #94a3b8; }
    .no-completions .material-icons { font-size: 32px; color: #cbd5e1; }
    .no-completions p { margin: 6px 0 0; font-size: 11px; }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .dem-header { flex-direction: column; align-items: stretch; }
      .header-actions { justify-content: flex-start; }
      .exercise-table { display: block; overflow-x: auto; }
      .stats-bar { grid-template-columns: 1fr; }
    }

    @media (max-width: 576px) {
      .dem-container { padding: 10px; }
      .dem-title-area h1 { font-size: 14px; }
      .actions-cell { flex-direction: column; }
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
