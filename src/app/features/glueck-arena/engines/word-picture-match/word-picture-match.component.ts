import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { GameAudioService } from '../../services/game-audio.service';
import { WordPictureMatchQuestion, GameAttempt, GameSet } from '../../glueck-arena.types';
import { germanUppercase } from '../../utils/german-text';

export interface WPMResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
}

interface ImageCard {
  pairIndex: number;
  imageUrl: string;
  matched: boolean;
  wrongFlash: boolean;
}

@Component({
  selector: 'app-word-picture-match',
  standalone: true,
  imports: [CommonModule, MaterialModule, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="wpm">
      <header class="wpm__hud">
        <div class="wpm__hud-left">
          <div class="wpm__score">
            <mat-icon>star</mat-icon>
            <span>{{ score }}</span>
          </div>
          <div class="wpm__lives">
            <mat-icon *ngFor="let _ of livesArr" style="color:#ef4444">favorite</mat-icon>
            <mat-icon *ngFor="let _ of lostLivesArr" style="color:#d1d5db">favorite_border</mat-icon>
          </div>
        </div>
        <div class="wpm__progress">
          <span>{{ matchedCount }}/{{ totalPairsInRound }} matched</span>
        </div>
        <div class="wpm__timer" [class.wpm__timer--warn]="remainingSeconds <= 15">
          <mat-icon>timer</mat-icon>
          <span>{{ formatTime(remainingSeconds) }}</span>
        </div>
      </header>

      <div class="wpm__round-info" *ngIf="totalQuestions > 1">
        <span>Round {{ currentQuestionIndex + 1 }} / {{ totalQuestions }}</span>
      </div>

      <div class="wpm__word-area" *ngIf="phase === 'playing'">
        <div class="wpm__word" [class.wpm__word--enter]="wordAnimState === 'enter'" [class.wpm__word--leave]="wordAnimState === 'leave'">
          <span class="wpm__word-text">{{ formatWord(currentWord) }}</span>
        </div>
        <p class="wpm__hint">Click the matching picture</p>
      </div>

      <div class="wpm__board" *ngIf="phase === 'playing'" (click)="audio.unlock()">
        <ng-container *ngFor="let card of cards">
          <button
            *ngIf="!card.matched"
            class="wpm__card"
            [class.wpm__card--wrong]="card.wrongFlash"
            [disabled]="submitting"
            (click)="onCardClick(card)"
          >
            <img [src]="card.imageUrl" alt="" draggable="false">
          </button>
        </ng-container>
      </div>

      <div class="wpm__empty" *ngIf="phase === 'playing' && cards.length === 0">
        <p>Loading images...</p>
      </div>

      <app-xp-float [xp]="xpBurst" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .wpm { position: relative; max-width: 720px; margin: 0 auto; padding: 16px; }
    .wpm__hud {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 12px 16px; background: #fff; border-radius: 16px;
      margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.06);
    }
    .wpm__hud-left { display: flex; align-items: center; gap: 16px; }
    .wpm__score { font-size: 22px; font-weight: 800; color: #f59e0b; display: flex; align-items: center; gap: 4px; }
    .wpm__score mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .wpm__lives { display: flex; gap: 2px; }
    .wpm__lives mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .wpm__progress { font-size: 13px; font-weight: 700; color: #64748b; background: #f1f5f9; padding: 4px 12px; border-radius: 999px; }
    .wpm__timer { display: flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 700; color: #1e293b; background: #f1f5f9; padding: 6px 14px; border-radius: 999px; }
    .wpm__timer mat-icon { font-size: 18px; width: 18px; height: 18px; color: #64748b; }
    .wpm__timer--warn { color: #dc2626; background: #fef2f2; }
    .wpm__timer--warn mat-icon { color: #dc2626; }
    .wpm__round-info { text-align: center; font-size: 12px; font-weight: 700; color: #94a3b8; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .04em; }
    .wpm__word-area { text-align: center; margin-bottom: 16px; min-height: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .wpm__word {
      display: inline-block; font-size: 32px; font-weight: 800; color: #1e293b;
      padding: 12px 28px; background: #fff; border-radius: 16px;
      box-shadow: 0 4px 16px rgba(0,0,0,.08); border: 2px solid #e2e8f0;
    }
    .wpm__word--enter { animation: wpmWordIn .35s ease-out; }
    .wpm__word--leave { animation: wpmWordOut .25s ease-in forwards; }
    @keyframes wpmWordIn {
      from { opacity: 0; transform: translateX(-40px) scale(.9); }
      to { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes wpmWordOut {
      from { opacity: 1; transform: translateX(0) scale(1); }
      to { opacity: 0; transform: translateX(40px) scale(.9); }
    }
    .wpm__hint { margin: 8px 0 0; font-size: 13px; color: #94a3b8; }
    .wpm__board {
      display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;
      background: #fff; border-radius: 20px; padding: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,.08);
      min-height: 160px;
    }
    .wpm__card {
      position: relative; width: 140px; height: 140px; border-radius: 16px;
      overflow: hidden; cursor: pointer; border: 3px solid #e2e8f0;
      background: #f8fafc; padding: 0; transition: transform .15s, border-color .2s, opacity .3s;
      flex-shrink: 0;
    }
    .wpm__card:hover:not(:disabled) { transform: translateY(-3px); border-color: #6366f1; box-shadow: 0 8px 20px rgba(99,102,241,.2); }
    .wpm__card:active:not(:disabled) { transform: translateY(0); }
    .wpm__card img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .wpm__card--wrong { border-color: #ef4444; animation: wpmShake .35s ease; }
    @keyframes wpmShake {
      0%,100% { transform: translateX(0); }
      20% { transform: translateX(-8px); }
      40% { transform: translateX(8px); }
      60% { transform: translateX(-6px); }
      80% { transform: translateX(6px); }
    }

  `]
})
export class WordPictureMatchComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() questions: WordPictureMatchQuestion[] = [];
  @Input() shuffledWords: string[] = [];
  @Input() gameSet!: GameSet;
  @Output() onComplete = new EventEmitter<WPMResult>();

  score = 0;
  lives = 3;
  currentQuestionIndex = 0;
  cards: ImageCard[] = [];
  currentWord = '';
  currentWordIndex = 0;
  totalPairs = 0;
  correctCount = 0;
  matchedCount = 0;
  totalPairsInRound = 0;
  totalQuestions = 0;
  phase: 'playing' | 'done' = 'playing';
  submitting = false;
  allMatched = false;

  wordAnimState: 'enter' | 'leave' | '' = '';
  xpBurst = 0;
  xpTrigger = 0;
  showConfetti = false;

  remainingSeconds: number;
  private timerRef: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();
  private questionWords: string[] = [];

  get livesArr(): number[] { return Array(this.lives).fill(0); }
  get lostLivesArr(): number[] { return Array(3 - this.lives).fill(0); }

  formatWord(word: string): string {
    return germanUppercase(word);
  }

  get accuracy(): number {
    if (this.totalPairs === 0) return 0;
    return Math.round((this.correctCount / this.totalPairs) * 100);
  }

  constructor(
    private svc: InteractiveGameService,
    readonly audio: GameAudioService,
    private cdr: ChangeDetectorRef
  ) {
    this.remainingSeconds = 120;
  }

  ngOnInit() {
    this.lives = this.attempt.livesRemaining ?? 3;
    this.totalQuestions = this.questions.length;
    const limitSec = this.gameSet?.timerSettings?.sessionLimitSeconds;
    this.remainingSeconds = limitSec && limitSec > 0 ? limitSec : 120;

    this.totalPairs = 0;
    this.questions.forEach(q => {
      if (q.pairs) this.totalPairs += q.pairs.length;
    });

    this.loadQuestion(0);
    this.startTimer();
  }

  ngOnDestroy() {
    this.stopTimer();
  }

  private startTimer() {
    this.timerRef = setInterval(() => {
      this.remainingSeconds--;
      if (this.remainingSeconds <= 0) {
        this.remainingSeconds = 0;
        this.endGame();
      }
    }, 1000);
  }

  private stopTimer() {
    if (this.timerRef) {
      clearInterval(this.timerRef);
      this.timerRef = null;
    }
  }

  private loadQuestion(index: number) {
    const q = this.questions[index];
    if (!q) {
      this.endGame();
      return;
    }

    this.currentQuestionIndex = index;
    const pairs = q.pairs || [];
    this.totalPairsInRound = pairs.length;
    this.matchedCount = 0;

    this.cards = pairs.map((p, i) => ({
      pairIndex: i,
      imageUrl: p.imageUrl || '',
      matched: false,
      wrongFlash: false,
    }));

    this.questionWords = pairs.map(p => p.word).filter(Boolean);
    this.questionWords = this.shuffleArray(this.questionWords);
    this.currentWordIndex = 0;
    this.nextWord();
  }

  private shuffleArray<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private nextWord() {
    if (this.currentWordIndex < this.questionWords.length) {
      this.currentWord = this.questionWords[this.currentWordIndex];
      this.wordAnimState = 'enter';
      setTimeout(() => { this.wordAnimState = ''; }, 350);
    } else {
      this.currentWord = '';
      this.advanceRound();
    }
  }

  private advanceRound() {
    const nextIndex = this.currentQuestionIndex + 1;
    if (nextIndex < this.totalQuestions) {
      setTimeout(() => this.loadQuestion(nextIndex), 300);
    } else {
      this.endGame();
    }
  }

  onCardClick(card: ImageCard) {
    if (this.submitting || card.matched) return;

    this.submitting = true;
    const q = this.questions[this.currentQuestionIndex];

    this.svc.submitWordPictureMatchSlot(this.attempt._id, {
      questionId: q._id,
      pairIndex: card.pairIndex,
      word: this.currentWord,
      responseTimeMs: Date.now() - this.startTime,
    }).subscribe({
      next: (r) => {
        this.submitting = false;
        if (r.isCorrect) {
          this.handleCorrect(card);
        } else {
          this.handleWrong(card);
        }
      },
      error: () => {
        this.submitting = false;
      }
    });
  }

  private handleCorrect(card: ImageCard) {
    card.matched = true;
    this.matchedCount++;
    this.correctCount++;
    this.score += 10;
    this.xpBurst = 10;
    this.xpTrigger++;

    this.audio.playCorrect();
    this.audio.playXpGain();

    this.wordAnimState = 'leave';
    setTimeout(() => {
      this.currentWordIndex++;
      this.nextWord();
    }, 250);
  }

  private handleWrong(card: ImageCard) {
    this.lives--;
    card.wrongFlash = true;
    this.audio.playWrong();
    setTimeout(() => {
      card.wrongFlash = false;
    }, 350);

    if (this.lives <= 0) {
      this.audio.playLost();
      setTimeout(() => this.endGame(), 400);
    }
  }

  private endGame() {
    if (this.phase !== 'playing') return;
    this.stopTimer();
    this.allMatched = this.lives > 0 && this.remainingSeconds > 0;
    const timeSpentSeconds = Math.round((Date.now() - this.startTime) / 1000);

    if (this.allMatched) {
      this.showConfetti = true;
    }

    this.phase = 'done';
    this.onComplete.emit({
      score: this.score,
      xpEarned: this.score,
      accuracy: this.accuracy,
      timeSpentSeconds,
    });
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  }
}
