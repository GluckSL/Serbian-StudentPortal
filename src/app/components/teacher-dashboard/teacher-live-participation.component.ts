import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TeacherService } from '../../services/teacher.service';

type StudentGameStatus = 'playing' | 'completed' | 'not_started';

@Component({
  selector: 'app-teacher-live-participation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="tgm">
      <div class="tgm__header">
        <button class="tgm__back" (click)="goBack()"><i class="fas fa-arrow-left"></i> My Classes</button>
        <div *ngIf="meeting">
          <h1 class="tgm__title">
            <i class="fas fa-gamepad"></i> Live Game Monitor
            <span class="tgm__live-dot" *ngIf="isClassLive"></span>
          </h1>
          <p class="tgm__sub">{{ meeting.topic || 'Class' }} · {{ meeting.batch }} · Day {{ meeting.courseDay ?? '—' }}</p>
          <div class="tgm__badges">
            <span class="tgm__badge" [class.tgm__badge--live]="meeting.status === 'started'">{{ meeting.status | titlecase }}</span>
            <span class="tgm__badge tgm__badge--muted" *ngIf="lastUpdated">Updated {{ lastUpdated | date:'h:mm:ss a' }}</span>
            <span class="tgm__badge tgm__badge--auto" *ngIf="autoRefresh"><i class="fas fa-sync-alt fa-spin"></i> Auto-refresh</span>
          </div>
        </div>
        <button type="button" class="tgm__refresh-btn" (click)="load()" [disabled]="loading">
          <i class="fas fa-sync-alt" [class.fa-spin]="loading"></i> Refresh now
        </button>
      </div>

      <div *ngIf="loading && !data" class="tgm__loading">
        <div class="tgm__skel" *ngFor="let i of skeletons"></div>
      </div>

      <div *ngIf="error" class="tgm__error">
        <i class="fas fa-exclamation-triangle"></i> {{ error }}
        <button (click)="load()">Retry</button>
      </div>

      <ng-container *ngIf="data && !error">
        <div class="tgm__warn" *ngIf="!data.games?.length">
          <i class="fas fa-info-circle"></i>
          No GlückArena game is linked to journey day {{ meeting?.courseDay ?? '—' }} for batch {{ meeting?.batch }}.
          Assign a game with this course day in GlückArena admin.
        </div>

        <div class="tgm__game-picker" *ngIf="data.games?.length > 1">
          <label>Game for this class</label>
          <select [(ngModel)]="selectedGameId" (ngModelChange)="onGameChange()">
            <option *ngFor="let g of data.games" [value]="g._id">
              {{ g.sequenceLetter ? g.sequenceLetter + ' · ' : '' }}{{ g.title }}
            </option>
          </select>
        </div>

        <div class="tgm__game-title" *ngIf="data.selectedGame">
          <strong>{{ data.selectedGame.title }}</strong>
          <span>{{ data.selectedGame.gameType | titlecase }} · {{ data.selectedGame.level || data.selectedGame.difficulty }}</span>
        </div>

        <div class="tgm__stats">
          <div class="tgm__stat tgm__stat--total">
            <span class="tgm__stat-n">{{ data.summary.total }}</span>
            <span class="tgm__stat-l">In batch</span>
          </div>
          <div class="tgm__stat tgm__stat--playing">
            <span class="tgm__stat-n">{{ data.summary.playing }}</span>
            <span class="tgm__stat-l">Playing now</span>
          </div>
          <div class="tgm__stat tgm__stat--done">
            <span class="tgm__stat-n">{{ data.summary.completed }}</span>
            <span class="tgm__stat-l">Finished</span>
          </div>
          <div class="tgm__stat tgm__stat--idle">
            <span class="tgm__stat-n">{{ data.summary.notStarted }}</span>
            <span class="tgm__stat-l">Not started</span>
          </div>
        </div>

        <div class="tgm__layout">
          <!-- Student participation list -->
          <section class="tgm__panel">
            <h2><i class="fas fa-users"></i> Batch participation</h2>
            <div class="tgm__filters">
              <input type="text" placeholder="Search student…" [(ngModel)]="search" (ngModelChange)="applyFilter()" />
              <div class="tgm__pills">
                <button [class.active]="filter === 'all'" (click)="setFilter('all')">All</button>
                <button [class.active]="filter === 'playing'" (click)="setFilter('playing')">Playing</button>
                <button [class.active]="filter === 'completed'" (click)="setFilter('completed')">Done</button>
                <button [class.active]="filter === 'not_started'" (click)="setFilter('not_started')">Not started</button>
              </div>
            </div>

            <div class="tgm__list" *ngIf="filteredStudents.length; else emptyList">
              <div
                class="tgm__row"
                *ngFor="let s of filteredStudents; let i = index"
                [class.tgm__row--playing]="s.status === 'playing'"
                [class.tgm__row--done]="s.status === 'completed'"
                [class.tgm__row--idle]="s.status === 'not_started'"
              >
                <span class="tgm__rank">{{ i + 1 }}</span>
                <div class="tgm__student">
                  <div class="tgm__name">{{ s.name }}</div>
                  <div class="tgm__email">{{ s.regNo || s.email }}</div>
                </div>
                <div class="tgm__status-wrap">
                  <span class="tgm__status" [attr.data-status]="s.status">
                    <i class="fas" [class.fa-circle]="s.status === 'playing'" [class.fa-check]="s.status === 'completed'" [class.fa-minus]="s.status === 'not_started'"></i>
                    {{ statusLabel(s.status) }}
                  </span>
                  <div class="tgm__progress" *ngIf="s.status !== 'not_started'">
                    <div class="tgm__progress-bar" [style.width.%]="s.progressPercent"></div>
                  </div>
                </div>
                <div class="tgm__score">
                  <ng-container *ngIf="s.status === 'playing'">
                    <strong>{{ s.activeAttempt?.score ?? 0 }}</strong> pts
                    <small>{{ s.activeAttempt?.correctAnswers ?? 0 }}/{{ s.activeAttempt?.totalQuestions ?? '?' }}</small>
                  </ng-container>
                  <ng-container *ngIf="s.status === 'completed'">
                    <strong>{{ s.bestCompleted?.score ?? 0 }}</strong> pts
                    <small>{{ s.bestCompleted?.accuracy ?? 0 }}%</small>
                  </ng-container>
                  <span *ngIf="s.status === 'not_started'" class="tgm__dash">—</span>
                </div>
              </div>
            </div>
            <ng-template #emptyList>
              <p class="tgm__empty">No students match this filter.</p>
            </ng-template>
          </section>

          <!-- Live leaderboard (mirrors what students see during play) -->
          <aside class="tgm__panel tgm__panel--lb">
            <h2><i class="fas fa-trophy"></i> Live leaderboard</h2>
            <p class="tgm__lb-hint">Updates every {{ refreshSec }}s while this page is open</p>
            <div *ngIf="!data.liveLeaderboard?.length" class="tgm__empty">No one has started the game yet.</div>
            <div class="tgm__lb" *ngFor="let e of data.liveLeaderboard">
              <span class="tgm__lb-rank" [class.tgm__lb-rank--top]="e.rank <= 3">#{{ e.rank }}</span>
              <div class="tgm__lb-body">
                <span class="tgm__lb-name">
                  {{ e.name }}
                  <span class="tgm__lb-live" *ngIf="e.isLive">LIVE</span>
                </span>
                <span class="tgm__lb-meta">{{ e.score }} pts · {{ e.accuracy }}%</span>
              </div>
            </div>
          </aside>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .tgm { padding: 16px; max-width: 1200px; margin: 0 auto; font-family: 'Inter', system-ui, sans-serif; }
    .tgm__header { background: #b3cde0; border-radius: 14px; padding: 14px 18px; margin-bottom: 14px; display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; justify-content: space-between; }
    .tgm__back { border: none; background: rgba(1,31,75,0.12); border-radius: 8px; padding: 5px 12px; font-size: 11px; font-weight: 600; color: #011f4b; cursor: pointer; }
    .tgm__title { margin: 0 0 4px; font-size: 16px; font-weight: 800; color: #011f4b; display: flex; align-items: center; gap: 8px; }
    .tgm__live-dot { width: 10px; height: 10px; border-radius: 50%; background: #dc2626; animation: pulse 1.2s infinite; }
    @keyframes pulse { 50% { opacity: 0.4; } }
    .tgm__sub { margin: 0 0 8px; font-size: 12px; color: #011f4b; opacity: 0.75; }
    .tgm__badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .tgm__badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; background: rgba(1,31,75,0.1); color: #011f4b; }
    .tgm__badge--live { background: #fee2e2; color: #b91c1c; }
    .tgm__badge--muted { background: #f1f5f9; color: #64748b; }
    .tgm__badge--auto { background: #dcfce7; color: #15803d; }
    .tgm__refresh-btn { border: 1.5px solid #005b96; background: #fff; color: #005b96; border-radius: 8px; padding: 8px 14px; font-size: 12px; font-weight: 700; cursor: pointer; align-self: center; }
    .tgm__refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .tgm__loading { display: flex; flex-direction: column; gap: 8px; }
    .tgm__skel { height: 48px; border-radius: 10px; background: linear-gradient(90deg,#e8ecf4 25%,#f4f6fb 50%,#e8ecf4 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .tgm__error, .tgm__warn { padding: 12px 16px; border-radius: 10px; margin-bottom: 12px; font-size: 12px; }
    .tgm__error { background: #fee2e2; color: #b91c1c; }
    .tgm__warn { background: #fff7ed; color: #9a3412; }
    .tgm__game-picker { margin-bottom: 12px; }
    .tgm__game-picker label { display: block; font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; }
    .tgm__game-picker select { width: 100%; max-width: 420px; padding: 8px 10px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 12px; }
    .tgm__game-title { margin-bottom: 12px; font-size: 13px; color: #011f4b; }
    .tgm__game-title span { margin-left: 8px; color: #64748b; font-size: 11px; }
    .tgm__stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
    @media (max-width: 640px) { .tgm__stats { grid-template-columns: repeat(2, 1fr); } }
    .tgm__stat { background: #fff; border: 1px solid #e8ecf4; border-radius: 12px; padding: 12px; text-align: center; box-shadow: 0 2px 8px rgba(15,23,42,0.05); }
    .tgm__stat-n { display: block; font-size: 24px; font-weight: 800; line-height: 1; }
    .tgm__stat-l { font-size: 10px; text-transform: uppercase; font-weight: 700; color: #64748b; }
    .tgm__stat--playing .tgm__stat-n { color: #7c3aed; }
    .tgm__stat--done .tgm__stat-n { color: #15803d; }
    .tgm__stat--idle .tgm__stat-n { color: #94a3b8; }
    .tgm__layout { display: grid; grid-template-columns: 1fr 320px; gap: 14px; }
    @media (max-width: 900px) { .tgm__layout { grid-template-columns: 1fr; } }
    .tgm__panel { background: #fff; border: 1px solid #e8ecf4; border-radius: 12px; padding: 14px; box-shadow: 0 2px 8px rgba(15,23,42,0.05); }
    .tgm__panel h2 { margin: 0 0 12px; font-size: 13px; font-weight: 800; color: #011f4b; display: flex; align-items: center; gap: 6px; }
    .tgm__filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .tgm__filters input { flex: 1; min-width: 140px; padding: 7px 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; }
    .tgm__pills { display: flex; gap: 4px; flex-wrap: wrap; }
    .tgm__pills button { border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 20px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; }
    .tgm__pills button.active { background: #011f4b; color: #fff; border-color: #011f4b; }
    .tgm__row { display: grid; grid-template-columns: 28px 1fr 120px 70px; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
    .tgm__row:last-child { border-bottom: none; }
    .tgm__row--playing { background: rgba(124,58,237,0.04); margin: 0 -8px; padding-left: 8px; padding-right: 8px; border-radius: 8px; }
    .tgm__rank { font-size: 11px; font-weight: 700; color: #94a3b8; }
    .tgm__name { font-size: 12px; font-weight: 700; color: #011f4b; }
    .tgm__email { font-size: 10px; color: #64748b; }
    .tgm__status { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }
    .tgm__status[data-status="playing"] { background: #ede9fe; color: #6d28d9; }
    .tgm__status[data-status="completed"] { background: #dcfce7; color: #15803d; }
    .tgm__status[data-status="not_started"] { background: #f1f5f9; color: #64748b; }
    .tgm__progress { height: 4px; background: #e2e8f0; border-radius: 2px; margin-top: 4px; overflow: hidden; }
    .tgm__progress-bar { height: 100%; background: #7c3aed; transition: width 0.3s; }
    .tgm__score { text-align: right; font-size: 11px; }
    .tgm__score strong { display: block; font-size: 13px; color: #011f4b; }
    .tgm__score small { color: #64748b; }
    .tgm__dash { color: #cbd5e1; }
    .tgm__empty { text-align: center; color: #94a3b8; font-size: 12px; padding: 24px 8px; }
    .tgm__lb-hint { font-size: 10px; color: #94a3b8; margin: -8px 0 12px; }
    .tgm__lb { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .tgm__lb-rank { width: 28px; font-weight: 800; font-size: 12px; color: #64748b; }
    .tgm__lb-rank--top { color: #d97706; }
    .tgm__lb-name { font-size: 12px; font-weight: 700; color: #011f4b; display: flex; align-items: center; gap: 6px; }
    .tgm__lb-live { font-size: 9px; background: #fee2e2; color: #dc2626; padding: 1px 5px; border-radius: 4px; animation: pulse 1.2s infinite; }
    .tgm__lb-meta { font-size: 10px; color: #64748b; display: block; }
  `]
})
export class TeacherLiveParticipationComponent implements OnInit, OnDestroy {
  loading = false;
  error = '';
  data: any = null;
  meeting: any = null;
  meetingId = '';
  selectedGameId = '';
  search = '';
  filter: 'all' | StudentGameStatus = 'all';
  filteredStudents: any[] = [];
  lastUpdated: Date | null = null;
  autoRefresh = false;
  readonly refreshSec = 5;
  readonly skeletons = [0, 1, 2, 3, 4, 5];

  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private teacherService: TeacherService
  ) {}

  ngOnInit() {
    this.meetingId = this.route.snapshot.paramMap.get('meetingId') || '';
    if (!this.meetingId) {
      this.error = 'No meeting ID provided.';
      return;
    }
    this.load(true);
    this.pollTimer = setInterval(() => this.load(false), this.refreshSec * 1000);
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  get isClassLive(): boolean {
    return this.meeting?.status === 'started';
  }

  load(showSpinner = true) {
    if (showSpinner) this.loading = true;
    this.autoRefresh = !showSpinner;
    const gameSetId = this.selectedGameId || undefined;
    this.teacherService.getMeetingLiveGameMonitor(this.meetingId, gameSetId).subscribe({
      next: (res) => {
        this.data = res.data;
        this.meeting = res.data?.meeting;
        if (!this.selectedGameId && res.data?.selectedGame?._id) {
          this.selectedGameId = String(res.data.selectedGame._id);
        }
        this.lastUpdated = new Date();
        this.loading = false;
        this.error = '';
        this.applyFilter();
      },
      error: (err) => {
        this.loading = false;
        this.autoRefresh = false;
        this.error = err?.error?.message || 'Failed to load live game data.';
      }
    });
  }

  onGameChange() {
    this.load(true);
  }

  applyFilter() {
    let list = [...(this.data?.students || [])];
    const q = this.search.trim().toLowerCase();
    if (q) {
      list = list.filter((s) =>
        s.name?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q) ||
        s.regNo?.toLowerCase().includes(q)
      );
    }
    if (this.filter !== 'all') list = list.filter((s) => s.status === this.filter);
    this.filteredStudents = list;
  }

  setFilter(f: 'all' | StudentGameStatus) {
    this.filter = f;
    this.applyFilter();
  }

  statusLabel(status: StudentGameStatus): string {
    if (status === 'playing') return 'Playing now';
    if (status === 'completed') return 'Finished';
    return 'Not started';
  }

  goBack() {
    this.router.navigate(['/teacher-dashboard/my-classes']);
  }
}
