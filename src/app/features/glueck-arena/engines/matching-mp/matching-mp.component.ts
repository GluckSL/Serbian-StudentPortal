import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { GameHudComponent } from '../../shared/game-hud/game-hud.component';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { GameAudioService } from '../../services/game-audio.service';
import {
  ArenaBattleRound, ArenaBattleMatchingQuestion, ArenaBattleAnswerResult,
} from '../../glueck-arena.types';

@Component({
  selector: 'app-matching-mp',
  standalone: true,
  imports: [CommonModule, MaterialModule, GameHudComponent, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="mmp">
      <app-game-hud
        [score]="localScore"
        [current]="roundIndex + 1"
        [total]="totalRounds"
        [showLives]="false"
      ></app-game-hud>

      <div class="mmp__board" *ngIf="question && !answered">
        <p class="mmp__instruction">Match each item on the left with the correct one on the right</p>
        <div class="mmp__pairs">
          <div class="mmp__pair" *ngFor="let pair of displayPairs; let i = index">
            <div class="mmp__left">{{ pair.left }}</div>
            <div class="mmp__arrow" [class.mmp__arrow--matched]="pair.selected !== null">
              <mat-icon *ngIf="pair.selected === null">arrow_forward</mat-icon>
              <mat-icon *ngIf="pair.selected !== null && feedback !== 'wrong'">check</mat-icon>
              <mat-icon *ngIf="pair.selected !== null && feedback === 'wrong'" style="color:#c62828">close</mat-icon>
            </div>
            <select class="mmp__right" [value]="pair.selected || ''" (change)="selectOption(i, $event)"
              [disabled]="!!feedback">
              <option value="" disabled>Choose…</option>
              <option *ngFor="let opt of rightOptions" [value]="opt">{{ opt }}</option>
            </select>
          </div>
        </div>
        <div class="mmp__actions">
          <button mat-raised-button color="primary" (click)="submit()"
            [disabled]="!allSelected || !!feedback">
            <mat-icon>check</mat-icon> Pošalji
          </button>
        </div>
        <div class="mmp__feedback mmp__feedback--correct" *ngIf="feedback === 'correct'">
          <mat-icon>check_circle</mat-icon> +{{ lastPoints }} pts
        </div>
        <div class="mmp__feedback mmp__feedback--wrong" *ngIf="feedback === 'wrong'">
          <mat-icon>cancel</mat-icon> {{ revealAnswer || 'Incorrect match' }}
        </div>
      </div>

      <div class="mmp__waiting" *ngIf="answered">Waiting for next round…</div>
      <app-xp-float [xp]="lastPoints" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .mmp { position: relative; display: flex; flex-direction: column; gap: 12px; }
    .mmp__board { background: #fff; border-radius: 20px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
    .mmp__counter { text-align: center; font-size: 13px; color: #888; font-weight: 600; }
    .mmp__instruction { text-align: center; color: #666; font-size: 14px; margin: 8px 0 16px; }
    .mmp__pairs { display: flex; flex-direction: column; gap: 12px; max-width: 500px; margin: 0 auto; }
    .mmp__pair { display: flex; align-items: center; gap: 12px; }
    .mmp__left { flex: 1; padding: 12px 16px; background: #e8edf5; border-radius: 10px; font-weight: 700; color: #405980; text-align: center; }
    .mmp__arrow { display: flex; align-items: center; color: #aaa; }
    .mmp__arrow--matched { color: #22c55e; }
    .mmp__right { flex: 1; padding: 10px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 15px; font-weight: 600; background: #f8f9fa; cursor: pointer; }
    .mmp__right:focus { border-color: #405980; }
    .mmp__actions { text-align: center; margin-top: 16px; }
    .mmp__feedback { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 12px; padding: 10px; border-radius: 10px; font-weight: 700; }
    .mmp__feedback--correct { background: #e8f5e9; color: #2e7d32; }
    .mmp__feedback--wrong { background: #fce4ec; color: #b71c1c; }
    .mmp__waiting { text-align: center; color: #888; padding: 24px; font-style: italic; }
  `]
})
export class MatchingMpComponent implements OnChanges {
  @Input() round: ArenaBattleRound | null = null;
  @Input() localScore = 0;
  @Input() answerResult: ArenaBattleAnswerResult | null = null;
  @Output() submitAnswer = new EventEmitter<{ orderedTokens: string[] }>();

  question: ArenaBattleMatchingQuestion | null = null;
  roundIndex = 0;
  totalRounds = 10;
  displayPairs: { left: string; selected: string | null }[] = [];
  rightOptions: string[] = [];
  feedback: 'correct' | 'wrong' | null = null;
  answered = false;
  lastPoints = 0;
  revealAnswer = '';
  xpTrigger = 0;
  showConfetti = false;

  constructor(readonly audio: GameAudioService) {}

  get allSelected(): boolean {
    return this.displayPairs.length > 0 && this.displayPairs.every(p => p.selected !== null);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['round'] && this.round) this.loadRound(this.round);
    if (changes['answerResult'] && this.answerResult) this.applyResult(this.answerResult);
  }

  loadRound(round: ArenaBattleRound) {
    this.question = round.question as ArenaBattleMatchingQuestion;
    this.roundIndex = round.roundIndex;
    this.totalRounds = round.totalRounds;
    this.feedback = null;
    this.answered = false;
    this.revealAnswer = '';

    if (this.question?.pairs) {
      this.displayPairs = this.question.pairs.map(p => ({ left: p.left, selected: null }));
      this.rightOptions = [...(this.question.shuffledRight || [])];
    }
  }

  selectOption(index: number, event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    if (index >= 0 && index < this.displayPairs.length) {
      this.displayPairs[index].selected = val;
    }
  }

  submit() {
    if (!this.allSelected || this.feedback || this.answered) return;
    this.answered = true;
    this.submitAnswer.emit({ orderedTokens: this.displayPairs.map(p => p.selected || '') });
  }

  applyResult(r: ArenaBattleAnswerResult) {
    this.feedback = r.isCorrect ? 'correct' : 'wrong';
    this.lastPoints = r.points;
    this.revealAnswer = r.correctAnswer?.sentence || '';
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
