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

      <div class="lb__grid">
        <!-- Left column: podium + user stats -->
        <div class="lb__left">
          <!-- Top 3 podium -->
          <div class="lb__podium-card" *ngIf="!loading">
            <div class="lb__podium-heading">
              <mat-icon>emoji_events</mat-icon> Top Students
            </div>
            <div class="lb__podium">
              <div class="lb__podium__place lb__podium__place--2">
                <div class="lb__podium__avatar">
                  <img *ngIf="leaderboard[1]?.avatarUrl" [src]="leaderboard[1].avatarUrl" (error)="leaderboard[1]!.avatarUrl = undefined" />
                  <span *ngIf="!leaderboard[1]?.avatarUrl">{{ leaderboard[1]?.name?.charAt(0)?.toUpperCase() ?? '-' }}</span>
                </div>
                <div class="lb__podium__bar">
                  🥈
                  <span class="lb__podium__xp">{{ leaderboard[1]?.totalXp ?? '-' }}</span>
                </div>
                <span class="lb__podium__name">{{ leaderboard[1]?.name ?? '-' }}</span>
              </div>
              <div class="lb__podium__place lb__podium__place--1">
                <div class="lb__podium__avatar">
                  <img *ngIf="leaderboard[0]?.avatarUrl" [src]="leaderboard[0].avatarUrl" (error)="leaderboard[0]!.avatarUrl = undefined" />
                  <span *ngIf="!leaderboard[0]?.avatarUrl">{{ leaderboard[0]?.name?.charAt(0)?.toUpperCase() ?? '-' }}</span>
                </div>
                <div class="lb__podium__bar">
                  🥇
                  <span class="lb__podium__xp">{{ leaderboard[0]?.totalXp ?? '-' }}</span>
                </div>
                <span class="lb__podium__name">{{ leaderboard[0]?.name ?? '-' }}</span>
              </div>
              <div class="lb__podium__place lb__podium__place--3">
                <div class="lb__podium__avatar">
                  <img *ngIf="leaderboard[2]?.avatarUrl" [src]="leaderboard[2].avatarUrl" (error)="leaderboard[2]!.avatarUrl = undefined" />
                  <span *ngIf="!leaderboard[2]?.avatarUrl">{{ leaderboard[2]?.name?.charAt(0)?.toUpperCase() ?? '-' }}</span>
                </div>
                <div class="lb__podium__bar">
                  🥉
                  <span class="lb__podium__xp">{{ leaderboard[2]?.totalXp ?? '-' }}</span>
                </div>
                <span class="lb__podium__name">{{ leaderboard[2]?.name ?? '-' }}</span>
              </div>
            </div>
          </div>

          <div class="lb__stats-card">
            <div class="lb__stats-heading">
              <mat-icon>person</mat-icon> Your Stats
            </div>
            <app-game-stats-banner [stats]="myStats"></app-game-stats-banner>
          </div>
        </div>

        <!-- Right column: tabs + leaderboard table -->
        <div class="lb__right-card">
          <div class="lb__right">
            <div class="lb__right-heading">
              <mat-icon>leaderboard</mat-icon> Leaderboard
            </div>
            <!-- Period tabs -->
            <mat-tab-group (selectedIndexChange)="onTabChange($event)" class="lb__tabs">
            <mat-tab label="All Time"></mat-tab>
            <mat-tab label="This Week"></mat-tab>
            <mat-tab label="Today"></mat-tab>
          </mat-tab-group>

          <mat-progress-bar *ngIf="loading" mode="indeterminate"></mat-progress-bar>

          <!-- Full list -->
          <div class="lb__list" *ngIf="!loading">
            <div
              class="lb__row"
              *ngFor="let e of leaderboard"
              [class.lb__row--me]="isMe(e)"
            >
              <div class="lb__row-top">
                <span class="lb__rank"
                  [class.lb__rank--gold]="e.rank === 1"
                  [class.lb__rank--silver]="e.rank === 2"
                  [class.lb__rank--bronze]="e.rank === 3"
                >{{ e.rank }}</span>
                <div class="lb__avatar">{{ e.name.charAt(0).toUpperCase() }}</div>
                <div class="lb__info">
                  <span class="lb__name">{{ e.name }} <span *ngIf="isMe(e)" class="lb__you">(You)</span></span>
                  <div class="lb__stats">
                    <span class="lb__stat"><mat-icon>bolt</mat-icon> {{ e.totalXp }}</span>
                    <span class="lb__stat"><mat-icon>sports_esports</mat-icon> {{ e.gamesCompleted ?? 0 }}</span>
                    <span class="lb__stat"><mat-icon>emoji_events</mat-icon> {{ e.bestScore }}</span>
                    <span class="lb__stat" *ngIf="e.accuracy != null"><mat-icon>track_changes</mat-icon> {{ e.accuracy }}%</span>
                    <span class="lb__stat" *ngIf="e.currentStreak"><mat-icon>local_fire_department</mat-icon> {{ e.currentStreak }}</span>
                  </div>
                </div>
              </div>
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
        </div>
      </div>
    </div>
  `,
  styles: [`
    .lb { max-width: 1500px; margin: 0 auto; padding: 24px 16px; }
    .lb__header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 20px; }
    .lb__header h1 { display: flex; align-items: center; gap: 8px; font-size: 24px; font-weight: 700; color: #405980; margin: 0; }
    .lb__header h1 mat-icon { font-size: 28px; width: 28px; height: 28px; }
    .lb__header p { color: #888; margin: 4px 0 0; }

    .lb__grid { display: grid; grid-template-columns: 0.3fr 0.7fr; gap: 24px; align-items: start; }
    .lb__left { display: flex; flex-direction: column; gap: 16px; }
    .lb__right-card { background: #fff; border: 1px solid #e8ecf4; border-radius: 16px; padding: 20px 16px; }
    .lb__right-heading { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; color: #405980; }
    .lb__right-heading mat-icon { font-size: 22px; width: 22px; height: 22px; color: #405980; }
    .lb__right { display: flex; flex-direction: column; gap: 16px; }

    .lb__tabs { }
    ::ng-deep .lb__tabs .mdc-tab { min-width: 100px; }

    .lb__podium-card { background: #fff; border: 1px solid #e8ecf4; border-radius: 16px; padding: 20px 12px 16px; }
    .lb__podium-heading { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; color: #405980; margin-bottom: 16px; padding: 0 4px; }
    .lb__podium-heading mat-icon { font-size: 22px; width: 22px; height: 22px; color: #f59e0b; }
    .lb__stats-card { background: #fff; border: 1px solid #e8ecf4; border-radius: 16px; padding: 20px 16px 16px; }
    .lb__stats-heading { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; color: #405980; margin-bottom: 12px; }
    .lb__stats-heading mat-icon { font-size: 22px; width: 22px; height: 22px; color: #405980; }
    ::ng-deep .lb__stats-card .gsb { margin-bottom: 0; grid-template-columns: 1fr 1fr !important; }
    .lb__podium { display: flex; align-items: flex-end; justify-content: center; gap: 8px; }
    .lb__podium__place { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .lb__podium__avatar { width: 44px; height: 44px; border-radius: 50%; background: #e8edf5; color: #405980; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; overflow: hidden; flex-shrink: 0; }
    .lb__podium__avatar img { width: 100%; height: 100%; object-fit: cover; }
    .lb__podium__bar { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; width: 76px; border-radius: 10px 10px 0 0; font-size: 24px; padding: 6px 0; }
    .lb__podium__xp { font-size: 14px; font-weight: 800; color: #fff; }
    .lb__podium__name { font-size: 12px; font-weight: 600; color: #555; max-width: 80px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lb__podium__place--1 .lb__podium__bar { height: 110px; background: linear-gradient(180deg,#ffd700,#ffb300); }
    .lb__podium__place--2 .lb__podium__bar { height: 80px; background: linear-gradient(180deg,#b0bec5,#90a4ae); }
    .lb__podium__place--3 .lb__podium__bar { height: 60px; background: linear-gradient(180deg,#cd7f32,#a0522d); }

    .lb__list { display: flex; flex-direction: column; gap: 8px; }
    .lb__row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: #e8edf5; border: 1px solid #d0d8e8; transition: background .2s; }
    .lb__row--me { background: #fff !important; border-color: #b8c4d8; box-shadow: 0 2px 8px rgba(64,89,128,.1); }
    .lb__row-top { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
    .lb__row-top .lb__info { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
    .lb__row-top .lb__stats { display: flex; align-items: center; gap: 12px; margin-left: auto; }
    .lb__rank { width: 30px; text-align: center; font-size: 15px; font-weight: 800; color: #888; flex-shrink: 0; }
    .lb__rank--gold { color: #ff8f00; }
    .lb__rank--silver { color: #90a4ae; }
    .lb__rank--bronze { color: #a0522d; }
    .lb__avatar { width: 38px; height: 38px; border-radius: 50%; background: #405980; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; flex-shrink: 0; }
    .lb__info { flex: 1; min-width: 0; }
    .lb__name { display: block; font-size: 14px; font-weight: 600; color: #2c3e50; }
    .lb__you { font-size: 11px; color: #405980; font-weight: 700; }
    .lb__stat { display: flex; align-items: center; gap: 4px; font-size: 15px; font-weight: 700; color: #405980; white-space: nowrap; }
    .lb__stat mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .lb__stat:nth-child(1) mat-icon { color: #f59e0b; }
    .lb__stat:nth-child(2) mat-icon { color: #3b82f6; }
    .lb__stat:nth-child(3) mat-icon { color: #8b5cf6; }
    .lb__stat:nth-child(4) mat-icon { color: #10b981; }
    .lb__stat:nth-child(5) mat-icon { color: #ef4444; }

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

    @media (max-width: 1024px) {
      .lb__grid { grid-template-columns: 1fr 1fr; gap: 20px; }
    }
    @media (max-width: 900px) {
      .lb__row { flex-direction: column; align-items: stretch; gap: 6px; }
      .lb__row-top { flex-wrap: wrap; }
      .lb__row-top .lb__info { flex-direction: column; align-items: flex-start; gap: 4px; }
      .lb__row-top .lb__stats { margin-left: 0; }
      .lb__stat { font-size: 13px; }
      .lb__stat mat-icon { font-size: 17px; width: 17px; height: 17px; }
    }
    @media (max-width: 768px) {
      .lb__grid { grid-template-columns: 1fr; gap: 16px; }
      .lb__stats-card { display: none; }
      .lb__podium-card { padding: 20px 8px 12px; }
      .lb__podium__avatar { width: 38px; height: 38px; font-size: 15px; }
      .lb__podium__bar { width: 68px; font-size: 20px; }
      .lb__podium__place--1 .lb__podium__bar { height: 100px; }
      .lb__podium__place--2 .lb__podium__bar { height: 72px; }
      .lb__podium__place--3 .lb__podium__bar { height: 54px; }
      .lb__podium__xp { font-size: 12px; }
    }
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
