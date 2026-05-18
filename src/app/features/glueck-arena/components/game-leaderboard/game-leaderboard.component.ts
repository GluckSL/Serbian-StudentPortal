import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { LeaderboardEntry, LeaderboardPeriod, StudentGameStats } from '../../glueck-arena.types';
import { GameStatsBannerComponent } from '../../shared/game-stats-banner/game-stats-banner.component';

@Component({
  selector: 'app-game-leaderboard',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule, GameStatsBannerComponent],
  template: `
    <div class="lb">
      <div class="lb__header">
        <button mat-icon-button routerLink="/glueck-arena">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div>
          <h1><mat-icon>leaderboard</mat-icon> GlückArena Leaderboard</h1>
          <p>See how you stack up against other students</p>
        </div>
      </div>

      <app-game-stats-banner [stats]="myStats"></app-game-stats-banner>

      <!-- Period tabs -->
      <mat-tab-group (selectedIndexChange)="onTabChange($event)" class="lb__tabs">
        <mat-tab label="All Time"></mat-tab>
        <mat-tab label="This Week"></mat-tab>
        <mat-tab label="Today"></mat-tab>
      </mat-tab-group>

      <mat-progress-bar *ngIf="loading" mode="indeterminate"></mat-progress-bar>

      <!-- Your rank callout -->
      <div class="lb__your-rank" *ngIf="studentRank">
        <mat-icon>person</mat-icon>
        Your rank: <strong>#{{ studentRank }}</strong>
        <span *ngIf="myStats" class="lb__your-rank__meta">· {{ myStats.totalXp }} XP · {{ myStats.gamesCompleted }} games</span>
      </div>

      <!-- Top 3 podium -->
      <div class="lb__podium" *ngIf="!loading && leaderboard.length >= 3">
        <div class="lb__podium__place lb__podium__place--2">
          <span class="lb__podium__name">{{ leaderboard[1]?.name }}</span>
          <div class="lb__podium__bar">
            <span class="lb__podium__xp">{{ leaderboard[1]?.totalXp }} XP</span>
            🥈
          </div>
        </div>
        <div class="lb__podium__place lb__podium__place--1">
          <span class="lb__podium__name">{{ leaderboard[0]?.name }}</span>
          <div class="lb__podium__bar">
            <span class="lb__podium__xp">{{ leaderboard[0]?.totalXp }} XP</span>
            🥇
          </div>
        </div>
        <div class="lb__podium__place lb__podium__place--3">
          <span class="lb__podium__name">{{ leaderboard[2]?.name }}</span>
          <div class="lb__podium__bar">
            <span class="lb__podium__xp">{{ leaderboard[2]?.totalXp }} XP</span>
            🥉
          </div>
        </div>
      </div>

      <!-- Full list -->
      <div class="lb__list" *ngIf="!loading">
        <div
          class="lb__row"
          *ngFor="let e of leaderboard"
          [class.lb__row--me]="isMe(e)"
        >
          <span class="lb__rank"
            [class.lb__rank--gold]="e.rank === 1"
            [class.lb__rank--silver]="e.rank === 2"
            [class.lb__rank--bronze]="e.rank === 3"
          >{{ e.rank }}</span>
          <div class="lb__avatar">{{ e.name?.charAt(0)?.toUpperCase() }}</div>
          <div class="lb__info">
            <span class="lb__name">{{ e.name }} <span *ngIf="isMe(e)" class="lb__you">(You)</span></span>
            <span class="lb__sub">
              {{ e.gamesCompleted ?? 0 }} games · Best: {{ e.bestScore ?? 0 }} pts
              <ng-container *ngIf="e.accuracy != null"> · {{ e.accuracy }}% accuracy</ng-container>
            </span>
          </div>
          <span class="lb__xp">⚡ {{ e.totalXp }}</span>
        </div>

        <div *ngIf="leaderboard.length === 0" class="lb__empty">
          <mat-icon>emoji_events</mat-icon>
          <p *ngIf="periodLabel === 'all' && myStats?.gamesCompleted">No other players ranked yet — you're leading with {{ myStats!.totalXp }} XP!</p>
          <p *ngIf="!(periodLabel === 'all' && myStats?.gamesCompleted)">No completed games for this period yet. Play a game to appear here!</p>
        </div>
      </div>

      <div class="lb__list lb__list--skel" *ngIf="loading">
        <div class="lb__row lb__row--skel" *ngFor="let _ of [1,2,3]"></div>
      </div>
    </div>
  `,
  styles: [`
    .lb { max-width: 850px; margin: 0 auto; padding: 24px 16px; }
    .lb__header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 20px; }
    .lb__header h1 { display: flex; align-items: center; gap: 8px; font-size: 24px; font-weight: 700; color: #405980; margin: 0; }
    .lb__header h1 mat-icon { font-size: 28px; width: 28px; height: 28px; }
    .lb__header p { color: #888; margin: 4px 0 0; }
    .lb__tabs { margin-bottom: 16px; }

    .lb__your-rank { background: #e8edf5; border-radius: 12px; padding: 10px 16px; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 15px; color: #405980; font-weight: 600; margin-bottom: 16px; }
    .lb__your-rank mat-icon { color: #405980; }
    .lb__your-rank__meta { font-weight: 500; font-size: 13px; color: #64748b; }

    .lb__podium { display: flex; align-items: flex-end; justify-content: center; gap: 8px; margin: 20px 0; height: 160px; }
    .lb__podium__place { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .lb__podium__name { font-size: 13px; font-weight: 600; color: #555; max-width: 90px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lb__podium__bar { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 90px; border-radius: 12px 12px 0 0; font-size: 24px; padding: 8px 0; }
    .lb__podium__xp { font-size: 12px; font-weight: 700; color: #fff; }
    .lb__podium__place--1 .lb__podium__bar { height: 110px; background: linear-gradient(180deg,#ffd700,#ffb300); }
    .lb__podium__place--2 .lb__podium__bar { height: 80px; background: linear-gradient(180deg,#b0bec5,#90a4ae); }
    .lb__podium__place--3 .lb__podium__bar { height: 60px; background: linear-gradient(180deg,#cd7f32,#a0522d); }

    .lb__list { display: flex; flex-direction: column; gap: 2px; }
    .lb__row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: #fff; border: 1px solid #f0f0f0; transition: background .2s; }
    .lb__row--me { background: #e8edf5 !important; border-color: #405980; }
    .lb__rank { width: 30px; text-align: center; font-size: 15px; font-weight: 800; color: #888; flex-shrink: 0; }
    .lb__rank--gold { color: #ff8f00; }
    .lb__rank--silver { color: #90a4ae; }
    .lb__rank--bronze { color: #a0522d; }
    .lb__avatar { width: 38px; height: 38px; border-radius: 50%; background: #405980; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; flex-shrink: 0; }
    .lb__info { flex: 1; min-width: 0; }
    .lb__name { display: block; font-size: 14px; font-weight: 600; color: #2c3e50; }
    .lb__sub { display: block; font-size: 12px; color: #888; }
    .lb__you { font-size: 11px; color: #405980; font-weight: 700; }
    .lb__xp { font-size: 15px; font-weight: 800; color: #ff8f00; flex-shrink: 0; }

    .lb__empty { text-align: center; padding: 40px; color: #aaa; }
    .lb__empty mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: .3; }

    .lb__list--skel { }
    .lb__row--skel {
      height: 60px; cursor: default;
      background: linear-gradient(90deg, #e8edf5 25%, #f5f7fa 50%, #e8edf5 75%);
      background-size: 200% 100%;
      animation: skel 1.4s infinite;
    }
    @keyframes skel { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
  `]
})
export class GameLeaderboardComponent implements OnInit {
  leaderboard: LeaderboardEntry[] = [];
  myStats: StudentGameStats | null = null;
  studentRank: number | null = null;
  loading = false;
  currentPeriod: LeaderboardPeriod = 'all';
  private periods: LeaderboardPeriod[] = ['all', 'weekly', 'daily'];

  constructor(private svc: InteractiveGameService) {}

  ngOnInit() {
    this.svc.getMyStats().subscribe({ next: r => this.myStats = r.stats });
    this.load();
  }

  get periodLabel(): string {
    return this.currentPeriod;
  }

  load() {
    this.loading = true;
    this.svc.getGlobalLeaderboard(this.currentPeriod).subscribe({
      next: (r) => {
        this.leaderboard = (r.leaderboard || []).map(row => ({
          ...row,
          totalXp: row.totalXp ?? 0,
          gamesCompleted: row.gamesCompleted ?? 0,
          bestScore: row.bestScore ?? 0,
        }));
        this.studentRank = r.studentRank ?? null;
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  onTabChange(index: number) {
    this.currentPeriod = this.periods[index] ?? 'all';
    this.load();
  }

  isMe(e: LeaderboardEntry): boolean {
    if (!this.myStats?.studentId) return false;
    return String(e.studentId) === String(this.myStats.studentId);
  }
}
