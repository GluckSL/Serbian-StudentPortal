// src/app/components/admin-dashboard/journey-management/journey-management.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

interface BatchSummary {
  batchName: string;
  journeyLength: number;
  batchCurrentDay: number;
  batchStartDate: string | null;
  autoDay: boolean;
  notes: string;
  studentCount: number;
  studentDays: { avg: number; min: number; max: number };
}

interface IncompleteTaskItem {
  kind: 'exercise' | 'class';
  title: string;
  courseDay: number;
}

interface TaskCheckModal {
  studentId: string;
  studentName: string;
  currentDay: number;
  complete: boolean;
  incompleteTasks: IncompleteTaskItem[];
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

interface TimelineDay {
  day: number;
  modules: { _id: string; title: string; category: string; level: string }[];
  exercises: { _id: string; title: string; category: string; level: string }[];
  classes: { _id: string; topic: string; batch: string; startTime: string; duration: number }[];
}

@Component({
  selector: 'app-journey-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
      <button class="j-btn j-btn-outline" (click)="loadBatches()">
        <i class="fas fa-sync-alt"></i> Refresh
      </button>
    </div>
  </div>

  <!-- ══ Loading ══════════════════════════════════════════ -->
  <div *ngIf="loading" class="j-loading">
    <div class="spinner-border text-primary"></div>
    <p>Loading journeys…</p>
  </div>

  <!-- ══ BATCH OVERVIEW (level 1) ══════════════════════════════════════════ -->
  <div *ngIf="!loading && !selectedBatch" class="j-content">

    <div *ngIf="batches.length === 0" class="j-empty">
      <i class="fas fa-layer-group fa-3x"></i>
      <p>No student batches found. Create students with a batch name first.</p>
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
              placeholder="Search by batch name…"
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
                <th>Journey</th>
                <th>Progress</th>
                <th class="j-th-narrow">Min</th>
                <th class="j-th-narrow">Avg</th>
                <th class="j-th-narrow">Max</th>
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
                <td class="j-td-mono">{{ b.studentDays.min }}</td>
                <td class="j-td-mono">{{ b.studentDays.avg }}</td>
                <td class="j-td-mono">{{ b.studentDays.max }}</td>
                <td>
                  <button class="j-btn j-btn-primary j-btn-manage" (click)="openBatch(b)">
                    <i class="fas fa-pen"></i> Manage
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- ══ BATCH DETAIL (level 2) ══════════════════════════════════════════ -->
  <div *ngIf="!loading && selectedBatch" class="j-content">

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
      <h4 class="j-card-title">Batch Settings</h4>
      <div class="j-config-row">
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

        <div class="j-config-field" style="flex:2">
          <label>Notes</label>
          <input type="text" [(ngModel)]="editNotes" class="j-input" maxlength="500" placeholder="Optional notes…">
        </div>

        <div class="j-config-actions">
          <button class="j-btn j-btn-outline" (click)="saveConfig()" [disabled]="savingConfig">
            <i class="fas fa-save"></i> {{ savingConfig ? 'Saving…' : 'Save Config' }}
          </button>
          <button class="j-btn j-btn-primary" (click)="applyDayToAllStudents()" [disabled]="applyingDay">
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
          Student journey days advance independently when they complete their tasks.
        </div>
        <button type="button" class="j-btn-icon-sm" title="Remove start date (switch to manual)"
                (click)="clearStartDate()">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>

    <!-- ── Tabs ────────────────────────────────────── -->
    <div class="j-tabs">
      <button class="j-tab" [class.active]="activeTab === 'students'" (click)="activeTab = 'students'">
        <i class="fas fa-users"></i> Students
      </button>
      <button class="j-tab" [class.active]="activeTab === 'timeline'" (click)="openTimeline()">
        <i class="fas fa-stream"></i> Content Timeline
      </button>
    </div>

    <!-- ── Students tab ───────────────────────────── -->
    <div *ngIf="activeTab === 'students'" class="j-table-card">
      <div *ngIf="loadingStudents" class="j-loading-inline">
        <div class="spinner-border spinner-border-sm text-primary"></div> Loading students…
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
                <th class="text-center">Set Day / Advance</th>
              </tr>
            </thead>
        <tbody>
          <tr *ngFor="let s of batchStudents">
            <td>
              <div class="j-student-name">{{ s.name }}</div>
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
            <!-- Set Day / Advance -->
            <td>
              <div class="j-student-day-ctrl">
                <input type="number" [(ngModel)]="s.editDay" min="1" [max]="selectedBatch!.journeyLength"
                       class="j-input-sm" placeholder="Day">
                <button class="j-btn j-btn-sm j-btn-primary"
                        title="Set to exact day"
                        (click)="setStudentDay(s)"
                        [disabled]="s.saving || !s.editDay">
                  <i class="fas fa-pen"></i>
                </button>
                <button class="j-btn j-btn-sm"
                        title="{{ s.taskStatus?.complete ? 'Advance to next day' : 'Force advance (tasks not done)' }}"
                        [class.j-btn-success]="s.taskStatus?.complete"
                        [class.j-btn-warning]="!s.taskStatus?.complete"
                        (click)="advanceStudentDay(s, !s.taskStatus?.complete)"
                        [disabled]="s.advancing || s.currentCourseDay >= selectedBatch!.journeyLength">
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
    <div *ngIf="activeTab === 'timeline'" class="j-timeline-section">
      <div *ngIf="loadingTimeline" class="j-loading-inline">
        <div class="spinner-border spinner-border-sm text-primary"></div> Loading timeline…
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
          </div>
        </div>
      </div>
    </div>

  </div><!-- /detail -->

  <!-- Task check: centered modal -->
  <div class="j-modal-backdrop" *ngIf="taskModal" (click)="closeTaskModal()">
    <div class="j-modal-card" (click)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-labelledby="j-task-modal-title">
      <div class="j-modal-header">
        <h3 id="j-task-modal-title">Tasks — {{ taskModal.studentName }}</h3>
        <button type="button" class="j-modal-close" (click)="closeTaskModal()" aria-label="Close">&times;</button>
      </div>
      <p class="j-modal-sub">
        Checking journey <strong>Day {{ taskModal.currentDay }}</strong>
        (exercises with this course day + live classes for this batch &amp; day).
      </p>

      <div *ngIf="taskModal.complete" class="j-modal-all-done">
        <span class="j-modal-icon-ok"><i class="fas fa-check-circle"></i></span>
        <span>All tasks for this day are completed. Student can advance to the next day.</span>
      </div>

      <div *ngIf="!taskModal.complete && taskModal.incompleteTasks.length" class="j-modal-list">
        <h4 class="j-modal-list-title">Incomplete tasks</h4>
        <ul class="j-modal-task-ul">
          <li *ngFor="let t of taskModal.incompleteTasks" class="j-modal-task-li">
            <span class="j-modal-kind" [class.j-kind-ex]="t.kind === 'exercise'" [class.j-kind-cl]="t.kind === 'class'">
              <i class="fas" [class.fa-dumbbell]="t.kind === 'exercise'" [class.fa-video]="t.kind === 'class'"></i>
              {{ t.kind === 'exercise' ? 'Exercise' : 'Live class' }}
            </span>
            <span class="j-modal-task-title">{{ t.title }}</span>
            <span class="j-modal-day-pill">Day {{ t.courseDay }}</span>
          </li>
        </ul>
      </div>

      <div *ngIf="!taskModal.complete && !taskModal.incompleteTasks.length" class="j-modal-empty-day">
        <i class="fas fa-info-circle"></i>
        No exercises or live classes are scheduled for this journey day.
      </div>

      <div class="j-modal-footer">
        <button type="button" class="j-btn j-btn-outline" (click)="refreshTaskModal()" *ngIf="taskModal.studentId">
          <i class="fas fa-sync-alt"></i> Re-check
        </button>
        <button type="button" class="j-btn j-btn-primary" (click)="closeTaskModal()">Close</button>
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
    .j-btn-sm { padding: 4px 10px; font-size: 11px; }

    /* ── Loading ── */
    .j-loading { text-align: center; padding: 60px 20px; color: #64748b; }
    .j-loading p { margin-top: 12px; font-size: 14px; }
    .j-loading-inline { padding: 20px; color: #64748b; font-size: 13px; display: flex; align-items: center; gap: 8px; }
    .j-empty { text-align: center; padding: 60px 20px; color: #94a3b8; }
    .j-empty p { margin-top: 12px; font-size: 14px; }
    .j-empty-inline { padding: 24px; color: #94a3b8; font-size: 13px; text-align: center; }

    /* ── Batch overview: filters + table ── */
    .j-batch-table-wrap { display: flex; flex-direction: column; gap: 14px; }

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
      align-items: flex-end;
      gap: 10px 12px;
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
    .j-btn-clear { margin-left: auto; }

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
    .j-table--batches { min-width: 720px; }
    .j-table--batches .j-batch-name-cell {
      font-size: 14px;
      font-weight: 700;
      color: #03396c;
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
    .j-th-actions { text-align: right; min-width: 110px; }
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
    .j-config-field label { font-size: 11px; font-weight: 600; color: #475569; }
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
    .j-table tbody td {
      padding: 9px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle;
    }
    .j-table tbody tr:hover { background: #f8fafc; }
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
      .j-btn-clear { margin-left: 0; }
      .j-filter-sort { min-width: 0; }
      .j-config-row { flex-direction: column; }
    }
  `]
})
export class JourneyManagementComponent implements OnInit {

  private apiUrl = `${environment.apiUrl}/batch-journey`;

  batches: BatchSummary[] = [];
  loading = false;

  /** Batch list (level 1) filters */
  batchSearch = '';
  batchSort: 'name' | 'nameDesc' | 'day' | 'dayDesc' | 'students' | 'length' = 'name';
  filtersExpanded = false;
  filterDayMin: number | null = null;
  filterDayMax: number | null = null;
  filterStudentsMin: number | null = null;
  filterJourneyMin: number | null = null;

  selectedBatch: BatchSummary | null = null;
  batchStudents: StudentRow[] = [];
  loadingStudents = false;
  savingConfig = false;
  applyingDay = false;

  editJourneyLength = 200;
  editBatchDay = 1;
  editBatchStartDate = '';   // ISO date string 'YYYY-MM-DD', empty = manual mode
  editNotes = '';

  activeTab: 'students' | 'timeline' = 'students';

  timelineDays: TimelineDay[] = [];
  loadingTimeline = false;
  jumpDay: number | null = null;

  /** Centered card: task check results */
  taskModal: TaskCheckModal | null = null;

  constructor(private http: HttpClient) {}

  /** Filtered & sorted batch overview rows */
  get filteredBatches(): BatchSummary[] {
    let list = [...this.batches];
    const q = this.batchSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(b => String(b.batchName).toLowerCase().includes(q));
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
      (this.filterJourneyMin != null && !isNaN(this.filterJourneyMin))
    );
  }

  clearBatchFilters(): void {
    this.batchSearch = '';
    this.filterDayMin = null;
    this.filterDayMax = null;
    this.filterStudentsMin = null;
    this.filterJourneyMin = null;
  }

  trackBatch(_index: number, b: BatchSummary): string {
    return b.batchName;
  }

  ngOnInit(): void {
    this.loadBatches();
  }

  loadBatches(): void {
    this.loading = true;
    this.http.get<{ batches: BatchSummary[] }>(this.apiUrl, { withCredentials: true }).subscribe({
      next: r => { this.batches = r.batches; this.loading = false; },
      error: e => { console.error(e); this.loading = false; }
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
    this.activeTab = 'students';
    this.timelineDays = [];
    this.loadStudents(b.batchName);
  }

  closeBatch(): void {
    this.selectedBatch = null;
    this.batchStudents = [];
    this.timelineDays = [];
    this.loadBatches();
  }

  loadStudents(batchName: string): void {
    this.loadingStudents = true;
    this.http.get<any>(`${this.apiUrl}/${encodeURIComponent(batchName)}/students`, { withCredentials: true }).subscribe({
      next: r => {
        this.batchStudents = (r.students || []).map((s: any) => ({
          ...s,
          editDay: s.currentCourseDay,
          enrollmentDate: s.enrollmentDate || null,
          accountCreatedAt: s.accountCreatedAt || null
        }));
        this.loadingStudents = false;
      },
      error: e => { console.error(e); this.loadingStudents = false; }
    });
  }

  saveConfig(): void {
    if (!this.selectedBatch) return;
    this.savingConfig = true;
    const payload: any = {
      journeyLength: this.editJourneyLength,
      batchCurrentDay: this.editBatchDay,
      batchStartDate: this.editBatchStartDate || null,
      notes: this.editNotes
    };
    this.http.put<any>(`${this.apiUrl}/${encodeURIComponent(this.selectedBatch.batchName)}`,
      payload, { withCredentials: true }).subscribe({
      next: r => {
        this.selectedBatch!.journeyLength = r.config.journeyLength;
        this.selectedBatch!.batchCurrentDay = r.config.batchCurrentDay;
        this.selectedBatch!.batchStartDate = r.config.batchStartDate || null;
        this.selectedBatch!.autoDay = !!r.config.batchStartDate;
        this.selectedBatch!.notes = r.config.notes;
        this.savingConfig = false;
        alert('Batch config saved.');
      },
      error: e => { console.error(e); this.savingConfig = false; alert('Failed to save config.'); }
    });
  }

  applyDayToAllStudents(): void {
    if (!this.selectedBatch) return;
    const day = this.editBatchDay;
    if (!confirm(`Set ALL students in "${this.selectedBatch.batchName}" to Day ${day}?`)) return;
    this.applyingDay = true;
    this.http.post<any>(`${this.apiUrl}/${encodeURIComponent(this.selectedBatch.batchName)}/set-day`,
      { day }, { withCredentials: true }).subscribe({
      next: r => {
        this.selectedBatch!.batchCurrentDay = day;
        alert(`${r.message} (${r.studentsUpdated} student(s) updated)`);
        this.applyingDay = false;
        this.loadStudents(this.selectedBatch!.batchName);
      },
      error: e => { console.error(e); this.applyingDay = false; alert('Failed to apply day.'); }
    });
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
      },
      error: e => { console.error(e); s.saving = false; alert('Failed to update student day.'); }
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
        this.openTaskModalFromResponse(s._id, s.name, r.currentDay ?? s.currentCourseDay, r.complete, incomplete);
      },
      error: e => {
        console.error(e);
        s.checkingTasks = false;
        alert('Failed to check task status.');
      }
    });
  }

  openTaskModalFromResponse(
    studentId: string,
    studentName: string,
    currentDay: number,
    complete: boolean,
    incompleteTasks: IncompleteTaskItem[]
  ): void {
    this.taskModal = {
      studentId,
      studentName,
      currentDay,
      complete,
      incompleteTasks: incompleteTasks || []
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

  closeTaskModal(): void {
    this.taskModal = null;
  }

  refreshTaskModal(): void {
    if (!this.taskModal?.studentId) return;
    const s = this.batchStudents.find(x => x._id === this.taskModal!.studentId);
    if (s) this.checkStudentTasks(s);
  }

  advanceStudentDay(s: StudentRow, force = false): void {
    if (!this.selectedBatch) return;
    if (s.currentCourseDay >= this.selectedBatch.journeyLength) return;
    if (force && !confirm(`Force-advance ${s.name} to Day ${s.currentCourseDay + 1} even though tasks are not completed?`)) return;
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
          s.taskStatus = {
            complete: false,
            breakdown: r.breakdown,
            incompleteTasks: incomplete
          };
          this.openTaskModalFromResponse(
            s._id,
            s.name,
            r.currentDay ?? s.currentCourseDay,
            false,
            incomplete
          );
        }
      },
      error: e => {
        s.advancing = false;
        console.error(e);
        alert(e?.error?.message || 'Failed to advance student day.');
      }
    });
  }

  openTimeline(): void {
    this.activeTab = 'timeline';
    if (!this.selectedBatch || this.timelineDays.length) return;
    this.loadingTimeline = true;
    this.http.get<any>(`${this.apiUrl}/${encodeURIComponent(this.selectedBatch.batchName)}/timeline`, { withCredentials: true }).subscribe({
      next: r => { this.timelineDays = r.days || []; this.loadingTimeline = false; },
      error: e => { console.error(e); this.loadingTimeline = false; }
    });
  }

  scrollToDay(day: number | null): void {
    if (!day) return;
    const el = document.getElementById(`day-${day}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else alert(`No content found for Day ${day}.`);
  }
}
