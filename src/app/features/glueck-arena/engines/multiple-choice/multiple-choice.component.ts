import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { GameAudioService } from '../../services/game-audio.service';
import { MultipleChoiceQuestion, GameAttempt, GameSet } from '../../glueck-arena.types';

export interface MCResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
}

@Component({
  selector: 'app-multiple-choice',
  standalone: true,
  imports: [CommonModule, MaterialModule, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="mc">
      <header class="mc__hud">
        <div class="mc__lives">
          <mat-icon *ngFor="let _ of [].constructor(lives); let i = index" class="mc__heart">favorite</mat-icon>
          <mat-icon *ngFor="let _ of [].constructor(maxLives - lives); let i = index" class="mc__heart mc__heart--lost">favorite_border</mat-icon>
        </div>
        <div class="mc__score">
          <mat-icon>star</mat-icon>
          <span>{{ score }}</span>
        </div>
        <div class="mc__progress">
          <span>{{ currentIndex + 1 }} / {{ questions.length }}</span>
        </div>
        <div class="mc__timer" [class.mc__timer--warn]="remainingSeconds <= 10 && remainingSeconds > 0" [class.mc__timer--danger]="remainingSeconds <= 5 && remainingSeconds > 0">
          <mat-icon>timer</mat-icon>
          <span>{{ formatTime(remainingSeconds) }}</span>
        </div>
      </header>

      <div class="mc__body" *ngIf="phase === 'playing' && currentQuestion">
        <div class="mc__image" *ngIf="currentQuestion.imageUrl">
          <img [src]="currentQuestion.imageUrl" alt="">
        </div>

        <h2 class="mc__question">{{ currentQuestion.questionText }}</h2>

        <div class="mc__options">
          <button
            *ngFor="let opt of currentQuestion.options; let i = index"
            class="mc__option"
            [class.mc__option--selected]="submitting && selectedIndex === i"
            [class.mc__option--correct]="correctIndex !== null && i === correctIndex"
            [class.mc__option--wrong]="correctIndex !== null && selectedIndex === i && i !== correctIndex"
            [class.mc__option--disabled]="correctIndex !== null || submitting"
            [disabled]="correctIndex !== null || submitting"
            (click)="selectOption(i)"
          >
            <span class="mc__option-letter">{{ optionLetters[i] }}</span>
            <span class="mc__option-text">{{ opt.text }}</span>
            <mat-icon *ngIf="correctIndex !== null && i === correctIndex" class="mc__option-icon mc__option-icon--correct">check_circle</mat-icon>
            <mat-icon *ngIf="correctIndex !== null && selectedIndex === i && i !== correctIndex" class="mc__option-icon mc__option-icon--wrong">cancel</mat-icon>
          </button>
        </div>

        <div class="mc__next-area" *ngIf="correctIndex !== null && !isLast && lives > 0">
          <button class="mc__next" (click)="nextQuestion()">
            Sledeće <mat-icon>arrow_forward</mat-icon>
            <div class="mc__next-progress"></div>
          </button>
        </div>
      </div>

      <div class="mc__body mc__body--done" *ngIf="phase === 'done'">
        <mat-icon class="mc__done-icon" *ngIf="dead">heart_broken</mat-icon>
        <mat-icon class="mc__done-icon" *ngIf="!dead && accuracy >= 80">emoji_events</mat-icon>
        <mat-icon class="mc__done-icon" *ngIf="!dead && accuracy < 80 && accuracy >= 50">thumb_up</mat-icon>
        <mat-icon class="mc__done-icon" *ngIf="!dead && accuracy < 50">replay</mat-icon>
        <p *ngIf="dead">Igra završena — nema više života!</p>
        <p *ngIf="!dead">Sva pitanja odgovorena!</p>
      </div>

      <app-xp-float [xp]="xpBurst" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .mc { position: relative; max-width: 640px; margin: 0 auto; }
    .mc__hud {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 12px 16px; background: #fff; border-radius: 16px;
      margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.06);
    }
    .mc__score { display: flex; align-items: center; gap: 4px; font-weight: 700; font-size: 18px; color: #f59e0b; }
    .mc__score mat-icon { color: #f59e0b; }
    .mc__lives { display: flex; align-items: center; gap: 2px; }
    .mc__heart { font-size: 20px; width: 20px; height: 20px; color: #ef4444; }
    .mc__heart--lost { color: #cbd5e1; }
    .mc__progress { font-size: 14px; font-weight: 600; color: #64748b; }
    .mc__timer { display: flex; align-items: center; gap: 4px; font-size: 16px; font-weight: 700; color: #334155; }
    .mc__timer--warn { color: #f59e0b; }
    .mc__timer--danger { color: #ef4444; animation: mc-pulse 0.6s infinite; }
    @keyframes mc-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }

    .mc__body { 
      background: #fff; border-radius: 16px; padding: 32px 24px;
      box-shadow: 0 2px 12px rgba(0,0,0,.06); text-align: center;
    }
    .mc__body--done { text-align: center; padding: 48px; }
    .mc__done-icon { font-size: 64px; width: 64px; height: 64px; margin-bottom: 12px; color: #f59e0b; }

    .mc__image { margin-bottom: 20px; }
    .mc__image img { max-width: 100%; max-height: 200px; border-radius: 12px; object-fit: cover; }

    .mc__question { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 24px; line-height: 1.4; }

    .mc__options { display: flex; flex-direction: column; gap: 12px; max-width: 480px; margin: 0 auto; }
    .mc__option {
      display: flex; align-items: center; gap: 12px; width: 100%;
      padding: 14px 18px; border: 2px solid #cbd5e1; border-radius: 14px;
      background: #fff; cursor: pointer; font-size: 16px; text-align: left;
      color: #0f172a; transition: all 0.15s; font-family: inherit;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
    }
    .mc__option:hover:not(.mc__option--disabled) { border-color: #6366f1; background: #eef2ff; transform: translateX(4px); box-shadow: 0 2px 8px rgba(99,102,241,.12); }
    .mc__option--selected { border-color: #6366f1; background: #eef2ff; }
    .mc__option--correct { border-color: #22c55e; background: #f0fdf4; }
    .mc__option--wrong { border-color: #ef4444; background: #fef2f2; }
    .mc__option--disabled { cursor: default; opacity: .85; }
    .mc__option-letter {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 50%;
      background: #e2e8f0; font-weight: 700; font-size: 14px; color: #475569;
      flex-shrink: 0;
    }
    .mc__option--selected .mc__option-letter { background: #6366f1; color: #fff; }
    .mc__option--correct .mc__option-letter { background: #22c55e; color: #fff; }
    .mc__option--wrong .mc__option-letter { background: #ef4444; color: #fff; }
    .mc__option-text { flex: 1; }
    .mc__option-icon { flex-shrink: 0; font-size: 22px; width: 22px; height: 22px; }
    .mc__option-icon--correct { color: #22c55e; }
    .mc__option-icon--wrong { color: #ef4444; }

    .mc__next {
      position: relative; display: inline-flex; align-items: center; gap: 6px; margin-top: 24px;
      padding: 10px 24px; border: none; border-radius: 10px;
      background: #1e3a5f; color: #fff;
      font-size: 15px; font-weight: 600; cursor: pointer; overflow: hidden;
      transition: transform 0.15s; font-family: inherit;
    }
    .mc__next:hover { transform: translateY(-1px); }
    .mc__next-progress {
      position: absolute; inset: 0; border-radius: 10px;
      background: rgba(255,255,255,.15);
      pointer-events: none;
      animation: mc-progress 3s linear forwards;
    }
    @keyframes mc-progress { from { width: 0%; } to { width: 100%; } }
  `]
})
export class MultipleChoiceComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() gameSet!: GameSet;
  @Input() questions: MultipleChoiceQuestion[] = [];
  @Output() onComplete = new EventEmitter<MCResult>();

  readonly optionLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
  readonly maxLives = 3;
  phase: 'playing' | 'done' = 'playing';
  currentIndex = 0;
  lives = 3;
  score = 0;
  accuracy = 0;
  correctCount = 0;
  submitting = false;
  selectedIndex: number | null = null;
  correctIndex: number | null = null;
  xpBurst = 0;
  xpTrigger = 0;
  showConfetti = false;

  remainingSeconds = 0;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private autoAdvanceHandle: ReturnType<typeof setTimeout> | null = null;
  private startTs = 0;

  get dead(): boolean { return this.lives <= 0; }

  constructor(
    private svc: InteractiveGameService,
    private cdr: ChangeDetectorRef,
    public audio: GameAudioService,
  ) {}

  get currentQuestion(): MultipleChoiceQuestion | null {
    return this.questions[this.currentIndex] ?? null;
  }

  get isLast(): boolean {
    return this.currentIndex >= this.questions.length - 1;
  }

  ngOnInit() {
    this.startTimer();
    this.startTs = Date.now();
  }

  ngOnDestroy() {
    this.stopTimer();
    this.stopAutoAdvance();
  }

  private startTimer() {
    const limit = this.gameSet?.timerSettings?.perQuestionSeconds;
    if (limit && limit > 0) {
      this.remainingSeconds = limit;
      this.timerHandle = setInterval(() => {
        this.remainingSeconds--;
        if (this.remainingSeconds <= 0) {
          this.autoSubmit();
        }
        this.cdr.markForCheck();
      }, 1000);
    } else {
      this.remainingSeconds = 999;
    }
  }

  private stopTimer() {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private autoSubmit() {
    if (this.correctIndex !== null || this.submitting || this.dead) return;
    this.stopTimer();
    this.selectOption(-1);
  }

  selectOption(index: number) {
    if (this.correctIndex !== null || this.submitting || this.dead) return;
    this.audio.unlock();
    this.submitting = true;
    this.selectedIndex = index;

    const payload: any = {
      gameType: 'multiple_choice',
      questionId: this.currentQuestion!._id,
      selectedIndex: index,
    };

    this.svc.submitAnswer(this.attempt._id, payload).subscribe({
      next: (r: any) => {
        this.submitting = false;
        this.correctIndex = r.correctAnswer?.correctIndex ?? -1;
        if (r.isCorrect) {
          this.score += r.pointsEarned || 0;
          this.correctCount++;
          this.xpBurst = r.pointsEarned || 0;
          this.xpTrigger++;
          this.audio.playCorrect();
          this.audio.playXpGain();
        } else {
          this.lives--;
          this.audio.playWrong();
        }
        if (this.dead || this.isLast) {
          this.finish();
        } else {
          this.startAutoAdvance();
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.submitting = false;
        this.cdr.markForCheck();
      }
    });
  }

  private startAutoAdvance() {
    this.autoAdvanceHandle = setTimeout(() => this.nextQuestion(), 3000);
  }

  private stopAutoAdvance() {
    if (this.autoAdvanceHandle) {
      clearTimeout(this.autoAdvanceHandle);
      this.autoAdvanceHandle = null;
    }
  }

  nextQuestion() {
    this.stopAutoAdvance();
    this.currentIndex++;
    this.selectedIndex = null;
    this.correctIndex = null;
    this.stopTimer();
    this.startTimer();
  }

  private finish() {
    this.stopTimer();
    this.stopAutoAdvance();
    const timeSpentSeconds = Math.round((Date.now() - this.startTs) / 1000);
    const accuracy = this.questions.length > 0
      ? Math.round((this.correctCount / this.questions.length) * 100)
      : 0;

    this.svc.completeAttempt(this.attempt._id, { timeSpentSeconds }).subscribe({
      next: (r) => {
        this.showConfetti = accuracy >= 80;
        this.phase = 'done';
        this.onComplete.emit({
          score: this.score,
          xpEarned: r.xpBonus || 0,
          accuracy,
          timeSpentSeconds,
        });
        this.cdr.markForCheck();
      },
      error: () => {
        this.phase = 'done';
        this.onComplete.emit({ score: this.score, xpEarned: 0, accuracy, timeSpentSeconds });
        this.cdr.markForCheck();
      }
    });
  }

  formatTime(sec: number): string {
    if (sec >= 999) return '--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  }
}
