// src/app/components/admin-dashboard/go-students/go-students-journey.component.ts
// 200-day journey builder for the GO-SILVER Silver-plan batch

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../services/notification.service';

interface TimelineDay {
  day: number;
  modules: { _id: string; title: string; category: string; level: string; courseDay?: number | null }[];
  exercises: { _id: string; title: string; category: string; level: string; courseDay?: number | null }[];
  classes: { _id: string; topic: string; batch: string; startTime: string; duration: number; courseDay?: number | null }[];
  recordings: { _id: string; title: string; level: string; plan?: string; courseDay?: number | null; isPublished?: boolean }[];
}

interface BatchConfig {
  batchName: string;
  journeyLength: number;
  batchCurrentDay: number;
  batchStartDate: string | null;
  notes: string;
}

interface PickerItem {
  _id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  courseDay?: number | null;
  /** MANUAL vs ZOOM from admin list — only MANUAL can be linked to journey day here */
  recordingType?: string;
}

@Component({
  selector: 'app-go-students-journey',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="gs-root">

  <!-- Header -->
  <div class="gs-header">
    <div class="gs-header-inner">
      <div>
        <h1 class="gs-title">
          <span>🚀</span> GO Students Journey
        </h1>
        <p class="gs-subtitle">
          Manage the 200-day learning journey for Silver GO batch students. Link modules, exercises, live classes, and class recordings to each day (recordings are tagged to the GO-SILVER batch automatically).
        </p>
      </div>
      <div class="gs-header-actions">
        <button type="button" class="gs-btn gs-btn-outline" (click)="loadData()">
          <i class="fas fa-sync-alt"></i> Refresh
        </button>
      </div>
    </div>
  </div>

  <!-- Config card -->
  <div class="gs-config-card" *ngIf="batchConfig">
    <div class="gs-config-row">
      <div class="gs-config-field">
        <label class="gs-label">Journey Length</label>
        <input type="number" class="gs-input" [(ngModel)]="editJourneyLength" min="1" max="200" />
      </div>
      <div class="gs-config-field">
        <label class="gs-label">Current Day</label>
        <input type="number" class="gs-input" [(ngModel)]="editCurrentDay" min="1" [max]="editJourneyLength" />
      </div>
      <div class="gs-config-field" style="flex:2;">
        <label class="gs-label">Notes</label>
        <input type="text" class="gs-input" [(ngModel)]="editNotes" placeholder="Optional notes…" />
      </div>
      <div class="gs-config-field gs-config-add-day">
        <label class="gs-label">Show day in list</label>
        <div class="gs-add-day-row">
          <input
            type="number"
            class="gs-input gs-input-day-slot"
            [(ngModel)]="newJourneyDayInput"
            min="1"
            max="200"
            placeholder="e.g. 3"
          />
          <button type="button" class="gs-btn gs-btn-config-outline" (click)="addJourneyDaySlot()">
            <i class="fas fa-calendar-plus"></i> Add day
          </button>
        </div>
      </div>
      <div class="gs-config-actions">
        <button type="button" class="gs-btn gs-btn-primary" [disabled]="saving" (click)="saveConfig()">
          <i class="fas" [class.fa-spinner]="saving" [class.fa-save]="!saving"></i>
          {{ saving ? 'Saving…' : 'Save Config' }}
        </button>
      </div>
    </div>
    <div class="gs-config-meta">
      <span class="gs-info-chip">GO-SILVER batch</span>
      <span class="gs-info-chip">Day {{ batchConfig.batchCurrentDay }} / {{ batchConfig.journeyLength }}</span>
      <span *ngIf="batchConfig.batchStartDate" class="gs-info-chip">Started {{ batchConfig.batchStartDate | date:'dd MMM yyyy' }}</span>
    </div>
  </div>

  <!-- Loading -->
  <div *ngIf="loading" class="gs-loading">
    <div class="spinner-border text-primary"></div>
    <p>Loading GO-SILVER journey…</p>
  </div>

  <!-- Content area -->
  <div *ngIf="!loading" class="gs-content">

    <!-- Stats bar -->
    <div class="gs-stats-bar">
      <div class="gs-stat">
        <span class="gs-stat-val">{{ goStudentCount }}</span>
        <span class="gs-stat-lbl">GO Students</span>
      </div>
      <div class="gs-stat">
        <span class="gs-stat-val">{{ timelineDays.length }}</span>
        <span class="gs-stat-lbl">Days with Content</span>
      </div>
      <div class="gs-stat">
        <span class="gs-stat-val">{{ totalModules }}</span>
        <span class="gs-stat-lbl">Modules</span>
      </div>
      <div class="gs-stat">
        <span class="gs-stat-val">{{ totalExercises }}</span>
        <span class="gs-stat-lbl">Exercises</span>
      </div>
      <div class="gs-stat">
        <span class="gs-stat-val">{{ totalClasses }}</span>
        <span class="gs-stat-lbl">Classes</span>
      </div>
      <div class="gs-stat">
        <span class="gs-stat-val">{{ totalRecordings }}</span>
        <span class="gs-stat-lbl">Recordings</span>
      </div>
    </div>

    <!-- Day navigator -->
    <div class="gs-day-nav">
      <input type="number" class="gs-input-sm" [(ngModel)]="jumpDay" placeholder="Jump to day…" min="1" max="200" />
      <button class="gs-btn gs-btn-outline gs-btn-sm" (click)="scrollToDay(jumpDay)" [disabled]="!jumpDay">Go</button>
      <span class="gs-timeline-count">{{ timelineDays.length }} day(s) have content scheduled</span>
    </div>

    <!-- Empty state -->
    <div *ngIf="displayTimelineDays.length === 0" class="gs-empty">
      <i class="fas fa-calendar-plus fa-3x" style="color:#cbd5e1;margin-bottom:12px;"></i>
      <p>No content assigned to journey days yet.</p>
      <p style="font-size:13px;color:#94a3b8;">Pick a day below, then use <strong>Add content</strong> to link modules, exercises, classes, or class recordings. Manual uploads can be linked; Zoom rows in the list are view-only.</p>
      <div class="gs-empty-add">
        <label class="gs-label" for="gs-empty-day">Day (1–200)</label>
        <div class="gs-empty-add-row">
          <input id="gs-empty-day" type="number" class="gs-input" [(ngModel)]="emptyAddDay" min="1" max="200" />
          <button type="button" class="gs-btn gs-btn-primary gs-btn-sm" (click)="openAddModal(emptyAddDay)">
            <i class="fas fa-plus"></i> Add content
          </button>
        </div>
      </div>
    </div>

    <!-- Timeline -->
    <div class="gs-timeline" *ngIf="displayTimelineDays.length > 0">
      <div
        *ngFor="let d of displayTimelineDays"
        class="gs-day-card"
        [id]="'gsday-' + d.day"
        [class.gs-day-current]="d.day === (batchConfig?.batchCurrentDay || 0)"
      >
        <div class="gs-day-header">
          <div class="gs-day-header-start">
            <span class="gs-day-num">Day {{ d.day }}</span>
            <span *ngIf="d.day === (batchConfig?.batchCurrentDay || 0)" class="gs-current-badge">Current Day</span>
          </div>
          <div class="gs-day-chips">
            <span *ngIf="d.modules.length" class="gs-chip gs-chip-mod">{{ d.modules.length }} module(s)</span>
            <span *ngIf="d.exercises.length" class="gs-chip gs-chip-ex">{{ d.exercises.length }} exercise(s)</span>
            <span *ngIf="d.classes.length" class="gs-chip gs-chip-cls">{{ d.classes.length }} class(es)</span>
            <span *ngIf="d.recordings?.length" class="gs-chip gs-chip-rec">{{ d.recordings?.length ?? 0 }} recording(s)</span>
          </div>
          <button type="button" class="gs-btn-day-add" (click)="openAddModal(d.day)">
            <i class="fas fa-plus"></i> Add
          </button>
        </div>

        <div class="gs-day-content">
          <!-- Modules -->
          <div *ngIf="d.modules.length" class="gs-content-group">
            <div class="gs-group-label"><i class="fas fa-book"></i> Learning Modules</div>
            <div class="gs-content-item" *ngFor="let m of d.modules">
              <span class="gs-badge gs-badge-blue">{{ m.level }}</span>
              <span class="gs-badge gs-badge-gray">{{ m.category }}</span>
              <span class="gs-content-title">{{ m.title }}</span>
              <div class="gs-item-actions">
                <button type="button" class="gs-mini-btn" (click)="editTimelineItem('modules', m._id, d.day, $event)">Edit</button>
                <button type="button" class="gs-mini-btn gs-mini-btn-danger" (click)="deleteTimelineItem('modules', m._id, $event)">Delete</button>
              </div>
            </div>
          </div>

          <!-- Exercises -->
          <div *ngIf="d.exercises.length" class="gs-content-group">
            <div class="gs-group-label"><i class="fas fa-dumbbell"></i> Digital Exercises</div>
            <div class="gs-content-item" *ngFor="let e of d.exercises">
              <span class="gs-badge gs-badge-blue">{{ e.level }}</span>
              <span class="gs-badge gs-badge-gray">{{ e.category }}</span>
              <span class="gs-content-title">{{ e.title }}</span>
              <div class="gs-item-actions">
                <button type="button" class="gs-mini-btn" (click)="editTimelineItem('exercises', e._id, d.day, $event)">Edit</button>
                <button type="button" class="gs-mini-btn gs-mini-btn-danger" (click)="deleteTimelineItem('exercises', e._id, $event)">Delete</button>
              </div>
            </div>
          </div>

          <!-- Classes -->
          <div *ngIf="d.classes.length" class="gs-content-group">
            <div class="gs-group-label"><i class="fas fa-video"></i> Live Classes</div>
            <div class="gs-content-item" *ngFor="let c of d.classes">
              <span class="gs-badge gs-badge-gold">{{ c.batch }}</span>
              <span class="gs-content-title">{{ c.topic }}</span>
              <span *ngIf="c.startTime" class="gs-class-time">
                {{ c.startTime | date:'dd MMM · HH:mm' }}
                <span *ngIf="c.duration"> · {{ c.duration }}min</span>
              </span>
              <div class="gs-item-actions">
                <button type="button" class="gs-mini-btn" (click)="editTimelineItem('classes', c._id, d.day, $event)">Edit</button>
                <button type="button" class="gs-mini-btn gs-mini-btn-danger" (click)="deleteTimelineItem('classes', c._id, $event)">Delete</button>
              </div>
            </div>
          </div>

          <!-- Class recordings (manual uploads linked by course day + GO-SILVER batch) -->
          <div *ngIf="d.recordings?.length" class="gs-content-group">
            <div class="gs-group-label"><i class="fas fa-film"></i> Class Recordings</div>
            <div class="gs-content-item" *ngFor="let rec of (d.recordings || [])">
              <span class="gs-badge gs-badge-blue">{{ rec.level }}</span>
              <span class="gs-badge gs-badge-gray">{{ rec.plan || 'ALL' }}</span>
              <span *ngIf="rec.isPublished === false" class="gs-badge gs-badge-draft">Draft</span>
              <span class="gs-content-title">{{ rec.title }}</span>
              <div class="gs-item-actions">
                <button type="button" class="gs-mini-btn" (click)="editTimelineItem('recordings', rec._id, d.day, $event)">Edit</button>
                <button type="button" class="gs-mini-btn gs-mini-btn-danger" (click)="deleteTimelineItem('recordings', rec._id, $event)">Delete</button>
              </div>
            </div>
          </div>

          <p
            *ngIf="!(d.modules.length || d.exercises.length || d.classes.length || (d.recordings?.length || 0))"
            class="gs-day-empty-hint"
          >
            No content yet. Use <strong>Add</strong> to link modules, exercises, or recordings.
          </p>
        </div>
      </div>
    </div>

    <!-- How empty days work -->
    <div *ngIf="displayTimelineDays.length > 0" class="gs-empty-days-note">
      <i class="fas fa-info-circle"></i>
      The list shows days that already have content, the batch <strong>current day</strong>, and any day you add with <strong>Add day</strong> or <strong>Go</strong>.
      Pinned empty days are remembered in this browser until that day has scheduled content.
    </div>
  </div>

  <!-- Add content modal -->
  <div class="gs-modal-backdrop" *ngIf="showAddModal" (click)="closeAddModal()">
    <div class="gs-modal" (click)="$event.stopPropagation()">
      <div class="gs-modal-header">
        <h3>Add Content to Journey Day</h3>
        <button type="button" class="gs-modal-close" (click)="closeAddModal()">×</button>
      </div>

      <div class="gs-modal-body">
        <p class="gs-modal-day-hint">Content will be linked to <strong>Day {{ addTargetDay }}</strong>. You can change the day below if needed.</p>
        <div class="gs-modal-row">
          <label class="gs-label">Target Day</label>
          <input type="number" class="gs-input" [(ngModel)]="addTargetDay" min="1" max="200" />
        </div>

        <div class="gs-type-cards">
          <button type="button" class="gs-type-card" [class.gs-type-card--on]="addType === 'recordings'" (click)="selectAddType('recordings')">
            <i class="fas fa-video"></i>
            <span>Recording Classes</span>
          </button>
          <button type="button" class="gs-type-card" [class.gs-type-card--on]="addType === 'exercises'" (click)="selectAddType('exercises')">
            <i class="fas fa-dumbbell"></i>
            <span>Digital Exercises</span>
          </button>
          <button type="button" class="gs-type-card" [class.gs-type-card--on]="addType === 'modules'" (click)="selectAddType('modules')">
            <i class="fas fa-book"></i>
            <span>Modules</span>
          </button>
        </div>

        <div class="gs-modal-row">
          <input type="search" class="gs-input" [(ngModel)]="addSearch" placeholder="Search content..." />
        </div>

        <div *ngIf="addListLoading" class="gs-list-loading">
          <div class="spinner-border spinner-border-sm text-primary"></div> Loading list...
        </div>

        <div *ngIf="!addListLoading && filteredPickerItems.length === 0" class="gs-list-empty">
          No items found.
        </div>

        <div *ngIf="!addListLoading && filteredPickerItems.length > 0" class="gs-picker-list">
          <div class="gs-picker-item" *ngFor="let item of filteredPickerItems">
            <div class="gs-picker-main">
              <div class="gs-picker-title">{{ item.title }}</div>
              <div class="gs-picker-meta">
                <span *ngIf="item.subtitle">{{ item.subtitle }}</span>
                <span *ngIf="item.meta"> · {{ item.meta }}</span>
                <span *ngIf="item.courseDay"> · Day {{ item.courseDay }}</span>
              </div>
            </div>
            <div>
              <button
                *ngIf="addType !== 'recordings' || canLinkRecording(item)"
                type="button"
                class="gs-mini-btn"
                [disabled]="savingItemAction"
                (click)="addItemToDay(item)"
              >
                Add
              </button>
              <span *ngIf="addType === 'recordings' && !canLinkRecording(item)" class="gs-readonly-pill">Zoom only</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
  `,
  styles: [`
    .gs-root {
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      background: #f0f4f8;
      padding-bottom: 40px;
    }

    /* Header */
    .gs-header {
      background: linear-gradient(135deg, #03396c, #005b96);
      color: #fff;
      padding: 24px 32px;
    }
    .gs-header-inner {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .gs-title {
      margin: 0 0 4px;
      font-size: 22px;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .gs-subtitle { margin: 0; font-size: 13px; opacity: .8; max-width: 600px; }
    .gs-header-actions { display: flex; gap: 10px; flex-wrap: wrap; align-self: center; }

    /* Buttons */
    .gs-btn {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 9px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      border: none;
      transition: all .15s;
    }
    .gs-btn:disabled { opacity: .55; cursor: not-allowed; }
    .gs-btn-primary { background: #005b96; color: #fff; }
    .gs-btn-primary:hover:not(:disabled) { background: #03396c; }
    .gs-btn-outline { background: rgba(255,255,255,.15); color: #fff; border: 1px solid rgba(255,255,255,.35); }
    .gs-btn-outline:hover:not(:disabled) { background: rgba(255,255,255,.25); }
    .gs-btn-sm { padding: 7px 14px; font-size: 12px; }
    .gs-mini-btn {
      border: 1px solid #cbd5e1;
      background: #fff;
      color: #0f172a;
      border-radius: 7px;
      padding: 4px 9px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .gs-mini-btn:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
    .gs-mini-btn-danger { color: #b91c1c; border-color: #fecaca; background: #fff5f5; }
    .gs-mini-btn-danger:hover:not(:disabled) { background: #fee2e2; }

    /* Config card */
    .gs-config-card {
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      padding: 16px 32px;
    }
    .gs-config-row {
      display: flex;
      align-items: flex-end;
      gap: 14px;
      flex-wrap: wrap;
    }
    .gs-config-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 120px; }
    .gs-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
    .gs-input {
      padding: 8px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      color: #0f172a;
      background: #f8fafc;
    }
    .gs-input:focus { outline: none; border-color: #005b96; background: #fff; }
    .gs-config-add-day { flex: 0 1 220px; min-width: 180px; }
    .gs-add-day-row { display: flex; align-items: stretch; gap: 8px; }
    .gs-input-day-slot { width: 72px; flex-shrink: 0; text-align: center; }
    .gs-btn-config-outline {
      background: #fff;
      color: #005b96;
      border: 1px solid #93c5fd;
      white-space: nowrap;
    }
    .gs-btn-config-outline:hover:not(:disabled) { background: #e0f2fe; border-color: #005b96; }
    .gs-config-actions { display: flex; align-items: flex-end; }
    .gs-config-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .gs-info-chip {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      background: #e0f2fe;
      color: #0369a1;
      font-size: 11px;
      font-weight: 600;
    }

    /* Content */
    .gs-content { padding: 20px 32px; max-width: 1200px; margin: 0 auto; }

    /* Stats bar */
    .gs-stats-bar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .gs-stat {
      flex: 1;
      min-width: 100px;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .gs-stat-val { font-size: 24px; font-weight: 800; color: #005b96; }
    .gs-stat-lbl { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }

    /* Day nav */
    .gs-day-nav {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .gs-input-sm {
      padding: 7px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      color: #0f172a;
      background: #fff;
      width: 130px;
    }
    .gs-input-sm:focus { outline: none; border-color: #005b96; }
    .gs-btn-outline.gs-btn-sm { background: #f8fafc; color: #005b96; border-color: #93c5fd; }
    .gs-btn-outline.gs-btn-sm:hover:not(:disabled) { background: #e0f2fe; }
    .gs-timeline-count { font-size: 12px; color: #64748b; margin-left: 4px; }

    /* Loading */
    .gs-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px; gap: 12px; color: #64748b; font-size: 14px; }

    /* Empty */
    .gs-empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 48px 24px; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; color: #475569; }
    .gs-empty-add { margin-top: 20px; width: 100%; max-width: 360px; text-align: left; }
    .gs-empty-add-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
    .gs-empty-add-row .gs-input { flex: 1; min-width: 100px; }

    /* Timeline */
    .gs-timeline { display: flex; flex-direction: column; gap: 16px; }
    .gs-day-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,.04);
    }
    .gs-day-card.gs-day-current { border-color: #005b96; }
    .gs-day-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      flex-wrap: wrap;
    }
    .gs-day-header-start { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .gs-day-card.gs-day-current .gs-day-header { background: #e8f4fc; border-color: #bae6fd; }
    .gs-day-num { font-size: 14px; font-weight: 800; color: #03396c; }
    .gs-current-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      background: #005b96;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .05em;
    }
    .gs-day-chips { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 120px; align-items: center; }
    .gs-btn-day-add {
      margin-left: auto;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid #005b96;
      background: #005b96;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
    }
    .gs-btn-day-add:hover { background: #03396c; border-color: #03396c; }
    .gs-chip {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .gs-chip-mod { background: #dbeafe; color: #1e40af; }
    .gs-chip-ex { background: #fce7f3; color: #9d174d; }
    .gs-chip-cls { background: #fef3c7; color: #92400e; }
    .gs-chip-rec { background: #e9d5ff; color: #5b21b6; }

    /* Day content */
    .gs-day-content { padding: 14px 18px; display: flex; flex-direction: column; gap: 14px; }
    .gs-day-empty-hint {
      margin: 0;
      font-size: 13px;
      color: #64748b;
      padding: 10px 12px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px dashed #cbd5e1;
    }
    .gs-content-group { display: flex; flex-direction: column; gap: 8px; }
    .gs-group-label {
      font-size: 11px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: .05em;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .gs-content-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      flex-wrap: wrap;
    }
    .gs-content-title { font-size: 13px; font-weight: 600; color: #0f172a; flex: 1; }
    .gs-class-time { font-size: 11px; color: #64748b; flex-shrink: 0; }
    .gs-item-actions { display: inline-flex; gap: 6px; margin-left: auto; }

    /* Badges */
    .gs-badge {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
    }
    .gs-badge-blue { background: #dbeafe; color: #1e40af; }
    .gs-badge-gray { background: #f1f5f9; color: #475569; }
    .gs-badge-draft { background: #fef3c7; color: #92400e; }
    .gs-badge-gold { background: #fef3c7; color: #92400e; }

    /* Empty days note */
    .gs-empty-days-note {
      margin-top: 24px;
      padding: 12px 16px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      font-size: 12px;
      color: #64748b;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Add modal */
    .gs-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, .45);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .gs-modal {
      width: min(780px, 100%);
      max-height: 90vh;
      background: #fff;
      border-radius: 14px;
      border: 1px solid #e2e8f0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .gs-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
    }
    .gs-modal-header h3 { margin: 0; font-size: 16px; color: #0f172a; }
    .gs-modal-close {
      border: none;
      background: #e2e8f0;
      color: #334155;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
    }
    .gs-modal-body { padding: 16px; overflow: auto; }
    .gs-modal-day-hint { margin: 0 0 12px; font-size: 13px; color: #475569; }
    .gs-modal-row { margin-bottom: 12px; display: flex; flex-direction: column; gap: 6px; }
    .gs-type-cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    .gs-type-card {
      border: 1px solid #dbeafe;
      background: #f8fafc;
      color: #0f172a;
      border-radius: 10px;
      padding: 12px 10px;
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: center;
      cursor: pointer;
      font-weight: 600;
      font-size: 12px;
    }
    .gs-type-card--on { border-color: #2563eb; background: #e0f2fe; color: #1e3a8a; }
    .gs-picker-list { display: flex; flex-direction: column; gap: 8px; }
    .gs-picker-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border: 1px solid #e2e8f0;
      background: #fff;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .gs-picker-main { min-width: 0; }
    .gs-picker-title { font-size: 13px; font-weight: 600; color: #0f172a; }
    .gs-picker-meta { font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gs-list-loading, .gs-list-empty {
      border: 1px dashed #cbd5e1;
      background: #f8fafc;
      border-radius: 10px;
      padding: 14px;
      font-size: 12px;
      color: #64748b;
    }
    .gs-readonly-pill {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 999px;
      background: #f1f5f9;
      color: #64748b;
      font-size: 11px;
      font-weight: 600;
    }
  `]
})
export class GoStudentsJourneyComponent implements OnInit {

  private batchJourneyUrl = `${environment.apiUrl}/batch-journey`;
  private goStudentsUrl = `${environment.apiUrl}/go-students`;
  private learningModulesUrl = `${environment.apiUrl}/learning-modules`;
  private digitalExercisesUrl = `${environment.apiUrl}/digital-exercises`;
  private classRecordingsUrl = `${environment.apiUrl}/class-recordings`;
  private zoomUrl = `${environment.apiUrl}/zoom`;

  readonly GO_BATCH = 'GO-SILVER';

  loading = false;
  saving = false;

  batchConfig: BatchConfig | null = null;
  timelineDays: TimelineDay[] = [];
  goStudentCount = 0;

  editJourneyLength = 200;
  editCurrentDay = 1;
  editNotes = '';

  jumpDay: number | null = null;
  /** Empty day rows the admin asked to see (API only returns days with content or the batch “current” day). */
  pinnedJourneyDays: number[] = [];
  /** Input next to “Add day” in the config bar */
  newJourneyDayInput: number | null = null;
  private readonly pinnedDaysStorageKey = 'go-silver-journey-pinned-days';
  /** When the timeline is empty, use this day for the empty-state “Add content” control */
  emptyAddDay = 1;
  showAddModal = false;
  addTargetDay: number | null = null;
  addType: 'recordings' | 'exercises' | 'modules' = 'recordings';
  addSearch = '';
  addListLoading = false;
  savingItemAction = false;
  pickerRecordings: PickerItem[] = [];
  pickerExercises: PickerItem[] = [];
  pickerModules: PickerItem[] = [];

  get totalModules(): number {
    return this.timelineDays.reduce((s, d) => s + d.modules.length, 0);
  }

  get totalExercises(): number {
    return this.timelineDays.reduce((s, d) => s + d.exercises.length, 0);
  }

  get totalClasses(): number {
    return this.timelineDays.reduce((s, d) => s + d.classes.length, 0);
  }

  get totalRecordings(): number {
    return this.timelineDays.reduce((s, d) => s + (d.recordings?.length || 0), 0);
  }

  /** API timeline days plus pinned empty slots (for building days with no content yet). */
  get displayTimelineDays(): TimelineDay[] {
    const byDay = new Map<number, TimelineDay>();
    for (const d of this.timelineDays) {
      byDay.set(d.day, d);
    }
    for (const p of this.pinnedJourneyDays) {
      if (!byDay.has(p)) {
        byDay.set(p, {
          day: p,
          modules: [],
          exercises: [],
          classes: [],
          recordings: []
        });
      }
    }
    return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
  }

  canLinkRecording(item: PickerItem): boolean {
    if (item.recordingType === 'ZOOM') return false;
    const id = String(item._id || '');
    if (id.startsWith('zoom-')) return false;
    return /^[a-f0-9]{24}$/i.test(id);
  }

  get filteredPickerItems(): PickerItem[] {
    const q = String(this.addSearch || '').trim().toLowerCase();
    const base =
      this.addType === 'recordings'
        ? this.pickerRecordings
        : this.addType === 'exercises'
          ? this.pickerExercises
          : this.pickerModules;
    if (!q) return base;
    return base.filter(i =>
      String(i.title || '').toLowerCase().includes(q) ||
      String(i.subtitle || '').toLowerCase().includes(q) ||
      String(i.meta || '').toLowerCase().includes(q)
    );
  }

  constructor(
    private http: HttpClient,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadPinnedJourneyDaysFromStorage();
    this.loadData();
  }

  loadData(): void {
    this.loading = true;
    this.ensureBatchExists(() => {
      Promise.all([
        this.fetchTimeline(),
        this.fetchGoStudentCount()
      ]).finally(() => {
        this.loading = false;
      });
    });
  }

  private ensureBatchExists(cb: () => void): void {
    // Try to fetch config; if 404 create it, then continue
    this.http.get<any>(
      `${this.batchJourneyUrl}`,
      { withCredentials: true }
    ).subscribe({
      next: (r) => {
        const batches: any[] = r.batches || r || [];
        const existing = batches.find((b: any) =>
          String(b.batchName || '').toLowerCase() === this.GO_BATCH.toLowerCase()
        );
        if (existing) {
          this.batchConfig = existing;
          this.editJourneyLength = existing.journeyLength || 200;
          this.editCurrentDay = existing.batchCurrentDay || 1;
          this.editNotes = existing.notes || '';
        } else {
          // Config doesn't exist yet; create it
          this.http.post<any>(
            `${this.batchJourneyUrl}`,
            { batchName: this.GO_BATCH, journeyLength: 200 },
            { withCredentials: true }
          ).subscribe({
            next: (created) => {
              this.batchConfig = created.batch || created;
              this.editJourneyLength = 200;
              this.editCurrentDay = 1;
            },
            error: () => {}
          });
        }
        cb();
      },
      error: () => {
        cb();
      }
    });
  }

  private fetchTimeline(): Promise<void> {
    return new Promise((resolve) => {
      this.http.get<any>(
        `${this.batchJourneyUrl}/${encodeURIComponent(this.GO_BATCH)}/timeline`,
        { withCredentials: true }
      ).subscribe({
        next: (r) => {
          const raw = r.days || r || [];
          this.timelineDays = raw
            .map((d: any) => ({
              ...d,
              modules: d.modules || [],
              exercises: d.exercises || [],
              classes: d.classes || [],
              recordings: d.recordings || []
            }))
            .sort((a: TimelineDay, b: TimelineDay) => a.day - b.day);
          this.prunePinnedDaysAgainstApi();
          resolve();
        },
        error: () => {
          this.timelineDays = [];
          this.prunePinnedDaysAgainstApi();
          resolve();
        }
      });
    });
  }

  private fetchGoStudentCount(): Promise<void> {
    return new Promise((resolve) => {
      this.http.get<any>(`${this.goStudentsUrl}`, { withCredentials: true }).subscribe({
        next: (r) => {
          this.goStudentCount = (r.students || []).length;
          resolve();
        },
        error: () => {
          this.goStudentCount = 0;
          resolve();
        }
      });
    });
  }

  saveConfig(): void {
    this.saving = true;
    this.http.put<any>(
      `${this.batchJourneyUrl}/${encodeURIComponent(this.GO_BATCH)}`,
      {
        journeyLength: this.editJourneyLength,
        batchCurrentDay: this.editCurrentDay,
        notes: this.editNotes
      },
      { withCredentials: true }
    ).subscribe({
      next: (r) => {
        this.saving = false;
        if (this.batchConfig) {
          this.batchConfig.journeyLength = this.editJourneyLength;
          this.batchConfig.batchCurrentDay = this.editCurrentDay;
          this.batchConfig.notes = this.editNotes;
        }
        this.notify.success('GO-SILVER journey config saved.');
      },
      error: (e) => {
        this.saving = false;
        this.notify.error(e?.error?.message || 'Failed to save config.');
      }
    });
  }

  scrollToDay(day: number | null): void {
    if (day == null || (typeof day === 'number' && !Number.isFinite(day))) return;
    const n = Math.floor(Number(day));
    const maxDay = Math.min(200, Math.max(1, Math.floor(Number(this.editJourneyLength)) || 200));
    if (!Number.isFinite(n) || n < 1 || n > 200) {
      this.notify.error('Enter a day between 1 and 200.');
      return;
    }
    if (n > maxDay) {
      this.notify.error(`That day is outside the journey length (1–${maxDay}).`);
      return;
    }
    const inApiTimeline = this.timelineDays.some((d) => d.day === n);
    if (!inApiTimeline && !this.pinnedJourneyDays.includes(n)) {
      this.pinnedJourneyDays = [...this.pinnedJourneyDays, n].sort((a, b) => a - b);
      this.savePinnedJourneyDaysToStorage();
    }
    this.scrollToDayInView(n);
  }

  /** Pin an empty day so it appears between Notes and the timeline (persists for this browser). */
  addJourneyDaySlot(): void {
    const raw = this.newJourneyDayInput ?? this.jumpDay ?? this.editCurrentDay;
    const n = Math.floor(Number(raw));
    const maxDay = Math.min(200, Math.max(1, Math.floor(Number(this.editJourneyLength)) || 200));
    if (!Number.isFinite(n) || n < 1 || n > 200) {
      this.notify.error('Enter a day between 1 and 200.');
      return;
    }
    if (n > maxDay) {
      this.notify.error(`That day is outside the journey length (1–${maxDay}). Save a longer journey first if needed.`);
      return;
    }
    if (this.timelineDays.some((d) => d.day === n)) {
      this.notify.info(`Day ${n} is already listed.`);
      this.scrollToDayInView(n);
      return;
    }
    if (this.pinnedJourneyDays.includes(n)) {
      this.notify.info(`Day ${n} is already in the list.`);
      this.scrollToDayInView(n);
      return;
    }
    this.pinnedJourneyDays = [...this.pinnedJourneyDays, n].sort((a, b) => a - b);
    this.savePinnedJourneyDaysToStorage();
    this.notify.success(`Day ${n} added to the journey list.`);
    this.scrollToDayInView(n);
  }

  private scrollToDayInView(dayNum: number): void {
    setTimeout(() => {
      document.getElementById(`gsday-${dayNum}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  private loadPinnedJourneyDaysFromStorage(): void {
    try {
      const raw = sessionStorage.getItem(this.pinnedDaysStorageKey);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      const seen = new Set<number>();
      const out: number[] = [];
      for (const x of arr) {
        const v = Math.floor(Number(x));
        if (!Number.isFinite(v) || v < 1 || v > 200 || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
      }
      this.pinnedJourneyDays = out.sort((a, b) => a - b);
    } catch {
      this.pinnedJourneyDays = [];
    }
  }

  private savePinnedJourneyDaysToStorage(): void {
    try {
      sessionStorage.setItem(this.pinnedDaysStorageKey, JSON.stringify(this.pinnedJourneyDays));
    } catch {
      // ignore quota / private mode
    }
  }

  /** Drop pins once the API timeline already returns that day (e.g. after linking content). */
  private prunePinnedDaysAgainstApi(): void {
    const apiDays = new Set(this.timelineDays.map((d) => d.day));
    const next = this.pinnedJourneyDays.filter((p) => !apiDays.has(p));
    if (next.length !== this.pinnedJourneyDays.length) {
      this.pinnedJourneyDays = next;
      this.savePinnedJourneyDaysToStorage();
    }
  }

  openAddModal(day: number | null = null): void {
    const raw = day != null && Number.isFinite(Number(day)) ? Number(day) : Number(this.editCurrentDay) || 1;
    const n = Math.floor(raw);
    this.addTargetDay = Math.min(200, Math.max(1, n));
    this.showAddModal = true;
    this.addSearch = '';
    this.selectAddType('recordings');
  }

  closeAddModal(): void {
    this.showAddModal = false;
    this.addSearch = '';
  }

  selectAddType(type: 'recordings' | 'exercises' | 'modules'): void {
    this.addType = type;
    if (type === 'recordings' && this.pickerRecordings.length === 0) this.loadRecordingsPicker();
    if (type === 'exercises' && this.pickerExercises.length === 0) this.loadExercisesPicker();
    if (type === 'modules' && this.pickerModules.length === 0) this.loadModulesPicker();
  }

  addItemToDay(item: PickerItem): void {
    if (!this.addTargetDay || this.addTargetDay < 1 || this.addTargetDay > 200) {
      this.notify.error('Please enter a valid day between 1 and 200.');
      return;
    }
    if (this.addType === 'recordings') {
      if (!this.canLinkRecording(item)) {
        this.notify.error('Only manual class recordings can be linked to a journey day. Use Manage Classes for Zoom meetings.');
        return;
      }
      this.savingItemAction = true;
      this.http
        .put(
          `${this.classRecordingsUrl}/${item._id}`,
          { courseDay: this.addTargetDay, addBatch: this.GO_BATCH, isPublished: true },
          { withCredentials: true }
        )
        .subscribe({
          next: () => {
            this.savingItemAction = false;
            this.notify.success('Recording linked to day ' + this.addTargetDay + '.');
            this.fetchTimeline();
            this.closeAddModal();
          },
          error: (e) => {
            this.savingItemAction = false;
            this.notify.error(e?.error?.message || 'Failed to link recording.');
          }
        });
      return;
    }

    this.savingItemAction = true;
    this.setCourseDay(this.addType, item._id, this.addTargetDay).subscribe({
      next: () => {
        this.savingItemAction = false;
        this.notify.success('Added to selected day.');
        this.fetchTimeline();
        this.closeAddModal();
      },
      error: (e) => {
        this.savingItemAction = false;
        this.notify.error(e?.error?.message || 'Failed to add item to day.');
      }
    });
  }

  editTimelineItem(type: 'modules' | 'exercises' | 'classes' | 'recordings', itemId: string, currentDay: number, event?: Event): void {
    event?.stopPropagation();
    const input = window.prompt('Enter new day (1-200):', String(currentDay || 1));
    if (input == null) return;
    const nextDay = Number(input);
    if (!Number.isFinite(nextDay) || nextDay < 1 || nextDay > 200) {
      this.notify.error('Please enter a valid day between 1 and 200.');
      return;
    }
    const key = type === 'classes' ? 'classes' : type;
    this.savingItemAction = true;
    this.setCourseDay(key as 'modules' | 'exercises' | 'classes' | 'recordings', itemId, nextDay).subscribe({
      next: () => {
        this.savingItemAction = false;
        this.notify.success('Item updated.');
        this.fetchTimeline();
      },
      error: (e) => {
        this.savingItemAction = false;
        this.notify.error(e?.error?.message || 'Failed to update item.');
      }
    });
  }

  deleteTimelineItem(type: 'modules' | 'exercises' | 'classes' | 'recordings', itemId: string, event?: Event): void {
    event?.stopPropagation();
    const ok = window.confirm('Remove this item from journey day list?');
    if (!ok) return;
    const key = type === 'classes' ? 'classes' : type;
    this.savingItemAction = true;
    this.setCourseDay(key as 'modules' | 'exercises' | 'classes' | 'recordings', itemId, null).subscribe({
      next: () => {
        this.savingItemAction = false;
        this.notify.success('Item removed from day.');
        this.fetchTimeline();
      },
      error: (e) => {
        this.savingItemAction = false;
        this.notify.error(e?.error?.message || 'Failed to remove item.');
      }
    });
  }

  private setCourseDay(type: 'modules' | 'exercises' | 'classes' | 'recordings', itemId: string, day: number | null) {
    if (type === 'modules') {
      return this.http.put(`${this.learningModulesUrl}/${itemId}`, { courseDay: day, changeDescription: 'Updated from GO Students journey page' }, { withCredentials: true });
    }
    if (type === 'exercises') {
      return this.http.put(`${this.digitalExercisesUrl}/${itemId}`, { courseDay: day }, { withCredentials: true });
    }
    if (type === 'recordings') {
      return this.http.put(
        `${this.classRecordingsUrl}/${itemId}`,
        day == null ? { courseDay: null } : { courseDay: day, addBatch: this.GO_BATCH },
        { withCredentials: true }
      );
    }
    return this.http.put(`${this.zoomUrl}/meeting/${itemId}`, { courseDay: day }, { withCredentials: true });
  }

  private loadModulesPicker(): void {
    this.addListLoading = true;
    this.http.get<any>(`${this.learningModulesUrl}?page=1&limit=500`, { withCredentials: true }).subscribe({
      next: (r) => {
        const rows = r?.modules || [];
        this.pickerModules = rows.map((m: any) => ({
          _id: m._id,
          title: m.title || 'Untitled Module',
          subtitle: `${m.level || ''} ${m.category ? '· ' + m.category : ''}`.trim(),
          meta: m.visibleToStudents ? 'Published' : 'Draft',
          courseDay: m.courseDay ?? null
        }));
        this.addListLoading = false;
      },
      error: () => {
        this.addListLoading = false;
        this.notify.error('Failed to load modules.');
      }
    });
  }

  private loadExercisesPicker(): void {
    this.addListLoading = true;
    this.http.get<any>(`${this.digitalExercisesUrl}/admin/all?page=1&limit=500`, { withCredentials: true }).subscribe({
      next: (r) => {
        const rows = r?.exercises || [];
        this.pickerExercises = rows.map((e: any) => ({
          _id: e._id,
          title: e.title || 'Untitled Exercise',
          subtitle: `${e.level || ''} ${e.category ? '· ' + e.category : ''}`.trim(),
          meta: e.isActive ? 'Active' : 'Inactive',
          courseDay: e.courseDay ?? null
        }));
        this.addListLoading = false;
      },
      error: () => {
        this.addListLoading = false;
        this.notify.error('Failed to load exercises.');
      }
    });
  }

  private loadRecordingsPicker(): void {
    this.addListLoading = true;
    this.http.get<any>(`${this.classRecordingsUrl}/admin/all`, { withCredentials: true }).subscribe({
      next: (r) => {
        const rows = r?.recordings || [];
        this.pickerRecordings = rows.map((x: any) => ({
          _id: String(x._id || ''),
          title: x.title || 'Untitled Recording',
          subtitle: x.recordingType === 'ZOOM' ? 'Zoom Recording' : 'Manual Recording',
          meta: x.plan ? `Plan: ${x.plan}` : '',
          courseDay: x.courseDay ?? null,
          recordingType: x.recordingType === 'ZOOM' ? 'ZOOM' : 'MANUAL'
        }));
        this.addListLoading = false;
      },
      error: () => {
        this.addListLoading = false;
        this.notify.error('Failed to load recording classes.');
      }
    });
  }
}
