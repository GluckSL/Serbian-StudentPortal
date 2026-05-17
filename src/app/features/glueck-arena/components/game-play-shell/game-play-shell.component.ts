import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { NotificationService } from '../../../../services/notification.service';
import {
  GameAttempt, GameQuestion, GameLevel, GameSet,
  SentenceQuestion, ScrambleQuestion, AchievementDto
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
            <button mat-raised-button color="primary" class="shell-intro__start" (click)="startPlay()">
              <mat-icon>play_arrow</mat-icon> Start game
            </button>
            <button mat-stroked-button (click)="back()">Back to arena</button>
          </div>
        </div>
        <aside class="shell-intro__side">
          <section>
            <h3><mat-icon>rule</mat-icon> How to play</h3>
            <p *ngIf="set.gameType === 'sentence_builder'">Drag words into the correct positions. The clock counts up from zero — finish all sentences as fast as you can.</p>
            <p *ngIf="set.gameType === 'scramble_rush'">Type words before letters fall. Limited lives — complete all levels to win.</p>
          </section>
          <section>
            <h3><mat-icon>leaderboard</mat-icon> Scoring</h3>
            <ul>
              <li *ngIf="set.gameType === 'sentence_builder'"><strong>+15 pts</strong> per correct sentence</li>
              <li *ngIf="set.gameType === 'sentence_builder'">Faster total time = higher leaderboard rank</li>
            </ul>
          </section>
        </aside>
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
    .shell { max-width: 1100px; margin: 0 auto; padding: 16px; }
    .shell__loading, .shell__error { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 64px; text-align: center; }
    .shell__error mat-icon { font-size: 48px; width: 48px; height: 48px; color: #c62828; }

    .shell-intro {
      display: grid; grid-template-columns: 1fr 320px; gap: 24px; align-items: start;
    }
    @media (max-width: 860px) { .shell-intro { grid-template-columns: 1fr; } }
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
    .shell-intro__actions { display: flex; gap: 12px; flex-wrap: wrap; }
    .shell-intro__start { padding: 12px 28px !important; border-radius: 14px !important; font-size: 16px !important; }
    .shell-intro__side {
      background: #fff; border-radius: 20px; padding: 24px;
      border: 1px solid #e2e8f0; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
      position: sticky; top: 16px;
    }
    .shell-intro__side section { margin-bottom: 20px; }
    .shell-intro__side section:last-child { margin-bottom: 0; }
    .shell-intro__side h3 {
      display: flex; align-items: center; gap: 8px; margin: 0 0 10px;
      font-size: 13px; font-weight: 800; text-transform: uppercase; color: #475569;
    }
    .shell-intro__side h3 mat-icon { color: #6366f1; font-size: 20px; width: 20px; height: 20px; }
    .shell-intro__side p, .shell-intro__side li { font-size: 13px; color: #64748b; line-height: 1.55; }
    .shell-intro__side ul { margin: 0; padding-left: 18px; }

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

  constructor(
    private svc: InteractiveGameService,
    private notify: NotificationService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.svc.startAttempt(id).subscribe({
      next: (r) => {
        this.set = r.set;
        this.attempt = r.attempt;
        this.questions = r.questions;
        this.levels = r.levels || [];
        this.phase = 'intro';
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not start game';
        this.phase = 'error';
      }
    });
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
