import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { forkJoin, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { fmtPaymentAmount } from '../payment-hub-v2/payment-currency.util';
import { AuthService } from '../../services/auth.service';
import { NavService } from '../../shared/services/nav.service';
import { NotificationService } from '../../services/notification.service';

// ── Minimum batch number to include (35 → shows 35,36,…46,47 automatically) ──
const MIN_BATCH_NUMBER = 35;

/** Known test / legacy batch labels — never shown on this dashboard */
const EXCLUDED_BATCH_KEYS = new Set([
  '100',
  'batch-2024-a',
  'test batch',
]);

interface LevelCalendarDates {
  A1?: { startDate?: string | null; endDate?: string | null };
  A2?: { startDate?: string | null; endDate?: string | null };
  B1?: { startDate?: string | null; endDate?: string | null };
  B2?: { startDate?: string | null; endDate?: string | null };
}

interface BatchRow {
  batchName: string;
  batchNum: number;
  batchLevel: string;
  batchCurrentDay: number;
  journeyLength: number;
  studentCount: number;
  studentsBehindCount: number;
  teacherName: string | null;
  journeyActive: boolean;
  batchStartDate: string | null;
  levelCalendarDates: LevelCalendarDates | null;
  // payment
  paidLKR: number;
  paidINR: number;
  paidUSD: number;
  remainingLKR: number;
  remainingINR: number;
  remainingUSD: number;
  expectedLKR: number;
  expectedINR: number;
  overdueLKR: number;
  // progress rates (loaded lazily)
  classAttendancePct: number;    // avg per-class attendance (Zoom Reports formula)
  exerciseCompletionPct: number; // % of expected exercises completed
  dgBotCompletionPct: number;    // % of expected DG modules completed
  arenaEngagementPct: number;    // % of expected arena plays
  // raw totals (for tooltip / detail)
  totalClassesAttended: number;
  totalExercisesCompleted: number;
  totalDgBotCompleted: number;
  totalArenaCompleted: number;
  // weekly engagement
  engagementPct: number;         // avg weekly minutes / 360 * 100
  avgWeeklyMinutesPerStudent: number;
  studentsOnTarget: number;
  progressLoaded: boolean;
  // health
  health: number;
  healthLabel: string;
  healthColor: string;
}

interface PaymentBatchRow {
  batch?: string;
  langPaidLKR?: number;
  langPaidINR?: number;
  langPaidUSD?: number;
  totalPaidLKR?: number;
  totalPaidINR?: number;
  totalPaidUSD?: number;
  totalPendingLKR?: number;
  totalPendingINR?: number;
  totalPendingUSD?: number;
  totalOverdueLKR?: number;
  totalOverdueINR?: number;
  totalOverdueUSD?: number;
}

@Component({
  selector: 'app-admin-hub-overview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="ov">

  <!-- ── Loading ── -->
  <ng-container *ngIf="loading">
    <div class="ov-kpi-row">
      <div class="ov-kpi sk" *ngFor="let _ of [1,2,3,4,5]"></div>
    </div>
    <div class="ov-table-wrap">
      <div class="ov-table-sk">
        <div class="ov-table-sk__head sk"></div>
        <div class="ov-table-sk__row sk" *ngFor="let _ of [1,2,3,4,5,6,7,8]"></div>
      </div>
    </div>
  </ng-container>

  <!-- ── Error ── -->
  <div class="ov-empty" *ngIf="!loading && error">
    <span class="material-icons">error_outline</span>
    <p>{{ error }}</p>
  </div>

  <!-- ── Content ── -->
  <ng-container *ngIf="!loading && !error">

    <!-- Header row -->
    <div class="ov-header">
      <div class="ov-header__left">
        <span class="ov-header__dot"></span>
        <span class="ov-header__title">Live Batch Overview</span>
        <span class="ov-header__sub">New-batch students · Batch {{ minBatch }}+</span>
      </div>
    </div>

    <!-- KPI strip -->
    <div class="ov-kpi-row">
      <div class="ov-kpi ov-kpi--blue">
        <span class="ov-kpi__icon material-icons">groups</span>
        <div class="ov-kpi__body">
          <span class="ov-kpi__val">{{ displayKpi.totalStudents }}</span>
          <span class="ov-kpi__lbl">Total Students</span>
        </div>
      </div>
      <div class="ov-kpi ov-kpi--red" *ngIf="displayKpi.totalBehind > 0">
        <span class="ov-kpi__icon material-icons">trending_down</span>
        <div class="ov-kpi__body">
          <span class="ov-kpi__val">{{ displayKpi.totalBehind }}</span>
          <span class="ov-kpi__lbl">Behind Journey</span>
        </div>
      </div>
      <div class="ov-kpi ov-kpi--green" *ngIf="displayKpi.totalBehind === 0">
        <span class="ov-kpi__icon material-icons">check_circle</span>
        <div class="ov-kpi__body">
          <span class="ov-kpi__val">All</span>
          <span class="ov-kpi__lbl">On Track</span>
        </div>
      </div>
      <div class="ov-kpi ov-kpi--purple" *ngIf="canViewFinance">
        <span class="ov-kpi__icon material-icons">paid</span>
        <div class="ov-kpi__body">
          <span class="ov-kpi__val">{{ fmtTotal(displayKpi.totalPaidLKR, displayKpi.totalPaidINR) }}</span>
          <span class="ov-kpi__lbl">Collected</span>
        </div>
      </div>
      <div class="ov-kpi ov-kpi--orange" *ngIf="canViewFinance">
        <span class="ov-kpi__icon material-icons">pending_actions</span>
        <div class="ov-kpi__body">
          <span class="ov-kpi__val">{{ fmtTotal(displayKpi.totalPendingLKR, displayKpi.totalPendingINR) }}</span>
          <span class="ov-kpi__lbl">Total Pending</span>
        </div>
      </div>
      <div class="ov-kpi-slot">
        <div class="ov-kpi-actions" *ngIf="batches.length > 0">
          <div class="ov-action-wrap">
            <button type="button" class="ov-action-btn" (click)="toggleLevelDropdown($event)">
              Level
              <span class="material-icons">expand_more</span>
            </button>
            <div class="ov-level-dropdown" *ngIf="levelDropdownOpen" (click)="$event.stopPropagation()">
              <label class="ov-level-check ov-level-check--all">
                <input type="checkbox" [checked]="metricsScopeAll" (change)="toggleAllMetrics()">
                <span>All</span>
              </label>
              <div class="ov-level-dropdown__divider"></div>
              <label class="ov-level-check" *ngFor="let lv of levelOptions">
                <input type="checkbox" [checked]="isLevelSelected(lv)" [disabled]="metricsScopeAll" (change)="toggleLevelCheck(lv)">
                <span>{{ lv }}</span>
              </label>
            </div>
          </div>
          <button type="button" class="ov-action-btn ov-action-btn--export" (click)="exportCsv()" [disabled]="!visibleBatches.length">
            Export
          </button>
        </div>
        <div class="ov-kpi ov-kpi--teal">
          <span class="ov-kpi__icon material-icons">favorite</span>
          <div class="ov-kpi__body">
            <span class="ov-kpi__val">{{ avgHealth }}%</span>
            <span class="ov-kpi__lbl">Avg Batch Health</span>
          </div>
        </div>
      </div>
    </div>

    <!-- View tabs removed: one unified table -->

    <!-- Empty -->
    <div class="ov-empty" *ngIf="batches.length === 0">
      <span class="material-icons">inbox</span>
      <p>No active batches found for Batch {{ minBatch }}+</p>
    </div>
    <div class="ov-empty" *ngIf="batches.length > 0 && visibleBatches.length === 0">
      <span class="material-icons">filter_alt</span>
      <p>No batches match the selected level filters.</p>
    </div>

    <!-- ─── OVERVIEW TABLE ─── -->
    <div class="ov-table-wrap" *ngIf="visibleBatches.length > 0">
      <div class="ov-table-scroll">
        <table class="ov-table">
          <thead>
            <tr>
              <th class="ov-th-batch">Batch</th>
              <th class="ov-th-journey">Journey</th>
              <th class="ov-th-dates">Dates</th>
              <th class="ov-th-num">Students</th>
              <th class="ov-th-pct" title="Avg attendance per completed class (same as Zoom Reports)">Classes %</th>
              <th class="ov-th-pct" title="Distinct exercises completed vs total available up to student day">Exercises %</th>
              <th class="ov-th-pct" title="Distinct DG modules completed vs expected">DG %</th>
              <th class="ov-th-pct" title="Arena plays vs expected">Arena %</th>
              <th class="ov-th-pct" title="Avg weekly language time (Ex+DG+Arena) vs 6h target">Engagement %</th>
              <th class="ov-th-pay" *ngIf="canViewFinance">Received / Pending</th>
              <th class="ov-th-health">Health</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let b of visibleBatches">
              <td class="ov-td-batch">
                <div class="ov-batch-name">Batch {{ b.batchName }}</div>
                <div class="ov-batch-teacher" *ngIf="b.teacherName">
                  <span class="material-icons">person</span>{{ b.teacherName }}
                </div>
                <div class="ov-batch-teacher ov-batch-teacher--empty" *ngIf="!b.teacherName">No teacher assigned</div>
              </td>

              <td class="ov-td-journey">
                <div class="ov-journey-badges">
                  <span class="ov-journey-badge ov-journey-badge--day">{{ b.batchCurrentDay }}</span>
                  <span class="ov-journey-badge ov-journey-badge--level">{{ (b.batchLevel || '—') | lowercase }}</span>
                </div>
              </td>

              <td class="ov-td-dates">
                <button
                  type="button"
                  class="ov-dates-btn"
                  [class.ov-dates-btn--readonly]="!canEditBatchDates"
                  (click)="openDateModal(b, $event)"
                  [attr.title]="canEditBatchDates ? 'Click to edit batch dates' : 'Batch dates'"
                >
                  <div class="ov-dates-batch">{{ fmtShortDate(b.batchStartDate) }}</div>
                  <div class="ov-dates-level" *ngIf="b.batchStartDate || levelStartIso(b) || levelEndIso(b)">
                    <span class="ov-dates-range">{{ levelStartDate(b) }}</span>
                    <span class="ov-dates-sep">/</span>
                    <span class="ov-dates-range">{{ levelEndDate(b) }}</span>
                  </div>
                  <div class="ov-dates-empty" *ngIf="!b.batchStartDate && !levelStartIso(b) && !levelEndIso(b)">—</div>
                </button>
              </td>

              <td class="ov-td-num">
                <span class="ov-num">{{ b.studentCount }}</span>
              </td>

              <!-- Classes % -->
              <td class="ov-td-pct">
                <ng-container *ngIf="b.progressLoaded; else metricSk">
                  <span class="ov-pct-only" [class.ov-pct-num--low]="b.classAttendancePct < 40">{{ b.classAttendancePct }}%</span>
                </ng-container>
              </td>

              <!-- Exercises % -->
              <td class="ov-td-pct">
                <ng-container *ngIf="b.progressLoaded; else metricSk">
                  <span class="ov-pct-only" [class.ov-pct-num--low]="b.exerciseCompletionPct < 40">{{ b.exerciseCompletionPct }}%</span>
                </ng-container>
              </td>

              <!-- DG Modules % -->
              <td class="ov-td-pct">
                <ng-container *ngIf="b.progressLoaded; else metricSk">
                  <span class="ov-pct-only" [class.ov-pct-num--low]="b.dgBotCompletionPct < 40">{{ b.dgBotCompletionPct }}%</span>
                </ng-container>
              </td>

              <!-- Arena % -->
              <td class="ov-td-pct">
                <ng-container *ngIf="b.progressLoaded; else metricSk">
                  <span class="ov-pct-only" [class.ov-pct-num--low]="b.arenaEngagementPct < 40">{{ b.arenaEngagementPct }}%</span>
                </ng-container>
              </td>

              <!-- Engagement % -->
              <td class="ov-td-pct">
                <ng-container *ngIf="b.progressLoaded; else metricSk">
                  <span class="ov-pct-only" [style.color]="engColor(b.engagementPct)" [class.ov-pct-num--low]="b.engagementPct < 40">{{ b.engagementPct }}%</span>
                  <span class="ov-pct-sub">{{ fmtMinutes(b.avgWeeklyMinutesPerStudent) }}/wk</span>
                </ng-container>
              </td>

              <td class="ov-td-pay" *ngIf="canViewFinance">
                <ng-container *ngIf="hasPaymentData(b); else payEmpty">
                  <div class="ov-pay-row" *ngFor="let line of payLines(b)">
                    <span class="ov-pay-received">{{ line.received }}</span>
                    <span class="ov-pay-slash">/</span>
                    <span class="ov-pay-remaining" [class.ov-pay-remaining--due]="line.hasDue">{{ line.remaining }}</span>
                  </div>
                </ng-container>
                <ng-template #payEmpty><span class="ov-pay-empty">—</span></ng-template>
              </td>

              <td class="ov-td-health">
                <ng-container *ngIf="b.progressLoaded; else healthSk">
                  <span class="ov-health-pct" [style.color]="b.healthColor">{{ b.health }}%</span>
                  <span class="ov-health-badge" [style.background]="b.healthColor + '18'" [style.color]="b.healthColor">
                    {{ b.healthLabel }}
                  </span>
                </ng-container>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ng-template #metricSk>
      <span class="ov-metric-sk"></span>
    </ng-template>

    <ng-template #healthSk>
      <span class="ov-metric-sk ov-metric-sk--wide"></span>
    </ng-template>
  </ng-container>

  <!-- Date edit modal -->
  <div class="ov-modal-backdrop" *ngIf="dateModalOpen" (click)="closeDateModal()"></div>
  <div class="ov-modal" *ngIf="dateModalOpen" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
    <div class="ov-modal__head">
      <div>
        <h3 class="ov-modal__title">Edit batch dates</h3>
        <p class="ov-modal__sub" *ngIf="dateModalBatch">Batch {{ dateModalBatch.batchName }} · {{ (dateModalBatch.batchLevel || '—') | uppercase }}</p>
      </div>
      <button type="button" class="ov-modal__close" (click)="closeDateModal()" aria-label="Close">
        <span class="material-icons">close</span>
      </button>
    </div>
    <div class="ov-modal__body">
      <label class="ov-modal-field">
        <span class="ov-modal-field__label">Batch start date</span>
        <input type="date" class="ov-modal-field__input" [(ngModel)]="dateModalBatchStart" [disabled]="dateModalSaving || !canEditBatchDates">
      </label>
      <label class="ov-modal-field">
        <span class="ov-modal-field__label">{{ (dateModalBatch?.batchLevel || 'Level') | uppercase }} start date</span>
        <input type="date" class="ov-modal-field__input" [(ngModel)]="dateModalLevelStart" [disabled]="dateModalSaving || !canEditBatchDates">
      </label>
      <label class="ov-modal-field">
        <span class="ov-modal-field__label">{{ (dateModalBatch?.batchLevel || 'Level') | uppercase }} end date</span>
        <input type="date" class="ov-modal-field__input" [(ngModel)]="dateModalLevelEnd" [disabled]="dateModalSaving || !canEditBatchDates">
      </label>
      <p class="ov-modal-hint">Saved dates are shown to all admins on this dashboard.</p>
      <p class="ov-modal-error" *ngIf="dateModalError">{{ dateModalError }}</p>
    </div>
    <div class="ov-modal__foot">
      <button type="button" class="ov-action-btn" (click)="closeDateModal()" [disabled]="dateModalSaving">Cancel</button>
      <button type="button" class="ov-action-btn ov-action-btn--save" (click)="saveDateModal()" [disabled]="dateModalSaving || !canEditBatchDates">
        {{ dateModalSaving ? 'Saving…' : 'Save dates' }}
      </button>
    </div>
  </div>
</div>
  `,
  styles: [`
:host { display: block; font-family: 'Inter', system-ui, sans-serif; background: #f1f5f9; }

.ov { padding: 18px 20px 36px; }

/* ── Header ── */
.ov-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
  flex-wrap: wrap;
}
.ov-header__left { display: flex; align-items: center; gap: 8px; }
.ov-header__dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34,197,94,0.2);
  animation: pulse-dot 2s infinite;
}
@keyframes pulse-dot {
  0%,100% { box-shadow: 0 0 0 3px rgba(34,197,94,0.2); }
  50% { box-shadow: 0 0 0 6px rgba(34,197,94,0.08); }
}
.ov-header__title { font-size: 0.9rem; font-weight: 800; color: #0f172a; }
.ov-header__sub {
  font-size: 0.7rem;
  color: #94a3b8;
  background: #e2e8f0;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
}

/* ── KPI strip ── */
.ov-kpi-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
  align-items: flex-end;
}
.ov-kpi-slot {
  flex: 1;
  min-width: 130px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ov-kpi-slot .ov-kpi {
  flex: none;
  width: 100%;
  min-height: 56px;
  box-sizing: border-box;
}
.ov-kpi-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  min-height: 22px;
  flex-shrink: 0;
}
.ov-action-wrap { position: relative; }
.ov-action-btn {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 999px;
  background: #fff; color: #475569; font-size: 0.65rem; font-weight: 700;
  font-family: inherit; cursor: pointer; transition: all .15s; white-space: nowrap;
}
.ov-action-btn .material-icons { font-size: 14px; }
.ov-action-btn:hover:not(:disabled) { border-color: #005b96; color: #005b96; background: #f8fafc; }
.ov-action-btn:disabled { opacity: .5; cursor: not-allowed; }
.ov-level-dropdown {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 20;
  min-width: 110px; padding: 6px 0;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
  box-shadow: 0 4px 16px rgba(15,23,42,.12);
}
.ov-level-check {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; cursor: pointer; font-size: 0.72rem; font-weight: 600; color: #334155;
}
.ov-level-check:hover { background: #f8fafc; }
.ov-level-check input { accent-color: #005b96; cursor: pointer; }
.ov-level-check--all { font-weight: 800; color: #0f172a; }
.ov-level-check input:disabled { opacity: 0.45; cursor: not-allowed; }
.ov-level-dropdown__divider {
  height: 1px; background: #e2e8f0; margin: 4px 0;
}
.ov-kpi {
  flex: 1;
  min-width: 130px;
  background: #fff;
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 1px 6px rgba(15,23,42,0.07);
  border-left: 3px solid transparent;
  &.ov-kpi--blue   { border-color: #3b82f6; .ov-kpi__icon { color: #3b82f6; } }
  &.ov-kpi--red    { border-color: #ef4444; .ov-kpi__icon { color: #ef4444; } }
  &.ov-kpi--green  { border-color: #22c55e; .ov-kpi__icon { color: #22c55e; } }
  &.ov-kpi--purple { border-color: #8b5cf6; .ov-kpi__icon { color: #8b5cf6; } }
  &.ov-kpi--orange { border-color: #f97316; .ov-kpi__icon { color: #f97316; } }
  &.ov-kpi--teal   { border-color: #14b8a6; .ov-kpi__icon { color: #14b8a6; } }
}
.ov-kpi__icon { font-size: 20px; flex-shrink: 0; opacity: 0.85; }
.ov-kpi__body { display: flex; flex-direction: column; gap: 1px; }
.ov-kpi__val { font-size: 1.15rem; font-weight: 800; color: #0f172a; letter-spacing: -0.04em; line-height: 1.1; }
.ov-kpi__lbl { font-size: 0.63rem; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }

/* ── Batch table ── */
.ov-table-wrap {
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 1px 8px rgba(15,23,42,0.07);
  border: 1px solid #e2e8f0;
  overflow: hidden;
}
.ov-table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.ov-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
  min-width: 1220px;
}
.ov-table thead th {
  background: #03396c;
  color: #fff;
  padding: 10px 12px;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: left;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}
.ov-table tbody td {
  padding: 12px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}
.ov-table tbody tr:last-child td { border-bottom: none; }
.ov-table tbody tr:hover { background: #f8fafc; }

.ov-th-num, .ov-td-num { text-align: center; width: 72px; }
.ov-th-pct, .ov-td-pct { min-width: 110px; }
.ov-th-metric, .ov-td-metric { min-width: 88px; }
.ov-th-pay, .ov-td-pay { min-width: 130px; }
.ov-th-health, .ov-td-health { min-width: 120px; }
.ov-th-batch { min-width: 160px; }
.ov-th-journey { min-width: 130px; }
.ov-th-dates, .ov-td-dates { min-width: 130px; }
.ov-th-engpct { min-width: 200px; }

.ov-td-batch { min-width: 160px; max-width: 220px; }

/* Dates column */
.ov-td-dates { vertical-align: middle; }
.ov-dates-batch {
  font-size: 0.78rem; font-weight: 700; color: #0f172a;
  letter-spacing: -0.01em; line-height: 1.3;
}
.ov-dates-level {
  display: flex; align-items: center; gap: 3px; margin-top: 4px; flex-wrap: wrap;
}
.ov-dates-range {
  font-size: 0.67rem; font-weight: 600; color: #475569;
}
.ov-dates-sep {
  font-size: 0.67rem; color: #cbd5e1; font-weight: 600;
}
.ov-dates-empty { color: #cbd5e1; font-size: 0.8rem; }
.ov-dates-btn {
  display: block; width: 100%; padding: 0; margin: 0; border: 0; background: transparent;
  text-align: left; cursor: pointer; font: inherit; border-radius: 8px;
  transition: background .15s ease, box-shadow .15s ease;
}
.ov-dates-btn:hover:not(.ov-dates-btn--readonly) {
  background: #eff6ff;
  box-shadow: inset 0 0 0 1px #bfdbfe;
}
.ov-dates-btn--readonly { cursor: default; }

/* Date edit modal */
.ov-modal-backdrop {
  position: fixed; inset: 0; z-index: 1040;
  background: rgba(15, 23, 42, 0.45);
}
.ov-modal {
  position: fixed; z-index: 1050; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: min(420px, calc(100vw - 24px));
  background: #fff; border-radius: 14px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.22);
  border: 1px solid #e2e8f0;
}
.ov-modal__head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 16px 18px 10px; border-bottom: 1px solid #f1f5f9;
}
.ov-modal__title { margin: 0; font-size: 1rem; font-weight: 800; color: #0f172a; }
.ov-modal__sub { margin: 4px 0 0; font-size: 0.72rem; color: #64748b; font-weight: 600; }
.ov-modal__close {
  border: 0; background: transparent; color: #64748b; cursor: pointer;
  padding: 2px; border-radius: 8px;
}
.ov-modal__close:hover { background: #f1f5f9; color: #0f172a; }
.ov-modal__body { padding: 14px 18px 6px; display: flex; flex-direction: column; gap: 12px; }
.ov-modal-field { display: flex; flex-direction: column; gap: 6px; }
.ov-modal-field__label { font-size: 0.72rem; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
.ov-modal-field__input {
  width: 100%; box-sizing: border-box; padding: 9px 11px;
  border: 1px solid #cbd5e1; border-radius: 10px; font-size: 0.85rem; color: #0f172a;
}
.ov-modal-field__input:focus { outline: none; border-color: #005b96; box-shadow: 0 0 0 3px rgba(0, 91, 150, 0.12); }
.ov-modal-hint { margin: 0; font-size: 0.68rem; color: #94a3b8; }
.ov-modal-error { margin: 0; font-size: 0.75rem; color: #dc2626; font-weight: 600; }
.ov-modal__foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px 16px; border-top: 1px solid #f1f5f9;
}
.ov-action-btn--save {
  background: #005b96; color: #fff; border-color: #005b96;
}
.ov-action-btn--save:hover:not(:disabled) { background: #004a7a; border-color: #004a7a; color: #fff; }
.ov-batch-name {
  font-size: 0.9rem; font-weight: 800; color: #0f172a;
  letter-spacing: -0.02em; line-height: 1.2;
}
.ov-batch-teacher {
  display: flex; align-items: center; gap: 4px; margin-top: 4px;
  font-size: 0.68rem; color: #64748b; font-weight: 600; line-height: 1.3;
  word-break: break-word;
}
.ov-batch-teacher .material-icons { font-size: 13px; opacity: 0.7; flex-shrink: 0; }
.ov-batch-teacher--empty { color: #cbd5e1; font-style: italic; font-weight: 500; }

/* Journey cell — just pill + % (no bar) */
.ov-td-journey {
  white-space: nowrap;
  min-width: 88px;
}
.ov-journey-badges {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.ov-journey-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.ov-journey-badge--day {
  background: #1e3a8a;
  color: #fff;
}
.ov-journey-badge--level {
  background: #ede9fe;
  color: #6d28d9;
  text-transform: lowercase;
}

/* Numeric cells */
.ov-num {
  font-size: 0.95rem; font-weight: 800; color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.ov-num--danger  { color: #dc2626; }
.ov-num--success { color: #16a34a; }
.ov-td-num--alert { background: #fff7ed; }

/* ── % rate cells ── */
.ov-td-pct, .ov-td-engpct { vertical-align: middle; }
.ov-pct-only {
  font-size: 0.88rem; font-weight: 800; color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.ov-pct-num--low { color: #dc2626; }
.ov-pct-sub {
  display: block; font-size: 0.58rem; color: #94a3b8;
  font-weight: 600; margin-top: 2px;
}

/* ── Engagement bar ── */
.ov-th-engpct { min-width: 200px; }
.ov-td-engpct { min-width: 200px; }
.ov-eng-bar-row {
  display: flex; align-items: center; gap: 8px;
}
.ov-eng-bar {
  position: relative; flex: 1; height: 10px;
  background: #e2e8f0; border-radius: 999px; overflow: visible;
  min-width: 80px; max-width: 160px;
}
.ov-eng-bar__fill {
  height: 100%; border-radius: 999px;
  transition: width .5s ease;
}
.ov-eng-bar__target {
  position: absolute; top: -3px; right: 0;
  width: 2px; height: 16px; background: #64748b;
  border-radius: 2px; opacity: .4;
}
.ov-eng-pct {
  font-size: 0.88rem; font-weight: 800;
  font-variant-numeric: tabular-nums; white-space: nowrap; min-width: 38px;
}
.ov-eng-sub {
  display: block; font-size: 0.6rem; color: #94a3b8; font-weight: 600; margin-top: 3px;
}
.ov-metric-sk {
  display: inline-block;
  width: 48px;
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s linear infinite;
}
.ov-metric-sk--wide { width: 72px; }

.ov-pay-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-wrap: wrap;
  line-height: 1.35;
}
.ov-pay-row + .ov-pay-row { margin-top: 3px; }
.ov-pay-received {
  font-size: 0.72rem;
  font-weight: 700;
  color: #16a34a;
  font-variant-numeric: tabular-nums;
}
.ov-pay-slash {
  font-size: 0.68rem;
  color: #cbd5e1;
  font-weight: 600;
}
.ov-pay-remaining {
  font-size: 0.72rem;
  font-weight: 700;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}
.ov-pay-remaining--due { color: #dc2626; }
.ov-pay-empty { color: #cbd5e1; font-size: 0.85rem; }

.ov-td-health {
  vertical-align: middle;
  white-space: nowrap;
}
.ov-health-pct {
  display: block;
  font-size: 0.88rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  margin-bottom: 3px;
}
.ov-health-badge {
  display: inline-block;
  font-size: 0.6rem;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

/* Table skeleton */
.ov-table-sk { padding: 0; }
.ov-table-sk__head {
  height: 40px;
  border-bottom: 1px solid #e2e8f0;
}
.ov-table-sk__row {
  height: 52px;
  border-bottom: 1px solid #f1f5f9;
}
.ov-table-sk__row:last-child { border-bottom: none; }

/* ── Skeleton ── */
.ov-kpi.sk { min-height: 56px; border-radius: 12px; }
.sk {
  background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s linear infinite;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ── Empty ── */
.ov-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 56px 20px; color: #94a3b8; text-align: center; font-size: 0.85rem;
  .material-icons { font-size: 44px; opacity: 0.2; }
}

/* ── Responsive ── */
@media (max-width: 640px) {
  .ov { padding: 12px 10px 28px; }
  .ov-kpi-row { gap: 6px; }
  .ov-kpi { min-width: 110px; padding: 10px 12px; }
}
  `]
})
export class AdminHubOverviewComponent implements OnInit, OnDestroy {
  loading = true;
  error = '';
  canViewFinance = false;
  canEditBatchDates = false;
  batches: BatchRow[] = [];
  dateModalOpen = false;
  dateModalBatch: BatchRow | null = null;
  dateModalBatchStart = '';
  dateModalLevelStart = '';
  dateModalLevelEnd = '';
  dateModalSaving = false;
  dateModalError = '';
  private userSub?: Subscription;
  private dataLoaded = false;
  private profileRefreshRequested = false;
  readonly minBatch = MIN_BATCH_NUMBER;
  readonly levelOptions = ['A1', 'A2', 'B1', 'B2'];
  selectedLevels = new Set<string>();
  levelDropdownOpen = false;
  levelsInitialized = false;
  metricsScopeAll = false;

  get visibleBatches(): BatchRow[] {
    if (!this.levelsInitialized) return this.batches;
    return this.batches.filter(b => !b.batchLevel || this.selectedLevels.has(b.batchLevel));
  }

  get avgHealth(): number {
    const loaded = this.visibleBatches.filter(b => b.progressLoaded);
    if (!loaded.length) return 0;
    return Math.round(loaded.reduce((s, b) => s + b.health, 0) / loaded.length);
  }

  get displayKpi() {
    const rows = this.visibleBatches;
    return {
      totalStudents: rows.reduce((s, b) => s + b.studentCount, 0),
      totalBehind: rows.reduce((s, b) => s + b.studentsBehindCount, 0),
      totalPaidLKR: rows.reduce((s, b) => s + b.paidLKR, 0),
      totalPaidINR: rows.reduce((s, b) => s + b.paidINR, 0),
      totalPendingLKR: rows.reduce((s, b) => s + b.remainingLKR, 0),
      totalPendingINR: rows.reduce((s, b) => s + b.remainingINR, 0),
    };
  }

  isLevelSelected(lv: string): boolean {
    return this.selectedLevels.has(lv);
  }

  toggleLevelDropdown(event: Event): void {
    event.stopPropagation();
    this.levelDropdownOpen = !this.levelDropdownOpen;
  }

  toggleLevelCheck(lv: string): void {
    if (this.metricsScopeAll) return;
    const next = new Set(this.selectedLevels);
    if (next.has(lv)) next.delete(lv);
    else next.add(lv);
    this.selectedLevels = next;
  }

  toggleAllMetrics(): void {
    this.metricsScopeAll = !this.metricsScopeAll;
    if (this.metricsScopeAll) {
      this.selectedLevels = new Set(this.levelOptions);
    } else {
      this.initLevelFilterFromBatches();
    }
    this.reloadAllProgress();
  }

  @HostListener('document:click')
  closeLevelDropdown(): void {
    this.levelDropdownOpen = false;
  }

  private initLevelFilterFromBatches(): void {
    const active = new Set(
      this.batches.map(b => b.batchLevel).filter(lv => lv && this.levelOptions.includes(lv))
    );
    this.selectedLevels = active.size ? active : new Set(this.levelOptions);
    this.levelsInitialized = true;
  }

  private reloadAllProgress(): void {
    this.batches.forEach((b, idx) => {
      this.batches[idx] = {
        ...this.batches[idx],
        progressLoaded: false,
        classAttendancePct: 0,
        exerciseCompletionPct: 0,
        dgBotCompletionPct: 0,
        arenaEngagementPct: 0,
        engagementPct: 0,
        avgWeeklyMinutesPerStudent: 0,
      };
      this.loadBatchProgress(idx);
    });
  }

  private loadBatchProgress(idx: number): void {
    const b = this.batches[idx];
    if (!b) return;
    const name = encodeURIComponent(b.batchName);
    const scope = this.metricsScopeAll ? 'all' : 'current';
    this.http.get<{ overall?: any }>(
      `${this.api}/batch-journey/${name}/progress?sections=overall&metricsScope=${scope}`,
      { withCredentials: true }
    ).pipe(catchError(() => of(null))).subscribe(res => {
      this.applyProgressRow(idx, res?.overall ?? {}, b.studentCount || 1, b.studentsBehindCount);
    });
  }

  private applyProgressRow(idx: number, ov: any, sc: number, studentsBehindCount: number): void {
    const regularity = ((sc - studentsBehindCount) / sc) * 100;
    const classRate = ov.classAttendancePct ?? 0;
    const exRate = ov.exerciseCompletionPct ?? 0;
    const dgRate = ov.dgBotCompletionPct ?? 0;
    const arenaRate = ov.arenaEngagementPct ?? 0;

    const health = Math.round(
      regularity * 0.35 +
      classRate  * 0.30 +
      exRate     * 0.20 +
      dgRate     * 0.10 +
      arenaRate  * 0.05
    );
    const healthLabel = health >= 70 ? 'Healthy' : health >= 40 ? 'Needs Attention' : 'Critical';
    const healthColor = health >= 70 ? '#22c55e' : health >= 40 ? '#f59e0b' : '#ef4444';

    this.batches[idx] = {
      ...this.batches[idx],
      batchLevel: ov.batchLevel ?? this.batches[idx].batchLevel,
      totalClassesAttended: ov.totalClassesAttended ?? 0,
      totalExercisesCompleted: ov.totalExercisesCompleted ?? 0,
      totalDgBotCompleted: ov.totalDgBotCompleted ?? 0,
      totalArenaCompleted: ov.totalArenaCompleted ?? 0,
      classAttendancePct: classRate,
      exerciseCompletionPct: exRate,
      dgBotCompletionPct: dgRate,
      arenaEngagementPct: arenaRate,
      engagementPct: ov.engagementPct ?? 0,
      avgWeeklyMinutesPerStudent: ov.avgWeeklyMinutesPerStudent ?? 0,
      studentsOnTarget: ov.studentsOnTarget ?? 0,
      progressLoaded: true,
      health,
      healthLabel,
      healthColor
    };
  }

  private readonly api = environment.apiUrl;
  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private navService: NavService,
    private notify: NotificationService,
  ) {}

  ngOnInit(): void {
    this.userSub = this.authService.currentUser$.subscribe(user => this.applyFinanceAccess(user));
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  private applyFinanceAccess(user: any | null): void {
    if (!user?.role) {
      this.canViewFinance = false;
      return;
    }

    if (!this.isPermissionProfileReady(user)) {
      if (!this.profileRefreshRequested) {
        this.profileRefreshRequested = true;
        this.authService.refreshUserProfile().subscribe({ error: () => {} });
      }
      return;
    }

    const prevCanView = this.canViewFinance;
    this.canViewFinance = this.navService.canViewFinanceDashboard(
      user.role,
      user.sidebarPermissions || [],
      user.sidebarAccessLevels || {},
      user.teacherTabPermissions || [],
      user.teacherTabAccessLevels || {},
    );
    this.canEditBatchDates = user.role === 'ADMIN' || user.role === 'TEACHER_ADMIN';

    if (!this.dataLoaded) {
      this.dataLoaded = true;
      this.load();
      return;
    }

    if (this.canViewFinance && !prevCanView) {
      this.enrichWithPaymentData();
    }
  }

  private isPermissionProfileReady(user: any): boolean {
    if (user.role === 'ADMIN' || user.role === 'TEACHER_ADMIN') return true;
    if (user.role === 'SUB_ADMIN') {
      return Array.isArray(user.sidebarPermissions)
        || Object.keys(user.sidebarAccessLevels || {}).length > 0;
    }
    if (user.role === 'TEACHER') {
      return Array.isArray(user.teacherTabPermissions)
        || Object.keys(user.teacherTabAccessLevels || {}).length > 0;
    }
    return true;
  }

  private enrichWithPaymentData(): void {
    this.http.get<{ success?: boolean; data?: { batches?: PaymentBatchRow[] } }>(
      `${this.api}/new-payments/batches/summary`, { withCredentials: true }
    ).pipe(catchError(() => of(null))).subscribe(payment => {
      const payMap = this.buildPaymentMap(payment);
      this.batches = this.batches.map(row => this.applyPaymentToRow(row, payMap));
    });
  }

  private buildPaymentMap(payment: { data?: { batches?: PaymentBatchRow[] } } | null): Map<string, PaymentBatchRow> {
    const payMap = new Map<string, PaymentBatchRow>();
    (payment?.data?.batches || []).forEach((p: PaymentBatchRow & { batch?: string }) =>
      payMap.set(this.normKey(p.batch ?? ''), p)
    );
    return payMap;
  }

  private applyPaymentToRow(row: BatchRow, payMap: Map<string, PaymentBatchRow>): BatchRow {
    const pay = this.resolvePayRow(payMap, row.batchName);
    return {
      ...row,
      paidLKR: pay.langPaidLKR ?? pay.totalPaidLKR ?? 0,
      paidINR: pay.langPaidINR ?? pay.totalPaidINR ?? 0,
      paidUSD: pay.langPaidUSD ?? pay.totalPaidUSD ?? 0,
      remainingLKR: pay.totalPendingLKR ?? 0,
      remainingINR: pay.totalPendingINR ?? 0,
      remainingUSD: pay.totalPendingUSD ?? 0,
      overdueLKR: pay.totalOverdueLKR ?? 0,
    };
  }

  private load(): void {
    const journey$ = this.http.get<{ batches: any[]; upcomingBatches?: any[] }>(
      `${this.api}/batch-journey`, { withCredentials: true }
    ).pipe(catchError(() => of({ batches: [], upcomingBatches: [] })));

    const payment$ = this.canViewFinance
      ? this.http.get<{ success?: boolean; data?: { batches?: PaymentBatchRow[] } }>(
          `${this.api}/new-payments/batches/summary`, { withCredentials: true }
        ).pipe(catchError(() => of(null)))
      : of(null);

    forkJoin({ journey: journey$, payment: payment$ }).subscribe(({ journey, payment }) => {

      const all = [...(journey.batches || []), ...(journey.upcomingBatches || [])];

      // Filter: new-batch type, numeric batch name (35, 36, …), exclude test batches
      const filtered = all.filter(b => this.isEligibleBatch(b.batchName, b.batchType));

      // Sort by batch number ascending
      filtered.sort((a, b) => (this.extractBatchNumber(a.batchName) ?? 0) - (this.extractBatchNumber(b.batchName) ?? 0));

      // Payment lookup (batch labels may be "35" vs "Batch 35")
      const payMap = this.canViewFinance ? this.buildPaymentMap(payment ?? null) : new Map<string, PaymentBatchRow>();

      this.batches = filtered.map(b => {
        const pay = this.canViewFinance ? this.resolvePayRow(payMap, b.batchName) : {};
        const paidLKR = pay.langPaidLKR ?? pay.totalPaidLKR ?? 0;
        const paidINR = pay.langPaidINR ?? pay.totalPaidINR ?? 0;
        const paidUSD = pay.langPaidUSD ?? pay.totalPaidUSD ?? 0;
        const remainingLKR = pay.totalPendingLKR ?? 0;
        const remainingINR = pay.totalPendingINR ?? 0;
        const remainingUSD = pay.totalPendingUSD ?? 0;
        const row: BatchRow = {
          batchName: b.batchName,
          batchNum: this.extractBatchNumber(b.batchName) ?? 0,
          batchLevel: b.batchLevel ?? '',
          batchCurrentDay: b.batchCurrentDay ?? 1,
          journeyLength: b.journeyLength ?? 200,
          studentCount: b.studentCount ?? 0,
          studentsBehindCount: b.studentsBehindCount ?? 0,
          teacherName: b.teacherName ?? null,
          journeyActive: !!b.journeyActive,
          batchStartDate: b.batchStartDate ? String(b.batchStartDate) : null,
          levelCalendarDates: this.normalizeLevelCalendarDates(b.levelCalendarDates),
          paidLKR,
          paidINR,
          paidUSD,
          remainingLKR,
          remainingINR,
          remainingUSD,
          expectedLKR: 0,
          expectedINR: 0,
          overdueLKR: pay.totalOverdueLKR ?? 0,
          totalClassesAttended: 0,
          totalExercisesCompleted: 0,
          totalDgBotCompleted: 0,
          totalArenaCompleted: 0,
          classAttendancePct: 0,
          exerciseCompletionPct: 0,
          dgBotCompletionPct: 0,
          arenaEngagementPct: 0,
          engagementPct: 0,
          avgWeeklyMinutesPerStudent: 0,
          studentsOnTarget: 0,
          progressLoaded: false,
          health: 0,
          healthLabel: '',
          healthColor: '#94a3b8'
        };
        return row;
      });

      this.initLevelFilterFromBatches();
      this.loading = false;

      // Lazy-load progress for each batch individually (UI fills in as each responds)
      this.batches.forEach((_, idx) => this.loadBatchProgress(idx));
    });
  }

  // Extract leading integer from batch name: "35" → 35, "Batch 35" → 35, "35A" → 35
  private extractBatchNumber(name: string): number | null {
    if (!name) return null;
    const m = String(name).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  /** Only new-type batches named as plain numbers (35, 46, …), not test labels */
  private isEligibleBatch(batchName: string, batchType?: string): boolean {
    if (String(batchType || '').toLowerCase() === 'old') return false;

    const label = String(batchName || '').trim();
    const key = this.normKey(label);
    if (EXCLUDED_BATCH_KEYS.has(key)) return false;
    if (/test/i.test(label)) return false;

    const m = label.match(/^(\d+)$/);
    if (!m) return false;

    const num = parseInt(m[1], 10);
    return num >= MIN_BATCH_NUMBER;
  }

  private normKey(name: string): string {
    return String(name || '').trim().toLowerCase();
  }

  /** Match payment row when journey batch is "35" but students use "Batch 35", etc. */
  private resolvePayRow(payMap: Map<string, PaymentBatchRow>, batchName: string): PaymentBatchRow {
    const directKeys = [
      this.normKey(batchName),
      this.normKey(`batch ${batchName}`),
    ];
    for (const key of directKeys) {
      const row = payMap.get(key);
      if (row) return row;
    }

    const num = this.extractBatchNumber(batchName);
    if (num != null) {
      for (const [key, row] of payMap.entries()) {
        if (this.extractBatchNumber(key) === num) return row;
      }
    }
    return {};
  }

  hasPaymentData(b: BatchRow): boolean {
    return (
      b.paidLKR > 0 || b.paidINR > 0 || b.paidUSD > 0 ||
      b.remainingLKR > 0 || b.remainingINR > 0 || b.remainingUSD > 0
    );
  }

  payLines(b: BatchRow): { received: string; remaining: string; hasDue: boolean }[] {
    const lines: { received: string; remaining: string; hasDue: boolean }[] = [];
    const add = (paid: number, remaining: number, prefix: string) => {
      if (paid <= 0 && remaining <= 0) return;
      lines.push({
        received: this.payAmt(paid, prefix),
        remaining: this.payAmt(remaining, prefix),
        hasDue: remaining > 0,
      });
    };
    add(b.paidLKR, b.remainingLKR, 'LKR');
    add(b.paidINR, b.remainingINR, 'INR');
    add(b.paidUSD, b.remainingUSD, 'EURO');
    return lines;
  }

  private payAmt(n: number, prefix: string): string {
    if (!n) return '—';
    return `${prefix} ${fmtPaymentAmount(n)}`;
  }

  private shortOrDash(n: number, prefix: string): string {
    if (!n) return '—';
    return this.short(n, prefix);
  }

  private readonly LEVEL_RANGES = [
    { level: 'A1', dayStart: 1,   dayEnd: 42  },
    { level: 'A2', dayStart: 43,  dayEnd: 84  },
    { level: 'B1', dayStart: 85,  dayEnd: 145 },
    { level: 'B2', dayStart: 146, dayEnd: 200 },
  ];

  fmtShortDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    } catch { return '—'; }
  }

  private toInputDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    } catch { return ''; }
  }

  private normalizeLevelCalendarDates(raw: unknown): LevelCalendarDates | null {
    if (!raw || typeof raw !== 'object') return null;
    const src = raw as Record<string, { startDate?: string | Date | null; endDate?: string | Date | null }>;
    const out: LevelCalendarDates = {};
    for (const level of ['A1', 'A2', 'B1', 'B2'] as const) {
      const row = src[level];
      if (!row) continue;
      out[level] = {
        startDate: row.startDate ? String(row.startDate) : null,
        endDate: row.endDate ? String(row.endDate) : null,
      };
    }
    return Object.keys(out).length ? out : null;
  }

  private levelOverrideIso(b: BatchRow, field: 'startDate' | 'endDate'): string | null {
    const lv = String(b.batchLevel || '').toUpperCase() as keyof LevelCalendarDates;
    const row = b.levelCalendarDates?.[lv];
    const value = row?.[field];
    return value ? String(value) : null;
  }

  private computedLevelStartIso(b: BatchRow): string | null {
    if (!b.batchStartDate) return null;
    const range = this.LEVEL_RANGES.find(r => r.level === b.batchLevel);
    if (!range) return null;
    const d = new Date(b.batchStartDate);
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + (range.dayStart - 1));
    return d.toISOString();
  }

  private computedLevelEndIso(b: BatchRow): string | null {
    if (!b.batchStartDate) return null;
    const range = this.LEVEL_RANGES.find(r => r.level === b.batchLevel);
    if (!range) return null;
    const d = new Date(b.batchStartDate);
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + (range.dayEnd - 1));
    return d.toISOString();
  }

  levelStartIso(b: BatchRow): string | null {
    return this.levelOverrideIso(b, 'startDate') ?? this.computedLevelStartIso(b);
  }

  levelEndIso(b: BatchRow): string | null {
    return this.levelOverrideIso(b, 'endDate') ?? this.computedLevelEndIso(b);
  }

  levelStartDate(b: BatchRow): string {
    return this.fmtShortDate(this.levelStartIso(b));
  }

  levelEndDate(b: BatchRow): string {
    return this.fmtShortDate(this.levelEndIso(b));
  }

  openDateModal(b: BatchRow, event: Event): void {
    event.stopPropagation();
    if (!this.canEditBatchDates) return;
    this.dateModalBatch = b;
    this.dateModalBatchStart = this.toInputDate(b.batchStartDate);
    this.dateModalLevelStart = this.toInputDate(this.levelStartIso(b));
    this.dateModalLevelEnd = this.toInputDate(this.levelEndIso(b));
    this.dateModalError = '';
    this.dateModalOpen = true;
  }

  closeDateModal(): void {
    if (this.dateModalSaving) return;
    this.dateModalOpen = false;
    this.dateModalBatch = null;
    this.dateModalError = '';
  }

  saveDateModal(): void {
    if (!this.dateModalBatch || !this.canEditBatchDates || this.dateModalSaving) return;
    const level = String(this.dateModalBatch.batchLevel || '').toUpperCase();
    if (!level) {
      this.dateModalError = 'Batch level is missing — cannot save level dates.';
      return;
    }

    this.dateModalSaving = true;
    this.dateModalError = '';

    const levelDatesUpdate: LevelCalendarDates = {
      [level]: {
        startDate: this.dateModalLevelStart || null,
        endDate: this.dateModalLevelEnd || null,
      },
    };

    const payload = {
      batchStartDate: this.dateModalBatchStart || null,
      levelCalendarDates: levelDatesUpdate,
    };

    this.http.put<{ config?: { batchStartDate?: string | null; batchCurrentDay?: number; levelCalendarDates?: LevelCalendarDates } }>(
      `${this.api}/batch-journey/${encodeURIComponent(this.dateModalBatch.batchName)}`,
      payload,
      { withCredentials: true }
    ).subscribe({
      next: (res) => {
        const cfg = res.config;
        const idx = this.batches.findIndex(row => row.batchName === this.dateModalBatch!.batchName);
        if (idx >= 0) {
          const updated = { ...this.batches[idx] };
          if (cfg?.batchStartDate !== undefined) {
            updated.batchStartDate = cfg.batchStartDate ? String(cfg.batchStartDate) : null;
          } else {
            updated.batchStartDate = this.dateModalBatchStart || null;
          }
          if (cfg?.batchCurrentDay != null) {
            updated.batchCurrentDay = cfg.batchCurrentDay;
          }
          const mergedDates = this.normalizeLevelCalendarDates({
            ...(updated.levelCalendarDates || {}),
            ...(cfg?.levelCalendarDates || levelDatesUpdate),
          });
          updated.levelCalendarDates = mergedDates;
          this.batches[idx] = updated;
        }
        this.dateModalSaving = false;
        this.dateModalOpen = false;
        this.dateModalBatch = null;
        this.notify.success('Batch dates saved');
      },
      error: (err) => {
        this.dateModalSaving = false;
        this.dateModalError = err.error?.message || 'Failed to save dates';
        this.notify.error(this.dateModalError);
      },
    });
  }

  engColor(pct: number): string {
    if (pct >= 70) return '#22c55e';
    if (pct >= 40) return '#f59e0b';
    return '#ef4444';
  }

  fmtMinutes(m: number): string {
    if (!m) return '0 min';
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return min ? `${h}h ${min}m` : `${h}h`;
    }
    return `${m}m`;
  }

  perStudent(total: number, students: number): string {
    if (!students) return '0';
    return (total / students).toFixed(1);
  }

  payPct(b: BatchRow): number {
    const exp = b.expectedLKR || b.expectedINR || 0;
    if (!exp) return 0;
    const paid = b.paidLKR || b.paidINR;
    return Math.min(100, Math.round((paid / exp) * 100));
  }

  formatLKR(n: number): string {
    if (!n) return '—';
    if (n >= 1_000_000) return `LKR ${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `LKR ${(n / 1000).toFixed(0)}K`;
    return `LKR ${n}`;
  }

  fmtTotal(lkr: number, inr: number): string {
    if (lkr > 0 && inr > 0) return `${this.short(lkr, 'LKR')} + ${this.short(inr, '₹')}`;
    if (lkr > 0) return this.short(lkr, 'LKR');
    if (inr > 0) return this.short(inr, '₹');
    return '—';
  }

  private short(n: number, p: string): string {
    if (n >= 10_000_000) return `${p} ${(n / 10_000_000).toFixed(1)}Cr`;
    if (n >= 100_000)    return `${p} ${(n / 100_000).toFixed(1)}L`;
    if (n >= 1000)       return `${p} ${(n / 1000).toFixed(0)}K`;
    return `${p} ${n}`;
  }

  exportCsv(): void {
    const rows = this.visibleBatches;
    if (!rows.length) return;

    const headers = [
      'Batch', 'Teacher', 'Journey', 'Batch Start Date', 'Level Start Date', 'Level End Date', 'Students',
      'Classes %', 'Exercises %', 'DG %', 'Arena %', 'Engagement %', 'Engagement min/wk',
      ...(this.canViewFinance ? ['Received LKR', 'Pending LKR', 'Received INR', 'Pending INR'] : []),
      'Health %', 'Health Status'
    ];

    const csvRows = rows.map(b => [
      b.batchName,
      b.teacherName || '',
      `${b.batchCurrentDay} ${(b.batchLevel || '').toLowerCase()}`,
      this.fmtShortDate(b.batchStartDate),
      this.levelStartDate(b),
      this.levelEndDate(b),
      b.studentCount,
      b.progressLoaded ? b.classAttendancePct : '',
      b.progressLoaded ? b.exerciseCompletionPct : '',
      b.progressLoaded ? b.dgBotCompletionPct : '',
      b.progressLoaded ? b.arenaEngagementPct : '',
      b.progressLoaded ? b.engagementPct : '',
      b.progressLoaded ? b.avgWeeklyMinutesPerStudent : '',
      ...(this.canViewFinance ? [b.paidLKR || '', b.remainingLKR || '', b.paidINR || '', b.remainingINR || ''] : []),
      b.progressLoaded ? b.health : '',
      b.progressLoaded ? b.healthLabel : '',
    ]);

    const csv = [headers, ...csvRows]
      .map(row => row.map(col => this.csvValue(col)).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `live-batch-overview-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private csvValue(v: string | number): string {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

}
