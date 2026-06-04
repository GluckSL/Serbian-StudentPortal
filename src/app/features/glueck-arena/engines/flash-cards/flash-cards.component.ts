import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../shared/material.module';
import { GameHudComponent } from '../../shared/game-hud/game-hud.component';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { GameAudioService } from '../../services/game-audio.service';
import { ScrambleQuestion, GameAttempt } from '../../glueck-arena.types';

export interface FCResult {
  score: number;
  accuracy: number;
  timeSpentSeconds: number;
  correctCount: number;
  totalQuestions: number;
}

@Component({
  selector: 'app-flash-cards',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule, GameHudComponent, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="fc">
      <app-game-hud
        [score]="score"
        [timeLeft]="timeLeft"
        [current]="currentIndex + 1"
        [total]="questions.length"
        [showLives]="false"
      ></app-game-hud>

      <div class="fc__card" *ngIf="phase === 'playing' && currentQuestion">
        <div class="fc__card-inner">
          <div class="fc__prompt">{{ currentQuestion.hint || 'Translate this word' }}</div>
          <div class="fc__word-display" *ngIf="!flipped">{{ currentQuestion.scrambledLetters?.join(' ') || '***' }}</div>
          <div class="fc__reveal" *ngIf="flipped">{{ currentQuestion.word }}</div>
        </div>
        <button class="fc__flip-btn" mat-stroked-button (click)="flip()" *ngIf="!flipped">
          <mat-icon>visibility</mat-icon> Show answer
        </button>
        <div class="fc__actions" *ngIf="flipped">
          <button mat-raised-button color="primary" (click)="rate(1)">
            <mat-icon>sentiment_satisfied</mat-icon> I knew it (+10)
          </button>
          <button mat-raised-button color="warn" (click)="rate(0)">
            <mat-icon>sentiment_dissatisfied</mat-icon> I didn't (+0)
          </button>
        </div>
      </div>

      <div class="fc__complete" *ngIf="phase === 'complete'">
        <mat-icon class="fc__complete-icon">emoji_events</mat-icon>
        <h3>Session Complete!</h3>
        <div class="fc__stats">
          <div class="fc__stat">
            <span class="fc__stat-val">{{ score }}</span>
            <span class="fc__stat-lbl">Score</span>
          </div>
          <div class="fc__stat">
            <span class="fc__stat-val">{{ accuracy }}%</span>
            <span class="fc__stat-lbl">Accuracy</span>
          </div>
          <div class="fc__stat">
            <span class="fc__stat-val">{{ correctCount }}/{{ questions.length }}</span>
            <span class="fc__stat-lbl">Correct</span>
          </div>
        </div>
      </div>

      <app-xp-float [xp]="xpBurst" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .fc { position: relative; display: flex; flex-direction: column; gap: 16px; max-width: 600px; margin: 0 auto; }
    .fc__card { background: linear-gradient(145deg, #fff, #f8fafc); border-radius: 24px; padding: 32px 24px; text-align: center; box-shadow: 0 8px 32px rgba(15,23,42,0.1); border: 1px solid #e2e8f0; min-height: 320px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; }
    .fc__card-inner { display: flex; flex-direction: column; gap: 12px; width: 100%; }
    .fc__prompt { font-size: 16px; color: #64748b; font-weight: 600; }
    .fc__word-display { font-size: 32px; font-weight: 800; color: #405980; letter-spacing: 4px; padding: 20px; background: #f0f4ff; border-radius: 16px; }
    .fc__reveal { font-size: 36px; font-weight: 800; color: #22c55e; padding: 20px; background: #f0fdf4; border-radius: 16px; animation: fc-pop 0.3s ease; }
    @keyframes fc-pop { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
    .fc__flip-btn { margin-top: 8px; }
    .fc__actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-top: 8px; }
    .fc__complete { text-align: center; padding: 40px 24px; }
    .fc__complete-icon { font-size: 72px; width: 72px; height: 72px; color: #ff8f00; }
    .fc__complete h3 { font-size: 24px; color: #1e293b; margin: 16px 0; }
    .fc__stats { display: flex; gap: 32px; justify-content: center; }
    .fc__stat { display: flex; flex-direction: column; align-items: center; }
    .fc__stat-val { font-size: 28px; font-weight: 800; color: #405980; }
    .fc__stat-lbl { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
    @media (max-width: 480px) { .fc__word-display { font-size: 24px; } .fc__reveal { font-size: 28px; } }
  `]
})
export class FlashCardsComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() questions: ScrambleQuestion[] = [];
  @Output() onComplete = new EventEmitter<FCResult>();

  phase: 'playing' | 'complete' = 'playing';
  currentIndex = 0;
  score = 0;
  correctCount = 0;
  flipped = false;
  timeLeft: number | null = null;
  xpBurst = 0;
  xpTrigger = 0;
  showConfetti = false;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private startedAt = Date.now();

  get currentQuestion() { return this.questions[this.currentIndex] || null; }
  get totalQuestions() { return this.questions.length; }
  get accuracy(): number {
    const total = this.correctCount + (this.currentIndex - this.correctCount);
    return total > 0 ? Math.round((this.correctCount / (this.currentIndex)) * 100) : 0;
  }

  constructor(
    private svc: InteractiveGameService,
    readonly audio: GameAudioService,
  ) {}

  ngOnInit() {
    this.audio.loadMutePreference();
    this.startedAt = Date.now();
    this.startTimer();
  }

  ngOnDestroy() {
    if (this.timerHandle) clearInterval(this.timerHandle);
  }

  startTimer() {
    this.timerHandle = setInterval(() => {
      this.timeLeft = Math.max(0, Math.floor((this.questions.length * 30 - (Date.now() - this.startedAt) / 1000)));
    }, 1000);
  }

  flip() {
    this.flipped = true;
  }

  rate(known: number) {
    if (this.phase !== 'playing') return;
    this.flipped = false;
    if (known) {
      this.correctCount++;
      this.score += 10;
      this.xpBurst = 10;
      this.xpTrigger++;
      this.audio.playXpGain();
      this.audio.playCorrect();
    } else {
      this.audio.playWrong();
    }
    this.currentIndex++;
    if (this.currentIndex >= this.questions.length) {
      this.finish();
    }
  }

  finish() {
    this.phase = 'complete';
    this.showConfetti = true;
    if (this.timerHandle) clearInterval(this.timerHandle);
    setTimeout(() => {
      this.onComplete.emit({
        score: this.score,
        accuracy: this.accuracy,
        timeSpentSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        correctCount: this.correctCount,
        totalQuestions: this.questions.length,
      });
    }, 800);
  }
}
