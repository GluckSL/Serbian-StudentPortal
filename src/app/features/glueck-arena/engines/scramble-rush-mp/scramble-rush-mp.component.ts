import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges,
  ViewChild, ElementRef, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../shared/material.module';
import { GameHudComponent } from '../../shared/game-hud/game-hud.component';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { GameAudioService } from '../../services/game-audio.service';
import {
  ArenaBattleRound,
  ArenaBattleScrambleQuestion,
  ArenaBattleAnswerResult,
} from '../../glueck-arena.types';
import { germanUppercase } from '../../utils/german-text';

@Component({
  selector: 'app-scramble-rush-mp',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule, GameHudComponent, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="srmp" (click)="focusInput()">
      <app-game-hud
        [score]="localScore"
        [timeLeft]="timeLeftSec"
        [current]="roundIndex + 1"
        [total]="totalRounds"
        [showLives]="false"
      ></app-game-hud>

      <div class="srmp__arena" *ngIf="question">
        <div class="srmp__letters">{{ displayLetters }}</div>
        <p class="srmp__hint" *ngIf="question.hint">{{ question.hint }}</p>
        <button type="button" class="srmp__audio" *ngIf="question.audioUrl"
          (click)="$event.stopPropagation(); audio.playUrl(question.audioUrl!)">
          <mat-icon>volume_up</mat-icon>
        </button>
        <div class="srmp__timer-bar">
          <div class="srmp__timer-fill" [style.width.%]="timerPercent"></div>
        </div>
        <div class="srmp__feedback srmp__feedback--correct" *ngIf="feedback === 'correct'">
          <mat-icon>check_circle</mat-icon> +{{ lastPoints }} pts
          <span *ngIf="lastFastest" class="srmp__bonus">⚡ Fastest!</span>
        </div>
        <div class="srmp__feedback srmp__feedback--wrong" *ngIf="feedback === 'wrong'">
          <mat-icon>cancel</mat-icon> {{ revealWord || 'Wrong' }}
        </div>
        <div class="srmp__locked" *ngIf="answered">Waiting for next round…</div>
      </div>

      <div class="srmp__input-bar" *ngIf="!answered">
        <input #wordInput class="srmp__input" type="text" [(ngModel)]="typedWord"
          (keyup.enter)="submit()" [disabled]="!!feedback"
          autocomplete="off" autocorrect="off" spellcheck="false"
          placeholder="Type the word…" inputmode="text">
        <button mat-raised-button color="primary" (click)="submit()" [disabled]="!typedWord.trim() || !!feedback">
          <mat-icon>send</mat-icon>
        </button>
      </div>

      <app-xp-float [xp]="lastPoints" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .srmp { position: relative; display: flex; flex-direction: column; gap: 12px; }
    .srmp__arena { position: relative; min-height: 220px; background: linear-gradient(180deg,#dbeeff,#eef4ff); border-radius: 20px; padding: 32px 24px; text-align: center; border: 2px solid #c8d8e8; }
    .srmp__round-badge { font-size: 13px; font-weight: 600; color: #666; margin-bottom: 12px; }
    .srmp__letters {
      font-size: 36px; font-weight: 800; letter-spacing: 6px; color: #ff8f00;
      display: block; margin: 16px 0; white-space: nowrap; word-break: keep-all;
    }
    .srmp__hint { color: #666; font-size: 14px; margin: 8px 0; }
    .srmp__audio { background: #fff; border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
    .srmp__timer-bar { height: 6px; background: #e0e0e0; border-radius: 3px; margin-top: 24px; overflow: hidden; }
    .srmp__timer-fill { height: 100%; background: linear-gradient(90deg,#405980,#5c7cfa); transition: width .1s linear; }
    .srmp__feedback { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 16px; padding: 10px; border-radius: 12px; font-weight: 700; }
    .srmp__feedback--correct { background: #e8f5e9; color: #2e7d32; }
    .srmp__feedback--wrong { background: #fce4ec; color: #b71c1c; }
    .srmp__bonus { margin-left: 8px; font-size: 13px; }
    .srmp__locked { margin-top: 16px; color: #888; font-style: italic; }
    .srmp__input-bar { display: flex; gap: 10px; background: #fff; padding: 10px; border-radius: 14px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    .srmp__input { flex: 1; border: 2px solid #e0e0e0; border-radius: 10px; padding: 12px; font-size: 18px; font-weight: 700; }
    @media (max-width: 480px) { .srmp__letters { font-size: 26px; letter-spacing: 3px; } }
  `]
})
export class ScrambleRushMpComponent implements OnChanges, OnDestroy {
  @Input() round: ArenaBattleRound | null = null;
  @Input() localScore = 0;
  @Input() answerResult: ArenaBattleAnswerResult | null = null;
  @Output() submitAnswer = new EventEmitter<{ typedWord: string }>();

  @ViewChild('wordInput') wordInputRef!: ElementRef<HTMLInputElement>;

  question: ArenaBattleScrambleQuestion | null = null;
  roundIndex = 0;
  totalRounds = 10;
  typedWord = '';
  feedback: 'correct' | 'wrong' | null = null;
  answered = false;
  timeLeftSec: number | null = null;
  timerPercent = 100;
  lastPoints = 0;
  lastFastest = false;
  revealWord = '';
  xpTrigger = 0;
  showConfetti = false;

  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(readonly audio: GameAudioService) {}

  get displayLetters(): string {
    return (this.question?.scrambledLetters || [])
      .map((ch) => String(ch || '').trim())
      .filter(Boolean)
      .join('\u00a0');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['round'] && this.round) {
      this.loadRound(this.round);
    }
    if (changes['answerResult'] && this.answerResult) {
      this.applyResult(this.answerResult);
    }
  }

  ngOnDestroy() {
    this.clearTimer();
  }

  loadRound(round: ArenaBattleRound) {
    this.clearTimer();
    this.question = round.question as ArenaBattleScrambleQuestion;
    this.roundIndex = round.roundIndex;
    this.totalRounds = round.totalRounds;
    this.typedWord = '';
    this.feedback = null;
    this.answered = false;
    this.revealWord = '';
    this.startRoundTimer(round);
    setTimeout(() => this.focusInput(), 200);
  }

  startRoundTimer(round: ArenaBattleRound) {
    const end = new Date(round.roundEndsAt || '').getTime();
    const start = new Date(round.roundStartedAt || '').getTime();
    const duration = end - start || round.roundDurationMs || 15000;

    const tick = () => {
      const now = Date.now();
      const left = Math.max(0, Math.ceil((end - now) / 1000));
      this.timeLeftSec = left;
      this.timerPercent = Math.max(0, ((end - now) / duration) * 100);
      if (left <= 0) this.clearTimer();
    };
    tick();
    this.timerId = setInterval(tick, 200);
  }

  submit() {
    const word = germanUppercase(this.typedWord);
    if (!word || this.answered || this.feedback) return;
    this.answered = true;
    this.submitAnswer.emit({ typedWord: word });
  }

  applyResult(r: ArenaBattleAnswerResult) {
    this.feedback = r.isCorrect ? 'correct' : 'wrong';
    this.lastPoints = r.points;
    this.lastFastest = !!r.fastest;
    this.revealWord = r.correctAnswer?.word || '';
    if (r.isCorrect) {
      this.audio.playCorrect();
      this.xpTrigger++;
      this.audio.playXpGain();
      this.showConfetti = true;
      setTimeout(() => this.showConfetti = false, 1500);
    } else {
      this.audio.playWrong();
    }
  }

  focusInput() {
    this.audio.unlock();
    this.wordInputRef?.nativeElement?.focus();
  }

  clearTimer() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;
  }
}

