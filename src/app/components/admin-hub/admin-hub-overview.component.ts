import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

// ── Minimum batch number to include (35 → shows 35,36,…46,47 automatically) ──
const MIN_BATCH_NUMBER = 35;

/** Known test / legacy batch labels — never shown on this dashboard */
const EXCLUDED_BATCH_KEYS = new Set([
  '100',
  'batch-2024-a',
  'test batch',
]);

interface BatchRow {
  batchName: string;
  batchNum: number;           // extracted number from name
  batchCurrentDay: number;
  journeyLength: number;
  studentCount: number;
  studentsBehindCount: number;
  teacherName: string | null;
  journeyActive: boolean;
  // payment
  paidLKR: number;
  paidINR: number;
  expectedLKR: number;
  expectedINR: number;
  overdueLKR: number;
  // progress (loaded lazily)
  totalClassesAttended: number;
  totalExercisesCompleted: number;
  totalDgBotCompleted: number;
  totalArenaCompleted: number;
  progressLoaded: boolean;
  // computed
  health: number;
  healthLabel: string;
  healthColor: string;
}

@Component({
  selector: 'app-admin-hub-overview',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="ov">

  <!-- ── Loading ── -->
  <ng-container *ngIf="loading">
    <div class="ov-kpi-row">
      <div class="ov-kpi sk" *ngFor="let _ of [1,2,3,4,5]"></div>
    </div>
    <div class="ov-list">
      <div class="ov-row sk" *ngFor="let _ of [1,2,3,4,5,6,7,8]"></div>
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
      <div class="ov-header__right">
        <span class="ov-header__count">{{ batches.length }} active batches</span>
      </div>
    </div>

    <!-- KPI strip -->
    <div class="ov-kpi-row">
      <div class="ov-kpi ov-kpi--blue">
        <span class="ov-kpi__icon material-icons">groups</span>
        <div class="ov-kpi__body">
          <span class="ov-kpi__val">{{ kpi.totalStudents }}</span>
          <span class="ov-kpi__lbl">Total Students</span>
        </div>
      </div>
      <div class="ov-kpi ov-kpi--red" *ngIf="kpi.totalBehind > 0">
        <span class="ov-kpi__icon material-icons">trending_down</span>
        <div class="ov-kpi__body">
          <span class="ov-kpi__val">{{ kpi.totalBehind }}</span>
          <span class="ov-kpi__lbl">Behind Journey</span>
        </div>
      </div>
      <div class="ov-kpi ov-kpi--green" *ngIf="kpi.totalBehind === 0">
        <span class="ov-kpi__icon material-icons">check_circle</span>
        <div class="ov-kpi__body">
          <span class="ov-kpi__val">All</span>
          <span class="ov-kpi__lbl">On Track</span>
        </div>
      </div>
      <div class="ov-kpi ov-kpi--purple">
        <span class="ov-kpi__icon material-icons">paid</span>
        <div class="ov-kpi__body">
          <span class="ov-kpi__val">{{ fmtTotal(kpi.totalPaidLKR, kpi.totalPaidINR) }}</span>
          <span class="ov-kpi__lbl">Collected</span>
        </div>
      </div>
      <div class="ov-kpi ov-kpi--orange" *ngIf="kpi.totalOverdueLKR > 0">
        <span class="ov-kpi__icon material-icons">schedule</span>
        <div class="ov-kpi__body">
          <span class="ov-kpi__val">{{ formatLKR(kpi.totalOverdueLKR) }}</span>
          <span class="ov-kpi__lbl">Overdue (LKR)</span>
        </div>
      </div>
      <div class="ov-kpi ov-kpi--teal">
        <span class="ov-kpi__icon material-icons">favorite</span>
        <div class="ov-kpi__body">
          <span class="ov-kpi__val">{{ avgHealth }}%</span>
          <span class="ov-kpi__lbl">Avg Batch Health</span>
        </div>
      </div>
    </div>

    <!-- Empty -->
    <div class="ov-empty" *ngIf="batches.length === 0">
      <span class="material-icons">inbox</span>
      <p>No active batches found for Batch {{ minBatch }}+</p>
    </div>

    <!-- Batch list — one full-width row per batch -->
    <div class="ov-list" *ngIf="batches.length > 0">
      <div
        class="ov-row"
        *ngFor="let b of batches"
        [class.ov-row--healthy]="b.progressLoaded && b.health >= 70"
        [class.ov-row--warning]="b.progressLoaded && b.health >= 40 && b.health < 70"
        [class.ov-row--critical]="b.progressLoaded && b.health < 40"
      >
        <!-- Left: batch identity + journey -->
        <div class="ov-row__identity">
          <div class="ov-row__batch-badge">Batch {{ b.batchName }}</div>
          <div class="ov-row__teacher" *ngIf="b.teacherName">
            <span class="material-icons">person</span>{{ b.teacherName }}
          </div>
          <div class="ov-row__journey-meta">
            <span class="ov-row__day-pill">
              <span class="material-icons">route</span>
              Day {{ b.batchCurrentDay }} / {{ b.journeyLength }}
            </span>
            <span class="ov-row__journey-pct">{{ journeyPct(b) | number:'1.0-0' }}% journey done</span>
          </div>
          <div class="ov-row__prog">
            <div class="ov-row__prog-fill" [style.width]="journeyPct(b) + '%'"></div>
          </div>
        </div>

        <!-- Middle: engagement metrics -->
        <div class="ov-row__metrics">
          <div class="ov-metric">
            <span class="material-icons ov-metric__ico ov-metric__ico--blue">people</span>
            <div class="ov-metric__body">
              <span class="ov-metric__val">{{ b.studentCount }}</span>
              <span class="ov-metric__lbl">Students</span>
            </div>
          </div>

          <div class="ov-metric" [class.ov-metric--alert]="b.studentsBehindCount > 0">
            <span class="material-icons ov-metric__ico" [class.ov-metric__ico--red]="b.studentsBehindCount > 0" [class.ov-metric__ico--green]="b.studentsBehindCount === 0">
              {{ b.studentsBehindCount > 0 ? 'person_off' : 'how_to_reg' }}
            </span>
            <div class="ov-metric__body">
              <span class="ov-metric__val">{{ b.studentsBehindCount }}</span>
              <span class="ov-metric__lbl">Behind</span>
            </div>
          </div>

          <div class="ov-metric" [class.ov-metric--loading]="!b.progressLoaded">
            <span class="material-icons ov-metric__ico ov-metric__ico--indigo">video_call</span>
            <div class="ov-metric__body">
              <span class="ov-metric__val" *ngIf="b.progressLoaded">{{ b.totalClassesAttended }}</span>
              <span class="ov-metric__sub" *ngIf="b.progressLoaded && b.studentCount">{{ perStudent(b.totalClassesAttended, b.studentCount) }}/stu</span>
              <span class="ov-metric__sk" *ngIf="!b.progressLoaded"></span>
              <span class="ov-metric__lbl">Classes</span>
            </div>
          </div>

          <div class="ov-metric" [class.ov-metric--loading]="!b.progressLoaded">
            <span class="material-icons ov-metric__ico ov-metric__ico--teal">assignment_turned_in</span>
            <div class="ov-metric__body">
              <span class="ov-metric__val" *ngIf="b.progressLoaded">{{ b.totalExercisesCompleted }}</span>
              <span class="ov-metric__sub" *ngIf="b.progressLoaded && b.studentCount">{{ perStudent(b.totalExercisesCompleted, b.studentCount) }}/stu</span>
              <span class="ov-metric__sk" *ngIf="!b.progressLoaded"></span>
              <span class="ov-metric__lbl">Exercises</span>
            </div>
          </div>

          <div class="ov-metric" [class.ov-metric--loading]="!b.progressLoaded">
            <span class="material-icons ov-metric__ico ov-metric__ico--amber">smart_toy</span>
            <div class="ov-metric__body">
              <span class="ov-metric__val" *ngIf="b.progressLoaded">{{ b.totalDgBotCompleted }}</span>
              <span class="ov-metric__sub" *ngIf="b.progressLoaded && b.studentCount">{{ perStudent(b.totalDgBotCompleted, b.studentCount) }}/stu</span>
              <span class="ov-metric__sk" *ngIf="!b.progressLoaded"></span>
              <span class="ov-metric__lbl">DG Modules</span>
            </div>
          </div>

          <div class="ov-metric" [class.ov-metric--loading]="!b.progressLoaded">
            <span class="material-icons ov-metric__ico ov-metric__ico--purple">sports_esports</span>
            <div class="ov-metric__body">
              <span class="ov-metric__val" *ngIf="b.progressLoaded">{{ b.totalArenaCompleted }}</span>
              <span class="ov-metric__sub" *ngIf="b.progressLoaded && b.studentCount">{{ perStudent(b.totalArenaCompleted, b.studentCount) }}/stu</span>
              <span class="ov-metric__sk" *ngIf="!b.progressLoaded"></span>
              <span class="ov-metric__lbl">Arena</span>
            </div>
          </div>

          <div class="ov-metric ov-metric--pay" *ngIf="b.expectedLKR > 0 || b.expectedINR > 0">
            <span class="material-icons ov-metric__ico ov-metric__ico--green">paid</span>
            <div class="ov-metric__body">
              <span class="ov-metric__val ov-metric__val--sm">{{ formatPayDisplay(b) }}</span>
              <span class="ov-metric__sub ov-metric__sub--good">{{ payPct(b) | number:'1.0-0' }}% collected</span>
              <span class="ov-metric__lbl">Payments</span>
            </div>
          </div>
        </div>

        <!-- Right: health -->
        <div class="ov-row__health">
          <div class="ov-health ov-health--lg" [class.ov-health--good]="b.health >= 70" [class.ov-health--warn]="b.health >= 40 && b.health < 70" [class.ov-health--bad]="b.health < 40" *ngIf="b.progressLoaded">
            <svg viewBox="0 0 36 36" class="ov-health__ring">
              <circle class="ov-health__bg" cx="18" cy="18" r="15.9" fill="none" stroke-width="3"/>
              <circle class="ov-health__arc" cx="18" cy="18" r="15.9" fill="none" stroke-width="3"
                [attr.stroke-dasharray]="b.health + ', 100'" stroke-linecap="round" transform="rotate(-90 18 18)"/>
            </svg>
            <div class="ov-health__pct">{{ b.health | number:'1.0-0' }}<span class="ov-health__sym">%</span></div>
          </div>
          <div class="ov-health ov-health--loading" *ngIf="!b.progressLoaded">
            <div class="sk-ring sk-ring--lg"></div>
          </div>
          <span class="ov-row__health-badge" *ngIf="b.progressLoaded" [style.background]="b.healthColor + '18'" [style.color]="b.healthColor">
            {{ b.healthLabel }}
          </span>
          <span class="ov-row__health-hint" *ngIf="b.progressLoaded">Health score</span>
        </div>
      </div>
    </div>
  </ng-container>
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
.ov-header__count {
  font-size: 0.7rem;
  font-weight: 700;
  color: #475569;
  background: #fff;
  border: 1px solid #e2e8f0;
  padding: 4px 10px;
  border-radius: 999px;
}

/* ── KPI strip ── */
.ov-kpi-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
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

/* ── Batch list (one row per batch) ── */
.ov-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ov-row {
  display: flex;
  align-items: stretch;
  gap: 0;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 1px 8px rgba(15,23,42,0.07);
  overflow: hidden;
  border-left: 4px solid #e2e8f0;
  transition: box-shadow 0.15s;

  &:hover { box-shadow: 0 4px 16px rgba(15,23,42,0.11); }
  &.ov-row--healthy { border-left-color: #22c55e; }
  &.ov-row--warning { border-left-color: #f59e0b; }
  &.ov-row--critical { border-left-color: #ef4444; }
}

/* Left column — identity */
.ov-row__identity {
  flex: 0 0 200px;
  min-width: 180px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #f8fafc 0%, #fff 100%);
  border-right: 1px solid #f1f5f9;
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
}
.ov-row__batch-badge {
  font-size: 1.05rem;
  font-weight: 900;
  color: #0f172a;
  letter-spacing: -0.03em;
}
.ov-row__teacher {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.68rem;
  color: #64748b;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  .material-icons { font-size: 13px; opacity: 0.7; }
}
.ov-row__journey-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.ov-row__day-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: #1e3a8a;
  color: #fff;
  font-size: 0.62rem;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 999px;
  .material-icons { font-size: 11px; opacity: 0.75; }
}
.ov-row__journey-pct {
  font-size: 0.62rem;
  color: #94a3b8;
  font-weight: 600;
}
.ov-row__prog {
  height: 5px;
  background: #e2e8f0;
  border-radius: 999px;
  overflow: hidden;
  margin-top: 4px;
}
.ov-row__prog-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6);
  border-radius: 999px;
  transition: width 0.6s ease;
}

/* Middle — metrics strip */
.ov-row__metrics {
  flex: 1;
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  padding: 10px 8px;
  gap: 0;
  min-width: 0;
}
.ov-metric {
  flex: 1;
  min-width: 72px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-right: 1px solid #f1f5f9;

  &:last-child { border-right: none; }
  &.ov-metric--alert { background: #fff7ed; }
  &.ov-metric--loading { min-height: 56px; }
  &.ov-metric--pay { background: #f0fdf4; }
}
.ov-metric__ico {
  font-size: 20px;
  flex-shrink: 0;
  opacity: 0.85;
  &.ov-metric__ico--blue   { color: #3b82f6; }
  &.ov-metric__ico--red    { color: #ef4444; }
  &.ov-metric__ico--green  { color: #22c55e; }
  &.ov-metric__ico--indigo { color: #6366f1; }
  &.ov-metric__ico--teal   { color: #14b8a6; }
  &.ov-metric__ico--amber  { color: #f59e0b; }
  &.ov-metric__ico--purple { color: #8b5cf6; }
}
.ov-metric__body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.ov-metric__val {
  font-size: 1rem;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.04em;
  line-height: 1.1;
  &.ov-metric__val--sm { font-size: 0.78rem; }
}
.ov-metric__sub {
  font-size: 0.58rem;
  color: #94a3b8;
  font-weight: 600;
  &.ov-metric__sub--good { color: #16a34a; }
}
.ov-metric__lbl {
  font-size: 0.58rem;
  color: #94a3b8;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 2px;
}
.ov-metric__sk {
  width: 36px; height: 14px; border-radius: 4px;
  background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s linear infinite;
}

/* Right — health */
.ov-row__health {
  flex: 0 0 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 14px;
  background: #fafbfc;
  border-left: 1px solid #f1f5f9;
}
.ov-row__health-badge {
  font-size: 0.6rem;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 999px;
  text-align: center;
  white-space: nowrap;
}
.ov-row__health-hint {
  font-size: 0.55rem;
  color: #94a3b8;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Health ring */
.ov-health {
  position: relative;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  &.ov-health--lg { width: 56px; height: 56px; }
}
.ov-health--lg .ov-health__ring { width: 56px; height: 56px; }
.ov-health__ring { width: 48px; height: 48px; }
.ov-health__bg { stroke: #e2e8f0; }
.ov-health__arc { stroke: #22c55e; transition: stroke-dasharray 0.8s; }
.ov-health--good .ov-health__arc { stroke: #22c55e; }
.ov-health--warn .ov-health__arc { stroke: #f59e0b; }
.ov-health--bad  .ov-health__arc { stroke: #ef4444; }
.ov-health__pct {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 900;
  color: #0f172a;
  letter-spacing: -0.04em;
}
.ov-health__sym { font-size: 0.52rem; opacity: 0.6; }
.ov-health--loading { display: flex; align-items: center; justify-content: center; }
.sk-ring {
  width: 40px; height: 40px; border-radius: 50%;
  background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s linear infinite;
  &.sk-ring--lg { width: 48px; height: 48px; }
}

/* ── Skeleton ── */
.ov-kpi.sk { min-height: 56px; border-radius: 12px; }
.ov-row.sk { min-height: 88px; border-radius: 14px; }
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
@media (max-width: 1100px) {
  .ov-row { flex-wrap: wrap; }
  .ov-row__identity { flex: 1 1 100%; border-right: none; border-bottom: 1px solid #f1f5f9; }
  .ov-row__metrics { flex: 1 1 100%; }
  .ov-row__health {
    flex: 1 1 100%;
    flex-direction: row;
    justify-content: flex-start;
    border-left: none;
    border-top: 1px solid #f1f5f9;
    gap: 12px;
  }
}

@media (max-width: 640px) {
  .ov { padding: 12px 10px 28px; }
  .ov-kpi-row { gap: 6px; }
  .ov-kpi { min-width: 110px; padding: 10px 12px; }
  .ov-metric { min-width: 50%; border-right: none; border-bottom: 1px solid #f1f5f9; }
}
  `]
})
export class AdminHubOverviewComponent implements OnInit {
  loading = true;
  error = '';
  batches: BatchRow[] = [];
  readonly minBatch = MIN_BATCH_NUMBER;

  kpi = { totalStudents: 0, totalBehind: 0, totalPaidLKR: 0, totalPaidINR: 0, totalOverdueLKR: 0 };

  get avgHealth(): number {
    const loaded = this.batches.filter(b => b.progressLoaded);
    if (!loaded.length) return 0;
    return Math.round(loaded.reduce((s, b) => s + b.health, 0) / loaded.length);
  }

  private readonly api = environment.apiUrl;
  constructor(private http: HttpClient) {}

  ngOnInit(): void { this.load(); }

  private load(): void {
    forkJoin({
      journey: this.http.get<{ batches: any[]; upcomingBatches?: any[] }>(
        `${this.api}/batch-journey`, { withCredentials: true }
      ).pipe(catchError(() => of({ batches: [], upcomingBatches: [] }))),
      payment: this.http.get<{ data: { batches: any[] } }>(
        `${this.api}/payment-hub/batches/summary`, { withCredentials: true }
      ).pipe(catchError(() => of(null)))
    }).subscribe(({ journey, payment }) => {

      const all = [...(journey.batches || []), ...(journey.upcomingBatches || [])];

      // Filter: new-batch type, numeric batch name (35, 36, …), exclude test batches
      const filtered = all.filter(b => this.isEligibleBatch(b.batchName, b.batchType));

      // Sort by batch number ascending
      filtered.sort((a, b) => (this.extractBatchNumber(a.batchName) ?? 0) - (this.extractBatchNumber(b.batchName) ?? 0));

      // Payment lookup
      const payMap = new Map<string, any>();
      (payment?.data?.batches || []).forEach((p: any) => payMap.set(this.normKey(p.batch), p));

      this.batches = filtered.map(b => {
        const pk = this.normKey(b.batchName);
        const pay = payMap.get(pk) ?? {};
        const row: BatchRow = {
          batchName: b.batchName,
          batchNum: this.extractBatchNumber(b.batchName) ?? 0,
          batchCurrentDay: b.batchCurrentDay ?? 1,
          journeyLength: b.journeyLength ?? 200,
          studentCount: b.studentCount ?? 0,
          studentsBehindCount: b.studentsBehindCount ?? 0,
          teacherName: b.teacherName ?? null,
          journeyActive: !!b.journeyActive,
          paidLKR: pay.totalPaidLKR ?? 0,
          paidINR: pay.totalPaidINR ?? 0,
          expectedLKR: pay.totalExpectedLKR ?? pay.fullExpectedLKR ?? 0,
          expectedINR: pay.totalExpectedINR ?? pay.fullExpectedINR ?? 0,
          overdueLKR: pay.totalOverdueLKR ?? 0,
          totalClassesAttended: 0,
          totalExercisesCompleted: 0,
          totalDgBotCompleted: 0,
          totalArenaCompleted: 0,
          progressLoaded: false,
          health: 0,
          healthLabel: '',
          healthColor: '#94a3b8'
        };
        return row;
      });

      // KPIs
      this.kpi = {
        totalStudents: this.batches.reduce((s, b) => s + b.studentCount, 0),
        totalBehind: this.batches.reduce((s, b) => s + b.studentsBehindCount, 0),
        totalPaidLKR: this.batches.reduce((s, b) => s + b.paidLKR, 0),
        totalPaidINR: this.batches.reduce((s, b) => s + b.paidINR, 0),
        totalOverdueLKR: this.batches.reduce((s, b) => s + b.overdueLKR, 0)
      };

      this.loading = false;

      // Lazy-load progress for each batch individually (UI fills in as each responds)
      this.batches.forEach((b, idx) => {
        const name = encodeURIComponent(b.batchName);
        this.http.get<{ overall?: any }>(
          `${this.api}/batch-journey/${name}/progress?sections=overall`,
          { withCredentials: true }
        ).pipe(catchError(() => of(null))).subscribe(res => {
          const ov = res?.overall ?? {};
          const sc = b.studentCount || 1;
          const day = b.batchCurrentDay || 1;

          // ── Health score ─────────────────────────────────────────────────────
          // 35% regularity  (% students on track with journey)
          // 30% class attendance rate vs expected
          // 20% exercise completion rate vs expected
          // 10% DG Bot module completion rate vs expected
          // 5%  Arena engagement rate vs expected

          const regularity = ((sc - b.studentsBehindCount) / sc) * 100;

          // Expected classes per student ≈ 1 class every 2 journey days
          const expectedClassesPerStudent = Math.max(1, day / 2);
          const avgClassesPerStudent = (ov.totalClassesAttended ?? 0) / sc;
          const classRate = Math.min(100, (avgClassesPerStudent / expectedClassesPerStudent) * 100);

          // Expected exercises per student ≈ 1 per journey day
          const expectedExPerStudent = Math.max(1, day);
          const avgExPerStudent = (ov.totalExercisesCompleted ?? 0) / sc;
          const exRate = Math.min(100, (avgExPerStudent / expectedExPerStudent) * 100);

          // Expected DG Bot modules ≈ 1 per 2 journey days
          const expectedDgPerStudent = Math.max(1, day / 2);
          const avgDgPerStudent = (ov.totalDgBotCompleted ?? 0) / sc;
          const dgRate = Math.min(100, (avgDgPerStudent / expectedDgPerStudent) * 100);

          // Expected Arena plays ≈ 1 per 5 journey days (optional engagement)
          const expectedArenaPerStudent = Math.max(1, day / 5);
          const avgArenaPerStudent = (ov.totalArenaCompleted ?? 0) / sc;
          const arenaRate = Math.min(100, (avgArenaPerStudent / expectedArenaPerStudent) * 100);

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
            totalClassesAttended: ov.totalClassesAttended ?? 0,
            totalExercisesCompleted: ov.totalExercisesCompleted ?? 0,
            totalDgBotCompleted: ov.totalDgBotCompleted ?? 0,
            totalArenaCompleted: ov.totalArenaCompleted ?? 0,
            progressLoaded: true,
            health,
            healthLabel,
            healthColor
          };
        });
      });
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

  journeyPct(b: BatchRow): number {
    if (!b.journeyLength) return 0;
    return Math.min(100, Math.round((b.batchCurrentDay / b.journeyLength) * 100));
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

  formatPayDisplay(b: BatchRow): string {
    if (b.paidLKR > 0) return this.short(b.paidLKR, 'LKR');
    if (b.paidINR > 0) return this.short(b.paidINR, '₹');
    return 'No data';
  }
}
