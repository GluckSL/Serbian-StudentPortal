import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { GameAudioService } from '../../services/game-audio.service';
import { HangmanQuestion, GameAttempt, GameSet } from '../../glueck-arena.types';

export interface HangmanResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
}

const ALPHABET = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','Ä','Ö','Ü','ß'];
const TOTAL_LIVES = 5;

@Component({
  selector: 'app-hangman-game',
  standalone: true,
  imports: [CommonModule, MaterialModule, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="hm">
      <header class="hm__top">
        <div class="hm__lives">
          <mat-icon *ngFor="let _ of hearts; let i = index" [class.hm__lives--lost]="i >= remainingLives">favorite</mat-icon>
        </div>
        <div class="hm__score">
          <mat-icon>star</mat-icon>
          <span>{{ score }}</span>
        </div>
        <div class="hm__progress">Word {{ currentIndex + 1 }} / {{ questions.length }}</div>
        <div class="hm__timer">
          <mat-icon>timer</mat-icon>
          <span>{{ formatElapsed(sessionElapsedSeconds) }}</span>
        </div>
        <button mat-icon-button type="button" (click)="onPause()" aria-label="Pause">
          <mat-icon>pause</mat-icon>
        </button>
      </header>

      <div class="hm__body" *ngIf="phase === 'playing' && currentQuestion">

        <div class="hm__picture-area" *ngIf="currentQuestion.imageUrl">
          <div class="hm__picture">
            <img [src]="currentQuestion.imageUrl" alt="" class="hm__picture-img">
          </div>
        </div>

        <div class="hm__hint">
          <mat-icon>lightbulb</mat-icon>
          <span>{{ currentQuestion.hint }}</span>
        </div>

        <div class="hm__gallows">
          <svg viewBox="0 0 200 220" class="hm__svg">
            <!-- Base -->
            <line x1="20" y1="200" x2="180" y2="200" stroke="#334155" stroke-width="4" stroke-linecap="round"/>
            <line x1="60" y1="200" x2="60" y2="20" stroke="#334155" stroke-width="4" stroke-linecap="round"/>
            <line x1="55" y1="20" x2="140" y2="20" stroke="#334155" stroke-width="4" stroke-linecap="round"/>
            <line x1="140" y1="20" x2="140" y2="50" stroke="#334155" stroke-width="3"/>
            <line x1="60" y1="40" x2="90" y2="20" stroke="#334155" stroke-width="3"/>
            <!-- Rope -->
            <line x1="140" y1="50" x2="140" y2="65" stroke="#94a3b8" stroke-width="2"/>
            <!-- Head -->
            <circle *ngIf="lostLives >= 1" cx="140" cy="80" r="15" fill="none" stroke="#334155" stroke-width="3"/>
            <!-- Body -->
            <line *ngIf="lostLives >= 2" x1="140" y1="95" x2="140" y2="145" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
            <!-- Left arm -->
            <line *ngIf="lostLives >= 3" x1="140" y1="105" x2="115" y2="125" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
            <!-- Right arm -->
            <line *ngIf="lostLives >= 4" x1="140" y1="105" x2="165" y2="125" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
            <!-- Legs -->
            <line *ngIf="lostLives >= 5" x1="140" y1="145" x2="120" y2="170" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
            <line *ngIf="lostLives >= 5" x1="140" y1="145" x2="160" y2="170" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
          </svg>
        </div>

        <div class="hm__word">
          <div
            class="hm__letter-box"
            *ngFor="let ch of displayLetters; let i = index"
            [class.hm__letter-box--revealed]="ch !== null"
          >
            <span class="hm__letter" *ngIf="ch !== null">{{ ch }}</span>
          </div>
        </div>

        <div class="hm__keys">
          <button
            class="hm__key"
            *ngFor="let letter of alphabet"
            [class.hm__key--used]="guessedLetters.has(letter)"
            [class.hm__key--correct]="correctSet.has(letter)"
            [disabled]="guessedLetters.has(letter) || wordComplete || gameOver"
            (click)="guessLetter(letter)"
          >{{ letter }}</button>
        </div>
      </div>

      <div class="hm-complete" *ngIf="phase === 'complete'">
        <mat-icon class="hm-complete__spinner">hourglass_top</mat-icon>
        <span class="hm-complete__calc">Calculating results...</span>
      </div>

      <app-xp-float [xp]="lastXp" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .hm { position: relative; display: flex; flex-direction: column; gap: 16px; }
    .hm__top {
      display: flex; align-items: center; gap: 24px; padding: 12px 20px;
      background: #fff; border-radius: 16px; border: 1px solid #e2e8f0;
    }
    .hm__score { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 18px; color: #f59e0b; }
    .hm__lives { display: flex; align-items: center; gap: 2px; }
    .hm__lives mat-icon { font-size: 20px; width: 20px; height: 20px; color: #ef4444; transition: color 0.3s, transform 0.3s; }
    .hm__lives--lost { color: #e2e8f0 !important; transform: scale(0.85); }
    .hm__progress { font-size: 14px; font-weight: 600; color: #64748b; }
    .hm__timer { display: flex; align-items: center; gap: 4px; margin-left: auto; font-size: 16px; font-weight: 700; color: #1e293b; }
    .hm__timer mat-icon { font-size: 20px; width: 20px; height: 20px; color: #64748b; }
    .hm__body {
      display: flex; flex-direction: column; align-items: center; gap: 20px;
      padding: 24px; background: #fff; border-radius: 20px; border: 1px solid #e2e8f0;
      min-height: 400px;
    }
    .hm__picture-area {
      width: 100%; max-width: 280px; aspect-ratio: 4/3;
      border-radius: 12px; overflow: hidden;
    }
    .hm__picture {
      width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
      background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;
    }
    .hm__picture-img { width: 100%; height: 100%; object-fit: cover; }
    .hm__hint {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 20px; background: #fef3c7; border-radius: 12px;
      border: 1px solid #fde68a; font-size: 16px; font-weight: 600; color: #92400e;
      max-width: 480px; width: 100%; box-sizing: border-box;
    }
    .hm__hint mat-icon { color: #f59e0b; flex-shrink: 0; }
    .hm__gallows { display: flex; justify-content: center; }
    .hm__svg { width: 140px; height: 160px; }
    .hm__word {
      display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
      padding: 8px 0;
    }
    .hm__letter-box {
      width: 40px; height: 48px; border-radius: 8px;
      border: 2px dashed #cbd5e1; background: #f8fafc;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; font-weight: 800; color: #1e293b;
      text-transform: uppercase; transition: all 0.2s ease;
    }
    .hm__letter-box--revealed {
      border-style: solid; border-color: #16a34a; background: #dcfce7;
      animation: hmReveal 0.3s ease;
    }
    @keyframes hmReveal {
      0% { transform: scale(0.8); opacity: 0; }
      50% { transform: scale(1.1); }
      100% { transform: scale(1); opacity: 1; }
    }
    .hm__letter { user-select: none; }
    .hm__keys {
      display: flex; flex-wrap: wrap; gap: 5px; justify-content: center;
      max-width: 520px; padding: 8px 0;
    }
    .hm__key {
      width: 38px; height: 42px; border-radius: 8px;
      border: 1px solid #cbd5e1; background: #fff;
      font-size: 15px; font-weight: 700; color: #334155;
      cursor: pointer; transition: all 0.12s ease; text-transform: uppercase;
      display: flex; align-items: center; justify-content: center;
      padding: 0; line-height: 1; box-sizing: border-box;
    }
    .hm__key:hover:not(:disabled) { background: #eef2ff; border-color: #6366f1; transform: translateY(-1px); }
    .hm__key:active:not(:disabled) { transform: scale(0.95); }
    .hm__key:disabled { cursor: default; opacity: 0.5; }
    .hm__key--used { opacity: 0.35; }
    .hm__key--correct { background: #dcfce7; border-color: #86efac; color: #16a34a; opacity: 1; }
    .hm-complete {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      padding: 48px; color: #64748b;
    }
    .hm-complete__spinner { font-size: 40px; width: 40px; height: 40px; color: #6366f1; }
    .hm-complete__calc { font-size: 16px; font-weight: 600; }
    @keyframes hmShake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(6px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(4px); }
    }
  `]
})
export class HangmanGameComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() questions!: HangmanQuestion[];
  @Input() gameSet!: GameSet;
  @Output() onComplete = new EventEmitter<HangmanResult>();

  readonly alphabet = ALPHABET;

  score = 0;
  xpEarned = 0;
  currentIndex = 0;
  wordsCompleted = 0;
  correctCount = 0;
  phase: 'playing' | 'complete' = 'playing';
  submitting = false;
  lastPoints = 0;
  lastXp = 0;
  xpTrigger = 0;
  showConfetti = false;
  sessionElapsedSeconds = 0;

  guessedLetters = new Set<string>();
  remainingLives = TOTAL_LIVES;private startTime = Date.now();
  private correctWord = '';
  private sessionTimerHandle: ReturnType<typeof setInterval> | null = null;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private svc: InteractiveGameService,
    private cdr: ChangeDetectorRef,
    readonly audio: GameAudioService,
  ) {}

  get currentQuestion(): HangmanQuestion | null {
    return this.questions[this.currentIndex] ?? null;
  }

  get displayLetters(): (string | null)[] {
    if (!this.correctWord) return [];
    return this.correctWord.split('').map(ch =>
      this.guessedLetters.has(ch) ? ch : null
    );
  }

  get wordComplete(): boolean {
    return this.displayLetters.every(ch => ch !== null);
  }

  get gameOver(): boolean {
    return this.remainingLives <= 0;
  }

  get lostLives(): number {
    return TOTAL_LIVES - this.remainingLives;
  }

  get hearts(): number[] {
    return Array(TOTAL_LIVES);
  }

  get correctSet(): Set<string> {
    const set = new Set<string>();
    for (const ch of this.correctWord) {
      if (this.guessedLetters.has(ch)) set.add(ch);
    }
    return set;
  }

  ngOnInit() {
    this.audio.unlock();
    this.startTime = Date.now();
    this.startSessionTimer();
    this.loadQuestion();
  }

  ngOnDestroy() {
    this.clearSessionTimer();
    this.clearFeedbackTimer();
  }

  private startSessionTimer() {
    this.sessionTimerHandle = setInterval(() => {
      this.sessionElapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    }, 1000);
  }

  private clearSessionTimer() {
    if (this.sessionTimerHandle) {
      clearInterval(this.sessionTimerHandle);
      this.sessionTimerHandle = null;
    }
  }

  private clearFeedbackTimer() {
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = null;
    }
  }

  formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  }

  private loadQuestion() {
    this.submitting = false;
    this.guessedLetters = new Set();
    this.clearFeedbackTimer();
    const q = this.currentQuestion;
    if (!q) return;
    this.correctWord = (q.word || '').toUpperCase();
  }

  onPause() {}

  guessLetter(letter: string) {
    this.audio.unlock();
    if (this.guessedLetters.has(letter) || this.wordComplete || this.gameOver) return;
    this.guessedLetters.add(letter);

    if (this.correctWord.includes(letter)) {
      this.audio.playCorrect();
      if (this.wordComplete) {
        this.feedbackTimer = setTimeout(() => this.submitWord(), 500);
      }
    } else {
      this.audio.playWrong();
      this.remainingLives--;
      if (this.gameOver) {
        this.audio.playLost();
        this.feedbackTimer = setTimeout(() => this.endGame(), 1500);
      }
    }
    this.cdr.detectChanges();
  }

  private submitWord() {
    if (this.submitting) return;
    this.submitting = true;
    const q = this.currentQuestion;
    if (!q) return;
    this.svc.submitAnswer(this.attempt._id, {
      questionId: q._id,
      typedWord: this.correctWord,
      responseTimeMs: Date.now() - this.startTime,
    }).subscribe({
      next: (r) => {
        this.submitting = false;
        this.lastPoints = r.pointsEarned;
        this.lastXp = r.pointsEarned ? 4 : 0;
        this.xpTrigger++;
        if (r.pointsEarned > 0) this.audio.playXpGain();
        this.score += r.pointsEarned;
        this.correctCount++;
        this.wordsCompleted++;
        if (r.pointsEarned > 0) this.xpEarned += 4;
        if (this.currentIndex + 1 >= this.questions.length) {
          this.endGame();
        } else {
          this.currentIndex++;
          this.loadQuestion();
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.submitting = false;
      }
    });
  }

  private endGame() {
    this.phase = 'complete';
    this.clearSessionTimer();
    this.showConfetti = true;
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    setTimeout(() => {
      this.onComplete.emit({
        score: this.score,
        xpEarned: this.xpEarned,
        accuracy: this.questions.length > 0
          ? Math.round((this.correctCount / this.questions.length) * 100) : 0,
        timeSpentSeconds: elapsed,
      });
    }, 1500);
  }
}
