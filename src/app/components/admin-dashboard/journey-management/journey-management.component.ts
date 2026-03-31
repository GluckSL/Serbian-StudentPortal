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
  notes: string;
  studentCount: number;
  studentDays: { avg: number; min: number; max: number };
}

interface StudentRow {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  level: string;
  studentStatus: string;
  currentCourseDay: number;
  enrollmentDate: string;
  editDay?: number;
  saving?: boolean;
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

    <div class="j-batch-grid">
      <div class="j-batch-card" *ngFor="let b of batches">
        <div class="j-batch-card-top">
          <div>
            <div class="j-batch-name">{{ b.batchName }}</div>
            <div class="j-batch-meta">
              {{ b.studentCount }} student{{ b.studentCount !== 1 ? 's' : '' }}
              &nbsp;·&nbsp;
              Journey: {{ b.journeyLength }} days
            </div>
          </div>
          <span class="j-day-pill">Day {{ b.batchCurrentDay }}</span>
        </div>

        <!-- Progress bar -->
        <div class="j-progress-track">
          <div class="j-progress-fill"
               [style.width.%]="(b.batchCurrentDay / b.journeyLength) * 100"></div>
        </div>
        <div class="j-progress-label">
          {{ b.batchCurrentDay }} / {{ b.journeyLength }} days
        </div>

        <!-- Student day spread -->
        <div class="j-day-spread">
          <span class="j-spread-item">
            <i class="fas fa-arrow-down text-danger"></i> Min: <strong>{{ b.studentDays.min }}</strong>
          </span>
          <span class="j-spread-item">
            <i class="fas fa-chart-bar text-primary"></i> Avg: <strong>{{ b.studentDays.avg }}</strong>
          </span>
          <span class="j-spread-item">
            <i class="fas fa-arrow-up text-success"></i> Max: <strong>{{ b.studentDays.max }}</strong>
          </span>
        </div>

        <div class="j-batch-actions">
          <button class="j-btn j-btn-primary" (click)="openBatch(b)">
            <i class="fas fa-pen"></i> Manage
          </button>
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
    </div>

    <!-- ── Config row ─────────────────────────────── -->
    <div class="j-config-card">
      <h4 class="j-card-title">Batch Settings</h4>
      <div class="j-config-row">
        <div class="j-config-field">
          <label>Journey Length (days)</label>
          <input type="number" [(ngModel)]="editJourneyLength" min="1" max="200" class="j-input">
        </div>
        <div class="j-config-field">
          <label>Current Batch Day</label>
          <input type="number" [(ngModel)]="editBatchDay" min="1" [max]="editJourneyLength" class="j-input">
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
            {{ applyingDay ? 'Applying…' : 'Apply Day ' + editBatchDay + ' to All Students' }}
          </button>
        </div>
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
            <th>Current Day</th>
            <th class="text-center">Set Day</th>
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
            <td>
              <div class="j-day-track">
                <div class="j-day-fill"
                     [style.width.%]="(s.currentCourseDay / selectedBatch!.journeyLength) * 100"></div>
              </div>
              <span class="j-day-text">Day {{ s.currentCourseDay }} / {{ selectedBatch!.journeyLength }}</span>
            </td>
            <td class="text-center">
              <div class="j-student-day-ctrl">
                <input type="number" [(ngModel)]="s.editDay" min="1" [max]="selectedBatch!.journeyLength"
                       class="j-input-sm" placeholder="Day">
                <button class="j-btn j-btn-sm j-btn-primary"
                        (click)="setStudentDay(s)"
                        [disabled]="s.saving || !s.editDay">
                  <i class="fas fa-check"></i>
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

    /* ── Batch grid ── */
    .j-batch-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 18px;
    }
    .j-batch-card {
      background: #fff;
      border-radius: 14px;
      padding: 18px 20px;
      box-shadow: 0 2px 12px rgba(15,23,42,.07);
      border: 1px solid #e8ecf4;
      display: flex; flex-direction: column; gap: 12px;
    }
    .j-batch-card-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .j-batch-name { font-size: 16px; font-weight: 700; color: #03396c; }
    .j-batch-meta { font-size: 11px; color: #64748b; margin-top: 2px; }
    .j-day-pill {
      background: #dbeafe; color: #005b96;
      border-radius: 999px; padding: 3px 10px;
      font-size: 12px; font-weight: 700; white-space: nowrap;
    }

    /* Progress bar */
    .j-progress-track {
      height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden;
    }
    .j-progress-fill {
      height: 100%; background: linear-gradient(90deg,#005b96,#6497b1);
      border-radius: 999px; transition: width .4s;
    }
    .j-progress-label { font-size: 10px; color: #94a3b8; text-align: right; }

    /* Student day spread */
    .j-day-spread { display: flex; gap: 12px; flex-wrap: wrap; }
    .j-spread-item { font-size: 11px; color: #475569; }

    .j-batch-actions { display: flex; gap: 8px; }

    /* ── Detail header ── */
    .j-back-btn { margin-bottom: 16px; }
    .j-detail-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
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
    @media (max-width: 600px) {
      .j-content { padding: 14px; }
      .j-batch-grid { grid-template-columns: 1fr; }
      .j-config-row { flex-direction: column; }
    }
  `]
})
export class JourneyManagementComponent implements OnInit {

  private apiUrl = `${environment.apiUrl}/batch-journey`;

  batches: BatchSummary[] = [];
  loading = false;

  selectedBatch: BatchSummary | null = null;
  batchStudents: StudentRow[] = [];
  loadingStudents = false;
  savingConfig = false;
  applyingDay = false;

  editJourneyLength = 200;
  editBatchDay = 1;
  editNotes = '';

  activeTab: 'students' | 'timeline' = 'students';

  timelineDays: TimelineDay[] = [];
  loadingTimeline = false;
  jumpDay: number | null = null;

  constructor(private http: HttpClient) {}

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

  openBatch(b: BatchSummary): void {
    this.selectedBatch = { ...b };
    this.editJourneyLength = b.journeyLength;
    this.editBatchDay = b.batchCurrentDay;
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
        this.batchStudents = (r.students || []).map((s: any) => ({ ...s, editDay: s.currentCourseDay }));
        this.loadingStudents = false;
      },
      error: e => { console.error(e); this.loadingStudents = false; }
    });
  }

  saveConfig(): void {
    if (!this.selectedBatch) return;
    this.savingConfig = true;
    this.http.put<any>(`${this.apiUrl}/${encodeURIComponent(this.selectedBatch.batchName)}`, {
      journeyLength: this.editJourneyLength,
      batchCurrentDay: this.editBatchDay,
      notes: this.editNotes
    }, { withCredentials: true }).subscribe({
      next: r => {
        this.selectedBatch!.journeyLength = r.config.journeyLength;
        this.selectedBatch!.batchCurrentDay = r.config.batchCurrentDay;
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
        s.saving = false;
      },
      error: e => { console.error(e); s.saving = false; alert('Failed to update student day.'); }
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
