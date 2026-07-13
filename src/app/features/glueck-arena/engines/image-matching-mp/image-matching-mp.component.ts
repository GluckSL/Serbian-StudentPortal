import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { GameHudComponent } from '../../shared/game-hud/game-hud.component';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { GameAudioService } from '../../services/game-audio.service';
import {
  ArenaBattleRound, ArenaBattleImageQuestion, ArenaBattleAnswerResult,
} from '../../glueck-arena.types';

@Component({
  selector: 'app-image-matching-mp',
  standalone: true,
  imports: [CommonModule, MaterialModule, GameHudComponent, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="immp">
      <app-game-hud
        [score]="localScore"
        [current]="roundIndex + 1"
        [total]="totalRounds"
        [showLives]="false"
      ></app-game-hud>

      <div class="immp__board" *ngIf="question && !answered">
        <div class="immp__image-area">
          <img *ngIf="question.imageUrl" [src]="question.imageUrl" alt="Match the word" class="immp__image">
          <div class="immp__no-image" *ngIf="!question.imageUrl">
            <mat-icon>image</mat-icon>
            <span>{{ question.word }}</span>
          </div>
        </div>
        <p class="immp__question">Which word matches this image?</p>
        <div class="immp__options">
          <button *ngFor="let opt of (question.options || [])" class="immp__option"
            [class.immp__option--selected]="selectedOption === opt"
            [class.immp__option--correct]="feedback === 'correct' && selectedOption === opt"
            [class.immp__option--wrong]="feedback === 'wrong' && selectedOption === opt"
            [disabled]="!!feedback"
            (click)="selectOption(opt)">
            {{ opt }}
          </button>
        </div>
        <div class="immp__submit-area" *ngIf="selectedOption && !feedback">
          <button mat-raised-button color="primary" (click)="submit()">
            <mat-icon>check</mat-icon> Confirm
          </button>
        </div>
        <div class="immp__feedback immp__feedback--correct" *ngIf="feedback === 'correct'">
          <mat-icon>check_circle</mat-icon> +{{ lastPoints }} pts
        </div>
        <div class="immp__feedback immp__feedback--wrong" *ngIf="feedback === 'wrong'">
          <mat-icon>cancel</mat-icon> {{ revealAnswer || 'Wrong' }}
        </div>
      </div>

      <div class="immp__waiting" *ngIf="answered">Waiting for next round…</div>
      <app-xp-float [xp]="lastPoints" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .immp { position: relative; display: flex; flex-direction: column; gap: 12px; }
    .immp__board { background: #fff; border-radius: 20px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,.08); text-align: center; }
    .immp__counter { font-size: 13px; color: #888; font-weight: 600; margin-bottom: 16px; }
    .immp__image-area { margin: 0 auto 16px; max-width: 260px; }
    .immp__image { width: 100%; max-height: 200px; object-fit: contain; border-radius: 12px; border: 2px solid #e2e8f0; }
    .immp__no-image { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px; background: #f1f5f9; border-radius: 12px; color: #64748b; }
    .immp__no-image mat-icon { font-size: 48px; width: 48px; height: 48px; }
    .immp__no-image span { font-size: 20px; font-weight: 700; }
    .immp__question { font-size: 15px; color: #475569; margin-bottom: 16px; }
    .immp__options { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
    .immp__option { padding: 12px 24px; border-radius: 999px; font-size: 16px; font-weight: 700; border: 2px solid #e2e8f0; background: #fff; cursor: pointer; transition: all .15s; color: #1e293b; }
    .immp__option:hover:not(:disabled) { border-color: #405980; background: #f0f4ff; }
    .immp__option--selected { border-color: #405980; background: #405980; color: #fff; }
    .immp__option--correct { border-color: #22c55e !important; background: #22c55e !important; color: #fff !important; }
    .immp__option--wrong { border-color: #ef4444 !important; background: #ef4444 !important; color: #fff !important; }
    .immp__submit-area { margin-top: 16px; }
    .immp__feedback { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 12px; padding: 10px; border-radius: 10px; font-weight: 700; }
    .immp__feedback--correct { background: #e8f5e9; color: #2e7d32; }
    .immp__feedback--wrong { background: #fce4ec; color: #b71c1c; }
    .immp__waiting { text-align: center; color: #888; padding: 24px; font-style: italic; }
  `]
})
export class ImageMatchingMpComponent implements OnChanges {
  @Input() round: ArenaBattleRound | null = null;
  @Input() localScore = 0;
  @Input() answerResult: ArenaBattleAnswerResult | null = null;
  @Output() submitAnswer = new EventEmitter<{ typedWord: string }>();

  question: ArenaBattleImageQuestion | null = null;
  roundIndex = 0;
  totalRounds = 10;
  selectedOption: string | null = null;
  feedback: 'correct' | 'wrong' | null = null;
  answered = false;
  lastPoints = 0;
  revealAnswer = '';
  xpTrigger = 0;
  showConfetti = false;

  constructor(readonly audio: GameAudioService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['round'] && this.round) this.loadRound(this.round);
    if (changes['answerResult'] && this.answerResult) this.applyResult(this.answerResult);
  }

  loadRound(round: ArenaBattleRound) {
    this.question = round.question as ArenaBattleImageQuestion;
    this.roundIndex = round.roundIndex;
    this.totalRounds = round.totalRounds;
    this.selectedOption = null;
    this.feedback = null;
    this.answered = false;
    this.revealAnswer = '';
  }

  selectOption(opt: string) {
    if (this.feedback) return;
    this.selectedOption = opt;
  }

  submit() {
    if (!this.selectedOption || this.feedback || this.answered) return;
    this.answered = true;
    this.submitAnswer.emit({ typedWord: this.selectedOption });
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
}
