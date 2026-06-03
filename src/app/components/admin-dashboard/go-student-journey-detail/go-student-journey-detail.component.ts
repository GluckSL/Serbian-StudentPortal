// Full-page GO Silver student journey detail (opened from Journey → Silver tab in a new tab).

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../services/notification.service';

@Component({
  selector: 'app-go-student-journey-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
<div class="gsd-root">
  <div class="gsd-bar">
    <a routerLink="/admin/journey" class="gsd-back">← Journey Management</a>
  </div>

  <div *ngIf="loading && !detail" class="gsd-loading">
    <div class="spinner-border text-primary" role="status"></div>
    <p>Loading student…</p>
  </div>

  <div *ngIf="error && !detail" class="gsd-error">{{ error }}</div>

  <ng-container *ngIf="detail">
    <div class="gsd-header">
      <div>
        <h1 class="gsd-title">{{ detail.student?.name }}</h1>
        <div class="gsd-meta">
          {{ detail.student?.email }}
          <span class="gsd-badge">{{ detail.student?.subscription }}</span>
          <span class="gsd-badge gsd-badge-go">GO</span>
        </div>
      </div>
      <div class="gsd-day-box">
        <label for="gsd-day-select">Journey day (student access)</label>
        <ng-container *ngIf="journeySync as sync">
          <div class="gsd-sync-banner" *ngIf="sync.reconciled">
            Synced from Day {{ sync.storedCourseDayBeforeSync }} → Day {{ sync.effectiveAccessDay }}
            (first day with incomplete resources).
          </div>
        </ng-container>
        <div class="gsd-day-row">
          <select id="gsd-day-select" class="gsd-select" [(ngModel)]="editDay">
            <option *ngFor="let d of dayOptions" [ngValue]="d">Day {{ d }}</option>
          </select>
          <button
            type="button"
            class="gsd-btn gsd-btn-primary"
            [disabled]="saving || editDay === (detail.student?.currentDay || 1)"
            (click)="saveJourneyDay()"
          >
            <span *ngIf="saving" class="spinner-border spinner-border-sm" role="status"></span>
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
        <p class="gsd-hint" *ngIf="journeySync?.sequentialUnlock">
          Silver GO: the student only unlocks the next day after finishing the current day (recordings ~90%, exercises, DG).
          This value matches what they see in the portal. Raising it manually skips that rule.
        </p>
        <p class="gsd-hint" *ngIf="!journeySync?.sequentialUnlock">
          Content for days after this stays locked for the student until you raise this day.
        </p>
      </div>
    </div>

    <div class="gsd-tabs">
      <button type="button" class="gsd-tab" [class.gsd-tab--on]="tab === 'recordings'" (click)="tab = 'recordings'">Class Recordings</button>
      <button type="button" class="gsd-tab" [class.gsd-tab--on]="tab === 'dgBot'" (click)="tab = 'dgBot'">DG Bot</button>
      <button type="button" class="gsd-tab" [class.gsd-tab--on]="tab === 'exercises'" (click)="tab = 'exercises'">Exercises</button>
      <button type="button" class="gsd-tab" [class.gsd-tab--on]="tab === 'arena'" (click)="tab = 'arena'">GlückArena</button>
    </div>

    <div class="gsd-body">
      <ng-container *ngIf="tab === 'recordings'">
        <div *ngIf="(detail.recordings?.length || 0) + (detail.zoomRecordings?.length || 0) === 0" class="gsd-empty">No class recordings found.</div>
        <div *ngFor="let r of detail.recordings" class="gsd-row gsd-row-flex" [class.gsd-locked]="r.locked">
          <div class="gsd-row-inner">
            <span class="gsd-ico">{{ r.locked ? '🔒' : '▶' }}</span>
            <div>
              <div class="gsd-row-title">{{ r.title }}</div>
              <div class="gsd-row-meta">
                <span *ngIf="r.courseDay != null">Day {{ r.courseDay }}</span>
                <span *ngIf="r.locked" class="gsd-chip gsd-chip-lock">Locked</span>
                <span *ngIf="!r.locked && r.watched" class="gsd-chip gsd-chip-ok">Watched · {{ (r.watchDuration / 60) | number:'1.0-0' }} min</span>
                <span *ngIf="!r.locked && !r.watched" class="gsd-chip">Not watched</span>
              </div>
            </div>
          </div>
          <div class="gsd-row-side" *ngIf="!r.locked">
            <button
              type="button"
              class="gsd-btn gsd-btn-outline"
              *ngIf="!r.watched"
              [disabled]="markingRecordingId === r._id"
              (click)="markManualWatched(r)"
            >
              <span *ngIf="markingRecordingId === r._id" class="spinner-border spinner-border-sm" role="status"></span>
              {{ markingRecordingId === r._id ? 'Saving…' : 'Mark watched' }}
            </button>
          </div>
        </div>
        <div *ngFor="let zr of detail.zoomRecordings" class="gsd-row gsd-row-flex" [class.gsd-locked]="zr.locked">
          <div class="gsd-row-inner">
            <span class="gsd-ico">{{ zr.locked ? '🔒' : '🎬' }}</span>
            <div>
              <div class="gsd-row-title">{{ zr.topic }}</div>
              <div class="gsd-row-meta">
                <span *ngIf="zr.courseDay != null">Day {{ zr.courseDay }}</span>
                <span *ngIf="zr.locked" class="gsd-chip gsd-chip-lock">Locked</span>
                <span *ngIf="!zr.locked && zr.watched" class="gsd-chip gsd-chip-ok">Watched · {{ (zr.watchDuration / 60) | number:'1.0-0' }} min</span>
                <span *ngIf="!zr.locked && !zr.watched" class="gsd-chip">Not watched</span>
              </div>
            </div>
          </div>
          <div class="gsd-row-side" *ngIf="!zr.locked">
            <button
              type="button"
              class="gsd-btn gsd-btn-outline"
              *ngIf="!zr.watched"
              [disabled]="markingZoomId === zr.meetingLinkId"
              (click)="markZoomWatched(zr)"
            >
              <span *ngIf="markingZoomId === zr.meetingLinkId" class="spinner-border spinner-border-sm" role="status"></span>
              {{ markingZoomId === zr.meetingLinkId ? 'Saving…' : 'Mark watched' }}
            </button>
          </div>
        </div>
      </ng-container>

      <ng-container *ngIf="tab === 'dgBot'">
        <p class="gsd-section-hint gsd-section-hint--top">Speaking-practice modules the student sees in the portal (journey day controls locks).</p>
        <div *ngIf="(detail.dgModules?.length || 0) === 0" class="gsd-empty">No DG Bot modules are published for students yet.</div>
        <div *ngFor="let dm of (detail.dgModules || [])" class="gsd-row gsd-row-flex" [class.gsd-locked]="dm.locked">
          <div class="gsd-row-inner">
            <span class="gsd-ico">{{ dm.locked ? '🔒' : '🤖' }}</span>
            <div>
              <div class="gsd-row-title">{{ dm.title }}</div>
              <div class="gsd-row-meta">
                <span *ngIf="dm.courseDay != null">Day {{ dm.courseDay }}</span>
                <span *ngIf="dm.level">· {{ dm.level }}</span>
              </div>
            </div>
          </div>
          <div class="gsd-row-side">
            <span *ngIf="dm.locked" class="gsd-chip gsd-chip-lock">Locked</span>
            <ng-container *ngIf="!dm.locked">
              <span class="gsd-status" [class.gsd-status-done]="dm.status === 'completed'" [class.gsd-status-wip]="dm.status === 'in_progress'" [class.gsd-status-ns]="dm.status === 'not_started'">
                {{ dm.status === 'not_started' ? 'Not started' : dm.status === 'in_progress' ? 'In progress' : 'Completed' }}
              </span>
            </ng-container>
          </div>
        </div>
      </ng-container>

      <ng-container *ngIf="tab === 'exercises'">
        <div *ngIf="(detail.exercises?.length || 0) === 0" class="gsd-empty">No exercises found.</div>
        <div *ngFor="let e of detail.exercises" class="gsd-row gsd-row-flex" [class.gsd-locked]="e.locked">
          <div class="gsd-row-inner">
            <span class="gsd-ico">{{ e.locked ? '🔒' : '🏋️' }}</span>
            <div>
              <div class="gsd-row-title">{{ e.title }}</div>
              <div class="gsd-row-meta">
                <span *ngIf="e.courseDay != null">Day {{ e.courseDay }}</span>
                <span *ngIf="e.sequenceLetter">· {{ e.sequenceLetter }}</span>
                <span *ngIf="e.level">· {{ e.level }}</span>
              </div>
            </div>
          </div>
          <div class="gsd-row-side">
            <span *ngIf="e.locked" class="gsd-chip gsd-chip-lock">Locked</span>
            <ng-container *ngIf="!e.locked">
              <span *ngIf="!e.attempted" class="gsd-status gsd-status-ns">Not attempted</span>
              <ng-container *ngIf="e.attempted">
                <span class="gsd-score" [class.gsd-score-good]="e.scorePercent >= 70" [class.gsd-score-mid]="e.scorePercent >= 40 && e.scorePercent < 70" [class.gsd-score-low]="e.scorePercent < 40">{{ e.scorePercent }}%</span>
                <div class="gsd-pct">{{ e.earnedPoints }}/{{ e.totalPoints }} pts</div>
              </ng-container>
            </ng-container>
          </div>
        </div>
      </ng-container>

      <ng-container *ngIf="tab === 'arena'">
        <p class="gsd-section-hint gsd-section-hint--top">Games tagged with a journey day (set in the game editor).</p>
        <div *ngIf="(detail.arenaGames?.length || 0) === 0" class="gsd-empty">No journey-day arena games for this student’s batch.</div>
        <div *ngFor="let g of (detail.arenaGames || [])" class="gsd-row gsd-row-flex" [class.gsd-locked]="g.locked">
          <div class="gsd-row-inner">
            <span class="gsd-ico">{{ g.locked ? '🔒' : '🎮' }}</span>
            <div>
              <div class="gsd-row-title">{{ g.title }}</div>
              <div class="gsd-row-meta">
                <span *ngIf="g.courseDay != null">Day {{ g.courseDay }}</span>
                <span *ngIf="g.sequenceLetter">· {{ g.sequenceLetter }}</span>
                <span *ngIf="g.level">· {{ g.level }}</span>
              </div>
            </div>
          </div>
          <div class="gsd-row-side">
            <span *ngIf="g.locked" class="gsd-chip gsd-chip-lock">Locked</span>
            <ng-container *ngIf="!g.locked">
              <span *ngIf="!g.played" class="gsd-status gsd-status-ns">Not played</span>
              <span *ngIf="g.played" class="gsd-status gsd-status-done">Played</span>
            </ng-container>
          </div>
        </div>
      </ng-container>
    </div>
  </ng-container>
</div>
  `,
  styles: [`
    .gsd-root { font-family: 'Inter', sans-serif; min-height: 100vh; background: #f0f4f8; padding: 20px 24px 48px; }
    .gsd-bar { margin-bottom: 16px; }
    .gsd-back { color: #005b96; font-weight: 600; font-size: 13px; text-decoration: none; }
    .gsd-back:hover { text-decoration: underline; }
    .gsd-loading, .gsd-error { text-align: center; padding: 48px 20px; color: #64748b; }
    .gsd-error { color: #b91c1c; }
    .gsd-header {
      background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 22px;
      display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 20px;
      box-shadow: 0 2px 12px rgba(15,23,42,.06);
    }
    .gsd-title { margin: 0 0 8px; font-size: 1.35rem; color: #03396c; }
    .gsd-meta { font-size: 13px; color: #64748b; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .gsd-badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: 700; background: #e0f2fe; color: #0369a1; text-transform: uppercase; }
    .gsd-badge-go { background: #dcfce7; color: #166534; }
    .gsd-day-box { min-width: 220px; }
    .gsd-day-box label { display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
    .gsd-day-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .gsd-select {
      padding: 8px 12px; border-radius: 10px; border: 1px solid #e2e8f0; font-size: 14px; font-weight: 600;
      background: #fff; color: #0f172a; min-width: 120px;
    }
    .gsd-btn {
      display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 10px;
      font-size: 13px; font-weight: 600; cursor: pointer; border: none; font-family: inherit;
    }
    .gsd-btn:disabled { opacity: .55; cursor: not-allowed; }
    .gsd-btn-primary { background: #005b96; color: #fff; }
    .gsd-btn-primary:hover:not(:disabled) { background: #03396c; }
    .gsd-btn-outline {
      background: #fff; color: #005b96; border: 1px solid #bae6fd;
      font-size: 12px; padding: 6px 12px;
    }
    .gsd-btn-outline:hover:not(:disabled) { background: #e0f2fe; border-color: #7dd3fc; }
    .gsd-hint { margin: 10px 0 0; font-size: 12px; color: #64748b; line-height: 1.45; max-width: 360px; }
    .gsd-sync-banner {
      margin-bottom: 10px; padding: 8px 12px; border-radius: 10px; font-size: 12px; font-weight: 600;
      background: #fef9c3; color: #854d0e; border: 1px solid #fde047; line-height: 1.45; max-width: 360px;
    }
    .gsd-tabs {
      display: flex; gap: 4px; flex-wrap: wrap; margin: 18px 0 0; border-bottom: 2px solid #e2e8f0;
      background: #f8fafc; border-radius: 12px 12px 0 0; padding: 6px 8px 0;
    }
    .gsd-tab {
      border: none; background: transparent; padding: 10px 16px; font-size: 13px; font-weight: 500;
      color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; font-family: inherit;
    }
    .gsd-tab:hover { color: #005b96; }
    .gsd-tab--on { color: #005b96; border-bottom-color: #005b96; font-weight: 600; }
    .gsd-body {
      background: #fff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 14px 14px;
      padding: 16px 20px 24px; min-height: 200px; box-shadow: 0 2px 12px rgba(15,23,42,.05);
    }
    .gsd-empty { text-align: center; color: #94a3b8; padding: 32px; }
    .gsd-empty--tight { padding: 16px 12px; font-size: 13px; }
    .gsd-section-title {
      margin: 22px 0 0; font-size: 12px; font-weight: 700; color: #03396c; text-transform: uppercase; letter-spacing: .06em;
      border-top: 1px solid #f1f5f9; padding-top: 18px;
    }
    .gsd-section-title:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
    .gsd-section-hint { margin: 6px 0 12px; font-size: 12px; color: #64748b; line-height: 1.45; }
    .gsd-section-hint--top { margin-top: 0; margin-bottom: 16px; }
    .gsd-stats--snap { margin-bottom: 8px; }
    .gsd-row { padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
    .gsd-row:last-child { border-bottom: none; }
    .gsd-row.gsd-locked { opacity: .55; }
    .gsd-row-flex { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .gsd-row-inner { display: flex; align-items: flex-start; gap: 10px; flex: 1; min-width: 0; }
    .gsd-ico { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
    .gsd-row-title { font-size: 14px; font-weight: 600; color: #0f172a; }
    .gsd-row-meta { font-size: 12px; color: #64748b; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 8px; }
    .gsd-row-side { text-align: right; flex-shrink: 0; }
    .gsd-chip { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 8px; background: #f1f5f9; color: #64748b; }
    .gsd-chip-lock { background: #fef2f2; color: #dc2626; }
    .gsd-chip-ok { background: #dcfce7; color: #166534; }
    .gsd-status { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; text-transform: capitalize; }
    .gsd-status-done { background: #dcfce7; color: #166534; }
    .gsd-status-wip { background: #dbeafe; color: #2563eb; }
    .gsd-status-ns { background: #f1f5f9; color: #64748b; }
    .gsd-pct { font-size: 11px; color: #64748b; margin-top: 4px; }
    .gsd-score { font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 10px; }
    .gsd-score-good { background: #dcfce7; color: #16a34a; }
    .gsd-score-mid { background: #fef9c3; color: #ca8a04; }
    .gsd-score-low { background: #fee2e2; color: #dc2626; }
    .gsd-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .gsd-stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; text-align: center; }
    .gsd-stat-val { display: block; font-size: 22px; font-weight: 700; color: #0f172a; }
    .gsd-stat-lbl { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
    .gsd-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .gsd-table th { text-align: left; padding: 10px 12px; background: #03396c; color: #fff; font-size: 11px; text-transform: uppercase; }
    .gsd-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
    .gsd-day-pill { background: #dbeafe; color: #005b96; padding: 2px 10px; border-radius: 999px; font-weight: 700; font-size: 12px; }
  `]
})
export class GoStudentJourneyDetailComponent implements OnInit, OnDestroy {
  loading = false;
  saving = false;
  markingRecordingId: string | null = null;
  markingZoomId: string | null = null;
  detail: any = null;
  journeySync: {
    effectiveAccessDay?: number;
    storedCourseDayBeforeSync?: number;
    reconciled?: boolean;
    sequentialUnlock?: boolean;
  } | null = null;
  editDay = 1;
  maxJourneyDay = 200;
  dayOptions: number[] = [];
  tab: 'recordings' | 'dgBot' | 'exercises' | 'arena' = 'recordings';
  error = '';

  private sub?: Subscription;
  private studentId = '';
  private goApiPath = 'go-students';

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.goApiPath =
      String(this.route.snapshot.queryParamMap.get('track') || '').toLowerCase() === 'sinhala'
        ? 'go-students-sinhala'
        : 'go-students';
    this.sub = this.route.paramMap.subscribe((pm) => {
      const id = pm.get('studentId');
      if (id) {
        this.studentId = id;
        this.load(id);
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private rebuildDayOptions(): void {
    const n = Math.max(1, Math.min(this.maxJourneyDay, 200));
    this.dayOptions = Array.from({ length: n }, (_, i) => i + 1);
  }

  load(studentId: string): void {
    this.loading = true;
    this.error = '';
    this.http.get<any>(`${environment.apiUrl}/${this.goApiPath}/${studentId}/detail`, { withCredentials: true }).subscribe({
      next: (r) => {
        this.detail = r;
        this.journeySync = r.journeySync || null;
        this.maxJourneyDay = r.journeyLength >= 1 ? Math.min(r.journeyLength, 200) : 200;
        this.rebuildDayOptions();
        this.editDay = r.student?.currentDay || 1;
        if (r.journeySync?.reconciled) {
          this.notify.success(
            `Journey day synced to Day ${r.student?.currentDay} based on incomplete resources.`
          );
        }
        this.loading = false;
      },
      error: (e) => {
        this.loading = false;
        this.detail = null;
        this.error = e?.error?.message || 'Failed to load student details.';
        this.notify.error(this.error);
      }
    });
  }

  markManualWatched(recording: { _id: string; title?: string }): void {
    if (!this.studentId || !recording?._id) return;
    this.markingRecordingId = recording._id;
    this.http
      .post<{ journeyAdvanced?: boolean }>(
        `${environment.apiUrl}/${this.goApiPath}/${this.studentId}/recordings/${recording._id}/mark-watched`,
        {},
        { withCredentials: true }
      )
      .subscribe({
        next: (r) => {
          this.markingRecordingId = null;
          this.notify.success(
            r?.journeyAdvanced
              ? 'Marked as watched. Journey day advanced for this student.'
              : 'Marked as watched.'
          );
          this.load(this.studentId);
        },
        error: (e) => {
          this.markingRecordingId = null;
          this.notify.error(e?.error?.message || 'Failed to mark recording as watched.');
        }
      });
  }

  markZoomWatched(zoom: { meetingLinkId: string; topic?: string }): void {
    if (!this.studentId || !zoom?.meetingLinkId) return;
    this.markingZoomId = zoom.meetingLinkId;
    this.http
      .post<{ journeyAdvanced?: boolean }>(
        `${environment.apiUrl}/${this.goApiPath}/${this.studentId}/zoom-meetings/${zoom.meetingLinkId}/mark-watched`,
        {},
        { withCredentials: true }
      )
      .subscribe({
        next: (r) => {
          this.markingZoomId = null;
          this.notify.success(
            r?.journeyAdvanced
              ? 'Marked as watched. Journey day advanced for this student.'
              : 'Marked as watched.'
          );
          this.load(this.studentId);
        },
        error: (e) => {
          this.markingZoomId = null;
          this.notify.error(e?.error?.message || 'Failed to mark zoom recording as watched.');
        }
      });
  }

  saveJourneyDay(): void {
    if (!this.studentId) return;
    this.saving = true;
    this.http
      .patch<{ currentCourseDay: number }>(
        `${environment.apiUrl}/${this.goApiPath}/${this.studentId}/journey-day`,
        { currentCourseDay: this.editDay },
        { withCredentials: true }
      )
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.success('Journey day saved. The student portal uses this day for locks.');
          this.load(this.studentId);
        },
        error: (e) => {
          this.saving = false;
          this.notify.error(e?.error?.message || 'Failed to save journey day.');
        }
      });
  }
}
