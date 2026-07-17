import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../shared/material.module';
import { GameHudComponent } from '../../shared/game-hud/game-hud.component';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { GameAudioService } from '../../services/game-audio.service';
import {
  ArenaBattleRound, ArenaBattleFlashCardQuestion, ArenaBattleAnswerResult,
} from '../../glueck-arena.types';

@Component({
  selector: 'app-flash-cards-mp',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule, GameHudComponent, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="fcmp">
      <app-game-hud
        [score]="localScore"
        [current]="roundIndex + 1"
        [total]="totalRounds"
        [showLives]="false"
      ></app-game-hud>

      <div class="fcmp__card" *ngIf="question && !answered">
        <div class="fcmp__prompt">{{ question.prompt }}</div>
        <div class="fcmp__hint" *ngIf="question.hint">
          <mat-icon>lightbulb</mat-icon> {{ question.hint }}
        </div>
        <div class="fcmp__timer-bar">
          <div class="fcmp__timer-fill" [style.width.%]="timerPercent"></div>
        </div>
        <div class="fcmp__input-bar">
          <input #inputRef class="fcmp__input" type="text" [(ngModel)]="typedAnswer"
            (keyup.enter)="submit()" [disabled]="!!feedback"
            autocomplete="off" autocorrect="off" spellcheck="false"
            placeholder="Unesite odgovor…">
          <button mat-raised-button color="primary" (click)="submit()" [disabled]="!typedAnswer.trim() || !!feedback">
            <mat-icon>send</mat-icon>
          </button>
        </div>
        <div class="fcmp__feedback fcmp__feedback--correct" *ngIf="feedback === 'correct'">
          <mat-icon>check_circle</mat-icon> +{{ lastPoints }} pts
        </div>
        <div class="fcmp__feedback fcmp__feedback--wrong" *ngIf="feedback === 'wrong'">
          <mat-icon>cancel</mat-icon> {{ revealAnswer || 'Pogrešno' }}
        </div>
      </div>

      <div class="fcmp__waiting" *ngIf="answered">Waiting for next round…</div>

      <app-xp-float [xp]="lastPoints" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .fcmp { position: relative; display: flex; flex-direction: column; gap: 12px; }
    .fcmp__card { background: linear-gradient(180deg, #f0f4ff, #e8eeff); border-radius: 20px; padding: 32px 24px; text-align: center; border: 2px solid #c8d8e8; min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
    .fcmp__counter { font-size: 13px; font-weight: 600; color: #666; }
    .fcmp__prompt { font-size: 28px; font-weight: 800; color: #1e3a5f; max-width: 500px; line-height: 1.3; }
    .fcmp__hint { display: flex; align-items: center; gap: 6px; font-size: 14px; color: #666; background: #fff; padding: 8px 16px; border-radius: 10px; }
    .fcmp__hint mat-icon { font-size: 18px; width: 18px; height: 18px; color: #f59e0b; }
    .fcmp__timer-bar { height: 6px; background: #e0e0e0; border-radius: 3px; width: 100%; max-width: 400px; overflow: hidden; }
    .fcmp__timer-fill { height: 100%; background: linear-gradient(90deg, #405980, #5c7cfa); transition: width .1s linear; }
    .fcmp__input-bar { display: flex; gap: 10px; background: #fff; padding: 10px; border-radius: 14px; box-shadow: 0 2px 12px rgba(0,0,0,.08); width: 100%; max-width: 400px; }
    .fcmp__input { flex: 1; border: 2px solid #e0e0e0; border-radius: 10px; padding: 12px; font-size: 18px; font-weight: 700; outline: none; }
    .fcmp__input:focus { border-color: #405980; }
    .fcmp__feedback { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 20px; border-radius: 12px; font-weight: 700; }
    .fcmp__feedback--correct { background: #e8f5e9; color: #2e7d32; }
    .fcmp__feedback--wrong { background: #fce4ec; color: #b71c1c; }
    .fcmp__waiting { text-align: center; color: #888; padding: 24px; font-style: italic; }
  `]
})
export class FlashCardsMpComponent implements OnChanges, OnDestroy {
  @Input() round: ArenaBattleRound | null = null;
  @Input() localScore = 0;
  @Input() answerResult: ArenaBattleAnswerResult | null = null;
  @Output() submitAnswer = new EventEmitter<{ typedWord: string }>();

  question: ArenaBattleFlashCardQuestion | null = null;
  roundIndex = 0;
  totalRounds = 10;
  typedAnswer = '';
  feedback: 'correct' | 'wrong' | null = null;
  answered = false;
  timerPercent = 100;
  lastPoints = 0;
  revealAnswer = '';
  xpTrigger = 0;
  showConfetti = false;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(readonly audio: GameAudioService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['round'] && this.round) this.loadRound(this.round);
    if (changes['answerResult'] && this.answerResult) this.applyResult(this.answerResult);
  }

  ngOnDestroy() { this.clearTimer(); }

  loadRound(round: ArenaBattleRound) {
    this.clearTimer();
    this.question = round.question as ArenaBattleFlashCardQuestion;
    this.roundIndex = round.roundIndex;
    this.totalRounds = round.totalRounds;
    this.typedAnswer = '';
    this.feedback = null;
    this.answered = false;
    this.revealAnswer = '';
    this.startRoundTimer(round);
  }

  startRoundTimer(round: ArenaBattleRound) {
    const end = new Date(round.roundEndsAt || '').getTime();
    const start = new Date(round.roundStartedAt || '').getTime();
    const duration = end - start || round.roundDurationMs || 15000;
    const tick = () => {
      const now = Date.now();
      this.timerPercent = Math.max(0, ((end - now) / duration) * 100);
      if (now >= end) this.clearTimer();
    };
    tick();
    this.timerId = setInterval(tick, 200);
  }

  submit() {
    const answer = this.typedAnswer.trim();
    if (!answer || this.answered || this.feedback) return;
    this.answered = true;
    this.submitAnswer.emit({ typedWord: answer });
  }

  applyResult(r: ArenaBattleAnswerResult) {
    this.feedback = r.isCorrect ? 'correct' : 'wrong';
    this.lastPoints = r.points;
    this.revealAnswer = r.correctAnswer?.word || '';
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

  private clearTimer() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;
  }
}
