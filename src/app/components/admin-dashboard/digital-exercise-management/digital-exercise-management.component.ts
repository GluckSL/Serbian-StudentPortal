// src/app/components/admin-dashboard/digital-exercise-management/digital-exercise-management.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  DigitalExerciseService,
  DigitalExercise,
  DigitalExerciseBulkMetadata
} from '../../../services/digital-exercise.service';
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
      <button class="btn-video-exercise" (click)="navigateToVideoExercise()">
        <span class="material-icons">videocam</span> + Video Exercise
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
    <select [(ngModel)]="filters.scheduleFilter" (change)="onScheduleFilterChange()" class="filter-select">
      <option value="all">All schedule days</option>
      <option value="unassigned">General (no day)</option>
      <option value="by_day">Specific day…</option>
    </select>
    <input
      *ngIf="filters.scheduleFilter === 'by_day'"
      type="number"
      min="1"
      max="200"
      [(ngModel)]="filters.scheduleDay"
      (change)="loadExercises()"
      class="filter-input day-filter-input"
      placeholder="Day 1–200"
    />
  </div>

  <!-- Bulk selection -->
  <div class="bulk-actions-bar" *ngIf="!loading && selectedIds.length > 0">
    <span class="bulk-count">{{ selectedIds.length }} selected</span>
    <button type="button" class="btn-bulk btn-clear" (click)="clearSelection()">Clear</button>
    <button
      type="button"
      class="btn-bulk btn-edit"
      (click)="editSingleSelected()"
      [disabled]="selectedIds.length !== 1"
      matTooltip="Open the full editor (one exercise)"
    >
      <span class="material-icons">edit</span> Edit
    </button>
    <button type="button" class="btn-bulk" (click)="toggleBulkProperties()">
      <span class="material-icons">tune</span> Bulk properties
    </button>
    <button type="button" class="btn-bulk btn-delete-bulk" (click)="bulkDelete()" *ngIf="isAdminUser">
      <span class="material-icons">delete</span> Delete
    </button>
  </div>

  <div class="bulk-properties-panel" *ngIf="bulkPropertiesOpen && !loading">
    <p class="bulk-panel-hint">Only fields you set below are applied to every selected exercise.</p>
    <div class="bulk-fields">
      <select [(ngModel)]="bulkLevel" class="filter-select">
        <option value="">Level — no change</option>
        <option *ngFor="let l of levels" [value]="l">{{ l }}</option>
      </select>
      <select [(ngModel)]="bulkCategory" class="filter-select">
        <option value="">Category — no change</option>
        <option *ngFor="let c of categories" [value]="c">{{ c }}</option>
      </select>
      <select [(ngModel)]="bulkDifficulty" class="filter-select">
        <option value="">Difficulty — no change</option>
        <option value="Beginner">Beginner</option>
        <option value="Intermediate">Intermediate</option>
        <option value="Advanced">Advanced</option>
      </select>
      <select [(ngModel)]="bulkDayMode" class="filter-select">
        <option value="unchanged">Schedule day — no change</option>
        <option value="clear">General (no day)</option>
        <option value="set">Specific day…</option>
      </select>
      <input
        *ngIf="bulkDayMode === 'set'"
        type="number"
        min="1"
        max="200"
        [(ngModel)]="bulkDayNumber"
        class="filter-input day-filter-input"
        placeholder="Day 1–200"
      />
      <select [(ngModel)]="bulkVisibility" class="filter-select">
        <option value="unchanged">Student visibility — no change</option>
        <option value="show">Show to students</option>
        <option value="hide">Hide from students</option>
      </select>
    </div>
    <div class="bulk-panel-actions">
      <button type="button" class="btn-create" (click)="applyBulkProperties()" [disabled]="bulkApplying">
        {{ bulkApplying ? 'Applying…' : 'Apply to selected' }}
      </button>
      <button type="button" class="btn-bulk btn-clear" (click)="toggleBulkProperties()">Close</button>
    </div>
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
          <th class="checkbox-col">
            <mat-checkbox
              [checked]="allPageSelected"
              [indeterminate]="somePageSelected"
              (change)="toggleSelectAll($event.checked)"
              matTooltip="Select all on this page"
            ></mat-checkbox>
          </th>
          <th>Exercise</th>
          <th>Type Mix</th>
          <th>Level</th>
          <th>Category</th>
          <th>Day</th>
          <th>Questions</th>
          <th>Completions</th>
          <th>Avg Score</th>
          <th>Students</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let ex of exercises">
          <td class="checkbox-col" (click)="$event.stopPropagation()">
            <mat-checkbox
              [checked]="isRowSelected(exerciseRowId(ex))"
              (change)="setRowSelection(exerciseRowId(ex), $event.checked)"
            ></mat-checkbox>
          </td>
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
          <td class="center">
            <span *ngIf="ex.courseDay != null" class="day-pill">Day {{ ex.courseDay }}</span>
            <span *ngIf="ex.courseDay == null" class="text-muted">—</span>
          </td>
          <td class="center">{{ ex.questions.length || 0 }}</td>
          <td class="center">{{ ex.stats != null ? ex.stats.completions : 0 }}</td>
          <td class="center">
            <span *ngIf="ex.stats != null && ex.stats.avgScore" class="score-badge" [class.good]="ex.stats.avgScore >= 70">
              {{ ex.stats.avgScore }}%
            </span>
            <span *ngIf="ex.stats == null || !ex.stats.avgScore" class="text-muted">—</span>
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

</div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: calc(100vh - 80px);
      font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
    }

    .dem-container {
      padding: 24px 24px 48px;
      width: 100%;
      max-width: none;
      margin: 0;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      background: #f8f7ff;
      min-height: 100vh;
      box-sizing: border-box;
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

    .btn-video-exercise {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #7c3aed;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s;
    }
    .btn-video-exercise:hover { background: #6d28d9; }
    .btn-video-exercise .material-icons { font-size: 14px; }

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

    .bulk-actions-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      margin-bottom: 10px;
      background: #e0e7ff;
      border: 1px solid #c7d2fe;
      border-radius: 14px;
    }

    .bulk-count { font-size: 12px; font-weight: 700; color: #312e81; margin-right: 6px; }

    .btn-bulk {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #fff;
      border: 1px solid #c7d2fe;
      border-radius: 8px;
      padding: 5px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      color: #3730a3;
      font-family: inherit;
    }

    .btn-bulk .material-icons { font-size: 14px; }
    .btn-bulk:hover:not(:disabled) { border-color: #005b96; color: #005b96; }
    .btn-bulk:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-bulk.btn-clear { background: transparent; }
    .btn-bulk.btn-delete-bulk:hover:not(:disabled) { border-color: #e11d48; color: #e11d48; }

    .bulk-properties-panel {
      background: #fff;
      border: 1px solid #e8ecf4;
      border-radius: 14px;
      padding: 14px 16px;
      margin-bottom: 10px;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
    }

    .bulk-panel-hint { margin: 0 0 10px; font-size: 11px; color: #64748b; }
    .bulk-fields { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
    .bulk-panel-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

    .checkbox-col {
      width: 32px;
      max-width: 32px;
      padding-left: 6px;
      padding-right: 6px;
      text-align: center;
      vertical-align: middle;
    }

    .exercise-table th.checkbox-col { text-align: center; }

    :host ::ng-deep .checkbox-col mat-checkbox.mat-mdc-checkbox {
      display: inline-flex;
      vertical-align: middle;
    }

    :host ::ng-deep .checkbox-col mat-checkbox.mat-mdc-checkbox .mdc-checkbox {
      transform: scale(0.68);
      transform-origin: center center;
    }

    :host ::ng-deep .checkbox-col .mat-mdc-checkbox-touch-target {
      width: 28px;
      height: 28px;
    }

    .filter-input.day-filter-input {
      width: 100px;
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 12px;
      background: #f8fafc;
      font-family: inherit;
    }

    .day-pill {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 6px;
      background: #e0e7ff;
      color: #3730a3;
    }

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
    .page-info { font-size: 0.9rem; color: #6b7280; font-weight: 500; }
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

  /** Multi-select on the current list page */
  selectedIds: string[] = [];
  bulkPropertiesOpen = false;
  bulkApplying = false;
  bulkLevel = '';
  bulkCategory = '';
  bulkDifficulty = '';
  bulkDayMode: 'unchanged' | 'clear' | 'set' = 'unchanged';
  bulkDayNumber: number | null = null;
  bulkVisibility: 'unchanged' | 'show' | 'hide' = 'unchanged';

  filters: any = {
    search: '',
    level: '',
    category: '',
    /** all | unassigned | by_day */
    scheduleFilter: 'all',
    scheduleDay: null as number | null
  };

  levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  categories = ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'];

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
    const params: any = {
      search: this.filters.search,
      level: this.filters.level,
      category: this.filters.category,
      page: this.currentPage,
      limit: 20
    };
    if (this.filters.scheduleFilter === 'unassigned') {
      params.courseDay = 'unassigned';
    } else if (this.filters.scheduleFilter === 'by_day') {
      const d = parseInt(String(this.filters.scheduleDay), 10);
      if (Number.isFinite(d) && d >= 1 && d <= 200) {
        params.courseDay = d;
      }
    }
    this.exerciseService.getExercisesForAdmin(params).subscribe({
      next: (res) => {
        this.exercises = res.exercises || [];
        this.totalExercises = res.total || 0;
        this.totalPages = res.pages || 1;
        this.publishedCount = this.exercises.filter(e => e.visibleToStudents).length;
        this.totalCompletions = this.exercises.reduce((sum, e) => sum + (e.stats != null ? e.stats.completions : 0), 0);
        this.loading = false;
        this.clearSelection();
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

  onScheduleFilterChange(): void {
    if (this.filters.scheduleFilter !== 'by_day') {
      this.filters.scheduleDay = null;
    }
    this.loadExercises();
  }

  navigateToCreate(): void {
    this.router.navigate(['/admin/digital-exercises/create']);
  }

  navigateToVideoExercise(): void {
    this.router.navigate(['/admin/digital-exercises/create-video']);
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

  exerciseRowId(ex: DigitalExercise): string {
    const id = ex._id ?? (ex as { id?: string }).id;
    return id != null ? String(id) : '';
  }

  get exerciseIdsOnPage(): string[] {
    return this.exercises.map(e => this.exerciseRowId(e)).filter(Boolean);
  }

  isRowSelected(id: string): boolean {
    return !!id && this.selectedIds.includes(id);
  }

  setRowSelection(id: string, checked: boolean): void {
    if (!id) return;
    if (checked && !this.selectedIds.includes(id)) {
      this.selectedIds = [...this.selectedIds, id];
    } else if (!checked) {
      this.selectedIds = this.selectedIds.filter(x => x !== id);
    }
  }

  get allPageSelected(): boolean {
    const ids = this.exerciseIdsOnPage;
    return ids.length > 0 && ids.every(i => this.selectedIds.includes(i));
  }

  get somePageSelected(): boolean {
    const ids = this.exerciseIdsOnPage;
    return ids.some(i => this.selectedIds.includes(i)) && !this.allPageSelected;
  }

  toggleSelectAll(checked: boolean): void {
    const pageIds = this.exerciseIdsOnPage;
    if (checked) {
      this.selectedIds = [...new Set([...this.selectedIds, ...pageIds])];
    } else {
      const drop = new Set(pageIds);
      this.selectedIds = this.selectedIds.filter(id => !drop.has(id));
    }
  }

  clearSelection(): void {
    this.selectedIds = [];
    this.bulkPropertiesOpen = false;
  }

  editSingleSelected(): void {
    if (this.selectedIds.length !== 1) return;
    this.navigateToEdit(this.selectedIds[0]);
  }

  toggleBulkProperties(): void {
    this.bulkPropertiesOpen = !this.bulkPropertiesOpen;
    if (this.bulkPropertiesOpen) this.resetBulkForm();
  }

  resetBulkForm(): void {
    this.bulkLevel = '';
    this.bulkCategory = '';
    this.bulkDifficulty = '';
    this.bulkDayMode = 'unchanged';
    this.bulkDayNumber = null;
    this.bulkVisibility = 'unchanged';
  }

  applyBulkProperties(): void {
    const updates: DigitalExerciseBulkMetadata = {};
    if (this.bulkLevel) updates.level = this.bulkLevel as DigitalExercise['level'];
    if (this.bulkCategory) updates.category = this.bulkCategory;
    if (this.bulkDifficulty) updates.difficulty = this.bulkDifficulty as DigitalExercise['difficulty'];
    if (this.bulkDayMode === 'clear') updates.courseDay = null;
    if (this.bulkDayMode === 'set') {
      const d = parseInt(String(this.bulkDayNumber), 10);
      if (!Number.isFinite(d) || d < 1 || d > 200) {
        this.showError('Enter a valid schedule day between 1 and 200');
        return;
      }
      updates.courseDay = d;
    }
    if (this.bulkVisibility === 'show') updates.visibleToStudents = true;
    if (this.bulkVisibility === 'hide') updates.visibleToStudents = false;
    if (Object.keys(updates).length === 0) {
      this.showError('Choose at least one property to change');
      return;
    }
    this.bulkApplying = true;
    this.exerciseService.bulkUpdateExercises(this.selectedIds, updates).subscribe({
      next: (res) => {
        this.bulkApplying = false;
        this.showSuccess(`Updated ${res.modifiedCount} exercise(s)`);
        this.bulkPropertiesOpen = false;
        this.clearSelection();
        this.loadExercises();
      },
      error: (err) => {
        this.bulkApplying = false;
        const msg = err?.error?.error || err?.error?.message || err?.message || 'Bulk update failed';
        this.showError(msg);
      }
    });
  }

  bulkDelete(): void {
    if (!this.isAdminUser || this.selectedIds.length === 0) return;
    if (!confirm(`Delete ${this.selectedIds.length} exercise(s)? This cannot be undone.`)) return;
    this.exerciseService.bulkDeleteExercises(this.selectedIds).subscribe({
      next: (res) => {
        this.showSuccess(`Deleted ${res.modifiedCount} exercise(s)`);
        this.clearSelection();
        this.loadExercises();
      },
      error: (err) => {
        const msg = err?.error?.error || err?.error?.message || err?.message || 'Bulk delete failed';
        this.showError(msg);
      }
    });
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
    const id = exercise._id ?? (exercise as any).id;
    if (id) this.router.navigate(['/admin/digital-exercises', id, 'completions']);
  }

  changePage(page: number): void {
    this.currentPage = page;
    this.clearSelection();
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
