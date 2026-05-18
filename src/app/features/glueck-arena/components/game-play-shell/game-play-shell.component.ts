import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { NotificationService } from '../../../../services/notification.service';
import {
  GameAttempt, GameQuestion, GameLevel, GameSet, CatalogFilters,
  SentenceQuestion, ScrambleQuestion, AchievementDto, LeaderboardEntry
} from '../../glueck-arena.types';
import { SentenceBuilderComponent, SBResult } from '../../engines/sentence-builder/sentence-builder.component';
import { ScrambleRushComponent, SRResult } from '../../engines/scramble-rush/scramble-rush.component';

@Component({
  selector: 'app-game-play-shell',
  standalone: true,
  imports: [
    CommonModule, RouterModule, MaterialModule,
    SentenceBuilderComponent, ScrambleRushComponent
  ],
  template: `
    <div class="shell">
      <!-- Loading -->
      <div *ngIf="phase === 'loading'" class="shell__loading">
        <mat-spinner diameter="48"></mat-spinner>
        <p>Loading game…</p>
      </div>

      <!-- Error -->
      <div *ngIf="phase === 'error'" class="shell__error">
        <mat-icon>error</mat-icon>
        <p>{{ error }}</p>
        <button mat-raised-button (click)="back()">Go Back</button>
      </div>

      <div class="shell-game-wrap" *ngIf="phase === 'intro' || phase === 'playing'">

        <div class="shell-game-wrap__side">

          <!-- Info card -->
          <aside class="shell-side__info" *ngIf="set">
            <button class="shell-side__back" (click)="back()"><mat-icon>arrow_back</mat-icon></button>
            <div class="sb-panel__game">
              <div class="sb-panel__icon" [style.background]="getTypeColor(set.gameType)">
                <mat-icon>{{ set.icon || 'sports_esports' }}</mat-icon>
              </div>
              <h2>{{ set.title }}</h2>
              <p class="sb-panel__type">{{ formatType(set.gameType) }}</p>
            </div>
            <section class="sb-panel__block">
              <h3><mat-icon>info</mat-icon> How it works</h3>
              <p *ngIf="set.gameType === 'sentence_builder'">Drag words into the correct positions. The clock counts up from zero — finish all sentences as fast as you can.</p>
              <p *ngIf="set.gameType === 'scramble_rush'">Type words before letters fall. Limited lives — complete all levels to win.</p>
            </section>
          </aside>

          <!-- Leaderboard card -->
            <aside class="shell-side">
              <div class="shell-side__lb">
                <header class="shell-side__lb-head">
                  <h3><mat-icon>leaderboard</mat-icon> Leaderboard</h3>
                  <a routerLink="/glueck-arena/leaderboard" class="shell-side__lb-link">See all</a>
                </header>
                <div class="lb__list" *ngIf="!lbLoading && lbEntries.length">
                  <div class="lb__row" *ngFor="let e of lbEntries" [class.lb__row--me]="isMe(e)">
                    <span class="lb__rank"
                      [class.lb__rank--gold]="e.rank === 1"
                      [class.lb__rank--silver]="e.rank === 2"
                      [class.lb__rank--bronze]="e.rank === 3"
                    >{{ e.rank }}</span>
                    <div class="lb__info">
                      <span class="lb__name">{{ e.name }} <span *ngIf="isMe(e)" class="lb__you">(You)</span></span>
                      <span class="lb__sub">{{ e.gamesCompleted }} games · Best: {{ e.bestScore }} pts</span>
                    </div>
                    <span class="lb__xp">⚡{{ e.totalXp }}</span>
                  </div>
                </div>
                <div class="lb__list lb__list--skel" *ngIf="lbLoading">
                  <div class="lb__row lb__row--skel" *ngFor="let _ of [1,2,3]"></div>
                </div>
              </div>
            </aside>

            <!-- Similar games -->
            <aside class="shell-side shell-side--similar" *ngIf="similarGames.length">
              <h3 class="shell-side__sim-head"><mat-icon>extension</mat-icon> Similar games</h3>
              <a class="shell-side__sim-card" *ngFor="let g of similarGames" [routerLink]="['/glueck-arena', g._id]">
                <div class="shell-side__sim-visual" [style.background]="getTypeColor(g.gameType)">
                  <mat-icon>{{ g.icon || 'sports_esports' }}</mat-icon>
                </div>
                <div class="shell-side__sim-body">
                  <span class="shell-side__sim-title">{{ g.title }}</span>
                  <span class="shell-side__sim-meta">{{ g.estimatedDurationMinutes }} min · {{ g.questionCount }} Q</span>
                </div>
                <mat-icon class="shell-side__sim-arrow">chevron_right</mat-icon>
              </a>
            </aside>

        </div>

        <!-- Main game content -->
        <div class="shell-game-wrap__main">

          <!-- Intro -->
          <div *ngIf="phase === 'intro' && set" class="shell-intro">
            <div class="shell-intro__main">
              <div class="shell-intro__hero" [style.background]="getTypeColor(set.gameType)">
                <mat-icon>{{ set.icon || 'sports_esports' }}</mat-icon>
              </div>
              <div class="shell-intro__tags">
                <span class="shell-tag">{{ formatType(set.gameType) }}</span>
                <span class="shell-tag">{{ set.difficulty }}</span>
                <span class="shell-tag" *ngIf="set.level">{{ set.level }}</span>
              </div>
              <h1>{{ set.title }}</h1>
              <p class="shell-intro__desc">{{ set.description }}</p>
              <div class="shell-intro__stats">
                <div><mat-icon>quiz</mat-icon><strong>{{ questions.length }}</strong><span>Questions</span></div>
                <div><mat-icon>schedule</mat-icon><strong>~{{ set.estimatedDurationMinutes }}</strong><span>Minutes</span></div>
                <div><mat-icon>timer</mat-icon><strong>Count-up</strong><span>Total time</span></div>
                <div><mat-icon>bolt</mat-icon><strong>{{ set.xpReward }}</strong><span>Max XP</span></div>
              </div>
              <div class="shell-intro__actions">
                <button class="shell-intro__start" (click)="startPlay()">
                  <mat-icon>play_arrow</mat-icon>
                </button>
              </div>
            </div>
          </div>

          <!-- Engines -->
          <app-sentence-builder
            *ngIf="phase === 'playing' && set?.gameType === 'sentence_builder' && attempt && set"
            [attempt]="attempt!"
            [gameSet]="set"
            [questions]="asSentenceQuestions()"
            (onComplete)="handleComplete($event)"
          ></app-sentence-builder>

          <app-scramble-rush
            *ngIf="phase === 'playing' && set?.gameType === 'scramble_rush' && attempt"
            [attempt]="attempt!"
            [questions]="asScrambleQuestions()"
            [levels]="levels"
            (onComplete)="handleScrambleComplete($event)"
          ></app-scramble-rush>

          <!-- Placeholder -->
          <div *ngIf="phase === 'playing' && isPlaceholderType()" class="shell__placeholder">
            <mat-icon>construction</mat-icon>
            <h3>Coming Soon</h3>
            <p>{{ set?.gameType }} game type is coming soon!</p>
            <button mat-raised-button (click)="back()">Back to GlückArena</button>
          </div>

        </div>

      </div>

      <div class="shell__badge-popup" *ngIf="newBadges.length">
        <mat-icon>emoji_events</mat-icon>
        <div>
          <strong>Badge unlocked!</strong>
          <p *ngFor="let b of newBadges">{{ b.title }}</p>
        </div>
        <button mat-icon-button (click)="newBadges = []"><mat-icon>close</mat-icon></button>
      </div>

      <!-- Results -->
      <div *ngIf="phase === 'results'" class="shell__results">
        <mat-icon class="shell__results__icon">emoji_events</mat-icon>
        <h2>Game Complete!</h2>
        <div class="shell__results__stats">
          <div class="shell__results__stat">
            <span class="shell__results__val">{{ finalScore }}</span>
            <span class="shell__results__lbl">Score</span>
          </div>
          <div class="shell__results__stat">
            <span class="shell__results__val">{{ finalXp }}</span>
            <span class="shell__results__lbl">XP Earned</span>
          </div>
          <div class="shell__results__stat">
            <span class="shell__results__val">{{ finalAccuracy }}%</span>
            <span class="shell__results__lbl">Accuracy</span>
          </div>
          <div class="shell__results__stat" *ngIf="finalTimeSeconds > 0">
            <span class="shell__results__val">{{ formatTime(finalTimeSeconds) }}</span>
            <span class="shell__results__lbl">Time</span>
          </div>
        </div>
        <button mat-raised-button color="primary" routerLink="/glueck-arena/leaderboard">
          <mat-icon>leaderboard</mat-icon> Leaderboard
        </button>
        <button mat-stroked-button routerLink="/glueck-arena">Back to Games</button>
      </div>
    </div>
  `,
  styles: [`
    .shell { margin: 0 auto; padding: 16px; }
    .shell__loading, .shell__error { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 64px; text-align: center; }
    .shell__error mat-icon { font-size: 48px; width: 48px; height: 48px; color: #c62828; }

    .shell-game-wrap {
      display: grid;
      grid-template-columns: 0.3fr 0.7fr;
      gap: 16px;
      align-items: start;
      max-width: 1200px;
      margin: 0 auto;
    }
    .shell-game-wrap__side {
      display: flex; flex-direction: column; gap: 16px;
    }
    .shell-game-wrap__main { min-width: 0; }
    @media (max-width: 1000px) {
      .shell-game-wrap { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 640px) {
      .shell-game-wrap { grid-template-columns: 1fr; }
    }

    .shell-intro {
      display: grid;
      align-items: start;
    }
    .shell-intro__main {
      background: #fff; border-radius: 24px; padding: 32px 28px;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.1); border: 1px solid #e2e8f0;
    }
    .shell-intro__hero {
      width: 88px; height: 88px; border-radius: 20px;
      display: flex; align-items: center; justify-content: center; margin-bottom: 16px;
    }
    .shell-intro__hero mat-icon { font-size: 44px; width: 44px; height: 44px; color: rgba(255,255,255,.95); }
    .shell-intro__tags { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .shell-tag {
      font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
      background: #e0e7ff; color: #3730a3; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .shell-intro__main h1 { margin: 0 0 10px; font-size: 28px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em; }
    .shell-intro__desc { color: #64748b; line-height: 1.6; margin: 0 0 24px; font-size: 15px; }
    .shell-intro__stats {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px;
    }
    @media (max-width: 600px) { .shell-intro__stats { grid-template-columns: repeat(2, 1fr); } }
    .shell-intro__stats > div {
      text-align: center; padding: 14px 8px; border-radius: 14px;
      background: #f8fafc; border: 1px solid #e2e8f0;
    }
    .shell-intro__stats mat-icon { color: #6366f1; font-size: 22px; width: 22px; height: 22px; }
    .shell-intro__stats strong { display: block; font-size: 20px; color: #1e293b; margin-top: 4px; }
    .shell-intro__stats span { font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; }
    .shell-intro__actions { display: flex; justify-content: center; }
    .shell-intro__start {
      width: 70px; height: 70px; border-radius: 50%; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
      box-shadow: 0 6px 20px rgba(37, 99, 235, 0.35);
      animation: pulse 2s ease-in-out infinite;
    }
    .shell-intro__start mat-icon { font-size: 32px; width: 32px; height: 32px; color: #fff; }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }
    .shell-intro__info { margin-top: 24px; padding-top: 20px; border-top: 1px solid #e2e8f0; }

    .shell-side__info {
      background: #fff; border-radius: 20px; padding: 22px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 8px 32px rgba(15, 23, 42, 0.08);
      position: sticky; top: 16px;
    }
    .shell-side__back {
      position: absolute; top: 12px; left: 12px;
      display: flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border: none; border-radius: 10px;
      background: #f1f5f9; cursor: pointer; z-index: 1;
      color: #475569; transition: background 0.15s;
      padding: 0;
    }
    .shell-side__back:hover { background: #e2e8f0; }
    .shell-side__back mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .sb-panel__game { text-align: center; margin-bottom: 16px; }
    .sb-panel__icon {
      width: 64px; height: 64px; border-radius: 16px; margin: 0 auto 10px;
      display: flex; align-items: center; justify-content: center;
    }
    .sb-panel__icon mat-icon { font-size: 32px; width: 32px; height: 32px; color: #fff; }
    .shell-side__info h2 { margin: 0 0 4px; font-size: 18px; color: #1e293b; }
    .sb-panel__type { margin: 0; font-size: 12px; color: #6366f1; font-weight: 700; text-transform: uppercase; }

    .shell-side {
      background: #fff; border-radius: 20px; padding: 22px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 8px 32px rgba(15, 23, 42, 0.08);
      position: sticky; top: 16px;
    }
    .sb-panel__block { margin-bottom: 16px; }
    .sb-panel__block h3 {
      display: flex; align-items: center; gap: 6px;
      margin: 0 0 8px; font-size: 13px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.04em; color: #475569;
    }
    .sb-panel__block h3 mat-icon { font-size: 18px; width: 18px; height: 18px; color: #6366f1; }
    .sb-panel__block p { font-size: 13px; color: #64748b; line-height: 1.55; margin: 0; }
    .shell-side__lb-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 10px;
      padding: 0;
      background: none;
    }
    .shell-side__lb-head h3 {
      margin: 0; font-size: 14px; font-weight: 800; color: #1e293b;
      display: flex; align-items: center; gap: 6px;
    }
    .shell-side__lb-head h3 mat-icon { font-size: 18px; width: 18px; height: 18px; color: #6366f1; }
    .shell-side__lb-link {
      font-size: 11px; font-weight: 700; color: #6366f1; text-decoration: none;
    }
    .shell-side .lb__list { display: flex; flex-direction: column; gap: 8px; }
    .shell-side .lb__row {
      display: grid;
      grid-template-columns: 20px 1fr auto;
      gap: 6px;
      align-items: center;
      padding: 7px 10px;
      border-radius: 10px;
      background: #f8fafc;
      border: 1px solid #eef2f7;
    }
    .shell-side .lb__row--me { background: #e8edf5; border-color: #405980; }
    .shell-side .lb__rank {
      text-align: center; font-size: 12px; font-weight: 800;
      color: #888;
    }
    .shell-side .lb__rank--gold { color: #ff8f00; }
    .shell-side .lb__rank--silver { color: #90a4ae; }
    .shell-side .lb__rank--bronze { color: #a0522d; }
    .shell-side .lb__info { min-width: 0; overflow: hidden; }
    .shell-side .lb__name {
      display: block; font-size: 12px; font-weight: 600; color: #2c3e50;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .shell-side .lb__sub { display: block; font-size: 10px; color: #888; }
    .shell-side .lb__you { font-size: 10px; color: #405980; font-weight: 700; }
    .shell-side .lb__xp { font-size: 12px; font-weight: 800; color: #ff8f00; white-space: nowrap; }
    .shell-side .lb__row--skel {
      height: 43px; cursor: default;
      background: linear-gradient(90deg, #e8edf5 25%, #f5f7fa 50%, #e8edf5 75%);
      background-size: 200% 100%;
      animation: skel 1.4s infinite;
    }

    .shell__placeholder { text-align: center; padding: 64px 16px; background: #fff; border-radius: 20px; }
    .shell__placeholder mat-icon { font-size: 64px; width: 64px; height: 64px; color: #888; }

    .shell__results { text-align: center; padding: 48px 24px; background: #fff; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,.1); display: flex; flex-direction: column; align-items: center; gap: 20px; }
    .shell__results__icon { font-size: 72px; width: 72px; height: 72px; color: #ff8f00; }
    .shell__results h2 { font-size: 26px; font-weight: 700; margin: 0; }
    .shell__results__stats { display: flex; gap: 32px; }
    .shell__results__stat { display: flex; flex-direction: column; align-items: center; }
    .shell__results__val { font-size: 32px; font-weight: 800; color: #405980; }
    .shell__results__lbl { font-size: 13px; color: #888; }
    .shell__badge-popup {
      position: fixed; bottom: 24px; right: 24px; z-index: 100;
      display: flex; align-items: flex-start; gap: 12px;
      background: linear-gradient(135deg,#ff8f00,#ffc107); color: #fff;
      padding: 16px 20px; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,.2);
      max-width: 320px; animation: badgePop .4s ease;
    }
    .shell__badge-popup mat-icon { font-size: 36px; width: 36px; height: 36px; }
    @keyframes badgePop { from { transform: scale(.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    @keyframes skel { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

    .shell-side--similar { display: none; }
    @media (min-width: 1000px) {
      .shell-side--similar { display: block; }
    }
    .shell-side__sim-head {
      display: flex; align-items: center; gap: 6px;
      margin: 0 0 12px; font-size: 13px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.04em; color: #475569;
    }
    .shell-side__sim-head mat-icon { font-size: 18px; width: 18px; height: 18px; color: #6366f1; }
    .shell-side__sim-card {
      display: flex; align-items: center; gap: 10px;
      padding: 10px; border-radius: 12px;
      background: #f8fafc; border: 1px solid #eef2f7;
      text-decoration: none; margin-bottom: 8px;
      transition: background 0.15s;
    }
    .shell-side__sim-card:hover { background: #eef2f7; }
    .shell-side__sim-visual {
      width: 40px; height: 40px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .shell-side__sim-visual mat-icon { font-size: 20px; width: 20px; height: 20px; color: #fff; }
    .shell-side__sim-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .shell-side__sim-title { font-size: 13px; font-weight: 700; color: #1e293b; }
    .shell-side__sim-meta { font-size: 11px; color: #94a3b8; }
    .shell-side__sim-arrow { font-size: 18px; width: 18px; height: 18px; color: #cbd5e1; }
  `]
})
export class GamePlayShellComponent implements OnInit {
  phase: 'loading' | 'intro' | 'playing' | 'results' | 'error' = 'loading';
  error = '';
  set: GameSet | null = null;
  attempt: GameAttempt | null = null;
  questions: GameQuestion[] = [];
  levels: GameLevel[] = [];
  finalScore = 0;
  finalXp = 0;
  finalAccuracy = 0;
  finalTimeSeconds = 0;
  newBadges: AchievementDto[] = [];

  lbEntries: LeaderboardEntry[] = [];
  lbLoading = false;

  similarGames: GameSet[] = [];

  constructor(
    private svc: InteractiveGameService,
    private notify: NotificationService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.loadLeaderboard();
    this.svc.startAttempt(id).subscribe({
      next: (r) => {
        this.set = r.set;
        this.attempt = r.attempt;
        this.questions = r.questions;
        this.levels = r.levels || [];
        this.phase = 'intro';
        this.loadSimilarGames();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not start game';
        this.phase = 'error';
      }
    });
  }

  loadSimilarGames() {
    if (!this.set) return;
    const filters: CatalogFilters = {
      gameType: this.set.gameType,
      page: 1,
      limit: 5,
    };
    this.svc.getCatalog(filters).subscribe({
      next: (r) => {
        this.similarGames = (r.items || []).filter(s => s._id !== this.set!._id).slice(0, 4);
      },
    });
  }

  loadLeaderboard() {
    this.lbLoading = true;
    this.svc.getGlobalLeaderboard('all').subscribe({
      next: (r) => {
        this.lbEntries = (r.leaderboard || []).slice(0, 5).map(row => ({
          ...row,
          totalXp: row.totalXp ?? 0,
          gamesCompleted: row.gamesCompleted ?? 0,
          bestScore: row.bestScore ?? 0,
        }));
        this.lbLoading = false;
      },
      error: () => { this.lbLoading = false; }
    });
  }

  isMe(e: LeaderboardEntry): boolean {
    if (!this.lbEntries.length) return false;
    return String(e.studentId) === String(this.attempt?.studentId);
  }

  startPlay() { this.phase = 'playing'; }

  back() { this.router.navigate(['/glueck-arena']); }

  asSentenceQuestions(): SentenceQuestion[] { return this.questions as SentenceQuestion[]; }
  asScrambleQuestions(): ScrambleQuestion[] { return this.questions as ScrambleQuestion[]; }

  isPlaceholderType(): boolean {
    return ['matching', 'flashcards'].includes(this.set?.gameType ?? '');
  }

  handleComplete(result: SBResult) {
    this.finalScore = result.score;
    this.finalAccuracy = result.accuracy;
    this.finalTimeSeconds = result.timeSpentSeconds;
    if (!this.attempt) return;

    this.svc.completeAttempt(this.attempt._id, {
      timeSpentSeconds: result.timeSpentSeconds,
    }).subscribe({
      next: (r) => {
        this.finalXp = r.xpBonus ?? 0;
        this.newBadges = r.newAchievements || [];
        this.phase = 'results';
        this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
      },
      error: () => { this.phase = 'results'; }
    });
  }

  handleScrambleComplete(result: SRResult) {
    this.finalScore = result.score;
    this.finalAccuracy = result.accuracy;
    if (!this.attempt) return;

    this.svc.completeAttempt(this.attempt._id, {
      timeSpentSeconds: result.timeSpentSeconds,
      livesRemaining: result.livesRemaining,
      currentLevel: result.currentLevel,
    }).subscribe({
      next: (r) => {
        this.finalXp = r.xpBonus ?? 0;
        this.newBadges = r.newAchievements || [];
        this.phase = 'results';
        this.notify.success(`🎉 +${r.xpBonus} XP earned!`);
      },
      error: () => { this.phase = 'results'; }
    });
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  }

  formatType(t: string): string {
    const map: Record<string, string> = {
      scramble_rush: 'Scramble Rush', sentence_builder: 'Sentence Builder',
      matching: 'Matching', flashcards: 'Flashcards',
    };
    return map[t] ?? t;
  }

  getTypeColor(type: string): string {
    const map: Record<string, string> = {
      scramble_rush: 'linear-gradient(135deg,#1565c0,#42a5f5)',
      sentence_builder: 'linear-gradient(135deg,#2e7d32,#66bb6a)',
    };
    return map[type] ?? 'linear-gradient(135deg,#405980,#7a9cc0)';
  }
}
