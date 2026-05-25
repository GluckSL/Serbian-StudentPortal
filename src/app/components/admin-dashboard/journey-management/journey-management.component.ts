// src/app/components/admin-dashboard/journey-management/journey-management.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, ActivatedRoute } from '@angular/router';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../services/notification.service';
import { AuthService } from '../../../services/auth.service';
import { TestAccountBadgeComponent } from '../../../shared/test-account-badge/test-account-badge.component';

interface BatchSummary {
  batchName: string;
  journeyLength: number;
  batchCurrentDay: number;
  batchStartDate: string | null;
  autoDay: boolean;
  notes: string;
  batchType?: 'new' | 'old';
  /** When batchType is old: weekly DG Bot release (days 1–7, then 8–14, …). */
  oldBatchDgBotAccess?: boolean;
  /** When true, students need at least strictJourneyThresholdPercent of each day’s tasks to advance. */
  strictJourneyRule?: boolean;
  strictJourneyThresholdPercent?: number;
  /** When true, Zoom webhook recordings are automatically saved for this batch. */
  autoRecordingEnabled?: boolean;
  /** Shown on home table only when true; false batches appear under “upcoming”. */
  journeyActive?: boolean;
  studentCount: number;
  teacherId?: string | null;
  /** Resolved from students' assignedTeacher (most common per batch). */
  teacherName: string | null;
}

interface TeacherPick {
  _id: string;
  name: string;
  email: string;
  role: string;
  studentCount?: number;
}

interface IncompleteTaskItem {
  kind: 'exercise' | 'class' | 'module';
  title: string;
  courseDay: number;
}

interface TaskCheckModal {
  studentId: string;
  studentName: string;
  currentDay: number;
  complete: boolean;
  incompleteTasks: IncompleteTaskItem[];
  completionPercent?: number;
  totalTasks?: number;
  doneTasks?: number;
  strictJourneyRule?: boolean;
  strictJourneyThresholdPercent?: number;
  thresholdMet?: boolean;
}

interface StudentRow {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  level: string;
  studentStatus: string;
  currentCourseDay: number;
  enrollmentDate: string | null;
  accountCreatedAt: string | null;
  /** When true, show Test badge (excluded from batch analytics). */
  isTestAccount?: boolean;
  editDay?: number;
  saving?: boolean;
  checkingTasks?: boolean;
  taskStatus?: {
    complete: boolean;
    breakdown: { exercises: any; classes: any };
    incompleteTasks?: IncompleteTaskItem[];
  } | null;
  advancing?: boolean;
}

interface SilverStudentRow {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  batch?: string;
  level?: string;
  studentStatus?: string;
  subscription: string;
  currentCourseDay?: number;
}

interface TimelineDay {
  day: number;
  modules: { _id: string; title: string; category: string; level: string }[];
  exercises: { _id: string; title: string; category: string; level: string }[];
  classes: { _id: string; topic: string; batch: string; startTime: string; duration: number }[];
  recordings?: { _id: string; title: string; level: string; plan?: string }[];
}

@Component({
  selector: 'app-journey-management',
  standalone: true,
  imports: [CommonModule, FormsModule, NgChartsModule, TestAccountBadgeComponent],
  template: `
<div class="journey-root">

  <!-- ══ Header ══════════════════════════════════════════ -->
  <div class="j-header">
    <div class="j-header-inner">
      <div>
        <h1 class="j-title">
          <span class="j-icon">📅</span> Journey Management
        </h1>
        <p class="j-subtitle">
          Configure batch journey lengths, advance course days, and see all content scheduled per day.
        </p>
      </div>
      <div class="j-header-actions">
        <button *ngIf="!isJourneyReadOnly" type="button" class="j-btn j-btn-outline" (click)="showCreateBatch = true">
          <i class="fas fa-plus"></i> Create batch
        </button>
        <button type="button" class="j-btn j-btn-outline" (click)="loadBatches()">
          <i class="fas fa-sync-alt"></i> Refresh
        </button>
      </div>
    </div>
  </div>

  <!-- ══ Create Batch (admin) ══════════════════════════════════════════ -->
  <div class="j-modal-backdrop" *ngIf="showCreateBatch" (click)="closeCreateBatch()">
    <div class="j-modal-card" role="dialog" aria-label="Create batch" (click)="$event.stopPropagation()">
      <div class="j-modal-header">
        <h3>Create batch</h3>
        <button type="button" class="j-modal-close" (click)="closeCreateBatch()" aria-label="Close">×</button>
      </div>

      <p class="j-modal-sub" style="margin:10px 20px 0">
        This creates a batch config in the portal. Students will appear once they’re assigned to this batch (e.g. via Monday sync).
      </p>

      <div style="padding: 14px 20px 0; display:grid; gap:12px;">
        <div class="j-filter-field">
          <label>Batch name</label>
          <input class="j-input" [(ngModel)]="newBatchName" placeholder="e.g. Batch 13" autocomplete="off" />
        </div>
        <div class="j-filter-field">
          <label>Journey length (days)</label>
          <input class="j-input" type="number" [(ngModel)]="newJourneyLength" min="1" max="200" />
        </div>
      </div>

      <div class="j-modal-footer">
        <button type="button" class="j-btn j-btn-outline" (click)="closeCreateBatch()">Cancel</button>
        <button type="button" class="j-btn j-btn-primary" [disabled]="creatingBatch" (click)="createBatch()">
          <i class="fas" [class.fa-spinner]="creatingBatch" [class.fa-plus]="!creatingBatch"></i>
          {{ creatingBatch ? 'Creating…' : 'Create' }}
        </button>
      </div>
    </div>
  </div>

  <!-- ══ Assign Teacher (admin) ══════════════════════════════════════════ -->
  <div class="j-modal-backdrop" *ngIf="showAssignTeacher" (click)="closeAssignTeacher()">
    <div class="j-modal-card" role="dialog" aria-label="Assign teacher" (click)="$event.stopPropagation()">
      <div class="j-modal-header">
        <h3>Assign Teacher</h3>
        <button type="button" class="j-modal-close" (click)="closeAssignTeacher()" aria-label="Close">×</button>
      </div>
      <p class="j-modal-sub">
        Batch <strong>{{ assignBatchName }}</strong>.
        This will set <strong>assigned teacher</strong> for all students in this batch.
      </p>

      <div style="padding: 14px 20px 0; display:grid; gap:10px;">
        <div class="j-search-wrap" style="flex:unset;">
          <i class="fas fa-search j-search-icon"></i>
          <input type="search" class="j-search-input" [(ngModel)]="teacherSearch"
                 placeholder="Search teachers by name or email…" autocomplete="off" />
        </div>

        <div *ngIf="teachersLoading" class="j-loading-inline">
          <div class="spinner-border spinner-border-sm text-primary"></div> Loading teachers…
        </div>

        <div *ngIf="!teachersLoading && filteredTeachers.length === 0" class="j-empty-inline" style="padding:14px;">
          No teachers found.
        </div>

        <div *ngIf="!teachersLoading && filteredTeachers.length > 0" class="j-teacher-list">
          <button type="button"
                  class="j-teacher-row"
                  *ngFor="let t of filteredTeachers"
                  [class.active]="selectedTeacherId === t._id"
                  (click)="selectedTeacherId = t._id">
            <div class="j-teacher-main">
              <strong>{{ t.name }}</strong>
              <small>{{ t.email }}</small>
            </div>
            <div class="j-teacher-meta">
              <span class="j-badge j-badge-secondary">{{ t.role }}</span>
              <span class="j-badge j-badge-primary">{{ t.studentCount || 0 }} students</span>
            </div>
          </button>
        </div>
      </div>

      <div class="j-modal-footer">
        <button type="button" class="j-btn j-btn-outline" (click)="closeAssignTeacher()">Cancel</button>
        <button type="button" class="j-btn j-btn-primary"
                [disabled]="assigningTeacher || !selectedTeacherId"
                (click)="assignTeacherToBatch()">
          <i class="fas" [class.fa-spinner]="assigningTeacher" [class.fa-user-check]="!assigningTeacher"></i>
          {{ assigningTeacher ? 'Assigning…' : 'Assign Teacher' }}
        </button>
      </div>
    </div>
  </div>

  <!-- ══ Plan Tabs (Platinum / Silver) ══════════════════════════════════════ -->
  <div class="j-plan-tab-bar">
    <button type="button" class="j-plan-tab" [class.j-plan-tab--active]="planTab === 'platinum'" (click)="switchPlanTab('platinum')">
      <span class="j-plan-tab-icon">💎</span> Platinum
    </button>
    <button type="button" class="j-plan-tab" [class.j-plan-tab--active]="planTab === 'silver'" (click)="switchPlanTab('silver')">
      <span class="j-plan-tab-icon">🥈</span> Silver
    </button>
    <button type="button" class="j-plan-tab" [class.j-plan-tab--active]="planTab === 'silver-sinhala'" (click)="switchPlanTab('silver-sinhala')">
      <span class="j-plan-tab-icon">🥈</span> Silver Sinhala
    </button>
  </div>

  <!-- ══ Loading ══════════════════════════════════════════ -->
  <div *ngIf="loading && planTab === 'platinum'" class="j-loading">
    <div class="spinner-border text-primary"></div>
    <p>Loading journeys…</p>
  </div>

  <!-- ══ BATCH OVERVIEW (level 1) ══════════════════════════════════════════ -->
  <div *ngIf="!loading && !selectedBatch && planTab === 'platinum'" class="j-content">

    <div class="j-start-journey-bar" *ngIf="!isJourneyReadOnly">
      <div class="j-start-journey-split">
        <div class="j-start-journey-inner">
          <label class="j-start-journey-label" for="j-upcoming-batch">Upcoming batches</label>
          <div class="j-start-journey-row">
            <select id="j-upcoming-batch" class="j-select j-select--upcoming" [(ngModel)]="selectedUpcomingBatch">
              <option [ngValue]="''">Select a batch…</option>
              <option *ngFor="let u of upcomingBatches" [ngValue]="u.batchName">
                {{ u.batchName }} — {{ u.studentCount }} student(s)
              </option>
            </select>
            <button type="button" class="j-btn j-btn-primary" (click)="startJourneyForSelected()"
                    [disabled]="!selectedUpcomingBatch || startingJourney">
              <i class="fas" [class.fa-spinner]="startingJourney" [class.fa-play]="!startingJourney" [class.fa-spin]="startingJourney"></i>
              {{ startingJourney ? 'Starting…' : 'Start journey' }}
            </button>
          </div>
          <p class="j-start-journey-hint">Only batches you start here appear in the journey table. Other batches stay in this dropdown until you add them.</p>
        </div>
        <div class="j-start-journey-side">
          <button type="button" class="j-btn j-btn-outline j-btn-all-students" (click)="openAllStudentsPage()">
            <i class="fas fa-users"></i> All students
          </button>
        </div>
      </div>
    </div>

    <div *ngIf="isJourneyReadOnly && batches.length === 0 && upcomingBatches.length > 0" class="j-teacher-journey-hint">
      <i class="fas fa-info-circle"></i>
      <span>These batches are not on the active journey list yet. An administrator can add them from the same page.</span>
    </div>

    <div *ngIf="batches.length === 0" class="j-empty">
      <i class="fas fa-layer-group fa-3x"></i>
      <p *ngIf="!isJourneyReadOnly && upcomingBatches.length > 0">No active journey batches yet. Choose an upcoming batch above and click <strong>Start journey</strong>.</p>
      <p *ngIf="isJourneyReadOnly && upcomingBatches.length > 0">No active journey batches in your view.</p>
      <p *ngIf="upcomingBatches.length === 0">No batches found. Create a batch or assign students to a batch name first.</p>
    </div>

    <!-- Filters + table -->
    <div *ngIf="batches.length > 0" class="j-batch-table-wrap">
      <div class="j-filter-bar">
        <div class="j-filter-row j-filter-row--main">
          <div class="j-search-wrap">
            <i class="fas fa-search j-search-icon"></i>
            <input
              type="search"
              class="j-search-input"
              [(ngModel)]="batchSearch"
              placeholder="Search by batch or teacher…"
              autocomplete="off"
            />
          </div>
          <div class="j-filter-sort">
            <label class="j-filter-label" for="j-sort">Sort</label>
            <select id="j-sort" class="j-select" [(ngModel)]="batchSort">
              <option value="name">Batch name (A–Z)</option>
              <option value="nameDesc">Batch name (Z–A)</option>
              <option value="day">Current day (low → high)</option>
              <option value="dayDesc">Current day (high → low)</option>
              <option value="students">Students (most first)</option>
              <option value="length">Journey length (longest first)</option>
            </select>
          </div>
          <div class="j-filter-toolbar-end">
            <button
              type="button"
              class="j-btn j-btn-filter-toggle"
              [class.j-btn-filter-toggle--open]="filtersExpanded"
              (click)="filtersExpanded = !filtersExpanded"
            >
              <i class="fas fa-sliders-h"></i>
              {{ filtersExpanded ? 'Hide filters' : 'More filters' }}
            </button>
            <button
              type="button"
              class="j-btn j-btn-outline j-btn-clear"
              *ngIf="hasActiveBatchFilters()"
              (click)="clearBatchFilters()"
            >
              <i class="fas fa-times"></i> Clear
            </button>
          </div>
        </div>

        <div class="j-filter-panel" *ngIf="filtersExpanded">
          <div class="j-filter-grid">
            <div class="j-filter-field">
              <label>Current day ≥</label>
              <input type="number" class="j-input" [(ngModel)]="filterDayMin" min="1" placeholder="Any">
            </div>
            <div class="j-filter-field">
              <label>Current day ≤</label>
              <input type="number" class="j-input" [(ngModel)]="filterDayMax" min="1" placeholder="Any">
            </div>
            <div class="j-filter-field">
              <label>Students ≥</label>
              <input type="number" class="j-input" [(ngModel)]="filterStudentsMin" min="0" placeholder="Any">
            </div>
            <div class="j-filter-field">
              <label>Journey length ≥ (days)</label>
              <input type="number" class="j-input" [(ngModel)]="filterJourneyMin" min="1" placeholder="Any">
            </div>
            <div class="j-filter-field">
              <label>Batch type</label>
              <select class="j-select" [(ngModel)]="filterBatchType">
                <option value="all">All</option>
                <option value="new">New batches (no students yet)</option>
                <option value="existing">Existing batches (has students)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="j-filter-meta" *ngIf="filteredBatches.length !== batches.length || batchSearch">
          <span class="j-filter-count">
            Showing <strong>{{ filteredBatches.length }}</strong> of {{ batches.length }} batch{{ batches.length !== 1 ? 'es' : '' }}
          </span>
        </div>
      </div>

      <div class="j-table-card j-table-card--batch">
        <div *ngIf="filteredBatches.length === 0" class="j-empty-inline">
          No batches match your filters. <button type="button" class="j-link-btn" (click)="clearBatchFilters()">Clear filters</button>
        </div>

        <div class="j-table-scroll" *ngIf="filteredBatches.length > 0">
          <table class="j-table j-table--batches">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Current day</th>
                <th>Students</th>
                <th>Teacher</th>
                <th>Journey</th>
                <th>Progress</th>
                <th class="j-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let b of filteredBatches; trackBy: trackBatch">
                <td>
                  <div class="j-batch-name-cell">{{ b.batchName }}</div>
                </td>
                <td>
                  <span class="j-day-pill j-day-pill--table">Day {{ b.batchCurrentDay }}</span>
                </td>
                <td>{{ b.studentCount }}</td>
                <td class="j-td-teacher" [title]="b.teacherName || ''">
                  <div class="j-teacher-cell">
                    <span>{{ b.teacherName || '—' }}</span>
                    <button *ngIf="!isJourneyReadOnly && !b.teacherName"
                            type="button"
                            class="j-btn j-btn-outline j-btn-sm"
                            style="margin-left:10px;"
                            (click)="openAssignTeacher(b)">
                      <i class="fas fa-user-plus"></i> Assign teacher
                    </button>
                  </div>
                </td>
                <td>{{ b.journeyLength }} days</td>
                <td>
                  <div class="j-progress-cell">
                    <div class="j-progress-track j-progress-track--table">
                      <div class="j-progress-fill"
                           [style.width.%]="b.journeyLength ? (b.batchCurrentDay / b.journeyLength) * 100 : 0"></div>
                    </div>
                    <span class="j-progress-label j-progress-label--table">{{ b.batchCurrentDay }} / {{ b.journeyLength }}</span>
                  </div>
                </td>
                <td>
                  <div class="j-batch-actions">
                    <button *ngIf="!isJourneyReadOnly" type="button" class="j-btn j-btn-primary j-btn-manage" (click)="openBatch(b)">
                      <i class="fas fa-pen"></i> Manage
                    </button>
                    <button *ngIf="isJourneyReadOnly" type="button" class="j-btn j-btn-primary j-btn-manage" (click)="openBatch(b)">
                      <i class="fas fa-eye"></i> View
                    </button>
                    <button *ngIf="!isJourneyReadOnly" type="button" class="j-btn j-btn-outline j-btn-sm j-btn-remove-active"
                            [disabled]="removingJourneyBatch === b.batchName"
                            (click)="removeBatchFromActiveJourney(b)">
                      <i class="fas" [class.fa-spinner]="removingJourneyBatch === b.batchName" [class.fa-times]="removingJourneyBatch !== b.batchName" [class.fa-spin]="removingJourneyBatch === b.batchName"></i>
                      Remove from list
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- ══ BATCH DETAIL (level 2) ══════════════════════════════════════════ -->
  <div *ngIf="!loading && selectedBatch && planTab === 'platinum'" class="j-content">

    <!-- Back + header + config are hidden in progress-only mode -->
    <ng-container *ngIf="!progressOnlyMode">
      <!-- Back -->
      <button class="j-btn j-btn-outline j-back-btn" (click)="closeBatch()">
        <i class="fas fa-arrow-left"></i> Back to all batches
      </button>

      <div class="j-detail-header">
        <h2>{{ selectedBatch.batchName }}</h2>
        <span class="j-batch-meta">{{ batchStudents.length }} students</span>
        <span class="j-day-pill" style="margin-left:8px">Day {{ selectedBatch.batchCurrentDay }}</span>
        <span class="j-auto-badge" *ngIf="selectedBatch.autoDay">
          <i class="fas fa-magic"></i> Auto
        </span>
      </div>

      <!-- ── Config row ─────────────────────────────── -->
      <div class="j-config-card">
      <h4 class="j-card-title">
        Batch Settings
        <span *ngIf="isJourneyReadOnly" class="j-ro-pill">View only</span>
      </h4>

      <!-- Teachers: compact summary cards (read-only) -->
      <div class="j-ro-summary" *ngIf="isJourneyReadOnly">
        <div class="j-ro-card">
          <div class="j-ro-card-icon"><i class="fas fa-chalkboard-teacher"></i></div>
          <div class="j-ro-card-body">
            <span class="j-ro-card-label">Teacher</span>
            <span class="j-ro-card-value">{{ selectedBatch.teacherName || 'Not assigned' }}</span>
          </div>
        </div>
        <div class="j-ro-card">
          <div class="j-ro-card-icon j-ro-card-icon--violet"><i class="fas fa-road"></i></div>
          <div class="j-ro-card-body">
            <span class="j-ro-card-label">Journey length</span>
            <span class="j-ro-card-value">{{ editJourneyLength }} days</span>
          </div>
        </div>
        <div class="j-ro-card">
          <div class="j-ro-card-icon j-ro-card-icon--blue"><i class="fas fa-calendar-alt"></i></div>
          <div class="j-ro-card-body">
            <span class="j-ro-card-label">Batch start</span>
            <span class="j-ro-card-value">{{ editBatchStartDate ? (editBatchStartDate | date:'dd MMM yyyy') : 'Manual mode' }}</span>
          </div>
        </div>
        <div class="j-ro-card j-ro-card--highlight">
          <div class="j-ro-card-icon j-ro-card-icon--green"><i class="fas fa-bullseye"></i></div>
          <div class="j-ro-card-body">
            <span class="j-ro-card-label">Current batch day</span>
            <span class="j-ro-card-value">
              Day {{ editBatchStartDate ? computedDayFromDate() : editBatchDay }}
              <span class="j-auto-badge" *ngIf="editBatchStartDate" style="margin-left:6px"><i class="fas fa-magic"></i> Auto</span>
            </span>
          </div>
        </div>
        <div class="j-ro-card">
          <div class="j-ro-card-icon j-ro-card-icon--amber"><i class="fas fa-shield-alt"></i></div>
          <div class="j-ro-card-body">
            <span class="j-ro-card-label">Strict journey rule</span>
            <span class="j-ro-card-value">
              {{ editStrictJourneyRule ? ('On — min ' + editStrictThresholdPercent + '% of day tasks') : 'Off (lenient)' }}
            </span>
          </div>
        </div>
        <div class="j-ro-card">
          <div class="j-ro-card-icon j-ro-card-icon--blue"><i class="fas fa-toggle-on"></i></div>
          <div class="j-ro-card-body">
            <span class="j-ro-card-label">Batch type</span>
            <span class="j-ro-card-value">{{ editBatchType === 'old' ? (editOldBatchDgBotAccess ? 'Old — live/recordings + DG Bot (weekly)' : 'Old (live/recordings only)') : 'New (modules/exercises enabled)' }}</span>
          </div>
        </div>
        <div class="j-ro-card" *ngIf="editBatchType === 'old'">
          <div class="j-ro-card-icon" [ngClass]="editOldBatchDgBotAccess ? 'j-ro-card-icon--green' : 'j-ro-card-icon--muted'"><i class="fas fa-robot"></i></div>
          <div class="j-ro-card-body">
            <span class="j-ro-card-label">DG Bot access</span>
            <span class="j-ro-card-value">{{ editOldBatchDgBotAccess ? 'On — weekly release' : 'Off' }}</span>
          </div>
        </div>
        <div class="j-ro-card">
          <div class="j-ro-card-icon" [ngClass]="editAutoRecordingEnabled ? 'j-ro-card-icon--green' : 'j-ro-card-icon--muted'"><i class="fas fa-video"></i></div>
          <div class="j-ro-card-body">
            <span class="j-ro-card-label">Auto recording</span>
            <span class="j-ro-card-value">{{ editAutoRecordingEnabled ? 'On — recordings saved automatically' : 'Off — backfill manually' }}</span>
          </div>
        </div>
        <div class="j-ro-card j-ro-card--wide" *ngIf="editNotes?.trim()">
          <div class="j-ro-card-icon j-ro-card-icon--muted"><i class="fas fa-sticky-note"></i></div>
          <div class="j-ro-card-body">
            <span class="j-ro-card-label">Notes</span>
            <span class="j-ro-card-value j-ro-card-value--notes">{{ editNotes }}</span>
          </div>
        </div>
      </div>

      <div class="j-config-row" *ngIf="!isJourneyReadOnly">
        <div class="j-config-field" style="min-width: 220px;">
          <label>Teacher</label>
          <div class="j-teacher-inline">
            <span class="j-teacher-pill">
              <i class="fas fa-chalkboard-teacher"></i>
              {{ selectedBatch.teacherName || 'Not assigned' }}
            </span>
            <button type="button"
                    class="j-btn j-btn-outline j-btn-sm"
                    (click)="openAssignTeacher(selectedBatch!)">
              <i class="fas" [class.fa-user-plus]="!selectedBatch.teacherName" [class.fa-user-edit]="!!selectedBatch.teacherName"></i>
              {{ selectedBatch.teacherName ? 'Change teacher' : 'Assign teacher' }}
            </button>
          </div>
        </div>
        <div class="j-config-field">
          <label>Journey Length (days)</label>
          <input type="number" [(ngModel)]="editJourneyLength" min="1" max="200" class="j-input">
        </div>

        <!-- Batch Start Date -->
        <div class="j-config-field">
          <label>
            Batch Start Date
            <span class="j-label-hint">— auto-advances batch day daily</span>
          </label>
          <input type="date" [(ngModel)]="editBatchStartDate" class="j-input">
        </div>

        <!-- Current Batch Day — read-only when auto, editable when manual -->
        <div class="j-config-field">
          <label>
            Current Batch Day
            <span class="j-auto-badge" *ngIf="editBatchStartDate">
              <i class="fas fa-magic"></i> Auto
            </span>
          </label>
          <div *ngIf="editBatchStartDate" class="j-auto-day-display">
            <span class="j-day-pill">Day {{ computedDayFromDate() }}</span>
            <span class="j-auto-day-hint">
              <i class="fas fa-info-circle"></i>
              {{ daysSinceStart() }} day{{ daysSinceStart() !== 1 ? 's' : '' }} since
              {{ editBatchStartDate | date:'dd MMM yyyy' }}
            </span>
          </div>
          <input *ngIf="!editBatchStartDate"
                 type="number" [(ngModel)]="editBatchDay"
                 min="1" [max]="editJourneyLength" class="j-input">
        </div>

        <div class="j-config-field j-config-field--strict">
          <label>
            Strict journey rule
            <span class="j-label-hint">— task completion before next day</span>
          </label>
          <div class="j-strict-controls">
            <label class="j-switch">
              <input type="checkbox" [(ngModel)]="editStrictJourneyRule" (change)="onStrictJourneyToggle()" />
              <span class="j-switch-slider" aria-hidden="true"></span>
              <span class="j-switch-label">{{ editStrictJourneyRule ? 'On' : 'Off' }} (default: off — students advance without finishing modules / exercises / live classes)</span>
            </label>
            <input *ngIf="editStrictJourneyRule"
                   type="number"
                   class="j-input j-input--strict-pct"
                   [(ngModel)]="editStrictThresholdPercent"
                   min="1"
                   max="100"
                   placeholder="Enter the % of strictness" />
          </div>
        </div>

        <div class="j-config-field">
          <label>
            Batch type
            <span class="j-label-hint">— default: old</span>
          </label>
          <select class="j-input" [(ngModel)]="editBatchType" (ngModelChange)="onBatchTypeChange()">
            <option value="new">New batch (modules + exercises + classes)</option>
            <option value="old">Old batch (classes + recordings only)</option>
          </select>
        </div>

        <div class="j-config-field j-config-field--strict" *ngIf="editBatchType === 'old'">
          <label>
            Give access of DG Bot
            <span class="j-label-hint">— weekly: days 1–7, then 8–14 after week 1 complete</span>
          </label>
          <div class="j-strict-controls">
            <label class="j-switch">
              <input type="checkbox" [(ngModel)]="editOldBatchDgBotAccess" />
              <span class="j-switch-slider" aria-hidden="true"></span>
              <span class="j-switch-label">{{ editOldBatchDgBotAccess ? 'On — students get DG Bot in 7-day journey weeks' : 'Off — no DG Bot for this batch' }}</span>
            </label>
          </div>
        </div>

        <div class="j-config-field j-config-field--strict">
          <label>
            Auto recording
            <span class="j-label-hint">— Zoom webhook saves recordings automatically</span>
          </label>
          <div class="j-strict-controls">
            <label class="j-switch">
              <input type="checkbox" [(ngModel)]="editAutoRecordingEnabled" />
              <span class="j-switch-slider" aria-hidden="true"></span>
              <span class="j-switch-label">{{ editAutoRecordingEnabled ? 'On — recordings saved automatically via webhook' : 'Off (default) — recordings must be backfilled manually' }}</span>
            </label>
          </div>
        </div>

        <div class="j-config-field" style="flex:2">
          <label>Notes</label>
          <input type="text" [(ngModel)]="editNotes" class="j-input" maxlength="500" placeholder="Optional notes…">
        </div>

        <div class="j-config-actions">
          <button type="button" class="j-btn j-btn-outline" (click)="saveConfig()" [disabled]="savingConfig">
            <i class="fas fa-save"></i> {{ savingConfig ? 'Saving…' : 'Save Config' }}
          </button>
          <button type="button" class="j-btn j-btn-primary" (click)="applyDayToAllStudents()" [disabled]="applyingDay">
            <i class="fas fa-users"></i>
            {{ applyingDay ? 'Applying…' : 'Apply Day ' + (editBatchStartDate ? computedDayFromDate() : editBatchDay) + ' to All Students' }}
          </button>
        </div>
      </div>

      <!-- Info box when start date is set -->
      <div class="j-start-date-info" *ngIf="editBatchStartDate">
        <i class="fas fa-calendar-check"></i>
        <div>
          <strong>Auto-schedule active.</strong>
          Batch started on <strong>{{ editBatchStartDate | date:'dd MMM yyyy' }}</strong>.
          Today is automatically <strong>Day {{ computedDayFromDate() }}</strong>.
          {{ editStrictJourneyRule ? 'Strict rule is on: students only move to the next day when they meet the completion % for their current day (checked at daily rollover).' : 'Lenient mode: student journey days advance on the daily rollover even if tasks are not finished.' }}
        </div>
        <button *ngIf="!isJourneyReadOnly" type="button" class="j-btn-icon-sm" title="Remove start date (switch to manual)"
                (click)="clearStartDate()">
          <i class="fas fa-times"></i>
        </button>
      </div>
      </div>
    </ng-container>

    <!-- ── Tabs ────────────────────────────────────── -->
    <div class="j-tabs" *ngIf="!progressOnlyMode">
      <button class="j-tab" [class.active]="activeTab === 'students'" (click)="openStudentsTab()">
        <i class="fas fa-users"></i> Students
      </button>
      <button class="j-tab" [class.active]="activeTab === 'timeline'" (click)="openTimeline()">
        <i class="fas fa-stream"></i> Content Timeline
      </button>
      <button class="j-tab" [class.active]="activeTab === 'progress'" (click)="openProgress()">
        <i class="fas fa-chart-line"></i> Progress
      </button>
    </div>

    <!-- ── Students tab ───────────────────────────── -->
    <div *ngIf="activeTab === 'students' && !progressOnlyMode" class="j-table-card">
      <div *ngIf="loadingStudents" class="j-sk-table-wrap" aria-busy="true" aria-label="Loading students">
        <div class="j-sk-row j-sk-row--head">
          <div class="j-sk j-sk-cell" *ngFor="let _ of skStudentCols"></div>
        </div>
        <div class="j-sk-row" *ngFor="let _ of skStudentRows">
          <div class="j-sk j-sk-cell j-sk-cell--lg"></div>
          <div class="j-sk j-sk-cell"></div>
          <div class="j-sk j-sk-cell"></div>
          <div class="j-sk j-sk-cell"></div>
          <div class="j-sk j-sk-cell j-sk-cell--md"></div>
          <div class="j-sk j-sk-cell j-sk-cell--md"></div>
          <div class="j-sk j-sk-cell j-sk-cell--bar"></div>
          <div class="j-sk j-sk-cell"></div>
          <div class="j-sk j-sk-cell j-sk-cell--btn"></div>
          <div class="j-sk j-sk-cell j-sk-cell--wide"></div>
        </div>
      </div>

      <div *ngIf="!loadingStudents && batchStudents.length === 0" class="j-empty-inline">
        No students in this batch.
      </div>

      <table *ngIf="!loadingStudents && batchStudents.length > 0" class="j-table">
          <thead>
              <tr>
                <th>Name</th>
                <th>Reg No</th>
                <th>Level</th>
                <th>Status</th>
                <th>Batch Joined</th>
                <th>Account Created</th>
                <th>Student Day</th>
                <th>Batch Day</th>
                <th>Tasks (current day)</th>
                <th *ngIf="!isJourneyReadOnly" class="text-center">Set Day / Advance</th>
              </tr>
            </thead>
        <tbody>
          <tr *ngFor="let s of batchStudents">
            <td>
              <div class="j-student-name-row">
                <span class="j-student-name">{{ s.name }}</span>
                <app-test-account-badge [show]="!!s.isTestAccount"></app-test-account-badge>
              </div>
              <div class="j-student-email">{{ s.email }}</div>
            </td>
            <td><span class="j-badge j-badge-secondary">{{ s.regNo }}</span></td>
            <td><span class="j-badge j-badge-primary">{{ s.level }}</span></td>
            <td>
              <span class="j-badge" [ngClass]="{
                'j-badge-success': s.studentStatus === 'ONGOING',
                'j-badge-danger': s.studentStatus === 'WITHDREW',
                'j-badge-secondary': s.studentStatus === 'COMPLETED' || s.studentStatus === 'UNCERTAIN'
              }">{{ s.studentStatus }}</span>
            </td>
            <!-- Batch joining / enrollment date -->
            <td>
              <div *ngIf="s.enrollmentDate" class="j-date-cell">
                <span class="j-date-main">{{ s.enrollmentDate | date:'dd MMM yyyy' }}</span>
                <span class="j-date-sub">{{ s.enrollmentDate | date:'HH:mm' }}</span>
              </div>
              <span *ngIf="!s.enrollmentDate" class="j-date-empty">—</span>
            </td>
            <!-- Account creation date -->
            <td>
              <div *ngIf="s.accountCreatedAt" class="j-date-cell">
                <span class="j-date-main">{{ s.accountCreatedAt | date:'dd MMM yyyy' }}</span>
                <span class="j-date-sub">{{ s.accountCreatedAt | date:'HH:mm' }}</span>
              </div>
              <span *ngIf="!s.accountCreatedAt" class="j-date-empty">—</span>
            </td>
            <!-- Student's own journey day -->
            <td>
              <div class="j-day-track">
                <div class="j-day-fill"
                     [style.width.%]="(s.currentCourseDay / selectedBatch!.journeyLength) * 100"></div>
              </div>
              <span class="j-day-text">Day {{ s.currentCourseDay }} / {{ selectedBatch!.journeyLength }}</span>
            </td>
            <!-- Batch current day vs student day comparison -->
            <td>
              <span class="j-batch-vs-student"
                    [class.j-behind]="s.currentCourseDay < selectedBatch!.batchCurrentDay"
                    [class.j-ontrack]="s.currentCourseDay >= selectedBatch!.batchCurrentDay">
                <i class="fas" [class.fa-exclamation-triangle]="s.currentCourseDay < selectedBatch!.batchCurrentDay"
                               [class.fa-check-circle]="s.currentCourseDay >= selectedBatch!.batchCurrentDay"></i>
                Day {{ selectedBatch!.batchCurrentDay }}
              </span>
              <div class="j-behind-label" *ngIf="s.currentCourseDay < selectedBatch!.batchCurrentDay">
                {{ selectedBatch!.batchCurrentDay - s.currentCourseDay }} day(s) behind
              </div>
            </td>
            <!-- Task completion: Check opens centered modal -->
            <td>
              <div class="j-task-check-wrap">
                <button
                  type="button"
                  class="j-btn j-btn-sm j-btn-outline"
                  (click)="checkStudentTasks(s)"
                  [disabled]="s.checkingTasks"
                >
                  <span *ngIf="s.checkingTasks" class="spinner-border spinner-border-sm" role="status"></span>
                  <ng-container *ngIf="!s.checkingTasks">
                    <i class="fas fa-clipboard-check"></i> Check
                  </ng-container>
                </button>
                <button
                  *ngIf="s.taskStatus && !s.checkingTasks"
                  type="button"
                  class="j-btn-link"
                  (click)="openTaskModalForStudent(s)"
                >
                  View
                </button>
              </div>
            </td>
            <!-- Set Day / Advance (admins only) -->
            <td *ngIf="!isJourneyReadOnly">
              <div class="j-student-day-ctrl">
                <input type="number" [(ngModel)]="s.editDay" min="1" [max]="selectedBatch!.journeyLength"
                       class="j-input-sm" placeholder="Day">
                <button type="button" class="j-btn j-btn-sm j-btn-primary"
                        title="Set to exact day"
                        (click)="setStudentDay(s)"
                        [disabled]="s.saving || !s.editDay">
                  <i class="fas fa-pen"></i>
                </button>
                <button type="button" class="j-btn j-btn-sm"
                        [title]="advanceArrowTitle(s)"
                        [class.j-btn-success]="s.taskStatus?.complete"
                        [class.j-btn-warning]="!s.taskStatus?.complete"
                        (click)="advanceStudentDay(s, !s.taskStatus?.complete)"
                        [disabled]="s.advancing || s.saving || (!advanceArrowHasJumpTarget(s) && s.currentCourseDay >= selectedBatch!.journeyLength)">
                  <i class="fas" [class.fa-arrow-right]="!s.advancing" [class.fa-spinner]="s.advancing"
                                 [class.fa-spin]="s.advancing"></i>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Timeline tab ───────────────────────────── -->
    <div *ngIf="activeTab === 'timeline' && !progressOnlyMode" class="j-timeline-section">
      <div *ngIf="loadingTimeline" class="j-sk-timeline" aria-busy="true" aria-label="Loading timeline">
        <div class="j-sk-timeline-filter">
          <div class="j-sk j-sk-pill"></div>
          <div class="j-sk j-sk-pill j-sk-pill--short"></div>
        </div>
        <div class="j-sk-timeline-day" *ngFor="let _ of skTimelineDays">
          <div class="j-sk-timeline-head">
            <div class="j-sk j-sk-title"></div>
            <div class="j-sk-chips">
              <span class="j-sk j-sk-chip"></span>
              <span class="j-sk j-sk-chip"></span>
            </div>
          </div>
          <div class="j-sk-timeline-body">
            <div class="j-sk j-sk-line"></div>
            <div class="j-sk j-sk-line j-sk-line--short"></div>
          </div>
        </div>
      </div>

      <div *ngIf="!loadingTimeline && timelineDays.length === 0" class="j-empty-inline">
        No content with journey days assigned yet. Set the <strong>Course Day</strong> field when creating modules, exercises, or live classes.
      </div>

      <!-- Search filter -->
      <div *ngIf="!loadingTimeline && timelineDays.length > 0" class="j-timeline-filter">
        <input type="number" [(ngModel)]="jumpDay" class="j-input-sm" placeholder="Jump to day…" min="1" [max]="selectedBatch!.journeyLength">
        <button class="j-btn j-btn-outline j-btn-sm" (click)="scrollToDay(jumpDay)" [disabled]="!jumpDay">Go</button>
        <span class="j-timeline-count">{{ timelineDays.length }} day(s) have content</span>
      </div>

      <div class="j-timeline" *ngIf="!loadingTimeline && timelineDays.length > 0">
        <div class="j-timeline-day" *ngFor="let d of timelineDays" [id]="'day-' + d.day"
             [class.j-current-day]="d.day === selectedBatch!.batchCurrentDay">

          <div class="j-tday-header">
            <span class="j-tday-number">Day {{ d.day }}</span>
            <span class="j-tday-current" *ngIf="d.day === selectedBatch!.batchCurrentDay">Current Batch Day</span>
            <div class="j-tday-chips">
              <span class="j-chip j-chip-module" *ngIf="d.modules.length">{{ d.modules.length }} module(s)</span>
              <span class="j-chip j-chip-exercise" *ngIf="d.exercises.length">{{ d.exercises.length }} exercise(s)</span>
              <span class="j-chip j-chip-class" *ngIf="d.classes.length">{{ d.classes.length }} class(es)</span>
              <span class="j-chip j-chip-class" *ngIf="d.recordings?.length" style="background:#ede9fe;color:#5b21b6;">{{ d.recordings?.length ?? 0 }} recording(s)</span>
            </div>
          </div>

          <div class="j-tday-content">
            <!-- Modules -->
            <div *ngIf="d.modules.length" class="j-content-group">
              <div class="j-content-group-label">
                <i class="fas fa-book"></i> Learning Modules
              </div>
              <div class="j-content-item" *ngFor="let m of d.modules">
                <span class="j-badge j-badge-primary">{{ m.level }}</span>
                <span class="j-badge j-badge-secondary">{{ m.category }}</span>
                <span class="j-content-title">{{ m.title }}</span>
              </div>
            </div>

            <!-- Exercises -->
            <div *ngIf="d.exercises.length" class="j-content-group">
              <div class="j-content-group-label">
                <i class="fas fa-dumbbell"></i> Digital Exercises
              </div>
              <div class="j-content-item" *ngFor="let e of d.exercises">
                <span class="j-badge j-badge-primary">{{ e.level }}</span>
                <span class="j-badge j-badge-secondary">{{ e.category }}</span>
                <span class="j-content-title">{{ e.title }}</span>
              </div>
            </div>

            <!-- Classes -->
            <div *ngIf="d.classes.length" class="j-content-group">
              <div class="j-content-group-label">
                <i class="fas fa-video"></i> Live Classes
              </div>
              <div class="j-content-item" *ngFor="let c of d.classes">
                <span class="j-badge j-badge-class">{{ c.batch }}</span>
                <span class="j-content-title">{{ c.topic }}</span>
                <span class="j-class-time" *ngIf="c.startTime">
                  {{ c.startTime | date:'dd MMM yyyy, HH:mm' }} · {{ c.duration }} min
                </span>
              </div>
            </div>

            <!-- Class recordings (manual uploads with courseDay + batch) -->
            <div *ngIf="d.recordings?.length" class="j-content-group">
              <div class="j-content-group-label">
                <i class="fas fa-film"></i> Class Recordings
              </div>
              <div class="j-content-item" *ngFor="let rec of (d.recordings || [])">
                <span class="j-badge j-badge-primary">{{ rec.level }}</span>
                <span class="j-badge j-badge-secondary">{{ rec.plan || 'ALL' }}</span>
                <span class="j-content-title">{{ rec.title }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Progress tab ───────────────────────────── -->
    <div *ngIf="activeTab === 'progress'" class="jp-section">

      <!-- Initial load: summary + per-student rows only (daily/weekly load when you open those views) -->
      <div *ngIf="loadingProgressOverall && !batchProgress" class="jp-skeleton" aria-busy="true" aria-label="Loading progress">
        <div class="jp-sk-hero">
          <div>
            <div class="j-sk j-sk-hero-title"></div>
            <div class="j-sk j-sk-hero-sub"></div>
          </div>
          <div class="j-sk j-sk-btn"></div>
        </div>
        <div class="jp-sk-pills">
          <div class="j-sk j-sk-pill-wide" *ngFor="let _ of skPillRow"></div>
        </div>
        <div class="jp-sk-stats">
          <div class="jp-sk-stat" *ngFor="let _ of skStatRow">
            <div class="j-sk j-sk-stat-ico"></div>
            <div class="jp-sk-stat-text">
              <div class="j-sk j-sk-stat-val"></div>
              <div class="j-sk j-sk-stat-lbl"></div>
            </div>
          </div>
        </div>
        <div class="jp-sk-panel">
          <div class="j-sk j-sk-panel-head"></div>
          <div class="j-sk j-sk-row-bar" *ngFor="let _ of skPanelRows"></div>
        </div>
      </div>

      <ng-container *ngIf="batchProgress">
        <div class="jp-shell">

          <div class="jp-hero">
            <div class="jp-hero-text">
              <h2 class="jp-hero-title"><i class="fas fa-chart-line"></i> Batch progress</h2>
              <p class="jp-hero-sub">Summary loads first. Open <strong>Daily</strong> or <strong>Weekly</strong> to load charts and day-by-day breakdown. Use <strong>View</strong> on a row for full student detail.</p>
            </div>
            <button type="button" class="j-btn j-btn-outline jp-hero-refresh" (click)="loadBatchProgress()">
              <i class="fas fa-sync-alt"></i> Refresh data
            </button>
          </div>

          <!-- Sub-view toggle -->
          <div class="jp-view-pills jp-view-pills--segmented">
            <button type="button" class="jp-pill" [class.jp-pill-active]="progressView === 'overall'" (click)="onProgressViewChange('overall')">
              <i class="fas fa-users"></i> Overall
            </button>
            <button type="button" class="jp-pill" [class.jp-pill-active]="progressView === 'daily'" (click)="onProgressViewChange('daily')">
              <i class="fas fa-calendar-day"></i> Daily
            </button>
            <button type="button" class="jp-pill" [class.jp-pill-active]="progressView === 'weekly'" (click)="onProgressViewChange('weekly')">
              <i class="fas fa-calendar-week"></i> Weekly
            </button>
          </div>

          <!-- Stats cards -->
          <div class="jp-stats-row">
            <div class="jp-stat-card jp-stat-card--accent-gold">
              <div class="jp-stat-icon jp-icon-score"><i class="fas fa-star"></i></div>
              <div class="jp-stat-body">
                <div class="jp-stat-value">{{ progressOverall.avgScorePercent ?? 0 }}%</div>
                <div class="jp-stat-label">Avg score</div>
              </div>
            </div>
            <div class="jp-stat-card jp-stat-card--accent-blue">
              <div class="jp-stat-icon jp-icon-exercise"><i class="fas fa-dumbbell"></i></div>
              <div class="jp-stat-body">
                <div class="jp-stat-value">{{ progressOverall.totalExercisesCompleted ?? 0 }}</div>
                <div class="jp-stat-label">Exercises done</div>
              </div>
            </div>
            <div class="jp-stat-card jp-stat-card--accent-green">
              <div class="jp-stat-icon jp-icon-class"><i class="fas fa-video"></i></div>
              <div class="jp-stat-body">
                <div class="jp-stat-value">{{ progressOverall.totalClassesAttended ?? 0 }}</div>
                <div class="jp-stat-label">Class check-ins</div>
              </div>
            </div>
            <div class="jp-stat-card jp-stat-card--accent-violet">
              <div class="jp-stat-icon jp-icon-day"><i class="fas fa-road"></i></div>
              <div class="jp-stat-body">
                <div class="jp-stat-value">{{ progressOverall.avgDayReached ?? 0 }}</div>
                <div class="jp-stat-label">Avg day reached</div>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Overall view: per-student table ── -->
        <div *ngIf="batchProgress && progressView === 'overall'" class="jp-panel">
          <div class="jp-panel-head">
            <h3 class="jp-panel-title"><i class="fas fa-user-graduate"></i> Per-student summary</h3>
            <span class="jp-panel-meta">{{ progressStudents.length }} students</span>
          </div>
          <div class="jp-table-scroll">
          <table class="j-table jp-table-zebra">
            <thead>
              <tr>
                <th>Name</th>
                <th>Reg No</th>
                <th>Level</th>
                <th>Current Day</th>
                <th>Avg Score</th>
                <th>Exercises Done</th>
                <th>Classes Attended</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of progressStudents">
                <td><strong>{{ s.name }}</strong></td>
                <td>{{ s.regNo }}</td>
                <td><span class="j-badge j-badge-primary">{{ s.level }}</span></td>
                <td>
                  <span class="jp-day-badge">Day {{ s.currentDay }}</span>
                </td>
                <td>
                  <div class="jp-score-bar-wrap">
                    <div class="jp-score-bar" [style.width.%]="s.avgScore"></div>
                    <span class="jp-score-text">{{ s.avgScore }}%</span>
                  </div>
                </td>
                <td>{{ s.exercisesDone }}</td>
                <td>{{ s.classesAttended }}</td>
                <td>
                  <button class="j-btn j-btn-sm j-btn-primary" (click)="loadStudentDetail(s._id)">
                    <i class="fas fa-eye"></i> View
                  </button>
                </td>
              </tr>
              <tr *ngIf="progressStudents.length === 0">
                <td colspan="8" class="j-empty-inline">No students found.</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        <!-- ── Daily view: row expand = exercise/module summary; analytics buttons open modals ── -->
        <div *ngIf="batchProgress && progressView === 'daily'" class="jp-panel jp-daily-card">
          <div class="jp-detail-loading" *ngIf="loadingProgressDetail">
            <span class="spinner-border spinner-border-sm text-primary" role="status"></span>
            Loading day-by-day breakdown…
          </div>
          <ng-container *ngIf="!loadingProgressDetail">
          <div class="jp-panel-head">
            <h3 class="jp-panel-title"><i class="fas fa-calendar-alt"></i> Day-by-day operations</h3>
            <span class="jp-panel-meta">{{ progressDaily.length }} days</span>
          </div>
          <div class="jp-daily-table-scroll">
            <table class="j-table jp-daily-table">
              <thead>
                <tr>
                  <th class="jp-col-expand" aria-hidden="true"></th>
                  <th>Day</th>
                  <th>Students reached</th>
                  <th>Scheduled</th>
                  <th>Exercise completion</th>
                  <th>Module completion</th>
                  <th>Avg score (day)</th>
                  <th>Classes held</th>
                  <th>Check-ins</th>
                  <th>Analytics</th>
                </tr>
              </thead>
              <tbody>
                <ng-container *ngFor="let d of progressDaily">
                  <tr
                    class="jp-day-row"
                    [class.jp-day-row--open]="expandedProgressDay === d.day"
                    (click)="toggleProgressDay(d.day)"
                    [attr.aria-expanded]="expandedProgressDay === d.day"
                  >
                    <td class="jp-col-expand"><i class="fas" [ngClass]="expandedProgressDay === d.day ? 'fa-chevron-down' : 'fa-chevron-right'"></i></td>
                    <td><span class="jp-day-badge">Day {{ d.day }}</span></td>
                    <td>{{ d.studentsCompleted }}</td>
                    <td>
                      <span class="jp-sched-pill">{{ d.exerciseCount ?? 0 }} ex</span>
                      <span class="jp-sched-pill jp-sched-pill--mod">{{ d.moduleCount ?? 0 }} mod</span>
                    </td>
                    <td>
                      <div class="jp-score-bar-wrap jp-score-bar-wrap--narrow">
                        <div class="jp-score-bar jp-score-bar--violet" [style.width.%]="d.exerciseCompletionPercent ?? 0"></div>
                        <span class="jp-score-text">{{ d.exerciseCompletionPercent ?? 0 }}%</span>
                      </div>
                    </td>
                    <td>
                      <div class="jp-score-bar-wrap jp-score-bar-wrap--narrow">
                        <div class="jp-score-bar jp-score-bar--amber" [style.width.%]="d.moduleCompletionPercent ?? 0"></div>
                        <span class="jp-score-text">{{ d.moduleCompletionPercent ?? 0 }}%</span>
                      </div>
                    </td>
                    <td>
                      <div class="jp-score-bar-wrap jp-score-bar-wrap--narrow">
                        <div class="jp-score-bar" [style.width.%]="d.avgScore"></div>
                        <span class="jp-score-text">{{ d.avgScore }}%</span>
                      </div>
                    </td>
                    <td>{{ d.classesHeld }}</td>
                    <td>{{ d.classesAttended }}</td>
                    <td (click)="$event.stopPropagation()">
                      <button
                        type="button"
                        class="j-btn j-btn-sm j-btn-outline"
                        [disabled]="!dayHasAnalytics(d)"
                        [title]="dayAnalyticsHint(d)"
                        (click)="openDayAnalytics(d, $event)"
                      >
                        <i class="fas" [ngClass]="(d.classesHeld ?? 0) > 0 ? 'fa-video' : 'fa-chart-bar'"></i>
                        Analytics
                      </button>
                    </td>
                  </tr>
                  <tr *ngIf="expandedProgressDay === d.day" class="jp-day-detail-row">
                    <td colspan="10" class="jp-day-detail-cell">
                      <div *ngIf="dayDetailLoading" class="j-loading-inline">Loading day details…</div>
                      <div *ngIf="!dayDetailLoading && dayDetailError" class="j-empty-inline">{{ dayDetailError }}</div>
                      <ng-container *ngIf="!dayDetailLoading && !dayDetailError && dayDetail && dayDetail.day === d.day">
                        <div class="jp-detail-summary">
                          <span><strong>{{ dayDetail.exerciseCount }}</strong> exercises</span>
                          <span><strong>{{ dayDetail.moduleCount }}</strong> modules</span>
                          <span>Exercise completion: <strong>{{ dayDetail.exerciseCompletionPercent }}%</strong></span>
                          <span>Module completion: <strong>{{ dayDetail.moduleCompletionPercent }}%</strong></span>
                          <button
                            type="button"
                            class="j-btn j-btn-sm j-btn-primary"
                            *ngIf="dayDetail.exerciseCount > 0"
                            (click)="openExerciseAnalytics(d.day, $event)"
                          >
                            <i class="fas fa-chart-bar"></i> Exercise analytics
                          </button>
                        </div>
                      </ng-container>
                    </td>
                  </tr>
                </ng-container>
                <tr *ngIf="progressDetailLoaded && progressDaily.length === 0">
                  <td colspan="10" class="j-empty-inline">No daily data yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
          </ng-container>
        </div>

        <!-- ── Weekly view: charts + summary table ── -->
        <div *ngIf="batchProgress && progressView === 'weekly'" class="jp-week-wrap">
          <div class="jp-detail-loading" *ngIf="loadingProgressDetail">
            <span class="spinner-border spinner-border-sm text-primary" role="status"></span>
            Loading weekly charts…
          </div>
          <ng-container *ngIf="!loadingProgressDetail">
          <div class="jp-panel jp-week-charts-panel">
            <div class="jp-panel-head jp-panel-head--charts">
              <div>
                <h3 class="jp-panel-title"><i class="fas fa-chart-area"></i> Week-over-week: day-by-day analysis</h3>
                <p class="jp-panel-desc">
                  <strong>Live classes</strong> — students who reached that day vs how many joined at least one class (unique).
                  <strong>Modules</strong> — module completions vs not done (student × module slots).
                  <strong>Exercises</strong> — exercise completions vs not done, and <strong>avg score %</strong> (line) to spot weak days.
                </p>
              </div>
              <div class="jp-week-picker" *ngIf="progressWeekly.length">
                <span class="jp-week-picker-label">Week</span>
                <div class="jp-week-picker-pills">
                  <button
                    type="button"
                    class="jp-week-num"
                    *ngFor="let wk of progressWeekly"
                    [class.jp-week-num--active]="progressChartsWeek === wk.week"
                    (click)="selectProgressWeek(wk.week)"
                  >
                    {{ wk.week }}
                    <small>Days {{ wk.days[0] }}–{{ wk.days[wk.days.length - 1] }}</small>
                  </button>
                </div>
              </div>
            </div>

            <div class="jp-charts-grid jp-charts-grid--three" *ngIf="getDailyRowsForProgressWeek().length; else jpNoWeekData">
              <div class="jp-chart-card jp-chart-card--focus">
                <div class="jp-chart-card-label"><i class="fas fa-video"></i> Chart 1 · Live classes</div>
                <div class="jp-chart-canvas jp-chart-canvas--week">
                  <canvas *ngIf="jpWeekLiveData" baseChart [data]="jpWeekLiveData" [options]="jpWeekLiveOpts" [type]="'bar'"></canvas>
                </div>
              </div>
              <div class="jp-chart-card jp-chart-card--focus">
                <div class="jp-chart-card-label"><i class="fas fa-book"></i> Chart 2 · Modules</div>
                <div class="jp-chart-canvas jp-chart-canvas--week">
                  <canvas *ngIf="jpWeekModuleData" baseChart [data]="jpWeekModuleData" [options]="jpWeekModuleOpts" [type]="'bar'"></canvas>
                </div>
              </div>
              <div class="jp-chart-card jp-chart-card--focus">
                <div class="jp-chart-card-label"><i class="fas fa-dumbbell"></i> Chart 3 · Exercises</div>
                <div class="jp-chart-canvas jp-chart-canvas--week jp-chart-canvas--tall">
                  <canvas *ngIf="jpWeekExerciseData" baseChart [data]="jpWeekExerciseData" [options]="jpWeekExerciseOpts" [type]="'bar'"></canvas>
                </div>
              </div>
            </div>
            <ng-template #jpNoWeekData>
              <div class="jp-chart-empty">
                <i class="fas fa-chart-bar"></i>
                <p>No days in this week yet. As students move through the journey, daily metrics will appear here.</p>
              </div>
            </ng-template>
          </div>

          <div class="jp-panel">
            <div class="jp-panel-head">
              <h3 class="jp-panel-title"><i class="fas fa-table"></i> Weekly rollup</h3>
              <span class="jp-panel-meta">Totals per calendar week</span>
            </div>
            <div class="jp-table-scroll">
              <table class="j-table jp-table-zebra">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Days covered</th>
                    <th>Avg score</th>
                    <th>Exercises done</th>
                    <th>Class check-ins</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let w of progressWeekly" [class.jp-row-highlight]="progressChartsWeek === w.week">
                    <td><strong>Week {{ w.week }}</strong></td>
                    <td><span class="jp-day-range">Days {{ w.days[0] }}–{{ w.days[w.days.length - 1] }}</span></td>
                    <td>
                      <div class="jp-score-bar-wrap jp-score-bar-wrap--table">
                        <div class="jp-score-bar" [style.width.%]="w.avgScore"></div>
                        <span class="jp-score-text">{{ w.avgScore }}%</span>
                      </div>
                    </td>
                    <td>{{ w.exercisesDone }}</td>
                    <td>{{ w.classesAttended }}</td>
                    <td>
                      <button type="button" class="j-btn j-btn-sm j-btn-outline" (click)="openWeeklyStudentDetails(w.week)">
                        <i class="fas fa-external-link-alt"></i> View more
                      </button>
                    </td>
                  </tr>
                  <tr *ngIf="progressDetailLoaded && progressWeekly.length === 0">
                    <td colspan="6" class="j-empty-inline">No weekly data yet.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          </ng-container>
        </div>

      </ng-container>

      <div *ngIf="!batchProgress && !loadingProgressOverall" class="jp-empty-state">
        <i class="fas fa-database"></i>
        <p>No progress data loaded yet. Tap <strong>Refresh data</strong> or open this tab again.</p>
        <button type="button" class="j-btn j-btn-primary j-btn-sm" *ngIf="selectedBatch" (click)="loadBatchProgress()">
          <i class="fas fa-sync-alt"></i> Load progress
        </button>
      </div>
    </div><!-- /progress tab -->

  </div><!-- /detail -->

  <!-- ── Student Progress Detail Modal ──────────────────────────────────────── -->
  <div class="j-modal-backdrop" *ngIf="showStudentProgressModal" (click)="closeStudentProgressModal()">
    <div class="jp-detail-modal" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">

      <!-- Modal header -->
      <div class="j-modal-header">
        <div>
          <h3 *ngIf="selectedStudentProgress">
            {{ selectedStudentProgress.student.name }}
            <span class="jp-detail-sub">{{ selectedStudentProgress.student.regNo }} · {{ selectedStudentProgress.student.level }} · Day {{ selectedStudentProgress.student.currentDay }}</span>
          </h3>
          <h3 *ngIf="!selectedStudentProgress && loadingStudentProgress">Loading…</h3>
        </div>
        <button type="button" class="j-modal-close" (click)="closeStudentProgressModal()" aria-label="Close">&times;</button>
      </div>

      <!-- Loading spinner -->
      <div *ngIf="loadingStudentProgress" class="j-loading-inline jp-modal-loading">
        <div class="spinner-border spinner-border-sm text-primary"></div> Loading student data…
      </div>

      <ng-container *ngIf="selectedStudentProgress && !loadingStudentProgress">

        <!-- Inner tabs -->
        <div class="jp-inner-tabs">
          <button class="jp-inner-tab" [class.active]="studentProgressModalTab === 'overview'" (click)="studentProgressModalTab = 'overview'">
            <i class="fas fa-chart-bar"></i> Overview
          </button>
          <button class="jp-inner-tab" [class.active]="studentProgressModalTab === 'exercises'" (click)="studentProgressModalTab = 'exercises'">
            <i class="fas fa-dumbbell"></i> Exercises ({{ selectedStudentProgress.exercises.length }})
          </button>
          <button class="jp-inner-tab" [class.active]="studentProgressModalTab === 'modules'" (click)="studentProgressModalTab = 'modules'">
            <i class="fas fa-book"></i> Modules ({{ selectedStudentProgress.modules.length }})
          </button>
          <button class="jp-inner-tab" [class.active]="studentProgressModalTab === 'classes'" (click)="studentProgressModalTab = 'classes'">
            <i class="fas fa-video"></i> Live Classes ({{ selectedStudentProgress.liveClasses.length }})
          </button>
        </div>

        <!-- ── Overview tab ── -->
        <div *ngIf="studentProgressModalTab === 'overview'" class="jp-modal-body">

          <!-- Mini stat cards -->
          <div class="jp-stats-row jp-stats-sm">
            <div class="jp-stat-card">
              <div class="jp-stat-icon jp-icon-exercise"><i class="fas fa-dumbbell"></i></div>
              <div class="jp-stat-body">
                <div class="jp-stat-value">{{ selectedStudentProgress.exercises.length }}</div>
                <div class="jp-stat-label">Exercises Done</div>
              </div>
            </div>
            <div class="jp-stat-card">
              <div class="jp-stat-icon jp-icon-score"><i class="fas fa-star"></i></div>
              <div class="jp-stat-body">
                <div class="jp-stat-value">{{ avgScoreForDetail() }}%</div>
                <div class="jp-stat-label">Avg Score</div>
              </div>
            </div>
            <div class="jp-stat-card">
              <div class="jp-stat-icon jp-icon-class"><i class="fas fa-video"></i></div>
              <div class="jp-stat-body">
                <div class="jp-stat-value">{{ classesAttendedForDetail() }}</div>
                <div class="jp-stat-label">Classes Attended</div>
              </div>
            </div>
            <div class="jp-stat-card">
              <div class="jp-stat-icon jp-icon-day"><i class="fas fa-road"></i></div>
              <div class="jp-stat-body">
                <div class="jp-stat-value">{{ selectedStudentProgress.student.currentDay }}</div>
                <div class="jp-stat-label">Current Day</div>
              </div>
            </div>
          </div>

          <!-- Day-by-day breakdown -->
          <h4 class="jp-section-title">Day-by-Day Breakdown</h4>
          <div class="jp-day-grid">
            <div class="jp-day-cell" *ngFor="let d of selectedStudentProgress.dayBreakdown"
                 [class.jp-day-good]="d.exercisesDone > 0 || d.classesAttended > 0"
                 [class.jp-day-empty]="d.exercisesDone === 0 && d.classesAttended === 0">
              <div class="jp-dc-label">Day {{ d.day }}</div>
              <div class="jp-dc-score" *ngIf="d.exercisesDone > 0">{{ d.avgScore }}%</div>
              <div class="jp-dc-score jp-dc-empty" *ngIf="d.exercisesDone === 0">—</div>
              <div class="jp-dc-meta">
                <span><i class="fas fa-dumbbell"></i> {{ d.exercisesDone }}</span>
                <span><i class="fas fa-video"></i> {{ d.classesAttended }}/{{ d.classesTotal }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Exercises tab ── -->
        <div *ngIf="studentProgressModalTab === 'exercises'" class="jp-modal-body">
          <div *ngIf="selectedStudentProgress.exercises.length === 0" class="j-empty-inline">No completed exercises yet.</div>
          <div class="jp-exercise-list">
            <div class="jp-exercise-row" *ngFor="let ex of selectedStudentProgress.exercises">
              <div class="jp-ex-header" (click)="toggleExerciseExpand(ex.attemptId)">
                <div class="jp-ex-info">
                  <span class="jp-day-badge" *ngIf="ex.courseDay">Day {{ ex.courseDay }}</span>
                  <span class="jp-ex-title">{{ ex.title }}</span>
                  <span class="j-badge j-badge-secondary" *ngIf="ex.level">{{ ex.level }}</span>
                  <span class="j-badge j-badge-secondary" *ngIf="ex.category">{{ ex.category }}</span>
                </div>
                <div class="jp-ex-meta">
                  <span class="jp-score-chip" [class.jp-score-good]="ex.scorePercent >= 70" [class.jp-score-mid]="ex.scorePercent >= 40 && ex.scorePercent < 70" [class.jp-score-low]="ex.scorePercent < 40">
                    {{ ex.scorePercent }}%
                  </span>
                  <span class="jp-points">{{ ex.earnedPoints }}/{{ ex.totalPoints }} pts</span>
                  <span class="jp-time-spent" *ngIf="ex.timeSpentSeconds">{{ formatSeconds(ex.timeSpentSeconds) }}</span>
                  <span class="jp-completed-at" *ngIf="ex.completedAt">{{ ex.completedAt | date:'dd MMM yyyy' }}</span>
                  <i class="fas" [class.fa-chevron-down]="!expandedExercises.has(ex.attemptId)" [class.fa-chevron-up]="expandedExercises.has(ex.attemptId)"></i>
                </div>
              </div>

              <!-- Question-level breakdown -->
              <div class="jp-responses" *ngIf="expandedExercises.has(ex.attemptId)">
                <div *ngIf="ex.responses.length === 0" class="jp-no-responses">No question responses recorded.</div>
                <table class="jp-response-table" *ngIf="ex.responses.length > 0">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Type</th>
                      <th>Answer Given</th>
                      <th>Correct?</th>
                      <th>Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let r of ex.responses">
                      <td>Q{{ r.questionIndex + 1 }}</td>
                      <td><span class="jp-qtype">{{ r.questionType }}</span></td>
                      <td class="jp-answer">{{ questionAnswerLabel(r) }}</td>
                      <td>
                        <span class="jp-correct" *ngIf="r.isCorrect"><i class="fas fa-check-circle"></i></span>
                        <span class="jp-wrong" *ngIf="!r.isCorrect"><i class="fas fa-times-circle"></i></span>
                      </td>
                      <td>{{ r.pointsEarned }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Modules tab ── -->
        <div *ngIf="studentProgressModalTab === 'modules'" class="jp-modal-body">
          <div *ngIf="selectedStudentProgress.modules.length === 0" class="j-empty-inline">No module progress recorded yet.</div>
          <table class="j-table" *ngIf="selectedStudentProgress.modules.length > 0">
            <thead>
              <tr>
                <th>Module</th>
                <th>Level</th>
                <th>Day</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Exercises Done</th>
                <th>Last Accessed</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let m of selectedStudentProgress.modules">
                <td>{{ m.title }}</td>
                <td><span class="j-badge j-badge-primary" *ngIf="m.level">{{ m.level }}</span></td>
                <td><span class="jp-day-badge" *ngIf="m.courseDay">Day {{ m.courseDay }}</span></td>
                <td>
                  <span class="jp-status-chip" [class.jp-status-done]="m.status === 'completed'" [class.jp-status-wip]="m.status === 'in-progress'" [class.jp-status-ns]="m.status === 'not-started'">
                    {{ m.status }}
                  </span>
                </td>
                <td>
                  <div class="jp-score-bar-wrap">
                    <div class="jp-score-bar" [style.width.%]="m.progressPercent"></div>
                    <span class="jp-score-text">{{ m.progressPercent }}%</span>
                  </div>
                </td>
                <td>{{ m.exercisesCompleted }}</td>
                <td>{{ m.lastAccessedAt | date:'dd MMM yyyy' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ── Live Classes tab ── -->
        <div *ngIf="studentProgressModalTab === 'classes'" class="jp-modal-body">
          <div *ngIf="selectedStudentProgress.liveClasses.length === 0" class="j-empty-inline">No live classes scheduled yet.</div>
          <table class="j-table" *ngIf="selectedStudentProgress.liveClasses.length > 0">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Date &amp; Time</th>
                <th>Duration</th>
                <th>Day</th>
                <th>Attended?</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of selectedStudentProgress.liveClasses">
                <td>{{ c.topic }}</td>
                <td>{{ c.startTime | date:'dd MMM yyyy, HH:mm' }}</td>
                <td>{{ c.duration }} min</td>
                <td><span class="jp-day-badge" *ngIf="c.courseDay">Day {{ c.courseDay }}</span></td>
                <td>
                  <span class="jp-correct" *ngIf="c.attended"><i class="fas fa-check-circle"></i> Yes</span>
                  <span class="jp-wrong" *ngIf="!c.attended"><i class="fas fa-times-circle"></i> No</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </ng-container>
    </div>
  </div><!-- /student progress modal -->

  <!-- Task check: centered modal -->
  <div class="j-modal-backdrop" *ngIf="taskModal" (click)="closeTaskModal()">
    <div class="j-modal-card" (click)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-labelledby="j-task-modal-title">
      <div class="j-modal-header">
        <h3 id="j-task-modal-title">Tasks — {{ taskModal.studentName }}</h3>
        <button type="button" class="j-modal-close" (click)="closeTaskModal()" aria-label="Close">&times;</button>
      </div>
      <p class="j-modal-sub">
        Checking journey <strong>Day {{ taskModal.currentDay }}</strong>
        — modules, exercises (this course day), and live classes for this batch.
      </p>
      <p class="j-modal-meta" *ngIf="taskModal.totalTasks != null && taskModal.totalTasks > 0">
        Progress: <strong>{{ taskModal.doneTasks ?? 0 }} / {{ taskModal.totalTasks }}</strong> tasks
        (<strong>{{ taskModal.completionPercent }}%</strong> complete<span *ngIf="taskModal.strictJourneyRule">; strict rule requires ≥ {{ taskModal.strictJourneyThresholdPercent }}%</span>).
      </p>

      <div *ngIf="taskModal.complete" class="j-modal-all-done">
        <span class="j-modal-icon-ok"><i class="fas fa-check-circle"></i></span>
        <span>All tasks for this day are completed. Student can advance to the next day.</span>
      </div>

      <div *ngIf="!taskModal.complete && taskModal.incompleteTasks.length" class="j-modal-list">
        <h4 class="j-modal-list-title">Incomplete tasks</h4>
        <ul class="j-modal-task-ul">
          <li *ngFor="let t of taskModal.incompleteTasks" class="j-modal-task-li">
            <span class="j-modal-kind"
                  [class.j-kind-ex]="t.kind === 'exercise'"
                  [class.j-kind-cl]="t.kind === 'class'"
                  [class.j-kind-mod]="t.kind === 'module'">
              <i class="fas"
                 [class.fa-dumbbell]="t.kind === 'exercise'"
                 [class.fa-video]="t.kind === 'class'"
                 [class.fa-book-open]="t.kind === 'module'"></i>
              {{ t.kind === 'exercise' ? 'Exercise' : (t.kind === 'module' ? 'Module' : 'Live class') }}
            </span>
            <span class="j-modal-task-title">{{ t.title }}</span>
            <span class="j-modal-day-pill">Day {{ t.courseDay }}</span>
          </li>
        </ul>
      </div>

      <div *ngIf="!taskModal.complete && !taskModal.incompleteTasks.length" class="j-modal-empty-day">
        <i class="fas fa-info-circle"></i>
        No modules, exercises, or live classes are scheduled for this journey day.
      </div>

      <div class="j-modal-footer">
        <button type="button" class="j-btn j-btn-outline" (click)="refreshTaskModal()" *ngIf="taskModal.studentId">
          <i class="fas fa-sync-alt"></i> Re-check
        </button>
        <button type="button" class="j-btn j-btn-primary" (click)="closeTaskModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- Exercise analytics matrix (journey day) -->
  <div class="j-modal-backdrop" *ngIf="showExerciseAnalyticsModal" (click)="closeExerciseAnalyticsModal()">
    <div class="jp-detail-modal jp-ex-analytics-modal" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
      <div class="j-modal-header">
        <div>
          <h3>Exercise analytics — Day {{ exerciseAnalyticsDay }}</h3>
          <span class="jp-detail-sub" *ngIf="selectedBatch">{{ selectedBatch.batchName }}</span>
        </div>
        <button type="button" class="j-modal-close" (click)="closeExerciseAnalyticsModal()" aria-label="Close">&times;</button>
      </div>
      <div *ngIf="exerciseAnalyticsLoading" class="j-loading-inline jp-modal-loading">
        <div class="spinner-border spinner-border-sm text-primary"></div> Loading…
      </div>
      <div *ngIf="!exerciseAnalyticsLoading && exerciseAnalytics" class="jp-ex-analytics-body">
        <p *ngIf="!exerciseAnalytics.exercises?.length" class="j-empty-inline">No published exercises use this course day yet.</p>
        <div *ngIf="exerciseAnalytics.exercises?.length" class="jp-ex-table-wrap">
          <table class="j-table jp-ex-matrix">
            <thead>
              <tr>
                <th class="jp-ex-student-col">Student</th>
                <th *ngFor="let ex of exerciseAnalytics.exercises" class="jp-ex-title-col" [title]="ex.title">{{ ex.title }}</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of exerciseAnalytics.students">
                <td class="jp-ex-student-col"><strong>{{ row.name }}</strong><br /><small class="jp-reg">{{ row.regNo }}</small></td>
                <td *ngFor="let cell of row.exercises" class="jp-ex-cell" [class.jp-ex-cell--miss]="!cell.attempted" [class.jp-ex-cell--ok]="cell.attempted">
                  <span *ngIf="cell.attempted">{{ cell.scorePercent }}%</span>
                  <span *ngIf="!cell.attempted" class="jp-miss">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- Live class attendance (journey day) -->
  <div class="j-modal-backdrop" *ngIf="showClassAnalyticsModal" (click)="closeClassAnalyticsModal()">
    <div class="jp-detail-modal jp-class-analytics-modal" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
      <div class="j-modal-header">
        <div>
          <h3>Live class attendance — Day {{ classAnalyticsDay }}</h3>
          <span class="jp-detail-sub" *ngIf="selectedBatch">{{ selectedBatch.batchName }}</span>
        </div>
        <button type="button" class="j-modal-close" (click)="closeClassAnalyticsModal()" aria-label="Close">&times;</button>
      </div>
      <div *ngIf="classAnalyticsLoading" class="j-loading-inline jp-modal-loading">
        <div class="spinner-border spinner-border-sm text-primary"></div> Loading…
      </div>
      <div *ngIf="!classAnalyticsLoading && classAnalyticsDetail" class="jp-class-analytics-body">
        <p *ngIf="!classAnalyticsDetail.liveClasses?.length" class="jp-class-analytics-empty">
          No live Zoom classes are linked to this journey day yet. When a meeting uses the same <strong>Course Day</strong>, attendance will appear here.
        </p>
        <ng-container *ngFor="let lc of classAnalyticsDetail.liveClasses">
          <div class="jp-live-block jp-live-block--modal">
            <div class="jp-live-head">
              <strong>{{ lc.topic }}</strong>
              <span *ngIf="lc.startTime" class="jp-live-meta">{{ lc.startTime | date:'dd MMM yyyy, HH:mm' }}</span>
              <span *ngIf="lc.duration" class="jp-live-meta">{{ lc.duration }} min</span>
            </div>
            <div class="jp-att-grid">
              <div class="jp-att-col jp-att-yes">
                <span class="jp-att-title"><i class="fas fa-check-circle"></i> Attended ({{ attendedStudents(lc.students).length }})</span>
                <ul class="jp-att-list">
                  <li *ngFor="let st of attendedStudents(lc.students)">{{ st.name }}<span *ngIf="st.regNo" class="jp-reg"> · {{ st.regNo }}</span></li>
                </ul>
              </div>
              <div class="jp-att-col jp-att-no">
                <span class="jp-att-title"><i class="fas fa-user-slash"></i> Did not attend ({{ absentStudents(lc.students).length }})</span>
                <ul class="jp-att-list">
                  <li *ngFor="let st of absentStudents(lc.students)">{{ st.name }}<span *ngIf="st.regNo" class="jp-reg"> · {{ st.regNo }}</span></li>
                </ul>
              </div>
            </div>
          </div>
        </ng-container>
      </div>
      <div class="j-modal-footer jp-class-analytics-footer">
        <button type="button" class="j-btn j-btn-primary" (click)="closeClassAnalyticsModal()">Close</button>
      </div>
    </div>
  </div>
  <!-- ══ SILVER TAB (Tamil GO-SILVER) ═══════════════════════════════════════ -->
  <div *ngIf="planTab === 'silver' || planTab === 'silver-sinhala'" class="j-content">
    <div class="gs-add-bar">
      <div class="gs-add-title">
        <span class="gs-plan-badge">SILVER</span>
        <span>GO Batch management — {{ activeGoBatchLabel }}</span>
      </div>
      <div class="gs-silver-tab-bar">
        <button type="button" class="gs-silver-tab" [class.gs-silver-tab--active]="silverTab === 'go'" (click)="silverTab = 'go'">
          {{ planTab === 'silver-sinhala' ? 'GO Sinhala Students' : 'GO Students' }}
        </button>
        <button type="button" class="gs-silver-tab" [class.gs-silver-tab--active]="silverTab === 'silver'" (click)="silverTab = 'silver'">
          {{ planTab === 'silver-sinhala' ? 'Silver Sinhala Students' : 'Silver Students' }}
        </button>
      </div>
    </div>

    <div *ngIf="silverTab === 'go'">
      <div class="gs-add-bar gs-add-bar--compact">
        <div class="gs-add-row">
          <div class="j-search-wrap" style="flex:1;max-width:400px;">
            <i class="fas fa-envelope j-search-icon"></i>
            <input
              type="email"
              class="j-search-input"
              [(ngModel)]="goEmailInput"
              placeholder="Enter student email to add to GO batch…"
              autocomplete="off"
              (keyup.enter)="addGoStudent()"
            />
          </div>
          <button type="button" class="j-btn j-btn-primary" [disabled]="goAdding" (click)="addGoStudent()">
            <i class="fas" [class.fa-spinner]="goAdding" [class.fa-user-plus]="!goAdding"></i>
            {{ goAdding ? 'Adding…' : 'Add' }}
          </button>
        </div>
        <p *ngIf="goAddError" class="gs-add-error">{{ goAddError }}</p>
      </div>

      <div class="gs-filter-row" *ngIf="!goLoading && goStudents.length > 0">
        <div class="j-search-wrap" style="flex:1;min-width:240px;">
          <i class="fas fa-search j-search-icon"></i>
          <input
            type="search"
            class="j-search-input"
            [(ngModel)]="goSearch"
            placeholder="Search by name, email, or student ID…"
            autocomplete="off"
          />
        </div>
        <select class="j-select gs-batch-select" [(ngModel)]="goBatchFilter">
          <option value="all">All batches</option>
          <option *ngFor="let b of goBatchOptions" [value]="b">{{ b }}</option>
        </select>
        <select class="j-select gs-batch-select" [(ngModel)]="goStatusFilter">
          <option value="all">All statuses</option>
          <option value="ONGOING">ONGOING</option>
          <option value="WITHDREW">WITHDREW</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="UNCERTAIN">UNCERTAIN</option>
        </select>
        <input type="number" class="j-input-sm gs-day-input" [(ngModel)]="goDayMinFilter" min="1" max="200" placeholder="Day ≥" />
        <input type="number" class="j-input-sm gs-day-input" [(ngModel)]="goDayMaxFilter" min="1" max="200" placeholder="Day ≤" />
        <button type="button" class="j-btn j-btn-outline" (click)="loadGoStudents()">
          <i class="fas fa-sync-alt"></i> Refresh list
        </button>
      </div>

      <div *ngIf="goLoading" class="j-loading" style="min-height:200px;">
        <div class="spinner-border text-primary"></div>
        <p>Loading GO students…</p>
      </div>

      <div *ngIf="!goLoading && goStudents.length === 0" class="j-empty">
        <i class="fas fa-users fa-3x"></i>
        <p>No Silver students added to GO batch yet.</p>
      </div>

      <div *ngIf="!goLoading && goStudents.length > 0 && filteredGoStudents.length === 0" class="j-empty">
        <i class="fas fa-filter fa-3x"></i>
        <p>No GO students match this filter.</p>
      </div>

      <div class="gs-bulk-row" *ngIf="!goLoading && filteredGoStudents.length > 0">
        <div class="gs-bulk-left">
          <span class="gs-bulk-count">{{ goSelectedCount }} selected</span>
          <button
            type="button"
            class="j-btn j-btn-sm j-btn-outline"
            (click)="clearGoSelections()"
            [disabled]="goSelectedCount === 0 || goBulkUpdating"
          >
            Clear selection
          </button>
        </div>
        <div class="gs-bulk-actions">
          <input
            type="text"
            class="j-input-sm"
            style="min-width:160px;"
            [(ngModel)]="goBulkBatch"
            placeholder="Assign batch"
          />
          <button
            type="button"
            class="j-btn j-btn-sm"
            style="background:#ecfeff;color:#0e7490;border:1px solid #a5f3fc;"
            (click)="bulkSetGoBatch()"
            [disabled]="goSelectedCount === 0 || !goBulkBatch || goBulkUpdating"
          >
            <i class="fas" [class.fa-spinner]="goBulkUpdating" [class.fa-layer-group]="!goBulkUpdating"></i>
            {{ goBulkUpdating ? 'Updating…' : 'Assign Batch' }}
          </button>
          <button
            type="button"
            class="j-btn j-btn-sm"
            style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;"
            (click)="bulkRemoveBatchFromGo()"
            [disabled]="goSelectedCount === 0 || goBulkUpdating"
          >
            <i class="fas" [class.fa-spinner]="goBulkUpdating" [class.fa-eraser]="!goBulkUpdating"></i>
            {{ goBulkUpdating ? 'Updating…' : 'Remove Batch' }}
          </button>
          <input
            type="number"
            class="j-input-sm gs-day-input"
            [(ngModel)]="goBulkDay"
            min="1"
            max="200"
            placeholder="Set day"
          />
          <button
            type="button"
            class="j-btn j-btn-sm j-btn-primary"
            (click)="bulkSetGoDay()"
            [disabled]="goSelectedCount === 0 || !goBulkDay || goBulkUpdating"
          >
            <i class="fas" [class.fa-spinner]="goBulkUpdating" [class.fa-calendar-day]="!goBulkUpdating"></i>
            {{ goBulkUpdating ? 'Updating…' : 'Apply Day' }}
          </button>
        </div>
      </div>

      <div *ngIf="!goLoading && filteredGoStudents.length > 0" class="j-batch-table-wrap" style="margin-top:0;">
        <table class="j-table">
          <thead>
            <tr>
              <th style="width:42px;" class="text-center">
                <input
                  type="checkbox"
                  [checked]="areAllGoChecked"
                  (change)="toggleSelectAllGo($event)"
                  aria-label="Select all GO students"
                />
              </th>
              <th>Name</th>
              <th>Student ID</th>
              <th>Batch</th>
              <th>Status</th>
              <th>Plan</th>
              <th>Joining Date</th>
              <th>Journey Day</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let s of filteredGoStudents">
              <td class="text-center">
                <input
                  type="checkbox"
                  [checked]="isGoSelected(s._id)"
                  (change)="toggleGoSelection(s._id, $event)"
                  aria-label="Select GO student"
                />
              </td>
              <td>
                <div style="font-weight:600;color:#0f172a;">{{ s.name }}</div>
                <div style="font-size:11px;color:#64748b;">{{ s.email }}</div>
              </td>
              <td style="font-family:monospace;font-size:12px;">{{ s.regNo }}</td>
              <td>{{ s.batch || '—' }}</td>
              <td><span class="gs-status-go">{{ s.goStatus }}</span></td>
              <td><span class="gs-plan-badge">{{ s.subscription }}</span></td>
              <td>
                <span *ngIf="s.goJoiningDate">{{ s.goJoiningDate | date:'dd MMM yyyy' }}</span>
                <span *ngIf="!s.goJoiningDate" style="color:#94a3b8;">—</span>
              </td>
              <td>
                <div class="j-day-pill" style="display:inline-block;">Day {{ s.currentCourseDay || 1 }}</div>
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <button type="button" class="j-btn j-btn-outline j-btn-sm" (click)="openGoStudentDetail(s)">
                    <i class="fas fa-external-link-alt"></i> Open
                  </button>
                  <button
                    type="button"
                    class="j-btn j-btn-sm"
                    style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;"
                    [disabled]="isGoRemoving(s._id)"
                    (click)="removeFromGo(s)"
                  >
                    <i class="fas" [class.fa-spinner]="isGoRemoving(s._id)" [class.fa-undo]="!isGoRemoving(s._id)"></i>
                    {{ isGoRemoving(s._id) ? 'Updating…' : 'Make Silver' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div *ngIf="silverTab === 'silver'">
      <div class="gs-filter-row">
        <div class="j-search-wrap" style="flex:1;min-width:240px;">
          <i class="fas fa-search j-search-icon"></i>
          <input
            type="search"
            class="j-search-input"
            [(ngModel)]="silverSearch"
            placeholder="Search by name, email, or student ID…"
            autocomplete="off"
          />
        </div>
        <select class="j-select gs-batch-select" [(ngModel)]="silverBatchFilter">
          <option value="all">All batches</option>
          <option *ngFor="let b of silverBatchOptions" [value]="b">{{ b }}</option>
        </select>
        <button type="button" class="j-btn j-btn-outline" (click)="loadSilverStudents()">
          <i class="fas fa-sync-alt"></i> Refresh list
        </button>
      </div>

      <div class="gs-bulk-row" *ngIf="!silverLoading && filteredSilverStudents.length > 0">
        <div class="gs-bulk-left">
          <span class="gs-bulk-count">{{ silverSelectedCount }} selected</span>
          <button
            type="button"
            class="j-btn j-btn-sm j-btn-outline"
            (click)="clearSilverSelections()"
            [disabled]="silverSelectedCount === 0 || silverBulkUpdating"
          >
            Clear selection
          </button>
        </div>
        <div class="gs-bulk-actions">
          <input
            type="text"
            class="j-input-sm"
            style="min-width:160px;"
            [(ngModel)]="silverBulkBatch"
            placeholder="Assign batch"
          />
          <button
            type="button"
            class="j-btn j-btn-sm"
            style="background:#ecfeff;color:#0e7490;border:1px solid #a5f3fc;"
            (click)="bulkSetSilverBatch()"
            [disabled]="silverSelectedCount === 0 || !silverBulkBatch || silverBulkUpdating"
          >
            <i class="fas" [class.fa-spinner]="silverBulkUpdating" [class.fa-layer-group]="!silverBulkUpdating"></i>
            {{ silverBulkUpdating ? 'Updating…' : 'Assign Batch' }}
          </button>
          <button
            type="button"
            class="j-btn j-btn-sm"
            style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;"
            (click)="bulkRemoveBatchFromSilver()"
            [disabled]="silverSelectedCount === 0 || silverBulkUpdating"
          >
            <i class="fas" [class.fa-spinner]="silverBulkUpdating" [class.fa-eraser]="!silverBulkUpdating"></i>
            {{ silverBulkUpdating ? 'Updating…' : 'Remove Batch' }}
          </button>
          <input
            type="number"
            class="j-input-sm gs-day-input"
            [(ngModel)]="silverBulkDay"
            min="1"
            max="200"
            placeholder="Set day"
          />
          <button
            type="button"
            class="j-btn j-btn-sm j-btn-primary"
            (click)="bulkSetSilverDay()"
            [disabled]="silverSelectedCount === 0 || !silverBulkDay || silverBulkUpdating"
          >
            <i class="fas" [class.fa-spinner]="silverBulkUpdating" [class.fa-calendar-day]="!silverBulkUpdating"></i>
            {{ silverBulkUpdating ? 'Updating…' : 'Apply Day' }}
          </button>
        </div>
      </div>

      <div *ngIf="silverLoading" class="j-loading" style="min-height:200px;">
        <div class="spinner-border text-primary"></div>
        <p>Loading Silver students…</p>
      </div>

      <div *ngIf="!silverLoading && filteredSilverStudents.length === 0" class="j-empty">
        <i class="fas fa-user-friends fa-3x"></i>
        <p>No Silver students match this filter.</p>
      </div>

      <div *ngIf="!silverLoading && filteredSilverStudents.length > 0" class="j-batch-table-wrap" style="margin-top:0;">
        <table class="j-table">
          <thead>
            <tr>
              <th style="width:42px;" class="text-center">
                <input
                  type="checkbox"
                  [checked]="areAllVisibleSilverChecked"
                  (change)="toggleSelectAllVisibleSilver($event)"
                  aria-label="Select all visible Silver students"
                />
              </th>
              <th>Name</th>
              <th>Student ID</th>
              <th>Batch</th>
              <th>Status</th>
              <th>Plan</th>
              <th>Journey Day</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let s of filteredSilverStudents">
              <td class="text-center">
                <input
                  type="checkbox"
                  [checked]="isSilverSelected(s._id)"
                  (change)="toggleSilverSelection(s._id, $event)"
                  aria-label="Select student to move to GO"
                />
              </td>
              <td>
                <div style="font-weight:600;color:#0f172a;">{{ s.name }}</div>
                <div style="font-size:11px;color:#64748b;">{{ s.email }}</div>
              </td>
              <td style="font-family:monospace;font-size:12px;">{{ s.regNo || '—' }}</td>
              <td>{{ s.batch || '—' }}</td>
              <td>
                <span class="j-badge" [ngClass]="{
                  'j-badge-success': s.studentStatus === 'ONGOING',
                  'j-badge-danger': s.studentStatus === 'WITHDREW',
                  'j-badge-secondary': s.studentStatus === 'COMPLETED' || s.studentStatus === 'UNCERTAIN'
                }">{{ s.studentStatus || '—' }}</span>
              </td>
              <td><span class="gs-plan-badge">{{ s.subscription }}</span></td>
              <td><div class="j-day-pill" style="display:inline-block;">Day {{ s.currentCourseDay || 1 }}</div></td>
              <td>
                <button
                  type="button"
                  class="j-btn j-btn-primary j-btn-sm"
                  [disabled]="!isSilverSelected(s._id) || isSilverAdding(s._id)"
                  (click)="addGoStudentById(s)"
                >
                  <i class="fas" [class.fa-spinner]="isSilverAdding(s._id)" [class.fa-rocket]="!isSilverAdding(s._id)"></i>
                  {{ isSilverAdding(s._id) ? 'Adding…' : 'Go' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

</div><!-- /root -->
  `,
  styles: [`
    .journey-root {
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      background: #f0f4f8;
      padding-bottom: 40px;
    }

    /* ── Header ── */
    .j-header {
      background: linear-gradient(135deg, #03396c, #005b96);
      color: #fff;
      padding: 20px 28px 18px;
    }
    .j-header-inner {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .j-header-actions {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .j-icon { margin-right: 6px; }
    .j-title {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 4px;
      color: #fff;
    }
    .j-subtitle {
      font-size: 12px;
      opacity: .8;
      margin: 0;
    }

    /* ── Content wrapper ── */
    .j-content { padding: 22px 24px; }

    /* ── Buttons ── */
    .j-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 7px 14px;
      border-radius: 8px; border: none; cursor: pointer;
      font-size: 12px; font-weight: 600; font-family: inherit;
      transition: background .15s;
    }
    .j-btn:disabled { opacity: .55; cursor: not-allowed; }
    .j-btn-primary { background: #005b96; color: #fff; }
    .j-btn-primary:hover:not(:disabled) { background: #03396c; }
    .j-btn-outline { background: transparent; color: #005b96; border: 1.5px solid #005b96; }
    .j-btn-outline:hover:not(:disabled) { background: #e8f4fc; }
    /* Header uses a dark gradient; make outline buttons readable there */
    .j-header .j-btn-outline {
      color: #fff;
      border-color: rgba(255, 255, 255, 0.8);
      background: rgba(255, 255, 255, 0.1);
    }
    .j-header .j-btn-outline:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.18);
      border-color: rgba(255, 255, 255, 0.95);
    }
    .j-btn-sm { padding: 4px 10px; font-size: 11px; }

    /* ── Skeleton loaders (tab-wise lazy data) ── */
    @keyframes j-sk-shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
    .j-sk {
      position: relative;
      overflow: hidden;
      background: #e8ecf4;
      border-radius: 8px;
    }
    .j-sk::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent);
      animation: j-sk-shimmer 1.15s ease-in-out infinite;
    }
    .j-sk-table-wrap {
      padding: 12px 4px 16px;
      border-radius: 12px;
      background: #fff;
      border: 1px solid #e2e8f0;
    }
    .j-sk-row {
      display: grid;
      grid-template-columns: 1.4fr 0.7fr 0.6fr 0.7fr 0.9fr 0.9fr 1fr 0.7fr 0.7fr 1.1fr;
      gap: 10px;
      align-items: center;
      padding: 10px 8px;
      border-bottom: 1px solid #f1f5f9;
    }
    .j-sk-row--head { border-bottom: 2px solid #e8ecf4; padding-bottom: 12px; margin-bottom: 4px; }
    .j-sk-row--head .j-sk-cell { height: 12px; border-radius: 4px; }
    .j-sk-cell { height: 14px; }
    .j-sk-cell--lg { grid-column: span 1; min-width: 0; }
    .j-sk-cell--md { width: 70%; }
    .j-sk-cell--bar { height: 8px; margin-top: 4px; border-radius: 4px; }
    .j-sk-cell--btn { width: 52px; height: 26px; border-radius: 6px; margin: 0 auto; }
    .j-sk-cell--wide { min-height: 28px; }
    .j-sk-timeline { padding: 8px 0 20px; }
    .j-sk-timeline-filter {
      display: flex;
      gap: 10px;
      margin-bottom: 18px;
      padding: 0 4px;
    }
    .j-sk-pill { height: 34px; width: 140px; border-radius: 10px; }
    .j-sk-pill--short { width: 90px; }
    .j-sk-timeline-day {
      background: #fff;
      border: 1px solid #e8ecf4;
      border-radius: 14px;
      margin-bottom: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(15,23,42,.04);
    }
    .j-sk-timeline-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      background: #f8fafc;
      border-bottom: 1px solid #e8ecf4;
    }
    .j-sk-title { height: 14px; width: 120px; border-radius: 4px; }
    .j-sk-chips { display: flex; gap: 6px; }
    .j-sk-chip { display: inline-block; width: 72px; height: 22px; border-radius: 999px; }
    .j-sk-timeline-body { padding: 14px 16px; }
    .j-sk-line { height: 12px; border-radius: 4px; margin-bottom: 10px; max-width: 92%; }
    .j-sk-line--short { max-width: 55%; margin-bottom: 0; }

    .jp-skeleton {
      padding: 4px 4px 20px;
      animation: fadeIn .2s ease;
    }
    @keyframes fadeIn { from { opacity: .6; } to { opacity: 1; } }
    .jp-sk-hero {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 16px;
      padding: 20px;
      background: linear-gradient(180deg, #f0f7fc 0%, #fafbfc 100%);
      border: 1px solid #e2e8f0;
      border-radius: 18px;
      margin-bottom: 16px;
    }
    .j-sk-hero-title { height: 22px; width: 220px; margin-bottom: 10px; border-radius: 6px; }
    .j-sk-hero-sub { height: 13px; width: min(420px, 90%); border-radius: 4px; }
    .j-sk-btn { width: 130px; height: 36px; border-radius: 10px; flex-shrink: 0; }
    .jp-sk-pills {
      display: flex;
      gap: 6px;
      padding: 4px;
      background: #e8ecf4;
      border-radius: 14px;
      margin-bottom: 18px;
      max-width: 420px;
    }
    .j-sk-pill-wide { flex: 1; height: 36px; border-radius: 10px; min-width: 80px; }
    .jp-sk-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 14px;
      margin-bottom: 22px;
    }
    .jp-sk-stat {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 18px;
      background: #fff;
      border: 1px solid #e8ecf4;
      border-radius: 16px;
    }
    .j-sk-stat-ico { width: 42px; height: 42px; border-radius: 10px; flex-shrink: 0; }
    .jp-sk-stat-text { flex: 1; min-width: 0; }
    .j-sk-stat-val { height: 20px; width: 48px; margin-bottom: 6px; border-radius: 4px; }
    .j-sk-stat-lbl { height: 10px; width: 80px; border-radius: 4px; }
    .jp-sk-panel {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 18px;
      padding: 16px 18px 20px;
      box-shadow: 0 4px 16px rgba(15,23,42,.05);
    }
    .j-sk-panel-head { height: 16px; width: 200px; margin-bottom: 16px; border-radius: 4px; }
    .j-sk-row-bar { height: 14px; border-radius: 6px; margin-bottom: 12px; max-width: 100%; }
    .j-sk-row-bar:nth-child(odd) { max-width: 96%; }
    .j-sk-row-bar:nth-child(even) { max-width: 88%; }

    .j-teacher-cell { display:flex; align-items:center; gap:8px; flex-wrap: wrap; }

    .j-teacher-list { display:flex; flex-direction:column; gap:8px; max-height: 340px; overflow:auto; }
    .j-teacher-row {
      text-align: left;
      border: 1px solid #e2e8f0;
      background: #fff;
      border-radius: 12px;
      padding: 10px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .j-teacher-row:hover { background: #f8fafc; }
    .j-teacher-row.active { border-color: #005b96; box-shadow: 0 0 0 3px rgba(0,91,150,.12); }
    .j-teacher-main strong { display:block; font-size: 13px; color:#0f172a; }
    .j-teacher-main small { display:block; font-size: 11px; color:#94a3b8; }
    .j-teacher-meta { display:flex; gap:6px; flex-wrap: wrap; justify-content: flex-end; }

    /* ── Loading ── */
    .j-loading { text-align: center; padding: 60px 20px; color: #64748b; }
    .j-loading p { margin-top: 12px; font-size: 14px; }
    .j-loading-inline { padding: 20px; color: #64748b; font-size: 13px; display: flex; align-items: center; gap: 8px; }
    .j-empty { text-align: center; padding: 60px 20px; color: #94a3b8; }
    .j-empty p { margin-top: 12px; font-size: 14px; }
    .j-empty-inline { padding: 24px; color: #94a3b8; font-size: 13px; text-align: center; }

    /* ── Batch overview: filters + table ── */
    .j-batch-table-wrap { display: flex; flex-direction: column; gap: 14px; }

    .j-start-journey-bar {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.06);
      padding: 16px 18px;
      margin-bottom: 16px;
    }
    .j-start-journey-split {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px 20px;
    }
    .j-start-journey-inner { flex: 1 1 280px; max-width: 720px; min-width: 0; }
    .j-start-journey-side {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      padding-top: 22px;
    }
    .j-btn-all-students { white-space: nowrap; }
    .j-start-journey-label {
      display: block;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #475569;
      margin-bottom: 8px;
    }
    .j-start-journey-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
    }
    .j-select--upcoming {
      flex: 1 1 260px;
      min-width: 200px;
      max-width: 420px;
    }
    .j-start-journey-hint {
      margin: 10px 0 0;
      font-size: 12px;
      color: #64748b;
      line-height: 1.45;
    }
    .j-teacher-journey-hint {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 16px;
      margin-bottom: 14px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 12px;
      font-size: 13px;
      color: #1e40af;
      line-height: 1.45;
    }
    .j-teacher-journey-hint i { flex-shrink: 0; margin-top: 2px; }
    .j-batch-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
    }
    .j-btn-remove-active { white-space: nowrap; }

    .j-filter-bar {
      background: #fff;
      border-radius: 14px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 2px 10px rgba(15,23,42,.06);
      padding: 14px 16px;
    }
    .j-filter-row--main {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 12px;
    }
    .j-filter-toolbar-end {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }
    .j-search-wrap {
      flex: 1 1 220px;
      min-width: 180px;
      position: relative;
    }
    .j-search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: #94a3b8;
      font-size: 13px;
      pointer-events: none;
    }
    .j-search-input {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 12px 9px 36px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      font-size: 13px;
      font-family: inherit;
      background: #f8fafc;
      color: #0f172a;
      transition: border-color .15s, box-shadow .15s;
    }
    .j-search-input:focus {
      outline: none;
      border-color: #005b96;
      background: #fff;
      box-shadow: 0 0 0 3px rgba(0,91,150,.1);
    }
    .j-search-input::placeholder { color: #94a3b8; }

    .j-filter-sort {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 200px;
    }
    .j-filter-label {
      font-size: 10px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .j-select {
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      font-size: 12px;
      font-family: inherit;
      background: #fff;
      color: #0f172a;
      cursor: pointer;
    }
    .j-select:focus {
      outline: none;
      border-color: #005b96;
    }

    .j-btn-filter-toggle {
      background: #f1f5f9;
      color: #334155;
      border: 1px solid #e2e8f0;
      padding: 8px 14px;
    }
    .j-btn-filter-toggle:hover:not(:disabled) { background: #e2e8f0; }
    .j-btn-filter-toggle--open {
      background: #e8f4fc;
      border-color: #93c5fd;
      color: #005b96;
    }
    .j-filter-panel {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #f1f5f9;
    }
    .j-filter-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
    }
    .j-filter-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .j-filter-field label {
      font-size: 12px;
      font-weight: 600;
      color: #475569;
    }

    .j-filter-meta {
      margin-top: 10px;
      font-size: 12px;
      color: #64748b;
    }
    .j-filter-count strong { color: #03396c; }

    .j-link-btn {
      background: none;
      border: none;
      padding: 0;
      color: #005b96;
      font-weight: 600;
      cursor: pointer;
      text-decoration: underline;
      font-size: inherit;
      font-family: inherit;
    }
    .j-link-btn:hover { color: #03396c; }

    .j-table-card--batch { padding: 0; }
    .j-table-scroll {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .j-table--batches { min-width: 880px; }
    .j-table--batches .j-batch-name-cell {
      font-size: 14px;
      font-weight: 700;
      color: #03396c;
    }
    .j-td-teacher {
      font-size: 12px;
      font-weight: 500;
      color: #0f172a;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .j-day-pill {
      background: #dbeafe; color: #005b96;
      border-radius: 999px; padding: 3px 10px;
      font-size: 12px; font-weight: 700; white-space: nowrap;
    }
    .j-day-pill--table { font-size: 11px; padding: 2px 8px; }

    .j-progress-track {
      height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden;
    }
    .j-progress-track--table { height: 6px; max-width: 140px; }
    .j-progress-fill {
      height: 100%; background: linear-gradient(90deg,#005b96,#6497b1);
      border-radius: 999px; transition: width .4s;
    }
    .j-progress-cell { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
    .j-progress-label { font-size: 10px; color: #64748b; }
    .j-progress-label--table { text-align: left; }

    .j-th-narrow { text-align: center; width: 52px; }
    .j-th-actions { min-width: 110px; }
    .j-td-mono { text-align: center; font-variant-numeric: tabular-nums; color: #334155; }
    .j-table--batches tbody td:last-child { text-align: right; }
    .j-btn-manage { white-space: nowrap; }

    /* ── Auto-badge ── */
    .j-auto-badge {
      display: inline-flex; align-items: center; gap: 4px;
      background: #e0f2fe; color: #0369a1;
      border-radius: 999px; padding: 2px 9px;
      font-size: 11px; font-weight: 700;
    }
    .j-label-hint {
      font-size: 10px; font-weight: 400; color: #94a3b8; margin-left: 4px;
    }

    /* Auto-day display (when start date set) */
    .j-auto-day-display {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 6px 0;
    }
    .j-auto-day-hint {
      font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 4px;
    }

    /* Start-date info banner */
    .j-start-date-info {
      display: flex; align-items: flex-start; gap: 10px;
      margin-top: 14px; padding: 10px 14px;
      background: #e0f2fe; border: 1px solid #bae6fd; border-radius: 10px;
      font-size: 12px; color: #0c4a6e;
    }
    .j-start-date-info > i { color: #0369a1; font-size: 15px; margin-top: 1px; flex-shrink: 0; }
    .j-start-date-info > div { flex: 1; line-height: 1.5; }
    .j-btn-icon-sm {
      background: none; border: none; cursor: pointer;
      color: #64748b; padding: 4px; border-radius: 6px;
      display: inline-flex; align-items: center; justify-content: center;
      transition: color .15s, background .15s;
    }
    .j-btn-icon-sm:hover { color: #0f172a; background: rgba(0,0,0,.06); }

    /* ── Detail header ── */
    .j-back-btn { margin-bottom: 16px; }
    .j-detail-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .j-detail-header h2 { font-size: 18px; font-weight: 700; color: #03396c; margin: 0; }

    /* ── Config card ── */
    .j-config-card {
      background: #fff; border-radius: 14px;
      padding: 16px 20px; margin-bottom: 20px;
      box-shadow: 0 2px 12px rgba(15,23,42,.07); border: 1px solid #e8ecf4;
    }
    .j-card-title { font-size: 13px; font-weight: 700; color: #03396c; margin-bottom: 12px; }
    .j-config-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
    .j-config-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 140px; }
    .j-teacher-inline { display:flex; align-items:center; gap:10px; flex-wrap: wrap; }
    .j-teacher-pill {
      display:inline-flex; align-items:center; gap:6px;
      background:#f1f5f9; border:1px solid #e2e8f0;
      color:#0f172a; border-radius: 999px;
      padding: 6px 10px; font-size: 12px; font-weight: 700;
    }
    .j-config-field label { font-size: 11px; font-weight: 600; color: #475569; }
    .j-config-field--strict { flex: 1 1 280px; min-width: 240px; }
    .j-strict-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .j-switch {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      user-select: none;
      margin: 0;
    }
    .j-switch input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }
    .j-switch-slider {
      position: relative;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
      background: #cbd5e1;
      border-radius: 999px;
      transition: background .15s;
    }
    .j-switch-slider::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;
      width: 16px;
      height: 16px;
      background: #fff;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
      transition: transform .15s;
    }
    .j-switch input:checked + .j-switch-slider {
      background: #005b96;
    }
    .j-switch input:checked + .j-switch-slider::after {
      transform: translateX(18px);
    }
    .j-switch input:focus-visible + .j-switch-slider {
      outline: 2px solid #93c5fd;
      outline-offset: 2px;
    }
    .j-switch-label {
      font-size: 12px;
      color: #334155;
      line-height: 1.35;
      max-width: 360px;
    }
    .j-input--strict-pct {
      width: 100px;
      min-width: 88px;
    }
    .j-config-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }

    /* ── Input ── */
    .j-input {
      border: 1px solid #e2e8f0; border-radius: 8px;
      padding: 6px 10px; font-size: 12px; font-family: inherit; color: #0f172a;
      background: #f8fafc; width: 100%; box-sizing: border-box;
    }
    .j-input:focus { outline: none; border-color: #005b96; box-shadow: 0 0 0 2px rgba(0,91,150,.1); }
    .j-input-sm {
      border: 1px solid #e2e8f0; border-radius: 6px;
      padding: 4px 8px; font-size: 11px; font-family: inherit; color: #0f172a;
      background: #f8fafc; width: 68px;
    }
    .j-input-sm:focus { outline: none; border-color: #005b96; }

    /* ── Tabs ── */
    .j-tabs { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 2px solid #e2e8f0; }
    .j-tab {
      padding: 9px 18px; font-size: 12px; font-weight: 600;
      border: none; background: transparent; cursor: pointer; color: #64748b;
      border-bottom: 2px solid transparent; margin-bottom: -2px;
      font-family: inherit; transition: color .15s;
      display: flex; align-items: center; gap: 6px;
    }
    .j-tab.active { color: #005b96; border-bottom-color: #005b96; }
    .j-tab:hover { color: #005b96; }

    /* ── Table ── */
    .j-table-card {
      background: #fff; border-radius: 14px;
      box-shadow: 0 2px 12px rgba(15,23,42,.07); border: 1px solid #e8ecf4;
      overflow: auto;
    }
    .j-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .j-table thead th {
      background: #03396c; color: #fff; padding: 9px 12px;
      font-weight: 600; text-align: left; font-size: 10px;
      text-transform: uppercase; letter-spacing: .04em;
    }
    .j-table thead th.j-th-actions {
      text-align: right;
    }
    .j-table tbody td {
      padding: 9px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle;
    }
    .j-table tbody tr:hover { background: #f8fafc; }
    .j-student-name-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
    .j-student-name { font-weight: 600; color: #0f172a; }
    .j-student-email { color: #94a3b8; font-size: 10px; }

    /* Badges */
    .j-badge {
      display: inline-block; border-radius: 999px;
      padding: 2px 8px; font-size: 10px; font-weight: 600;
    }
    .j-badge-primary  { background: #dbeafe; color: #005b96; }
    .j-badge-secondary{ background: #f1f5f9; color: #475569; }
    .j-badge-success  { background: #dcfce7; color: #166534; }
    .j-badge-danger   { background: #ffe0e6; color: #e11d48; }
    .j-badge-class    { background: #fef3c7; color: #92400e; }

    /* Day mini progress in table */
    .j-day-track {
      height: 5px; background: #e2e8f0; border-radius: 999px; overflow: hidden;
      width: 80px; margin-bottom: 3px;
    }
    .j-day-fill { height: 100%; background: #005b96; border-radius: 999px; }
    .j-day-text { font-size: 10px; color: #64748b; }

    /* Date cells */
    .j-date-cell { display: flex; flex-direction: column; gap: 1px; }
    .j-date-main { font-size: 12px; font-weight: 600; color: #0f172a; white-space: nowrap; }
    .j-date-sub  { font-size: 10px; color: #94a3b8; }
    .j-date-empty { color: #cbd5e1; font-size: 12px; }

    /* Batch vs student day comparison */
    .j-batch-vs-student {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 12px; font-weight: 600;
    }
    .j-batch-vs-student.j-behind { color: #e11d48; }
    .j-batch-vs-student.j-ontrack { color: #16a34a; }
    .j-behind-label { font-size: 10px; color: #e11d48; margin-top: 2px; }

    .j-task-check-wrap { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .j-btn-link {
      background: none; border: none; padding: 0;
      color: #005b96; font-size: 12px; font-weight: 600;
      cursor: pointer; text-decoration: underline;
      font-family: inherit;
    }
    .j-btn-link:hover { color: #03396c; }

    /* Task check modal */
    .j-modal-backdrop {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(15, 23, 42, 0.45);
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
      animation: jFadeIn .15s ease;
    }
    @keyframes jFadeIn { from { opacity: 0; } to { opacity: 1; } }
    .j-modal-card {
      background: #fff; border-radius: 16px;
      max-width: 480px; width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,.25);
      border: 1px solid #e2e8f0;
      max-height: min(85vh, 640px);
      display: flex; flex-direction: column;
      animation: jModalUp .2s ease;
    }
    @keyframes jModalUp { from { transform: translateY(12px); opacity: 0.9; } to { transform: translateY(0); opacity: 1; } }
    .j-modal-header {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      padding: 18px 20px 0;
    }
    .j-modal-header h3 {
      margin: 0; font-size: 17px; font-weight: 700; color: #03396c;
    }
    .j-modal-close {
      background: #f1f5f9; border: none; width: 32px; height: 32px;
      border-radius: 8px; font-size: 22px; line-height: 1; color: #64748b;
      cursor: pointer; flex-shrink: 0;
    }
    .j-modal-close:hover { background: #e2e8f0; color: #0f172a; }
    .j-modal-sub {
      margin: 10px 20px 0; font-size: 12px; color: #64748b; line-height: 1.45;
    }
    .j-modal-meta {
      margin: 8px 20px 0;
      font-size: 12px;
      color: #475569;
      line-height: 1.45;
    }
    .j-modal-all-done {
      margin: 16px 20px 0;
      padding: 12px 14px;
      background: #ecfdf5; border: 1px solid #a7f3d0;
      border-radius: 10px;
      font-size: 13px; color: #065f46;
      display: flex; align-items: flex-start; gap: 10px;
    }
    .j-modal-icon-ok { color: #22c55e; font-size: 18px; }
    .j-modal-list { margin: 16px 20px 0; overflow-y: auto; flex: 1; min-height: 0; }
    .j-modal-list-title {
      margin: 0 0 10px; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: .04em; color: #c2410c;
    }
    .j-modal-task-ul { list-style: none; margin: 0; padding: 0; }
    .j-modal-task-li {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px;
      padding: 10px 12px; margin-bottom: 8px;
      background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
      font-size: 13px;
    }
    .j-modal-kind {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      padding: 2px 8px; border-radius: 6px; white-space: nowrap;
    }
    .j-kind-ex { background: #dbeafe; color: #1e40af; }
    .j-kind-mod { background: #e0e7ff; color: #3730a3; }
    .j-kind-cl { background: #fce7f3; color: #9d174d; }
    .j-modal-task-title { flex: 1; min-width: 140px; color: #0f172a; font-weight: 500; }
    .j-modal-day-pill {
      font-size: 11px; font-weight: 700; color: #03396c;
      background: #e0f2fe; padding: 3px 10px; border-radius: 999px;
      white-space: nowrap;
    }
    .j-modal-empty-day {
      margin: 16px 20px 0;
      padding: 12px 14px;
      background: #f8fafc; border-radius: 10px;
      font-size: 13px; color: #64748b;
      display: flex; align-items: center; gap: 8px;
    }
    .j-modal-footer {
      display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap;
      padding: 18px 20px;
      border-top: 1px solid #f1f5f9;
      margin-top: 16px;
    }

    /* Advance button colours */
    .j-btn-success { background: #22c55e; color: #fff; }
    .j-btn-success:hover:not(:disabled) { background: #16a34a; }
    .j-btn-warning { background: #f59e0b; color: #fff; }
    .j-btn-warning:hover:not(:disabled) { background: #d97706; }

    /* Per-student day control */
    .j-student-day-ctrl { display: flex; gap: 6px; align-items: center; justify-content: center; }

    /* ── Timeline ── */
    .j-timeline-section { }
    .j-timeline-filter {
      display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .j-timeline-count { font-size: 11px; color: #64748b; }
    .j-timeline { display: flex; flex-direction: column; gap: 12px; }

    .j-timeline-day {
      background: #fff; border-radius: 12px;
      border: 1px solid #e8ecf4;
      box-shadow: 0 1px 6px rgba(15,23,42,.05);
      overflow: hidden;
    }
    .j-timeline-day.j-current-day { border-color: #005b96; }

    .j-tday-header {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 10px 16px;
      background: #f8fafc;
      border-bottom: 1px solid #e8ecf4;
    }
    .j-current-day .j-tday-header { background: #e8f4fc; }
    .j-tday-number { font-weight: 700; font-size: 13px; color: #03396c; min-width: 50px; }
    .j-tday-current {
      background: #005b96; color: #fff; border-radius: 999px;
      padding: 2px 10px; font-size: 10px; font-weight: 700;
    }
    .j-tday-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
    .j-chip {
      border-radius: 999px; padding: 2px 9px; font-size: 10px; font-weight: 600;
    }
    .j-chip-module   { background: #dbeafe; color: #005b96; }
    .j-chip-exercise { background: #dcfce7; color: #166534; }
    .j-chip-class    { background: #fef3c7; color: #92400e; }

    .j-tday-content { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
    .j-content-group { }
    .j-content-group-label {
      font-size: 10px; font-weight: 700; color: #64748b;
      text-transform: uppercase; letter-spacing: .04em;
      margin-bottom: 6px; display: flex; align-items: center; gap: 5px;
    }
    .j-content-item {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      padding: 5px 0;
      border-bottom: 1px solid #f1f5f9;
      font-size: 12px;
    }
    .j-content-item:last-child { border-bottom: none; }
    .j-content-title { color: #0f172a; font-weight: 500; }
    .j-class-time { color: #94a3b8; font-size: 10px; margin-left: auto; }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .j-content { padding: 14px; }
      .j-filter-row--main { flex-direction: column; align-items: stretch; }
      .j-filter-toolbar-end { margin-left: 0; }
      .j-filter-sort { min-width: 0; }
      .j-config-row { flex-direction: column; }
    }

    /* ═══════════════════════════════════════════════════════════════
       PROGRESS TAB
       ═══════════════════════════════════════════════════════════════ */
    .jp-section { padding: 0 4px 28px; }

    .jp-loading-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 28px 24px;
      background: linear-gradient(135deg, #f8fafc 0%, #fff 100%);
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      color: #475569;
      font-size: 14px;
    }

    .jp-shell {
      background: linear-gradient(180deg, #f0f7fc 0%, #fafbfc 48%, transparent 100%);
      border-radius: 20px;
      padding: 20px 20px 8px;
      margin-bottom: 8px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
    }

    .jp-hero {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }
    .jp-hero-title {
      margin: 0 0 6px;
      font-size: 1.35rem;
      font-weight: 700;
      color: #0c4a6e;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .jp-hero-sub {
      margin: 0;
      font-size: 13px;
      color: #64748b;
      max-width: 520px;
      line-height: 1.5;
    }
    .jp-hero-refresh { flex-shrink: 0; }

    .jp-empty-state {
      text-align: center;
      padding: 36px 20px;
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 16px;
      color: #64748b;
      margin-bottom: 16px;
    }
    .jp-empty-state i { font-size: 2rem; color: #94a3b8; margin-bottom: 12px; display: block; }
    .jp-empty-state p { margin: 0 0 14px; max-width: 400px; margin-left: auto; margin-right: auto; line-height: 1.5; }

    /* Sub-view pills */
    .jp-view-pills {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .jp-view-pills--segmented {
      background: #e8ecf4;
      padding: 4px;
      border-radius: 14px;
      gap: 4px;
    }
    .jp-view-pills--segmented .jp-pill {
      border: none;
      background: transparent;
      border-radius: 10px;
      flex: 1 1 auto;
      justify-content: center;
      min-width: 100px;
    }
    .jp-view-pills--segmented .jp-pill:hover { background: rgba(255,255,255,.7); color: #005b96; }
    .jp-view-pills--segmented .jp-pill-active {
      background: #fff;
      color: #005b96;
      box-shadow: 0 1px 4px rgba(0,0,0,.08);
    }
    .jp-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 18px;
      border-radius: 24px;
      border: 1.5px solid #e2e8f0;
      background: #f8fafc;
      color: #64748b;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all .15s;
    }
    .jp-pill:hover { background: #e8f4fc; border-color: #005b96; color: #005b96; }
    .jp-pill-active {
      background: #005b96;
      border-color: #005b96;
      color: #fff;
    }

    /* Stats cards row */
    .jp-stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 14px;
      margin-bottom: 0;
    }
    .jp-stats-sm .jp-stat-card { padding: 14px 16px; }
    .jp-stat-card {
      display: flex;
      align-items: center;
      gap: 14px;
      background: #fff;
      border: 1px solid #e8ecf4;
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: 0 2px 12px rgba(15, 23, 42, 0.05);
      transition: transform .15s, box-shadow .15s;
    }
    .jp-stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
    }
    .jp-stat-card--accent-gold { border-left: 4px solid #f59e0b; }
    .jp-stat-card--accent-blue { border-left: 4px solid #2563eb; }
    .jp-stat-card--accent-green { border-left: 4px solid #16a34a; }
    .jp-stat-card--accent-violet { border-left: 4px solid #7c3aed; }
    .jp-stat-icon {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .jp-icon-score  { background: #fef3c7; color: #d97706; }
    .jp-icon-exercise { background: #dbeafe; color: #2563eb; }
    .jp-icon-class  { background: #dcfce7; color: #16a34a; }
    .jp-icon-day    { background: #ede9fe; color: #7c3aed; }
    .jp-stat-value { font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1.1; }
    .jp-stat-label { font-size: 11px; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: .04em; }

    /* Score bar */
    .jp-score-bar-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 100px;
    }
    .jp-score-bar {
      height: 7px;
      border-radius: 4px;
      background: linear-gradient(90deg, #005b96, #38bdf8);
      min-width: 2px;
      max-width: 80px;
      flex: 1 1 auto;
      transition: width .3s;
    }
    .jp-score-text { font-size: 12px; font-weight: 600; color: #334155; white-space: nowrap; }

    /* Day badge */
    .jp-day-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      background: #ede9fe;
      color: #7c3aed;
      font-size: 11px;
      font-weight: 600;
    }

    /* Panels & tables (Overall / Daily / Weekly) */
    .jp-panel {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 18px;
      box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06);
      margin-bottom: 20px;
      overflow: hidden;
    }
    .jp-panel-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px 16px;
      padding: 16px 20px;
      background: linear-gradient(90deg, #f8fafc 0%, #fff 100%);
      border-bottom: 1px solid #e8ecf4;
    }
    .jp-panel-head--charts { align-items: flex-start; }
    .jp-panel-title {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .jp-panel-meta { font-size: 12px; color: #64748b; font-weight: 500; }
    .jp-panel-desc {
      margin: 6px 0 0;
      font-size: 12px;
      color: #64748b;
      line-height: 1.45;
      max-width: 640px;
    }
    .jp-table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .jp-table-zebra tbody tr:nth-child(even) { background: #fafbfc; }
    .jp-table-zebra tbody tr:hover { background: #f0f9ff; }
    .jp-score-bar-wrap--table { min-width: 120px; max-width: 160px; }
    .jp-score-bar-wrap--table .jp-score-bar { max-width: 100px; }
    .jp-day-range { font-size: 12px; color: #475569; }
    .jp-row-highlight { background: #eff6ff !important; outline: 1px solid #93c5fd; }

    /* Weekly charts */
    .jp-week-wrap { margin-top: 4px; }
    .jp-week-charts-panel { margin-bottom: 20px; }
    .jp-week-picker { flex-shrink: 0; text-align: right; }
    .jp-week-picker-label {
      display: block;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .06em;
      color: #64748b;
      margin-bottom: 6px;
    }
    .jp-week-picker-pills { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .jp-week-num {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 72px;
      padding: 8px 12px;
      border-radius: 12px;
      border: 2px solid #e2e8f0;
      background: #fff;
      cursor: pointer;
      font-size: 15px;
      font-weight: 800;
      color: #334155;
      transition: all .15s;
    }
    .jp-week-num small {
      display: block;
      font-size: 9px;
      font-weight: 600;
      color: #94a3b8;
      margin-top: 2px;
    }
    .jp-week-num:hover { border-color: #005b96; color: #005b96; }
    .jp-week-num--active {
      border-color: #005b96;
      background: linear-gradient(180deg, #e8f4fc 0%, #fff 100%);
      color: #005b96;
      box-shadow: 0 2px 10px rgba(0, 91, 150, 0.15);
    }
    .jp-charts-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      padding: 16px 18px 22px;
    }
    .jp-charts-grid--three {
      grid-template-columns: 1fr;
      gap: 22px;
    }
    @media (min-width: 1100px) {
      .jp-charts-grid--three { grid-template-columns: repeat(3, 1fr); align-items: stretch; }
    }
    @media (max-width: 1200px) {
      .jp-charts-grid:not(.jp-charts-grid--three) { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 700px) {
      .jp-charts-grid:not(.jp-charts-grid--three) { grid-template-columns: 1fr; }
      .jp-week-picker { text-align: left; width: 100%; }
      .jp-week-picker-pills { justify-content: flex-start; }
    }
    .jp-chart-card {
      background: #fafbfc;
      border: 1px solid #e8ecf4;
      border-radius: 14px;
      padding: 12px 12px 8px;
      min-height: 0;
    }
    .jp-chart-card--wide {
      grid-column: span 2;
    }
    @media (max-width: 1200px) {
      .jp-chart-card--wide { grid-column: span 2; }
    }
    @media (max-width: 700px) {
      .jp-chart-card--wide { grid-column: span 1; }
    }
    .jp-chart-canvas {
      position: relative;
      height: 240px;
      width: 100%;
    }
    .jp-chart-canvas--tall { height: 280px; }
    .jp-chart-canvas--week { height: 260px; }
    .jp-chart-card--focus {
      display: flex;
      flex-direction: column;
      background: #fff;
      border: 1px solid #e2e8f0;
      box-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);
    }
    .jp-chart-card-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #475569;
      padding: 10px 14px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .jp-chart-card-label i { color: #005b96; }
    .jp-chart-empty {
      text-align: center;
      padding: 40px 20px;
      color: #94a3b8;
    }
    .jp-chart-empty i { font-size: 2rem; display: block; margin-bottom: 10px; opacity: .7; }
    .jp-chart-empty p { margin: 0; font-size: 13px; max-width: 360px; margin-left: auto; margin-right: auto; line-height: 1.5; }

    /* Daily progress: expandable rows + analytics */
    .jp-daily-card { padding-bottom: 4px; }
    .jp-panel.jp-daily-card .jp-daily-table-scroll { padding: 0 12px 16px; }
    .jp-daily-table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .jp-daily-table { min-width: 940px; }
    .jp-col-expand { width: 28px; text-align: center; color: #94a3b8; }
    .jp-day-row { cursor: pointer; transition: background .12s; }
    .jp-day-row:hover { background: #f1f5f9; }
    .jp-day-row--open { background: #eff6ff; }
    .jp-day-detail-row { background: #fafbfc; }
    .jp-day-detail-cell {
      padding: 16px 18px 20px !important;
      border-top: 1px dashed #e2e8f0;
      vertical-align: top;
    }
    .jp-sched-pill {
      display: inline-block; padding: 2px 8px; border-radius: 8px;
      font-size: 10px; font-weight: 700; background: #dcfce7; color: #166534; margin-right: 4px;
    }
    .jp-sched-pill--mod { background: #dbeafe; color: #1d4ed8; }
    .jp-score-bar-wrap--narrow { min-width: 72px; }
    .jp-score-bar--violet { background: linear-gradient(90deg, #7c3aed, #a78bfa) !important; }
    .jp-score-bar--amber { background: linear-gradient(90deg, #d97706, #fbbf24) !important; }
    .jp-detail-muted { font-size: 12px; color: #94a3b8; margin-bottom: 12px; line-height: 1.45; }
    .jp-live-block {
      border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; background: #fff;
    }
    .jp-live-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 14px; margin-bottom: 10px; }
    .jp-live-head strong { font-size: 13px; color: #0f172a; }
    .jp-live-meta { font-size: 11px; color: #64748b; }
    .jp-att-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 700px) { .jp-att-grid { grid-template-columns: 1fr; } }
    .jp-att-col { border-radius: 10px; padding: 10px 12px; font-size: 12px; }
    .jp-att-yes { background: #f0fdf4; border: 1px solid #bbf7d0; }
    .jp-att-no { background: #fef2f2; border: 1px solid #fecaca; }
    .jp-att-title { display: block; font-weight: 700; margin-bottom: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
    .jp-att-yes .jp-att-title { color: #166534; }
    .jp-att-no .jp-att-title { color: #b91c1c; }
    .jp-att-list { margin: 0; padding-left: 18px; color: #334155; max-height: 220px; overflow-y: auto; }
    .jp-att-list li { margin-bottom: 3px; }
    .jp-reg { color: #94a3b8; font-weight: 500; }
    .jp-detail-summary {
      display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin-top: 8px;
      padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #475569;
    }
    .jp-ex-analytics-modal { max-width: min(1200px, 96vw); }
    .jp-class-analytics-modal {
      max-width: min(880px, 96vw);
      max-height: 90vh;
      display: flex;
      flex-direction: column;
    }
    .jp-class-analytics-body {
      padding: 0 20px 16px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }
    .jp-class-analytics-empty {
      margin: 0;
      padding: 16px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      font-size: 13px;
      color: #475569;
      line-height: 1.5;
    }
    .jp-live-block--modal { margin-bottom: 16px; }
    .jp-class-analytics-footer { flex-shrink: 0; border-top: 1px solid #e8ecf4; padding-top: 14px; }
    .jp-ex-analytics-body { padding: 0 20px 20px; overflow: hidden; display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .jp-ex-table-wrap { overflow: auto; max-height: 65vh; border: 1px solid #e2e8f0; border-radius: 12px; }
    .jp-ex-matrix { margin: 0; font-size: 11px; }
    .jp-ex-student-col {
      position: sticky; left: 0; z-index: 2; background: #fff; min-width: 140px;
      box-shadow: 4px 0 8px rgba(15,23,42,.06);
    }
    th.jp-ex-student-col { z-index: 3; }
    .jp-ex-title-col {
      min-width: 100px; max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      vertical-align: bottom;
    }
    .jp-ex-cell { text-align: center; font-weight: 600; }
    .jp-ex-cell--ok { color: #166534; background: #f0fdf4; }
    .jp-ex-cell--miss { color: #94a3b8; background: #f8fafc; }
    .jp-miss { font-weight: 500; }

    /* ── Student detail modal ── */
    .jp-detail-modal {
      background: #fff;
      border-radius: 18px;
      box-shadow: 0 20px 60px rgba(0,0,0,.18);
      width: 92vw;
      max-width: 1000px;
      max-height: 90vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .jp-modal-loading { padding: 40px; justify-content: center; }
    .jp-detail-sub {
      display: block;
      font-size: 12px;
      font-weight: 400;
      color: #64748b;
      margin-top: 2px;
    }

    /* Inner tabs */
    .jp-inner-tabs {
      display: flex;
      gap: 2px;
      border-bottom: 2px solid #e2e8f0;
      padding: 0 20px;
      background: #f8fafc;
      flex-shrink: 0;
      overflow-x: auto;
    }
    .jp-inner-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 12px 18px;
      border: none;
      background: transparent;
      color: #64748b;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      white-space: nowrap;
      transition: color .15s;
    }
    .jp-inner-tab:hover { color: #005b96; }
    .jp-inner-tab.active { color: #005b96; border-bottom-color: #005b96; font-weight: 600; }

    .jp-modal-body {
      overflow-y: auto;
      padding: 20px;
      flex: 1 1 auto;
    }

    /* Day grid (overview) */
    .jp-section-title { font-size: 14px; font-weight: 600; color: #334155; margin: 18px 0 12px; }
    .jp-day-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
      gap: 8px;
    }
    .jp-day-cell {
      border-radius: 10px;
      padding: 10px 8px;
      text-align: center;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      transition: box-shadow .15s;
    }
    .jp-day-good { background: #f0fdf4; border-color: #86efac; }
    .jp-day-empty { opacity: .55; }
    .jp-dc-label { font-size: 10px; font-weight: 600; color: #64748b; text-transform: uppercase; }
    .jp-dc-score { font-size: 16px; font-weight: 700; color: #005b96; }
    .jp-dc-empty { color: #cbd5e1; font-size: 16px; }
    .jp-dc-meta { display: flex; justify-content: center; gap: 8px; margin-top: 4px; font-size: 10px; color: #64748b; }
    .jp-dc-meta span { display: inline-flex; align-items: center; gap: 3px; }

    /* Exercise list */
    .jp-exercise-list { display: flex; flex-direction: column; gap: 10px; }
    .jp-exercise-row {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      background: #fff;
    }
    .jp-ex-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      cursor: pointer;
      gap: 12px;
      transition: background .12s;
    }
    .jp-ex-header:hover { background: #f8fafc; }
    .jp-ex-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1; }
    .jp-ex-title { font-size: 13px; font-weight: 600; color: #0f172a; }
    .jp-ex-meta { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

    /* Score chips */
    .jp-score-chip {
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
    }
    .jp-score-good { background: #dcfce7; color: #16a34a; }
    .jp-score-mid  { background: #fef9c3; color: #ca8a04; }
    .jp-score-low  { background: #fee2e2; color: #dc2626; }
    .jp-points { font-size: 11px; color: #64748b; }
    .jp-time-spent { font-size: 11px; color: #94a3b8; }
    .jp-completed-at { font-size: 11px; color: #94a3b8; }

    /* Responses */
    .jp-responses { padding: 0 16px 16px; }
    .jp-no-responses { color: #94a3b8; font-size: 12px; font-style: italic; }
    .jp-response-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .jp-response-table th {
      text-align: left;
      padding: 6px 10px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
    }
    .jp-response-table td {
      padding: 7px 10px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
      vertical-align: top;
    }
    .jp-response-table tr:last-child td { border-bottom: none; }
    .jp-qtype {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 8px;
      background: #e0f2fe;
      color: #0369a1;
      font-size: 10px;
      font-weight: 600;
    }
    .jp-answer { max-width: 240px; word-break: break-word; }
    .jp-correct { color: #16a34a; font-size: 13px; }
    .jp-wrong   { color: #dc2626; font-size: 13px; }

    /* Status chips */
    .jp-status-chip {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: capitalize;
    }
    .jp-status-done { background: #dcfce7; color: #16a34a; }
    .jp-status-wip  { background: #dbeafe; color: #2563eb; }
    .jp-status-ns   { background: #f1f5f9; color: #64748b; }

    .j-ro-pill {
      display: inline-block;
      margin-left: 10px;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #e0f2fe;
      color: #0369a1;
      vertical-align: middle;
    }
    .j-ro-summary {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 4px;
    }
    .j-ro-card {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      background: linear-gradient(145deg, #f8fafc 0%, #fff 100%);
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
    }
    .j-ro-card--highlight {
      border-color: #c7d2fe;
      background: linear-gradient(145deg, #eef2ff 0%, #fff 100%);
    }
    .j-ro-card--wide {
      grid-column: 1 / -1;
    }
    .j-ro-card-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: #e0f2fe;
      color: #0369a1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .j-ro-card-icon--violet { background: #ede9fe; color: #6d28d9; }
    .j-ro-card-icon--blue { background: #dbeafe; color: #1d4ed8; }
    .j-ro-card-icon--green { background: #d1fae5; color: #047857; }
    .j-ro-card-icon--amber { background: #fef3c7; color: #b45309; }
    .j-ro-card-icon--muted { background: #f1f5f9; color: #64748b; }
    .j-ro-card-body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .j-ro-card-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
    }
    .j-ro-card-value {
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
      line-height: 1.35;
    }
    .j-ro-card-value--notes { font-weight: 500; font-size: 13px; color: #334155; }

    .jp-detail-loading {
      padding: 28px;
      text-align: center;
      color: #64748b;
      font-size: 13px;
    }
    .jp-detail-loading .spinner-border { vertical-align: middle; margin-right: 8px; }

    /* ── Plan tabs (Platinum / Silver) ── */
    .j-plan-tab-bar {
      display: flex;
      gap: 4px;
      padding: 14px 24px 0;
      background: transparent;
    }
    .j-plan-tab {
      padding: 8px 22px;
      border: 2px solid #e2e8f0;
      border-radius: 10px 10px 0 0;
      background: #f8fafc;
      color: #64748b;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all .15s;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .j-plan-tab:hover { background: #e8f4fc; color: #005b96; border-color: #93c5fd; }
    .j-plan-tab--active {
      background: #fff;
      border-color: #005b96;
      border-bottom-color: #fff;
      color: #005b96;
      box-shadow: 0 -2px 8px rgba(0,91,150,.08);
      position: relative;
      z-index: 1;
    }
    .j-plan-tab-icon { font-size: 15px; }

    /* ── GO Silver specific styles ── */
    .gs-add-bar {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 20px;
      box-shadow: 0 1px 4px rgba(0,0,0,.04);
    }
    .gs-add-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 12px;
    }
    .gs-silver-tab-bar {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #f8fafc;
    }
    .gs-silver-tab {
      border: none;
      background: transparent;
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
      padding: 7px 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: all .15s;
    }
    .gs-silver-tab:hover {
      background: #e2e8f0;
      color: #1e293b;
    }
    .gs-silver-tab--active {
      background: #005b96;
      color: #fff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .2);
    }
    .gs-add-bar--compact {
      margin-top: -8px;
      padding-top: 14px;
      padding-bottom: 14px;
    }
    .gs-add-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .gs-filter-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    .gs-bulk-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 0 0 12px;
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #f8fafc;
      flex-wrap: wrap;
    }
    .gs-bulk-left {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .gs-bulk-count {
      font-size: 12px;
      font-weight: 700;
      color: #0f172a;
      background: #e2e8f0;
      border-radius: 999px;
      padding: 4px 10px;
    }
    .gs-bulk-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .gs-day-input {
      width: 110px;
      height: 30px;
    }
    .gs-batch-select {
      min-width: 180px;
      max-width: 260px;
    }
    .gs-add-error {
      margin: 8px 0 0;
      font-size: 12px;
      color: #dc2626;
    }
    .gs-plan-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .04em;
      background: #e0f2fe;
      color: #0369a1;
    }
    .gs-status-go {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
      background: #dcfce7;
      color: #16a34a;
    }
    .j-tr-clickable:hover td { background: #f0f9ff; }
    .gs-detail-modal {
      max-width: 700px !important;
      max-height: min(90vh, 800px) !important;
      display: flex;
      flex-direction: column;
    }
    .gs-rec-row {
      display: flex;
      align-items: flex-start;
      padding: 10px 0;
      border-bottom: 1px solid #f1f5f9;
    }
    .gs-rec-row:last-child { border-bottom: none; }
    .gs-rec-row.gs-locked { opacity: 0.55; }
    .gs-rec-info { display: flex; align-items: flex-start; gap: 10px; flex: 1; }
    .gs-lock-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
    .gs-rec-title { font-size: 13px; font-weight: 600; color: #0f172a; }
    .gs-rec-meta { display: flex; align-items: center; gap: 8px; margin-top: 3px; flex-wrap: wrap; font-size: 11px; color: #64748b; }
    .gs-badge-locked { background: #fef2f2; color: #dc2626; padding: 1px 7px; border-radius: 8px; font-weight: 600; font-size: 10px; }
    .gs-badge-watched { background: #dcfce7; color: #16a34a; padding: 1px 7px; border-radius: 8px; font-weight: 600; font-size: 10px; }
    .gs-badge-unwatched { background: #f1f5f9; color: #64748b; padding: 1px 7px; border-radius: 8px; font-weight: 600; font-size: 10px; }
    .gs-item-row {
      display: flex;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid #f1f5f9;
      gap: 8px;
    }
    .gs-item-row:last-child { border-bottom: none; }
    .gs-item-row.gs-locked { opacity: 0.55; }
    .gs-item-title { font-size: 13px; font-weight: 600; color: #0f172a; }
    .gs-item-meta { font-size: 11px; color: #64748b; margin-top: 2px; }
  `]
})
export class JourneyManagementComponent implements OnInit {

  private apiUrl = `${environment.apiUrl}/batch-journey`;
  private adminUrl = `${environment.apiUrl}/admin`;

  batches: BatchSummary[] = [];
  /** Batches not on the active journey list (pick here + Start journey). */
  upcomingBatches: BatchSummary[] = [];
  selectedUpcomingBatch = '';
  startingJourney = false;
  removingJourneyBatch: string | null = null;
  loading = false;

  /** Create batch modal */
  showCreateBatch = false;
  creatingBatch = false;
  newBatchName = '';
  newJourneyLength = 200;

  /** Assign teacher modal */
  showAssignTeacher = false;
  assigningTeacher = false;
  assignBatchName = '';
  teachers: TeacherPick[] = [];
  teachersLoading = false;
  teacherSearch = '';
  selectedTeacherId: string = '';

  /** Batch list (level 1) filters */
  batchSearch = '';
  batchSort: 'name' | 'nameDesc' | 'day' | 'dayDesc' | 'students' | 'length' = 'name';
  filtersExpanded = false;
  filterDayMin: number | null = null;
  filterDayMax: number | null = null;
  filterStudentsMin: number | null = null;
  filterJourneyMin: number | null = null;
  filterBatchType: 'all' | 'new' | 'existing' = 'all';

  selectedBatch: BatchSummary | null = null;
  batchStudents: StudentRow[] = [];
  loadingStudents = false;
  /** Avoid refetching students when switching back to Students tab for the same batch */
  studentsLoadedForBatch: string | null = null;

  /** Skeleton row counts (template only) */
  readonly skStudentCols = Array.from({ length: 10 });
  readonly skStudentRows = Array.from({ length: 8 });
  readonly skTimelineDays = Array.from({ length: 5 });
  readonly skPillRow = Array.from({ length: 3 });
  readonly skStatRow = Array.from({ length: 4 });
  readonly skPanelRows = Array.from({ length: 10 });
  savingConfig = false;
  applyingDay = false;

  editJourneyLength = 200;
  editBatchDay = 1;
  editBatchStartDate = '';   // ISO date string 'YYYY-MM-DD', empty = manual mode
  editNotes = '';
  editBatchType: 'new' | 'old' = 'old';
  /** Old batch only: weekly DG Bot access. */
  editOldBatchDgBotAccess = false;
  /** When false, daily rollover advances students without requiring day tasks. */
  editStrictJourneyRule = false;
  /** 1–100; used when editStrictJourneyRule is true. */
  editStrictThresholdPercent = 100;
  /** When true, recordings are auto-saved via Zoom webhook for this batch. */
  editAutoRecordingEnabled = false;

  activeTab: 'students' | 'timeline' | 'progress' = 'students';

  timelineDays: TimelineDay[] = [];
  loadingTimeline = false;
  jumpDay: number | null = null;

  /** Centered card: task check results */
  taskModal: TaskCheckModal | null = null;

  // ── Progress tab state ──────────────────────────────────────────────────────
  progressView: 'overall' | 'daily' | 'weekly' = 'overall';
  batchProgress: any = null;
  /** Initial Progress tab load: overall + per-student summary rows only */
  loadingProgressOverall = false;
  /** Lazy load when user opens Daily or Weekly */
  loadingProgressDetail = false;
  progressOverallLoaded = false;
  progressDetailLoaded = false;
  /** Which journey week (1-based) the weekly charts focus on */
  progressChartsWeek = 1;

  /** Weekly day-by-day charts (Chart.js via ng2-charts) */
  jpWeekLiveData: ChartConfiguration<'bar'>['data'] | null = null;
  jpWeekLiveOpts!: ChartConfiguration<'bar'>['options'];
  jpWeekModuleData: ChartConfiguration<'bar'>['data'] | null = null;
  jpWeekModuleOpts!: ChartConfiguration<'bar'>['options'];
  /** Mixed bar + line (Chart.js dataset types) */
  jpWeekExerciseData: ChartConfiguration<'bar'>['data'] | null = null;
  jpWeekExerciseOpts!: ChartConfiguration<'bar'>['options'];

  /** Student detail modal */
  selectedStudentProgress: any = null;
  showStudentProgressModal = false;
  loadingStudentProgress = false;
  studentProgressModalTab: 'overview' | 'exercises' | 'modules' | 'classes' = 'overview';
  expandedExercises: Set<string> = new Set();

  /** Progress → Daily: expandable day + exercise analytics modal */
  expandedProgressDay: number | null = null;
  dayDetail: any = null;
  dayDetailLoading = false;
  dayDetailError = '';
  showExerciseAnalyticsModal = false;
  exerciseAnalytics: any = null;
  exerciseAnalyticsLoading = false;
  exerciseAnalyticsDay: number | null = null;

  showClassAnalyticsModal = false;
  classAnalyticsDetail: any = null;
  classAnalyticsLoading = false;
  classAnalyticsDay: number | null = null;

  /** True when logged in as TEACHER (journey tab is view-only). */
  isJourneyReadOnly = false;
  /** Used when deep-linked from Performance: show only Progress section. */
  progressOnlyMode = false;

  // ── Plan tabs (Platinum / Silver) ──────────────────────────────────────────
  planTab: 'platinum' | 'silver' | 'silver-sinhala' = 'platinum';

  // ── GO Silver state ─────────────────────────────────────────────────────────
  silverTab: 'go' | 'silver' = 'go';
  goEmailInput = '';
  goAdding = false;
  goAddError = '';
  goLoading = false;
  goStudents: any[] = [];
  silverLoading = false;
  silverStudents: SilverStudentRow[] = [];
  silverSearch = '';
  silverBatchFilter = 'all';
  goSearch = '';
  goBatchFilter = 'all';
  goStatusFilter = 'all';
  goDayMinFilter: number | null = null;
  goDayMaxFilter: number | null = null;
  silverSelectedIds = new Set<string>();
  goSelectedIds = new Set<string>();
  silverAddingIds = new Set<string>();
  goRemovingIds = new Set<string>();
  silverBatchList: string[] = [];
  goBulkDay: number | null = null;
  goBulkBatch = '';
  goBulkUpdating = false;
  silverBulkDay: number | null = null;
  silverBulkBatch = '';
  silverBulkUpdating = false;

  constructor(
    private http: HttpClient,
    private notify: NotificationService,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.isJourneyReadOnly = this.authService.getSnapshotUser()?.role === 'TEACHER';
  }

  get filteredTeachers(): TeacherPick[] {
    const q = String(this.teacherSearch || '').trim().toLowerCase();
    const list = [...(this.teachers || [])];
    if (!q) return list;
    return list.filter(t =>
      String(t.name || '').toLowerCase().includes(q) ||
      String(t.email || '').toLowerCase().includes(q)
    );
  }

  get activeGoApiPath(): string {
    return this.planTab === 'silver-sinhala' ? 'go-students-sinhala' : 'go-students';
  }

  get activeGoBatchName(): string {
    return this.planTab === 'silver-sinhala' ? 'GO-SINHALA' : 'GO-SILVER';
  }

  get activeGoBatchLabel(): string {
    return this.planTab === 'silver-sinhala' ? 'GO-SINHALA (Sinhala)' : 'GO-SILVER (Tamil)';
  }

  get silverBatchOptions(): string[] {
    const defaultBatch = this.activeGoBatchName;
    if (this.silverBatchList.length > 0) {
      const set = new Set(this.silverBatchList);
      set.add(defaultBatch);
      return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    const set = new Set<string>();
    (this.silverStudents || []).forEach((s) => {
      const batch = String(s.batch || '').trim();
      if (batch) set.add(batch);
    });
    set.add(defaultBatch);
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  get filteredSilverStudents(): SilverStudentRow[] {
    let list = [...(this.silverStudents || [])];
    const q = String(this.silverSearch || '').trim().toLowerCase();
    if (q) {
      list = list.filter((s) =>
        String(s.name || '').toLowerCase().includes(q) ||
        String(s.email || '').toLowerCase().includes(q) ||
        String(s.regNo || '').toLowerCase().includes(q)
      );
    }
    if (this.silverBatchFilter !== 'all') {
      list = list.filter((s) => String(s.batch || '') === this.silverBatchFilter);
    }
    return list;
  }

  get goBatchOptions(): string[] {
    const set = new Set<string>();
    (this.goStudents || []).forEach((s) => {
      const batch = String(s?.batch || '').trim();
      if (batch) set.add(batch);
    });
    set.add(this.activeGoBatchName);
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  get filteredGoStudents(): any[] {
    let list = [...(this.goStudents || [])];
    const q = String(this.goSearch || '').trim().toLowerCase();
    // Do not use Number(null) — it is 0 and would apply Day ≤ 0 when filters are unset.
    const minDay = this.goDayMinFilter;
    const maxDay = this.goDayMaxFilter;
    if (q) {
      list = list.filter((s) =>
        String(s?.name || '').toLowerCase().includes(q) ||
        String(s?.email || '').toLowerCase().includes(q) ||
        String(s?.regNo || '').toLowerCase().includes(q)
      );
    }
    if (this.goBatchFilter !== 'all') {
      list = list.filter((s) => String(s?.batch || '') === this.goBatchFilter);
    }
    if (this.goStatusFilter !== 'all') {
      list = list.filter((s) => String(s?.studentStatus || '').toUpperCase() === this.goStatusFilter);
    }
    if (minDay != null && Number.isFinite(minDay)) {
      list = list.filter((s) => Number(s?.currentCourseDay || 1) >= minDay);
    }
    if (maxDay != null && Number.isFinite(maxDay)) {
      list = list.filter((s) => Number(s?.currentCourseDay || 1) <= maxDay);
    }
    return list;
  }

  get areAllVisibleSilverChecked(): boolean {
    const list = this.filteredSilverStudents;
    if (!list.length) return false;
    return list.every((s) => this.silverSelectedIds.has(s._id));
  }

  get silverSelectedCount(): number {
    return this.silverSelectedIds.size;
  }

  get areAllGoChecked(): boolean {
    return this.filteredGoStudents.length > 0 && this.filteredGoStudents.every((s) => this.goSelectedIds.has(String(s._id)));
  }

  get goSelectedCount(): number {
    return this.goSelectedIds.size;
  }

  closeCreateBatch(): void {
    this.showCreateBatch = false;
    this.creatingBatch = false;
    this.newBatchName = '';
    this.newJourneyLength = 200;
  }

  openAssignTeacher(b: BatchSummary): void {
    this.assignBatchName = b.batchName;
    this.selectedTeacherId = '';
    this.teacherSearch = '';
    this.showAssignTeacher = true;
    this.loadTeachers();
  }

  closeAssignTeacher(): void {
    this.showAssignTeacher = false;
    this.assigningTeacher = false;
    this.assignBatchName = '';
    this.selectedTeacherId = '';
  }

  // ── Plan tab switch ─────────────────────────────────────────────────────────
  switchPlanTab(tab: 'platinum' | 'silver' | 'silver-sinhala'): void {
    if (this.planTab === tab) return;
    this.planTab = tab;
    if (tab === 'silver' || tab === 'silver-sinhala') {
      this.goStudents = [];
      this.silverStudents = [];
      this.goSelectedIds.clear();
      this.silverSelectedIds.clear();
      this.loadGoStudents();
      this.loadSilverStudents();
    }
  }

  // ── GO Silver methods ───────────────────────────────────────────────────────
  loadGoStudents(): void {
    this.goLoading = true;
    this.http.get<any>(`${environment.apiUrl}/${this.activeGoApiPath}`, { withCredentials: true }).subscribe({
      next: (r) => {
        this.goStudents = r.students || [];
        this.goSelectedIds.clear();
        this.goBulkDay = null;
        this.goBulkBatch = '';
        this.goLoading = false;
      },
      error: (e) => {
        this.goLoading = false;
        this.notify.error(e?.error?.message || 'Failed to load GO students.');
      }
    });
  }

  addGoStudent(): void {
    const email = (this.goEmailInput || '').trim();
    this.goAddError = '';
    if (!email) {
      this.goAddError = 'Please enter a student email.';
      return;
    }
    this.goAdding = true;
    this.http.post<any>(`${environment.apiUrl}/${this.activeGoApiPath}/add`, { email }, { withCredentials: true }).subscribe({
      next: (r) => {
        this.goAdding = false;
        this.goEmailInput = '';
        this.notify.success(r?.message || 'Student added to GO batch.');
        this.afterGoStudentAdded(r?.student);
      },
      error: (e) => {
        this.goAdding = false;
        this.goAddError = e?.error?.message || 'Failed to add student.';
      }
    });
  }

  loadSilverStudents(): void {
    this.silverLoading = true;
    this.http.get<any>(`${environment.apiUrl}/${this.activeGoApiPath}/silver`, { withCredentials: true }).subscribe({
      next: (r) => {
        this.silverStudents = r?.students || [];
        this.silverBatchList = r?.batches || [];
        this.silverLoading = false;
        this.silverSelectedIds.clear();
        this.silverBulkDay = null;
        this.silverBulkBatch = '';
      },
      error: (e) => {
        this.silverLoading = false;
        this.notify.error(e?.error?.message || 'Failed to load Silver students.');
      }
    });
  }

  isSilverSelected(studentId: string): boolean {
    return this.silverSelectedIds.has(studentId);
  }

  toggleSilverSelection(studentId: string, event: Event): void {
    const checked = !!(event?.target as HTMLInputElement)?.checked;
    if (checked) this.silverSelectedIds.add(studentId);
    else this.silverSelectedIds.delete(studentId);
  }

  toggleSelectAllVisibleSilver(event: Event): void {
    const checked = !!(event?.target as HTMLInputElement)?.checked;
    if (checked) this.filteredSilverStudents.forEach((s) => this.silverSelectedIds.add(s._id));
    else this.filteredSilverStudents.forEach((s) => this.silverSelectedIds.delete(s._id));
  }

  clearSilverSelections(): void {
    this.silverSelectedIds.clear();
  }

  isSilverAdding(studentId: string): boolean {
    return this.silverAddingIds.has(studentId);
  }

  isGoRemoving(studentId: string): boolean {
    return this.goRemovingIds.has(studentId);
  }

  isGoSelected(studentId: string): boolean {
    return this.goSelectedIds.has(String(studentId));
  }

  toggleGoSelection(studentId: string, event: Event): void {
    const id = String(studentId || '');
    const checked = !!(event?.target as HTMLInputElement)?.checked;
    if (!id) return;
    if (checked) this.goSelectedIds.add(id);
    else this.goSelectedIds.delete(id);
  }

  toggleSelectAllGo(event: Event): void {
    const checked = !!(event?.target as HTMLInputElement)?.checked;
    if (checked) this.filteredGoStudents.forEach((s) => this.goSelectedIds.add(String(s._id)));
    else this.filteredGoStudents.forEach((s) => this.goSelectedIds.delete(String(s._id)));
  }

  clearGoSelections(): void {
    this.goSelectedIds.clear();
  }

  removeFromGo(student: any): void {
    const studentId = String(student?._id || '');
    if (!studentId) return;
    this.goRemovingIds.add(studentId);
    this.http.delete<any>(
      `${environment.apiUrl}/${this.activeGoApiPath}/${encodeURIComponent(studentId)}/remove`,
      { withCredentials: true }
    ).subscribe({
      next: (r) => {
        this.goRemovingIds.delete(studentId);
        this.notify.success(r?.message || 'Student moved back to Silver.');
        this.goStudents = this.goStudents.filter((s) => String(s?._id) !== studentId);
        this.goSelectedIds.delete(studentId);
        const removedStudent = r?.student;
        if (removedStudent?.subscription === 'SILVER') {
          const exists = this.silverStudents.some((s) => String(s._id) === String(removedStudent._id));
          if (!exists) this.silverStudents = [removedStudent, ...this.silverStudents];
        }
      },
      error: (e) => {
        this.goRemovingIds.delete(studentId);
        this.notify.error(e?.error?.message || 'Failed to move student to Silver.');
      }
    });
  }

  bulkRemoveBatchFromGo(): void {
    const studentIds = Array.from(this.goSelectedIds);
    if (!studentIds.length) {
      this.notify.error('Select at least one GO student.');
      return;
    }

    this.goBulkUpdating = true;
    this.http.post<any>(
      `${environment.apiUrl}/${this.activeGoApiPath}/bulk-remove-batch`,
      { studentIds },
      { withCredentials: true }
    ).subscribe({
      next: (r) => {
        const idSet = new Set(studentIds.map((id) => String(id)));
        this.goStudents = this.goStudents.map((s) =>
          idSet.has(String(s._id)) ? { ...s, batch: '' } : s
        );
        this.goBulkUpdating = false;
        this.goSelectedIds.clear();
        this.notify.success(r?.message || 'Batch removed for selected GO students.');
      },
      error: (e) => {
        this.goBulkUpdating = false;
        this.notify.error(e?.error?.message || 'Failed to remove batch for selected GO students.');
      }
    });
  }

  bulkSetGoDay(): void {
    const studentIds = Array.from(this.goSelectedIds);
    const day = Number(this.goBulkDay);
    if (!studentIds.length) {
      this.notify.error('Select at least one GO student.');
      return;
    }
    if (!Number.isFinite(day) || day < 1 || day > 200) {
      this.notify.error('Enter a valid day between 1 and 200.');
      return;
    }

    this.goBulkUpdating = true;
    this.http.post<any>(
      `${environment.apiUrl}/${this.activeGoApiPath}/bulk-set-day`,
      { studentIds, day: Math.floor(day) },
      { withCredentials: true }
    ).subscribe({
      next: (r) => {
        const targetDay = Math.floor(day);
        const idSet = new Set(studentIds.map((id) => String(id)));
        this.goStudents = this.goStudents.map((s) =>
          idSet.has(String(s._id)) ? { ...s, currentCourseDay: targetDay } : s
        );
        this.goBulkUpdating = false;
        this.goSelectedIds.clear();
        this.notify.success(r?.message || `Journey day set to ${targetDay}.`);
      },
      error: (e) => {
        this.goBulkUpdating = false;
        this.notify.error(e?.error?.message || 'Failed to set journey day for selected GO students.');
      }
    });
  }

  bulkSetGoBatch(): void {
    const studentIds = Array.from(this.goSelectedIds);
    const batch = String(this.goBulkBatch || '').trim();
    if (!studentIds.length) {
      this.notify.error('Select at least one GO student.');
      return;
    }
    if (!batch) {
      this.notify.error('Enter a batch name.');
      return;
    }

    this.goBulkUpdating = true;
    this.http.post<any>(
      `${environment.apiUrl}/${this.activeGoApiPath}/bulk-set-batch`,
      { studentIds, batch },
      { withCredentials: true }
    ).subscribe({
      next: (r) => {
        const idSet = new Set(studentIds.map((id) => String(id)));
        this.goStudents = this.goStudents.map((s) =>
          idSet.has(String(s._id)) ? { ...s, batch } : s
        );
        this.goBulkUpdating = false;
        this.goSelectedIds.clear();
        this.notify.success(r?.message || `Batch set to "${batch}".`);
      },
      error: (e) => {
        this.goBulkUpdating = false;
        this.notify.error(e?.error?.message || 'Failed to set batch for selected GO students.');
      }
    });
  }

  addGoStudentById(student: SilverStudentRow): void {
    if (!student?._id) return;
    if (!this.silverSelectedIds.has(student._id)) {
      this.notify.error('Select the checkbox first, then click Go.');
      return;
    }
    this.silverAddingIds.add(student._id);
    this.http.post<any>(
      `${environment.apiUrl}/${this.activeGoApiPath}/add`,
      { studentId: student._id },
      { withCredentials: true }
    ).subscribe({
      next: (r) => {
        this.silverAddingIds.delete(student._id);
        this.notify.success(r?.message || 'Student moved to GO batch.');
        this.afterGoStudentAdded(r?.student);
      },
      error: (e) => {
        this.silverAddingIds.delete(student._id);
        this.notify.error(e?.error?.message || 'Failed to move student to GO batch.');
      }
    });
  }

  bulkRemoveBatchFromSilver(): void {
    const studentIds = Array.from(this.silverSelectedIds);
    if (!studentIds.length) {
      this.notify.error('Select at least one student.');
      return;
    }

    this.silverBulkUpdating = true;
    this.http.post<any>(
      `${environment.apiUrl}/${this.activeGoApiPath}/silver/bulk-remove-batch`,
      { studentIds },
      { withCredentials: true }
    ).subscribe({
      next: (r) => {
        const idSet = new Set(studentIds.map((id) => String(id)));
        this.silverStudents = this.silverStudents.map((s) =>
          idSet.has(String(s._id)) ? { ...s, batch: '' } : s
        );
        this.silverBulkUpdating = false;
        this.silverSelectedIds.clear();
        this.notify.success(r?.message || 'Batch removed for selected students.');
      },
      error: (e) => {
        this.silverBulkUpdating = false;
        this.notify.error(e?.error?.message || 'Failed to remove batch for selected students.');
      }
    });
  }

  bulkSetSilverDay(): void {
    const studentIds = Array.from(this.silverSelectedIds);
    const day = Number(this.silverBulkDay);
    if (!studentIds.length) {
      this.notify.error('Select at least one student.');
      return;
    }
    if (!Number.isFinite(day) || day < 1 || day > 200) {
      this.notify.error('Enter a valid day between 1 and 200.');
      return;
    }

    this.silverBulkUpdating = true;
    this.http.post<any>(
      `${environment.apiUrl}/${this.activeGoApiPath}/silver/bulk-set-day`,
      { studentIds, day: Math.floor(day) },
      { withCredentials: true }
    ).subscribe({
      next: (r) => {
        const targetDay = Math.floor(day);
        const idSet = new Set(studentIds.map((id) => String(id)));
        this.silverStudents = this.silverStudents.map((s) =>
          idSet.has(String(s._id)) ? { ...s, currentCourseDay: targetDay } : s
        );
        this.silverBulkUpdating = false;
        this.silverSelectedIds.clear();
        this.notify.success(r?.message || `Journey day set to ${targetDay}.`);
      },
      error: (e) => {
        this.silverBulkUpdating = false;
        this.notify.error(e?.error?.message || 'Failed to set journey day for selected students.');
      }
    });
  }

  bulkSetSilverBatch(): void {
    const studentIds = Array.from(this.silverSelectedIds);
    const batch = String(this.silverBulkBatch || '').trim();
    if (!studentIds.length) {
      this.notify.error('Select at least one student.');
      return;
    }
    if (!batch) {
      this.notify.error('Enter a batch name.');
      return;
    }

    this.silverBulkUpdating = true;
    this.http.post<any>(
      `${environment.apiUrl}/${this.activeGoApiPath}/silver/bulk-set-batch`,
      { studentIds, batch },
      { withCredentials: true }
    ).subscribe({
      next: (r) => {
        const idSet = new Set(studentIds.map((id) => String(id)));
        this.silverStudents = this.silverStudents.map((s) =>
          idSet.has(String(s._id)) ? { ...s, batch } : s
        );
        this.silverBulkUpdating = false;
        this.silverSelectedIds.clear();
        this.notify.success(r?.message || `Batch set to "${batch}".`);
      },
      error: (e) => {
        this.silverBulkUpdating = false;
        this.notify.error(e?.error?.message || 'Failed to set batch for selected students.');
      }
    });
  }

  private afterGoStudentAdded(student: any): void {
    if (!student?._id) return;
    this.goStudents = [student, ...this.goStudents.filter((s) => String(s?._id) !== String(student._id))];
    this.silverStudents = this.silverStudents.filter((s) => String(s._id) !== String(student._id));
    this.silverSelectedIds.delete(String(student._id));
  }

  openGoStudentDetail(student: any): void {
    const queryParams =
      this.planTab === 'silver-sinhala' ? { track: 'sinhala' } : {};
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/admin/journey/go', student._id], { queryParams })
    );
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  private loadTeachers(): void {
    this.teachersLoading = true;
    this.http.get<any>(`${this.adminUrl}/teachers`, { withCredentials: true }).subscribe({
      next: (r) => {
        this.teachers = (r?.data || []).map((t: any) => ({
          _id: t._id,
          name: t.name,
          email: t.email,
          role: t.role,
          studentCount: t.studentCount || 0
        }));
        this.teachersLoading = false;
      },
      error: (e) => {
        console.error(e);
        this.teachersLoading = false;
        this.notify.error('Failed to load teachers.');
      }
    });
  }

  assignTeacherToBatch(): void {
    if (!this.assignBatchName || !this.selectedTeacherId) return;
    this.assigningTeacher = true;
    this.http.post<any>(
      `${this.apiUrl}/${encodeURIComponent(this.assignBatchName)}/assign-teacher`,
      { teacherId: this.selectedTeacherId },
      { withCredentials: true }
    ).subscribe({
      next: (r) => {
        const teacherName = r?.teacher?.name || null;
        const teacherId = r?.teacher?._id || this.selectedTeacherId;
        const idx = this.batches.findIndex(x => x.batchName === this.assignBatchName);
        if (idx >= 0) {
          this.batches[idx].teacherName = teacherName;
          this.batches[idx].teacherId = teacherId;
        }
        if (this.selectedBatch?.batchName === this.assignBatchName) {
          this.selectedBatch.teacherName = teacherName;
          this.selectedBatch.teacherId = teacherId;
        }
        this.assigningTeacher = false;
        this.notify.success(r?.message || 'Teacher assigned.');
        this.closeAssignTeacher();
      },
      error: (e) => {
        console.error(e);
        this.assigningTeacher = false;
        this.notify.error(e?.error?.message || 'Failed to assign teacher.');
      }
    });
  }

  createBatch(): void {
    const name = String(this.newBatchName || '').trim();
    if (!name) {
      this.notify.error('Please enter a batch name.');
      return;
    }
    const existsLocal = this.batches.some(b => String(b.batchName || '').trim().toLowerCase() === name.toLowerCase());
    if (existsLocal) {
      this.notify.error(`Batch "${name}" already exists.`);
      return;
    }
    const len = Math.max(1, Math.min(200, Number(this.newJourneyLength || 200)));
    this.creatingBatch = true;
    this.http.put<any>(
      `${this.apiUrl}/${encodeURIComponent(name)}`,
      { journeyLength: len, batchCurrentDay: 1, createOnly: true },
      { withCredentials: true }
    ).subscribe({
      next: () => {
        this.notify.success(`Batch "${name}" created.`);
        this.closeCreateBatch();
        this.loadBatches();
      },
      error: (err) => {
        console.error('Create batch failed', err);
        this.creatingBatch = false;
        if (err?.status === 409) {
          this.notify.error(`Batch "${name}" already exists.`);
        } else {
          this.notify.error('Failed to create batch.');
        }
      }
    });
  }

  /** Filtered & sorted batch overview rows */
  get filteredBatches(): BatchSummary[] {
    let list = [...this.batches];
    const q = this.batchSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(b => {
        const batch = String(b.batchName).toLowerCase().includes(q);
        const teacher = String(b.teacherName || '').toLowerCase().includes(q);
        return batch || teacher;
      });
    }
    if (this.filterDayMin != null && !isNaN(this.filterDayMin)) {
      list = list.filter(b => b.batchCurrentDay >= this.filterDayMin!);
    }
    if (this.filterDayMax != null && !isNaN(this.filterDayMax)) {
      list = list.filter(b => b.batchCurrentDay <= this.filterDayMax!);
    }
    if (this.filterStudentsMin != null && !isNaN(this.filterStudentsMin)) {
      list = list.filter(b => b.studentCount >= this.filterStudentsMin!);
    }
    if (this.filterJourneyMin != null && !isNaN(this.filterJourneyMin)) {
      list = list.filter(b => b.journeyLength >= this.filterJourneyMin!);
    }
    if (this.filterBatchType === 'new') {
      list = list.filter(b => (b.studentCount || 0) === 0);
    } else if (this.filterBatchType === 'existing') {
      list = list.filter(b => (b.studentCount || 0) > 0);
    }

    list.sort((a, b) => {
      switch (this.batchSort) {
        case 'name':
          return String(a.batchName).localeCompare(String(b.batchName), undefined, { numeric: true });
        case 'nameDesc':
          return String(b.batchName).localeCompare(String(a.batchName), undefined, { numeric: true });
        case 'day':
          return a.batchCurrentDay - b.batchCurrentDay;
        case 'dayDesc':
          return b.batchCurrentDay - a.batchCurrentDay;
        case 'students':
          return b.studentCount - a.studentCount;
        case 'length':
          return b.journeyLength - a.journeyLength;
        default:
          return 0;
      }
    });
    return list;
  }

  hasActiveBatchFilters(): boolean {
    return !!(
      this.batchSearch.trim() ||
      (this.filterDayMin != null && !isNaN(this.filterDayMin)) ||
      (this.filterDayMax != null && !isNaN(this.filterDayMax)) ||
      (this.filterStudentsMin != null && !isNaN(this.filterStudentsMin)) ||
      (this.filterJourneyMin != null && !isNaN(this.filterJourneyMin)) ||
      this.filterBatchType !== 'all'
    );
  }

  clearBatchFilters(): void {
    this.batchSearch = '';
    this.filterDayMin = null;
    this.filterDayMax = null;
    this.filterStudentsMin = null;
    this.filterJourneyMin = null;
    this.filterBatchType = 'all';
  }

  trackBatch(_index: number, b: BatchSummary): string {
    return b.batchName;
  }

  ngOnInit(): void {
    this.authService.currentUser$.subscribe((u) => {
      this.isJourneyReadOnly = u?.role === 'TEACHER';
    });
    this.initProgressChartOptions();
    this.loadBatches();
  }

  loadBatches(): void {
    this.loading = true;
    this.http
      .get<{ batches: BatchSummary[]; upcomingBatches?: BatchSummary[] }>(this.apiUrl, { withCredentials: true })
      .subscribe({
        next: (r) => {
          this.batches = r.batches || [];
          this.upcomingBatches = r.upcomingBatches || [];
          this.loading = false;
          this.tryOpenBatchFromQuery();
        },
        error: (e) => {
          console.error(e);
          this.loading = false;
        }
      });
  }

  /** Deep-link from Performance or bookmarks: /admin/journey?batch=BatchName */
  private tryOpenBatchFromQuery(): void {
    const raw = this.route.snapshot.queryParamMap.get('batch');
    const tab = (this.route.snapshot.queryParamMap.get('tab') || '').trim().toLowerCase();
    this.progressOnlyMode = this.route.snapshot.queryParamMap.get('progressOnly') === '1';
    if (!raw) return;
    const q = raw.trim();
    if (!q) return;
    const lower = q.toLowerCase();
    const match = this.batches.find((b) => String(b.batchName || '').toLowerCase() === lower);
    if (match) {
      this.openBatch(match);
      if (this.progressOnlyMode || tab === 'progress') {
        setTimeout(() => this.openProgress(), 0);
      }
    }
  }

  openAllStudentsPage(): void {
    this.router.navigate(['/admin/journey/all-students']);
  }

  openWeeklyStudentDetails(week: number): void {
    const batchName = String(this.selectedBatch?.batchName || '').trim();
    if (!batchName || !Number.isFinite(week) || week < 1) return;
    this.router.navigate(['/admin/journey/weekly-students'], {
      queryParams: {
        batch: batchName,
        week
      }
    });
  }

  startJourneyForSelected(): void {
    const name = String(this.selectedUpcomingBatch || '').trim();
    if (!name) {
      this.notify.error('Select a batch first.');
      return;
    }
    this.startingJourney = true;
    this.http
      .post<any>(`${this.apiUrl}/${encodeURIComponent(name)}/journey-activate`, {}, { withCredentials: true })
      .subscribe({
        next: (r) => {
          this.startingJourney = false;
          this.selectedUpcomingBatch = '';
          this.notify.success(r?.message || 'Journey started.');
          this.loadBatches();
        },
        error: (e) => {
          this.startingJourney = false;
          this.notify.error(e?.error?.message || 'Failed to start journey.');
        }
      });
  }

  removeBatchFromActiveJourney(b: BatchSummary): void {
    const name = b.batchName;
    this.notify
      .confirm(
        'Remove from active list',
        `"${name}" will disappear from this table. Students and batch data are not deleted. Continue?`,
        'Remove',
        'Cancel'
      )
      .subscribe((ok) => {
        if (!ok) return;
        this.removingJourneyBatch = name;
        this.http
          .post<any>(`${this.apiUrl}/${encodeURIComponent(name)}/journey-deactivate`, {}, { withCredentials: true })
          .subscribe({
            next: (r) => {
              this.removingJourneyBatch = null;
              this.notify.success(r?.message || 'Removed from active journeys.');
              if (this.selectedBatch?.batchName === name) {
                this.closeBatch();
              } else {
                this.loadBatches();
              }
            },
            error: (e) => {
              this.removingJourneyBatch = null;
              this.notify.error(e?.error?.message || 'Failed to remove from list.');
            }
          });
      });
  }

  /** Days elapsed since editBatchStartDate (0 if today = start date) */
  daysSinceStart(): number {
    if (!this.editBatchStartDate) return 0;
    const today = new Date();
    const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const parts = this.editBatchStartDate.split('-').map(Number);
    const startUTC = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    return Math.max(0, Math.floor((todayUTC - startUTC) / 86_400_000));
  }

  computedDayFromDate(): number {
    return Math.min(this.editJourneyLength, Math.max(1, this.daysSinceStart() + 1));
  }

  clearStartDate(): void {
    this.editBatchStartDate = '';
  }

  openBatch(b: BatchSummary): void {
    this.selectedBatch = { ...b };
    this.editJourneyLength = b.journeyLength;
    this.editBatchDay = b.batchCurrentDay;
    this.editBatchStartDate = b.batchStartDate
      ? new Date(b.batchStartDate).toISOString().slice(0, 10)
      : '';
    this.editNotes = b.notes;
    this.editBatchType = b.batchType === 'old' ? 'old' : 'new';
    this.editOldBatchDgBotAccess = !!b.oldBatchDgBotAccess;
    this.editStrictJourneyRule = !!b.strictJourneyRule;
    this.editStrictThresholdPercent =
      b.strictJourneyThresholdPercent != null ? b.strictJourneyThresholdPercent : 100;
    this.editAutoRecordingEnabled = !!b.autoRecordingEnabled;
    this.activeTab = 'students';
    this.batchStudents = [];
    this.studentsLoadedForBatch = null;
    this.timelineDays = [];
    this.batchProgress = null;
    this.progressChartsWeek = 1;
    this.progressOverallLoaded = false;
    this.progressDetailLoaded = false;
    this.loadingProgressOverall = false;
    this.loadingProgressDetail = false;
    this.clearProgressWeeklyCharts();
    this.resetProgressDayUi();
    // Paint batch header/settings first, then load the students table (faster perceived load)
    const bn = b.batchName;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.selectedBatch?.batchName === bn && this.activeTab === 'students') {
          this.loadStudents(bn);
        }
      });
    });
  }

  closeBatch(): void {
    this.selectedBatch = null;
    this.batchStudents = [];
    this.timelineDays = [];
    this.batchProgress = null;
    this.studentsLoadedForBatch = null;
    this.progressOverallLoaded = false;
    this.progressDetailLoaded = false;
    this.loadingProgressOverall = false;
    this.loadingProgressDetail = false;
    this.clearProgressWeeklyCharts();
    this.resetProgressDayUi();
    this.loadBatches();
  }

  private resetProgressDayUi(): void {
    this.expandedProgressDay = null;
    this.dayDetail = null;
    this.dayDetailLoading = false;
    this.dayDetailError = '';
    this.showExerciseAnalyticsModal = false;
    this.exerciseAnalytics = null;
    this.exerciseAnalyticsLoading = false;
    this.exerciseAnalyticsDay = null;
    this.showClassAnalyticsModal = false;
    this.classAnalyticsDetail = null;
    this.classAnalyticsLoading = false;
    this.classAnalyticsDay = null;
  }

  loadStudents(batchName: string): void {
    this.loadingStudents = true;
    this.http.get<any>(`${this.apiUrl}/${encodeURIComponent(batchName)}/students`, { withCredentials: true }).subscribe({
      next: r => {
        if (this.selectedBatch && this.selectedBatch.batchName === batchName && r?.teacher) {
          this.selectedBatch.teacherName = r.teacher.teacherName ?? this.selectedBatch.teacherName ?? null;
          this.selectedBatch.teacherId = r.teacher.teacherId ?? this.selectedBatch.teacherId ?? null;
        }
        this.batchStudents = (r.students || []).map((s: any) => ({
          ...s,
          editDay: s.currentCourseDay,
          enrollmentDate: s.enrollmentDate || null,
          accountCreatedAt: s.accountCreatedAt || null
        }));
        if (this.selectedBatch?.batchName === batchName && r.config) {
          this.editStrictJourneyRule = !!r.config.strictJourneyRule;
          this.editStrictThresholdPercent =
            r.config.strictJourneyThresholdPercent != null ? r.config.strictJourneyThresholdPercent : 100;
          this.selectedBatch.strictJourneyRule = this.editStrictJourneyRule;
          this.selectedBatch.strictJourneyThresholdPercent = this.editStrictThresholdPercent;
          this.editAutoRecordingEnabled = !!r.config.autoRecordingEnabled;
          this.selectedBatch.autoRecordingEnabled = this.editAutoRecordingEnabled;
          this.editBatchType = r.config.batchType === 'old' ? 'old' : 'new';
          this.selectedBatch.batchType = this.editBatchType;
          this.editOldBatchDgBotAccess = !!r.config.oldBatchDgBotAccess;
          this.selectedBatch.oldBatchDgBotAccess = this.editOldBatchDgBotAccess;
        }
        if (this.selectedBatch?.batchName === batchName) {
          this.studentsLoadedForBatch = batchName;
        }
        this.loadingStudents = false;
      },
      error: e => { console.error(e); this.loadingStudents = false; }
    });
  }

  saveConfig(): void {
    if (!this.selectedBatch) return;
    if (this.editStrictJourneyRule) {
      const p = Number(this.editStrictThresholdPercent);
      if (!Number.isFinite(p) || p < 1 || p > 100) {
        this.notify.error('Enter a strict rule percentage between 1 and 100.');
        return;
      }
    }
    this.savingConfig = true;
    const payload = this.buildConfigPayload();
    this.http.put<any>(`${this.apiUrl}/${encodeURIComponent(this.selectedBatch.batchName)}`,
      payload, { withCredentials: true }).subscribe({
      next: r => {
        this.syncSelectedBatchConfig(r?.config);
        this.savingConfig = false;
        this.notify.success('Batch config saved.');
      },
      error: e => { console.error(e); this.savingConfig = false; this.notify.error('Failed to save config.'); }
    });
  }

  applyDayToAllStudents(): void {
    if (!this.selectedBatch) return;
    const day = this.editBatchStartDate ? this.computedDayFromDate() : this.editBatchDay;
    this.notify.confirm('Apply Day', `Set ALL students in "${this.selectedBatch.batchName}" to Day ${day}?`).subscribe(ok => {
      if (!ok) return;
      this.applyingDay = true;
      const payload = this.buildConfigPayload();
      // Persist settings first so date/type edits aren't lost when users click only "Apply Day".
      this.http.put<any>(
        `${this.apiUrl}/${encodeURIComponent(this.selectedBatch!.batchName)}`,
        payload,
        { withCredentials: true }
      ).subscribe({
        next: saveResp => {
          this.syncSelectedBatchConfig(saveResp?.config);
          this.http.post<any>(`${this.apiUrl}/${encodeURIComponent(this.selectedBatch!.batchName)}/set-day`,
            { day }, { withCredentials: true }).subscribe({
            next: r => {
              this.selectedBatch!.batchCurrentDay = day;
              this.notify.success(`${r.message} (${r.studentsUpdated} student(s) updated)`);
              this.applyingDay = false;
              this.loadStudents(this.selectedBatch!.batchName);
            },
            error: e => { console.error(e); this.applyingDay = false; this.notify.error('Failed to apply day.'); }
          });
        },
        error: e => {
          console.error(e);
          this.applyingDay = false;
          this.notify.error('Failed to save batch config before applying day.');
        }
      });
    });
  }

  private buildConfigPayload(): any {
    return {
      journeyLength: this.editJourneyLength,
      batchCurrentDay: this.editBatchDay,
      batchStartDate: this.editBatchStartDate || null,
      notes: this.editNotes,
      batchType: this.editBatchType,
      oldBatchDgBotAccess: this.editBatchType === 'old' ? !!this.editOldBatchDgBotAccess : false,
      strictJourneyRule: this.editStrictJourneyRule,
      strictJourneyThresholdPercent: this.editStrictThresholdPercent,
      autoRecordingEnabled: this.editAutoRecordingEnabled
    };
  }

  private syncSelectedBatchConfig(config: any): void {
    if (!this.selectedBatch || !config) return;
    this.selectedBatch.journeyLength = config.journeyLength;
    this.selectedBatch.batchCurrentDay = config.batchCurrentDay;
    this.selectedBatch.batchStartDate = config.batchStartDate || null;
    this.selectedBatch.autoDay = !!config.batchStartDate;
    this.selectedBatch.notes = config.notes;
    this.selectedBatch.batchType = config.batchType === 'old' ? 'old' : 'new';
    this.selectedBatch.strictJourneyRule = !!config.strictJourneyRule;
    this.selectedBatch.strictJourneyThresholdPercent =
      config.strictJourneyThresholdPercent != null ? config.strictJourneyThresholdPercent : 100;
    this.editStrictJourneyRule = !!config.strictJourneyRule;
    this.editBatchType = config.batchType === 'old' ? 'old' : 'new';
    this.editOldBatchDgBotAccess = !!config.oldBatchDgBotAccess;
    this.selectedBatch.oldBatchDgBotAccess = this.editOldBatchDgBotAccess;
    this.editStrictThresholdPercent =
      config.strictJourneyThresholdPercent != null ? config.strictJourneyThresholdPercent : 100;
    this.editAutoRecordingEnabled = !!config.autoRecordingEnabled;
    this.selectedBatch.autoRecordingEnabled = this.editAutoRecordingEnabled;
  }

  onBatchTypeChange(): void {
    if (this.editBatchType !== 'old') {
      this.editOldBatchDgBotAccess = false;
    }
  }

  setStudentDay(s: StudentRow): void {
    if (!s.editDay || s.editDay < 1) return;
    s.saving = true;
    this.http.patch<any>(`${this.apiUrl}/student/${s._id}/day`, { day: s.editDay }, { withCredentials: true }).subscribe({
      next: r => {
        s.currentCourseDay = r.student.currentCourseDay;
        s.editDay = r.student.currentCourseDay;
        s.saving = false;
        s.taskStatus = null;
        this.notify.success(`Set to Day ${r.student.currentCourseDay}.`);
      },
      error: e => { console.error(e); s.saving = false; this.notify.error('Failed to update student day.'); }
    });
  }

  checkStudentTasks(s: StudentRow): void {
    s.checkingTasks = true;
    s.taskStatus = null;
    this.http.get<any>(`${this.apiUrl}/student/${s._id}/day-status`, { withCredentials: true }).subscribe({
      next: r => {
        const incomplete = (r.incompleteTasks || []) as IncompleteTaskItem[];
        s.taskStatus = {
          complete: r.complete,
          breakdown: r.breakdown,
          incompleteTasks: incomplete
        };
        s.checkingTasks = false;
        this.openTaskModalFromResponse(s._id, s.name, r.currentDay ?? s.currentCourseDay, r.complete, incomplete, {
          completionPercent: r.completionPercent,
          totalTasks: r.totalTasks,
          doneTasks: r.doneTasks,
          strictJourneyRule: r.strictJourneyRule,
          strictJourneyThresholdPercent: r.strictJourneyThresholdPercent,
          thresholdMet: r.thresholdMet
        });
      },
      error: e => {
        console.error(e);
        s.checkingTasks = false;
        this.notify.error('Failed to check task status.');
      }
    });
  }

  openTaskModalFromResponse(
    studentId: string,
    studentName: string,
    currentDay: number,
    complete: boolean,
    incompleteTasks: IncompleteTaskItem[],
    extra?: Partial<TaskCheckModal>
  ): void {
    this.taskModal = {
      studentId,
      studentName,
      currentDay,
      complete,
      incompleteTasks: incompleteTasks || [],
      ...extra
    };
  }

  openTaskModalForStudent(s: StudentRow): void {
    if (!s.taskStatus) return;
    this.openTaskModalFromResponse(
      s._id,
      s.name,
      s.currentCourseDay,
      s.taskStatus.complete,
      s.taskStatus.incompleteTasks || []
    );
  }

  onStrictJourneyToggle(): void {
    if (this.editStrictJourneyRule) {
      const p = Number(this.editStrictThresholdPercent);
      if (!Number.isFinite(p) || p < 1 || p > 100) {
        this.editStrictThresholdPercent = 100;
      }
    }
  }

  closeTaskModal(): void {
    this.taskModal = null;
  }

  refreshTaskModal(): void {
    if (!this.taskModal?.studentId) return;
    const s = this.batchStudents.find(x => x._id === this.taskModal!.studentId);
    if (s) this.checkStudentTasks(s);
  }

  /** When the row has a valid day in the input that differs from current, the arrow applies that day (admin override). */
  advanceArrowHasJumpTarget(s: StudentRow): boolean {
    if (!this.selectedBatch) return false;
    const t = this.parsedEditDay(s);
    if (t == null) return false;
    return t !== s.currentCourseDay;
  }

  advanceArrowTitle(s: StudentRow): string {
    const t = this.parsedEditDay(s);
    if (t != null && t !== s.currentCourseDay) {
      return `Set journey day to ${t}`;
    }
    if (!this.editStrictJourneyRule) {
      return 'Advance to next day';
    }
    const thr = this.editStrictThresholdPercent ?? 100;
    return s.taskStatus?.complete
      ? 'Advance to next day'
      : `Advance if day tasks meet ≥ ${thr}% (or use force)`;
  }

  private parsedEditDay(s: StudentRow): number | null {
    if (!this.selectedBatch) return null;
    const max = this.selectedBatch.journeyLength;
    const raw = s.editDay as unknown;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 1 || n > max) return null;
    return n;
  }

  advanceStudentDay(s: StudentRow, force = false): void {
    if (!this.selectedBatch) return;
    const maxDay = this.selectedBatch.journeyLength;
    const jumpTo = this.parsedEditDay(s);
    if (jumpTo != null && jumpTo !== s.currentCourseDay) {
      this.notify.confirm(
        'Set journey day',
        `Set ${s.name} to Day ${jumpTo}? Their scheduled content will follow this day (admin override).`,
        'Set day',
        'Cancel'
      ).subscribe(ok => {
        if (ok) this.setStudentDay(s);
      });
      return;
    }
    if (s.currentCourseDay >= maxDay) return;
    if (force) {
      this.notify.confirm('Force Advance', `Force-advance ${s.name} to Day ${s.currentCourseDay + 1} even though tasks are not completed?`, 'Yes, Force', 'Cancel').subscribe(ok => {
        if (ok) this._doAdvanceStudentDay(s, true);
      });
      return;
    }
    this._doAdvanceStudentDay(s, false);
  }

  _doAdvanceStudentDay(s: StudentRow, force: boolean): void {
    s.advancing = true;
    this.http.post<any>(`${this.apiUrl}/student/${s._id}/advance-day`, { force }, { withCredentials: true }).subscribe({
      next: r => {
        s.advancing = false;
        if (r.advanced) {
          s.currentCourseDay = r.currentDay;
          s.editDay = r.currentDay;
          s.taskStatus = null;
          this.closeTaskModal();
        } else {
          const incomplete = (r.incompleteTasks || []) as IncompleteTaskItem[];
          s.taskStatus = { complete: false, breakdown: r.breakdown, incompleteTasks: incomplete };
          this.openTaskModalFromResponse(s._id, s.name, r.currentDay ?? s.currentCourseDay, false, incomplete, {
            completionPercent: r.completionPercent,
            totalTasks: r.totalTasks,
            doneTasks: r.doneTasks,
            strictJourneyRule: this.editStrictJourneyRule,
            strictJourneyThresholdPercent: this.editStrictThresholdPercent
          });
        }
      },
      error: e => {
        s.advancing = false;
        console.error(e);
        this.notify.error(e?.error?.message || 'Failed to advance student day.');
      }
    });
  }

  openTimeline(): void {
    this.activeTab = 'timeline';
    if (!this.selectedBatch || this.timelineDays.length) return;
    const batchName = this.selectedBatch.batchName;
    this.loadingTimeline = true;
    queueMicrotask(() => {
      if (!this.selectedBatch || this.selectedBatch.batchName !== batchName) {
        this.loadingTimeline = false;
        return;
      }
      this.http.get<any>(`${this.apiUrl}/${encodeURIComponent(batchName)}/timeline`, { withCredentials: true }).subscribe({
        next: r => {
          if (this.selectedBatch?.batchName !== batchName) {
            this.loadingTimeline = false;
            return;
          }
          this.timelineDays = r.days || [];
          this.loadingTimeline = false;
        },
        error: e => {
          console.error(e);
          this.loadingTimeline = false;
        }
      });
    });
  }

  scrollToDay(day: number | null): void {
    if (!day) return;
    const el = document.getElementById(`day-${day}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else this.notify.info(`No content found for Day ${day}.`);
  }

  openStudentsTab(): void {
    this.activeTab = 'students';
    if (!this.selectedBatch) return;
    if (this.studentsLoadedForBatch !== this.selectedBatch.batchName) {
      this.loadStudents(this.selectedBatch.batchName);
    }
  }

  // ── Progress tab methods ────────────────────────────────────────────────────

  openProgress(): void {
    this.activeTab = 'progress';
    if (!this.selectedBatch) return;
    if (!this.progressOverallLoaded) {
      this.loadProgressOverall();
      return;
    }
    if ((this.progressView === 'daily' || this.progressView === 'weekly') && !this.progressDetailLoaded) {
      this.loadProgressDetail();
    } else if (this.progressView === 'weekly' && this.progressDetailLoaded) {
      this.rebuildProgressWeeklyCharts();
    }
  }

  /** Full reload (all sections) — e.g. Refresh button */
  loadBatchProgress(): void {
    if (!this.selectedBatch) return;
    const batchName = this.selectedBatch.batchName;
    this.loadingProgressOverall = true;
    this.loadingProgressDetail = false;
    this.batchProgress = null;
    this.progressOverallLoaded = false;
    this.progressDetailLoaded = false;
    this.clearProgressWeeklyCharts();
    this.resetProgressDayUi();
    queueMicrotask(() => {
      if (!this.selectedBatch || this.selectedBatch.batchName !== batchName) {
        this.loadingProgressOverall = false;
        return;
      }
      this.http
        .get<any>(`${this.apiUrl}/${encodeURIComponent(batchName)}/progress`, { withCredentials: true })
        .subscribe({
          next: (r) => {
            if (!this.selectedBatch || this.selectedBatch.batchName !== batchName) {
              this.loadingProgressOverall = false;
              return;
            }
            this.batchProgress = r;
            this.progressOverallLoaded = true;
            this.progressDetailLoaded = true;
            this.loadingProgressOverall = false;
            this.ensureProgressChartsWeekInRange();
            if (this.progressView === 'weekly') this.rebuildProgressWeeklyCharts();
          },
          error: (e) => {
            console.error(e);
            this.loadingProgressOverall = false;
            if (this.selectedBatch?.batchName === batchName) {
              this.notify.error('Failed to load progress data.');
            }
          }
        });
    });
  }

  private loadProgressOverall(): void {
    if (!this.selectedBatch) return;
    const batchName = this.selectedBatch.batchName;
    this.loadingProgressOverall = true;
    queueMicrotask(() => {
      if (!this.selectedBatch || this.selectedBatch.batchName !== batchName) {
        this.loadingProgressOverall = false;
        return;
      }
      const url = `${this.apiUrl}/${encodeURIComponent(batchName)}/progress`;
      this.http
        .get<any>(url, { params: { sections: 'overall' }, withCredentials: true })
        .subscribe({
          next: (r) => {
            if (!this.selectedBatch || this.selectedBatch.batchName !== batchName) {
              this.loadingProgressOverall = false;
              return;
            }
            this.batchProgress = {
              overall: r.overall,
              students: r.students || [],
              daily: [],
              weekly: []
            };
            this.progressOverallLoaded = true;
            this.progressDetailLoaded = false;
            this.loadingProgressOverall = false;
            if (this.progressView === 'daily' || this.progressView === 'weekly') {
              this.loadProgressDetail();
            }
          },
          error: (e) => {
            console.error(e);
            this.loadingProgressOverall = false;
            if (this.selectedBatch?.batchName === batchName) {
              this.notify.error('Failed to load progress data.');
            }
          }
        });
    });
  }

  private loadProgressDetail(): void {
    if (!this.selectedBatch || !this.batchProgress) return;
    if (this.progressDetailLoaded) {
      if (this.progressView === 'weekly') this.rebuildProgressWeeklyCharts();
      return;
    }
    const batchName = this.selectedBatch.batchName;
    this.loadingProgressDetail = true;
    const url = `${this.apiUrl}/${encodeURIComponent(batchName)}/progress`;
    this.http
      .get<any>(url, { params: { sections: 'daily' }, withCredentials: true })
      .subscribe({
        next: (r) => {
          if (!this.selectedBatch || this.selectedBatch.batchName !== batchName) {
            this.loadingProgressDetail = false;
            return;
          }
          this.batchProgress = {
            ...this.batchProgress,
            daily: r.daily || [],
            weekly: r.weekly || []
          };
          this.progressDetailLoaded = true;
          this.loadingProgressDetail = false;
          this.ensureProgressChartsWeekInRange();
          if (this.progressView === 'weekly') this.rebuildProgressWeeklyCharts();
        },
        error: (e) => {
          console.error(e);
          this.loadingProgressDetail = false;
          if (this.selectedBatch?.batchName === batchName) {
            this.notify.error('Failed to load daily or weekly progress.');
          }
        }
      });
  }

  onProgressViewChange(v: 'overall' | 'daily' | 'weekly'): void {
    this.progressView = v;
    if (v === 'daily' || v === 'weekly') {
      this.loadProgressDetail();
    }
  }

  selectProgressWeek(w: number): void {
    this.progressChartsWeek = w;
    this.rebuildProgressWeeklyCharts();
  }

  private clearProgressWeeklyCharts(): void {
    this.jpWeekLiveData = null;
    this.jpWeekModuleData = null;
    this.jpWeekExerciseData = null;
  }

  private ensureProgressChartsWeekInRange(): void {
    const weeks = (this.batchProgress?.weekly || []).map((x: any) => x.week as number);
    if (!weeks.length) {
      this.progressChartsWeek = 1;
      return;
    }
    if (!weeks.includes(this.progressChartsWeek)) {
      this.progressChartsWeek = weeks[0];
    }
  }

  /** Daily rows for the selected progressChartsWeek (Days 1–7, 8–14, …) */
  getDailyRowsForProgressWeek(): any[] {
    const start = (this.progressChartsWeek - 1) * 7 + 1;
    const end = this.progressChartsWeek * 7;
    return (this.progressDaily || []).filter((d: any) => d.day >= start && d.day <= end);
  }

  private initProgressChartOptions(): void {
    const titleFont = { size: 13, weight: 'bold' as const };
    const axisColor = '#64748b';
    const gridColor = 'rgba(148, 163, 184, 0.15)';

    this.jpWeekLiveOpts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: axisColor } },
        title: {
          display: true,
          text: 'Students reached vs joined live (unique)',
          font: titleFont,
          color: '#0f172a',
          padding: { bottom: 8 }
        },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i == null) return [];
              const row = this.getDailyRowsForProgressWeek()[i];
              if (!row) return [];
              const reached = row.studentsCompleted ?? 0;
              const joined = this.weekLiveUniqueJoined(row);
              if (!reached) return ['No students at this day yet'];
              const pct = Math.round((100 * joined) / reached);
              return [`Join rate: ${joined} / ${reached} (${pct}%)`];
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: axisColor, maxRotation: 45, minRotation: 0 } },
        y: { beginAtZero: true, ticks: { stepSize: 1, color: axisColor }, grid: { color: gridColor }, title: { display: true, text: 'Students', color: axisColor, font: { size: 11 } } }
      }
    };

    this.jpWeekModuleOpts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: axisColor } },
        title: {
          display: true,
          text: 'Module slots: completed vs not done',
          font: titleFont,
          color: '#0f172a',
          padding: { bottom: 8 }
        },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i == null) return [];
              const row = this.getDailyRowsForProgressWeek()[i];
              if (!row) return [];
              const tot = this.weekModuleTotal(row);
              const done = this.weekModuleFilled(row);
              if (!tot) return ['No modules scheduled this day'];
              return [`Batch completion: ${row.moduleCompletionPercent ?? 0}% · ${done} / ${tot} slots`];
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: axisColor, maxRotation: 45, minRotation: 0 } },
        y: { beginAtZero: true, ticks: { stepSize: 1, color: axisColor }, grid: { color: gridColor }, title: { display: true, text: 'Student × module slots', color: axisColor, font: { size: 11 } } }
      }
    };

    this.jpWeekExerciseOpts = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: axisColor } },
        title: {
          display: true,
          text: 'Exercise slots: done vs not done · orange line = avg score',
          font: titleFont,
          color: '#0f172a',
          padding: { bottom: 8 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const y = ctx.parsed.y;
              const id = (ctx.dataset as { yAxisID?: string }).yAxisID;
              if (id === 'y1') return `${ctx.dataset.label}: ${y}%`;
              return `${ctx.dataset.label}: ${y}`;
            },
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i == null) return [];
              const row = this.getDailyRowsForProgressWeek()[i];
              if (!row) return [];
              const tot = this.weekExerciseTotal(row);
              const done = this.weekExerciseFilled(row);
              if (!tot) return ['No exercises scheduled this day'];
              return [`Batch completion: ${row.exerciseCompletionPercent ?? 0}% · ${done} / ${tot} slots · Avg score: ${row.avgScore ?? 0}%`];
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: axisColor, maxRotation: 45, minRotation: 0 } },
        y: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { color: axisColor, stepSize: 1 },
          title: { display: true, text: 'Exercise slots', color: axisColor, font: { size: 11 } }
        },
        y1: {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: { color: axisColor, callback: (v: string | number) => `${v}%` },
          title: { display: true, text: 'Avg score', color: axisColor, font: { size: 11 } }
        }
      }
    } as ChartConfiguration<'bar'>['options'];
  }

  private weekNStud(): number {
    return this.progressOverall?.totalStudents ?? 0;
  }

  private weekExerciseFilled(d: any): number {
    if (d.exerciseSlotsFilled != null) return d.exerciseSlotsFilled;
    const n = this.weekNStud();
    const ex = d.exerciseCount ?? 0;
    if (!n || !ex) return 0;
    return Math.round(((d.exerciseCompletionPercent ?? 0) / 100) * n * ex);
  }

  private weekExerciseTotal(d: any): number {
    if (d.exerciseSlotsTotal != null) return d.exerciseSlotsTotal;
    return (d.exerciseCount ?? 0) * this.weekNStud();
  }

  private weekModuleFilled(d: any): number {
    if (d.moduleSlotsFilled != null) return d.moduleSlotsFilled;
    const n = this.weekNStud();
    const m = d.moduleCount ?? 0;
    if (!n || !m) return 0;
    return Math.round(((d.moduleCompletionPercent ?? 0) / 100) * n * m);
  }

  private weekModuleTotal(d: any): number {
    if (d.moduleSlotsTotal != null) return d.moduleSlotsTotal;
    return (d.moduleCount ?? 0) * this.weekNStud();
  }

  private weekLiveUniqueJoined(d: any): number {
    if (d.liveUniqueJoined != null) return d.liveUniqueJoined;
    const att = d.classesAttended ?? 0;
    const reached = d.studentsCompleted ?? 0;
    return Math.min(att, reached);
  }

  rebuildProgressWeeklyCharts(): void {
    const rows = this.getDailyRowsForProgressWeek();
    if (!rows.length) {
      this.clearProgressWeeklyCharts();
      return;
    }
    const labels = rows.map((d: any) => `Day ${d.day}`);

    this.jpWeekLiveData = {
      labels,
      datasets: [
        {
          label: 'Students (reached this day)',
          data: rows.map((d: any) => d.studentsCompleted ?? 0),
          backgroundColor: 'rgba(100, 116, 139, 0.55)',
          borderRadius: 6,
          borderSkipped: false
        },
        {
          label: 'Joined live (unique)',
          data: rows.map((d: any) => this.weekLiveUniqueJoined(d)),
          backgroundColor: 'rgba(22, 163, 74, 0.88)',
          borderRadius: 6,
          borderSkipped: false
        }
      ]
    };

    this.jpWeekModuleData = {
      labels,
      datasets: [
        {
          label: 'Module slots done',
          data: rows.map((d: any) => this.weekModuleFilled(d)),
          backgroundColor: 'rgba(217, 119, 6, 0.88)',
          borderRadius: 6,
          borderSkipped: false
        },
        {
          label: 'Not completed',
          data: rows.map((d: any) => Math.max(0, this.weekModuleTotal(d) - this.weekModuleFilled(d))),
          backgroundColor: 'rgba(203, 213, 225, 0.75)',
          borderRadius: 6,
          borderSkipped: false
        }
      ]
    };

    const exDone = rows.map((d: any) => this.weekExerciseFilled(d));
    const exLeft = rows.map((d: any) => Math.max(0, this.weekExerciseTotal(d) - this.weekExerciseFilled(d)));
    const exAvg = rows.map((d: any) => d.avgScore ?? 0);

    this.jpWeekExerciseData = {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Exercise slots done',
          data: exDone,
          backgroundColor: 'rgba(37, 99, 235, 0.88)',
          yAxisID: 'y',
          borderRadius: 4,
          borderSkipped: false
        } as any,
        {
          type: 'bar',
          label: 'Not completed',
          data: exLeft,
          backgroundColor: 'rgba(148, 163, 184, 0.55)',
          yAxisID: 'y',
          borderRadius: 4,
          borderSkipped: false
        } as any,
        {
          type: 'line',
          label: 'Avg score %',
          data: exAvg,
          borderColor: '#ea580c',
          backgroundColor: 'rgba(234, 88, 12, 0.12)',
          yAxisID: 'y1',
          tension: 0.35,
          fill: false,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2.5
        } as any
      ]
    };
  }

  toggleProgressDay(day: number): void {
    if (this.expandedProgressDay === day) {
      this.expandedProgressDay = null;
      this.dayDetail = null;
      this.dayDetailError = '';
      this.dayDetailLoading = false;
      return;
    }
    this.expandedProgressDay = day;
    this.loadDayDetail(day);
  }

  loadDayDetail(day: number): void {
    if (!this.selectedBatch) return;
    this.dayDetailLoading = true;
    this.dayDetail = null;
    this.dayDetailError = '';
    this.http
      .get<any>(
        `${this.apiUrl}/${encodeURIComponent(this.selectedBatch.batchName)}/progress/day/${day}`,
        { withCredentials: true }
      )
      .subscribe({
        next: (r) => {
          this.dayDetail = r;
          this.dayDetailLoading = false;
        },
        error: (e) => {
          this.dayDetailLoading = false;
          this.dayDetailError = e?.error?.message || 'Failed to load day details.';
        }
      });
  }

  attendedStudents(students: any[] | undefined): any[] {
    return (students || []).filter((s) => s.attended);
  }

  absentStudents(students: any[] | undefined): any[] {
    return (students || []).filter((s) => !s.attended);
  }

  /** Single Analytics column: live classes take priority, else exercise matrix */
  dayHasAnalytics(d: { classesHeld?: number; exerciseCount?: number }): boolean {
    return (d.classesHeld ?? 0) > 0 || (d.exerciseCount ?? 0) > 0;
  }

  dayAnalyticsHint(d: { classesHeld?: number; exerciseCount?: number }): string {
    if ((d.classesHeld ?? 0) > 0) return 'Live class attendance for this day';
    if ((d.exerciseCount ?? 0) > 0) return 'Exercise scores for this day';
    return '';
  }

  openDayAnalytics(d: { day: number; classesHeld?: number; exerciseCount?: number }, ev?: Event): void {
    ev?.stopPropagation();
    if ((d.classesHeld ?? 0) > 0) {
      this.openClassAnalytics(d.day, ev);
      return;
    }
    if ((d.exerciseCount ?? 0) > 0) {
      this.openExerciseAnalytics(d.day, ev);
      return;
    }
    this.notify.info('No live classes or scheduled exercises for this day.');
  }

  openExerciseAnalytics(day: number, ev?: Event): void {
    ev?.stopPropagation();
    if (!this.selectedBatch) return;
    this.exerciseAnalyticsDay = day;
    this.showExerciseAnalyticsModal = true;
    this.exerciseAnalytics = null;
    this.exerciseAnalyticsLoading = true;
    this.http
      .get<any>(
        `${this.apiUrl}/${encodeURIComponent(this.selectedBatch.batchName)}/progress/day/${day}/exercise-analytics`,
        { withCredentials: true }
      )
      .subscribe({
        next: (r) => {
          this.exerciseAnalytics = r;
          this.exerciseAnalyticsLoading = false;
        },
        error: (e) => {
          this.exerciseAnalyticsLoading = false;
          this.notify.error(e?.error?.message || 'Failed to load exercise analytics.');
        }
      });
  }

  closeExerciseAnalyticsModal(): void {
    this.showExerciseAnalyticsModal = false;
    this.exerciseAnalytics = null;
    this.exerciseAnalyticsDay = null;
    this.exerciseAnalyticsLoading = false;
  }

  openClassAnalytics(day: number, ev?: Event): void {
    ev?.stopPropagation();
    if (!this.selectedBatch) return;
    this.classAnalyticsDay = day;
    this.showClassAnalyticsModal = true;
    this.classAnalyticsDetail = null;
    this.classAnalyticsLoading = true;
    this.http
      .get<any>(
        `${this.apiUrl}/${encodeURIComponent(this.selectedBatch.batchName)}/progress/day/${day}`,
        { withCredentials: true }
      )
      .subscribe({
        next: (r) => {
          this.classAnalyticsDetail = r;
          this.classAnalyticsLoading = false;
        },
        error: (e) => {
          this.classAnalyticsLoading = false;
          this.notify.error(e?.error?.message || 'Failed to load class attendance.');
          this.closeClassAnalyticsModal();
        }
      });
  }

  closeClassAnalyticsModal(): void {
    this.showClassAnalyticsModal = false;
    this.classAnalyticsDetail = null;
    this.classAnalyticsDay = null;
    this.classAnalyticsLoading = false;
  }

  loadStudentDetail(studentId: string): void {
    this.showStudentProgressModal = true;
    this.selectedStudentProgress = null;
    this.loadingStudentProgress = true;
    this.studentProgressModalTab = 'overview';
    this.expandedExercises.clear();
    this.http.get<any>(
      `${this.apiUrl}/student/${studentId}/full-progress`,
      { withCredentials: true }
    ).subscribe({
      next: r => { this.selectedStudentProgress = r; this.loadingStudentProgress = false; },
      error: e => { console.error(e); this.loadingStudentProgress = false; this.notify.error('Failed to load student detail.'); }
    });
  }

  closeStudentProgressModal(): void {
    this.showStudentProgressModal = false;
    this.selectedStudentProgress = null;
    this.expandedExercises.clear();
  }

  toggleExerciseExpand(id: string): void {
    if (this.expandedExercises.has(id)) this.expandedExercises.delete(id);
    else this.expandedExercises.add(id);
  }

  formatSeconds(sec: number): string {
    if (!sec) return '0m';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  questionAnswerLabel(r: any): string {
    if (!r) return '—';
    if (r.questionType === 'mcq') return r.selectedOptionIndex !== undefined ? `Option ${r.selectedOptionIndex + 1}` : '—';
    if (r.questionType === 'matching') return (r.matchingResponse || []).map((m: any) => `${m.leftIndex + 1}↔${m.rightIndex + 1}`).join(', ') || '—';
    if (r.questionType === 'fill-blank') return (r.fillBlankResponses || []).join(', ') || '—';
    if (r.questionType === 'pronunciation') return r.spokenText || '—';
    if (r.questionType === 'question-answer') return r.qaResponse || '—';
    if (r.questionType === 'listening') return r.listeningText || '—';
    return '—';
  }

  get progressStudents(): any[] { return this.batchProgress?.students || []; }
  get progressDaily(): any[] { return this.batchProgress?.daily || []; }
  get progressWeekly(): any[] { return this.batchProgress?.weekly || []; }
  get progressOverall(): any { return this.batchProgress?.overall || {}; }

  avgScoreForDetail(): number {
    const exs = this.selectedStudentProgress?.exercises || [];
    if (!exs.length) return 0;
    return Math.round(exs.reduce((sum: number, e: any) => sum + (e.scorePercent || 0), 0) / exs.length);
  }

  classesAttendedForDetail(): number {
    return (this.selectedStudentProgress?.liveClasses || []).filter((c: any) => c.attended).length;
  }
}
