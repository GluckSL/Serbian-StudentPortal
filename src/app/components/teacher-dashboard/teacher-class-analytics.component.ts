import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { TeacherService } from '../../services/teacher.service';

@Component({
  selector: 'app-teacher-class-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="tca">
      <!-- Header -->
      <div class="tca__header">
        <button class="tca__back-btn" (click)="goBack()">
          <i class="fas fa-arrow-left"></i> My Classes
        </button>
        <h1 class="tca__title">
          <i class="fas fa-chart-line"></i>
          Live Class Participation &amp; Arena Analytics
        </h1>
        <p class="tca__subtitle">Attendance, portal engagement, and GlückArena performance across all your classes</p>
      </div>

      <!-- Loading -->
      <div *ngIf="loading" class="tca__loading">
        <div class="tca__skeleton" *ngFor="let i of skeletons"></div>
      </div>

      <!-- Error -->
      <div *ngIf="!loading && error" class="tca__error">
        <i class="fas fa-exclamation-triangle"></i> {{ error }}
        <button (click)="load()">Retry</button>
      </div>

      <ng-container *ngIf="!loading && !error && data">
        <!-- Top summary -->
        <div class="tca__summary-grid">
          <div class="tca__stat tca__stat--blue">
            <i class="fas fa-video"></i>
            <div>
              <span class="tca__stat-val">{{ data.summary.totalMeetings }}</span>
              <span class="tca__stat-lbl">Total Classes</span>
            </div>
          </div>
          <div class="tca__stat tca__stat--green">
            <i class="fas fa-users"></i>
            <div>
              <span class="tca__stat-val">{{ data.summary.totalStudents }}</span>
              <span class="tca__stat-lbl">Unique Students</span>
            </div>
          </div>
          <div class="tca__stat tca__stat--violet">
            <i class="fas fa-check-double"></i>
            <div>
              <span class="tca__stat-val">
                {{ data.summary.avgAttendanceRate !== null ? (data.summary.avgAttendanceRate + '%') : '—' }}
              </span>
              <span class="tca__stat-lbl">Avg Attendance</span>
            </div>
          </div>
          <div class="tca__stat tca__stat--amber">
            <i class="fas fa-gamepad"></i>
            <div>
              <span class="tca__stat-val">{{ data.summary.totalArenaStudents }}</span>
              <span class="tca__stat-lbl">Arena Students</span>
            </div>
          </div>
        </div>

        <!-- Batch breakdown -->
        <div class="tca__section" *ngIf="data.batchBreakdown?.length > 0">
          <h2 class="tca__section-title"><i class="fas fa-layer-group"></i> Batch Performance</h2>
          <div class="tca__table-wrap">
            <table class="tca__table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Classes</th>
                  <th>Students</th>
                  <th>Attendance Rate</th>
                  <th>Arena Players</th>
                  <th>Arena Engagement</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let b of data.batchBreakdown">
                  <td><span class="tca__batch-chip">{{ b.batch }}</span></td>
                  <td>{{ b.meetings }}</td>
                  <td>{{ b.totalStudents }}</td>
                  <td>
                    <div class="tca__bar-wrap">
                      <div class="tca__bar" [style.width.%]="b.attendanceRate || 0"
                        [class.tca__bar--high]="(b.attendanceRate || 0) >= 75"
                        [class.tca__bar--mid]="(b.attendanceRate || 0) >= 50 && (b.attendanceRate || 0) < 75"
                        [class.tca__bar--low]="(b.attendanceRate || 0) < 50"></div>
                      <span class="tca__bar-label">{{ b.attendanceRate !== null ? (b.attendanceRate + '%') : '—' }}</span>
                    </div>
                  </td>
                  <td>{{ b.arenaParticipants }}</td>
                  <td>
                    <span class="tca__engage-badge"
                      [class.tca__engage-badge--high]="(b.arenaEngagementRate || 0) >= 60"
                      [class.tca__engage-badge--mid]="(b.arenaEngagementRate || 0) >= 30 && (b.arenaEngagementRate || 0) < 60"
                      [class.tca__engage-badge--low]="(b.arenaEngagementRate || 0) < 30">
                      {{ b.arenaEngagementRate !== null ? (b.arenaEngagementRate + '%') : '—' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Recent meetings -->
        <div class="tca__section" *ngIf="data.meetingRows?.length > 0">
          <h2 class="tca__section-title"><i class="fas fa-calendar-alt"></i> Recent Classes</h2>
          <div class="tca__table-wrap">
            <table class="tca__table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Batch</th>
                  <th>Date</th>
                  <th>Day</th>
                  <th>Students</th>
                  <th>Present</th>
                  <th>Absent</th>
                  <th>Attendance %</th>
                  <th>Arena Players</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let m of data.meetingRows">
                  <td class="tca__topic">{{ m.topic }}</td>
                  <td><span class="tca__batch-chip">{{ m.batch }}</span></td>
                  <td class="tca__date">{{ m.startTime | date:'MMM d, y' }}</td>
                  <td>
                    <span *ngIf="m.courseDay" class="tca__day-chip">Day {{ m.courseDay }}</span>
                    <span *ngIf="!m.courseDay" class="tca__na">—</span>
                  </td>
                  <td>{{ m.total }}</td>
                  <td><span class="tca__present-num">{{ m.present }}</span></td>
                  <td><span class="tca__absent-num">{{ m.absent }}</span></td>
                  <td>
                    <div class="tca__bar-wrap tca__bar-wrap--sm">
                      <div class="tca__bar" [style.width.%]="m.attendanceRate || 0"
                        [class.tca__bar--high]="(m.attendanceRate || 0) >= 75"
                        [class.tca__bar--mid]="(m.attendanceRate || 0) >= 50 && (m.attendanceRate || 0) < 75"
                        [class.tca__bar--low]="(m.attendanceRate || 0) < 50"></div>
                      <span class="tca__bar-label">{{ m.attendanceRate !== null ? (m.attendanceRate + '%') : '—' }}</span>
                    </div>
                  </td>
                  <td>
                    <span *ngIf="m.arenaParticipants > 0" class="tca__arena-count">
                      <i class="fas fa-gamepad"></i> {{ m.arenaParticipants }}
                    </span>
                    <span *ngIf="m.arenaParticipants === 0" class="tca__na">—</span>
                  </td>
                  <td>
                    <button class="tca__view-btn" [routerLink]="['/teacher-dashboard/live-participation', m._id]">
                      <i class="fas fa-users"></i> View
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Top arena performers -->
        <div class="tca__section" *ngIf="data.topPerformers?.length > 0">
          <h2 class="tca__section-title"><i class="fas fa-trophy"></i> Top Arena Performers</h2>
          <div class="tca__performers-grid">
            <div class="tca__performer" *ngFor="let p of data.topPerformers.slice(0, 12); let i = index">
              <div class="tca__performer-rank"
                [class.tca__performer-rank--gold]="i === 0"
                [class.tca__performer-rank--silver]="i === 1"
                [class.tca__performer-rank--bronze]="i === 2">
                #{{ i + 1 }}
              </div>
              <div class="tca__performer-info">
                <div class="tca__performer-name">{{ p.name }}</div>
                <div class="tca__performer-meta">
                  <span class="tca__batch-chip">{{ p.batch }}</span>
                  <span *ngIf="p.level" class="tca__level-chip">{{ p.level }}</span>
                </div>
              </div>
              <div class="tca__performer-stats">
                <span class="tca__xp"><i class="fas fa-bolt"></i> {{ p.totalXp | number }}</span>
                <span class="tca__accuracy-sm" *ngIf="p.accuracy">{{ p.accuracy }}%</span>
                <span *ngIf="p.currentStreak > 0" class="tca__streak-sm"><i class="fas fa-fire"></i> {{ p.currentStreak }}</span>
              </div>
            </div>
          </div>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .tca { padding: 16px; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 1300px; margin: 0 auto; }

    /* Header */
    .tca__header { background: #b3cde0; border-radius: 14px; padding: 16px 18px; margin-bottom: 14px; }
    .tca__back-btn { display: inline-flex; align-items: center; gap: 6px; background: rgba(1,31,75,0.12); border: none; border-radius: 8px; padding: 5px 12px; font-size: 11px; font-weight: 600; color: #011f4b; cursor: pointer; margin-bottom: 10px; }
    .tca__back-btn:hover { background: rgba(1,31,75,0.2); }
    .tca__title { font-size: 15px; font-weight: 800; color: #011f4b; margin: 0 0 4px; display: flex; align-items: center; gap: 7px; }
    .tca__subtitle { font-size: 11px; color: #011f4b; opacity: 0.65; margin: 0; }

    /* Loading */
    .tca__loading { display: flex; flex-direction: column; gap: 10px; }
    .tca__skeleton { height: 48px; border-radius: 10px; background: linear-gradient(90deg,#e8ecf4 25%,#f4f6fb 50%,#e8ecf4 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* Error */
    .tca__error { padding: 20px; text-align: center; color: #c62828; background: #ffebee; border-radius: 12px; }
    .tca__error button { margin-left: 10px; padding: 4px 12px; border-radius: 6px; border: 1px solid #c62828; background: transparent; color: #c62828; cursor: pointer; }

    /* Summary */
    .tca__summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
    @media (max-width: 700px) { .tca__summary-grid { grid-template-columns: repeat(2, 1fr); } }
    .tca__stat { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 12px; border: 1px solid #e8ecf4; background: #fff; box-shadow: 0 2px 8px rgba(15,23,42,0.06); }
    .tca__stat > i { font-size: 20px; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .tca__stat--blue > i { background: #dbeafe; color: #1d4ed8; }
    .tca__stat--green > i { background: #dcfce7; color: #15803d; }
    .tca__stat--violet > i { background: #ede9fe; color: #7c3aed; }
    .tca__stat--amber > i { background: #fef3c7; color: #d97706; }
    .tca__stat-val { display: block; font-size: 22px; font-weight: 800; color: #011f4b; line-height: 1; }
    .tca__stat-lbl { display: block; font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-top: 2px; }

    /* Section */
    .tca__section { margin-bottom: 16px; }
    .tca__section-title { font-size: 13px; font-weight: 800; color: #011f4b; margin: 0 0 10px; display: flex; align-items: center; gap: 7px; }
    .tca__section-title i { color: #005b96; font-size: 12px; }

    /* Table */
    .tca__table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid #e8ecf4; background: #fff; box-shadow: 0 2px 8px rgba(15,23,42,0.05); }
    .tca__table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .tca__table thead th { padding: 9px 12px; background: #f1f5f9; color: #475569; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #e8ecf4; white-space: nowrap; text-align: left; }
    .tca__table tbody tr { border-bottom: 1px solid #f1f5f9; }
    .tca__table tbody tr:last-child { border-bottom: none; }
    .tca__table tbody tr:hover { background: #f8fafc; }
    .tca__table td { padding: 9px 12px; vertical-align: middle; }
    .tca__topic { font-weight: 700; color: #011f4b; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tca__date { color: #64748b; white-space: nowrap; font-size: 11px; }
    .tca__batch-chip { display: inline-block; padding: 2px 7px; border-radius: 20px; background: #dbeafe; color: #1d4ed8; font-size: 10px; font-weight: 700; }
    .tca__level-chip { display: inline-block; padding: 2px 7px; border-radius: 20px; background: #ede9fe; color: #7c3aed; font-size: 10px; font-weight: 700; margin-left: 3px; }
    .tca__day-chip { display: inline-block; padding: 2px 7px; border-radius: 20px; background: #d5f5e3; color: #1a7a4a; font-size: 10px; font-weight: 700; }
    .tca__na { color: #cbd5e1; font-size: 11px; }
    .tca__present-num { font-weight: 700; color: #15803d; }
    .tca__absent-num { font-weight: 700; color: #dc2626; }

    /* Bar */
    .tca__bar-wrap { display: flex; align-items: center; gap: 6px; min-width: 80px; }
    .tca__bar-wrap--sm { min-width: 60px; }
    .tca__bar { height: 6px; border-radius: 3px; flex: 1; transition: width 0.3s; }
    .tca__bar--high { background: #15803d; }
    .tca__bar--mid { background: #d97706; }
    .tca__bar--low { background: #dc2626; }
    .tca__bar-label { font-size: 10px; font-weight: 700; color: #475569; white-space: nowrap; }

    /* Engagement badge */
    .tca__engage-badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; }
    .tca__engage-badge--high { background: #dcfce7; color: #15803d; }
    .tca__engage-badge--mid { background: #fef3c7; color: #d97706; }
    .tca__engage-badge--low { background: #fee2e2; color: #dc2626; }

    /* Arena count */
    .tca__arena-count { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: #7c3aed; }

    /* View btn */
    .tca__view-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border: 1.5px solid #005b96; border-radius: 8px; background: transparent; color: #005b96; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
    .tca__view-btn:hover { background: #005b96; color: #fff; }

    /* Performers */
    .tca__performers-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
    .tca__performer { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; border: 1px solid #e8ecf4; background: #fff; box-shadow: 0 1px 6px rgba(15,23,42,0.05); }
    .tca__performer-rank { width: 32px; height: 32px; border-radius: 50%; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .tca__performer-rank--gold { background: #fef3c7; color: #d97706; }
    .tca__performer-rank--silver { background: #f1f5f9; color: #64748b; }
    .tca__performer-rank--bronze { background: #fff7ed; color: #ea580c; }
    .tca__performer-info { flex: 1; min-width: 0; }
    .tca__performer-name { font-size: 12px; font-weight: 700; color: #011f4b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tca__performer-meta { display: flex; gap: 3px; margin-top: 2px; }
    .tca__performer-stats { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
    .tca__xp { display: flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 700; color: #d97706; }
    .tca__accuracy-sm { font-size: 10px; font-weight: 700; color: #15803d; }
    .tca__streak-sm { font-size: 10px; font-weight: 700; color: #ea580c; display: flex; align-items: center; gap: 2px; }
  `]
})
export class TeacherClassAnalyticsComponent implements OnInit {
  loading = false;
  error = '';
  data: any = null;
  readonly skeletons = [0, 1, 2, 3, 4, 5];

  constructor(
    private router: Router,
    private teacherService: TeacherService
  ) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.error = '';
    this.teacherService.getClassAnalytics().subscribe({
      next: (res) => {
        this.data = res.data;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load analytics.';
        this.loading = false;
      }
    });
  }

  goBack() {
    this.router.navigate(['/teacher-dashboard/my-classes']);
  }
}
