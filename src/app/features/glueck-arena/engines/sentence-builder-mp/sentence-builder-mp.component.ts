import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { MaterialModule } from '../../../../shared/material.module';
import { GameHudComponent } from '../../shared/game-hud/game-hud.component';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { GameAudioService } from '../../services/game-audio.service';
import {
  ArenaBattleRound,
  ArenaBattleSentenceQuestion,
  ArenaBattleAnswerResult,
} from '../../glueck-arena.types';

@Component({
  selector: 'app-sentence-builder-mp',
  standalone: true,
  imports: [CommonModule, DragDropModule, MaterialModule, GameHudComponent, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="sbmp">
      <app-game-hud
        [score]="localScore"
        [current]="roundIndex + 1"
        [total]="totalRounds"
        [showLives]="false"
      ></app-game-hud>

      <div class="sbmp__board" *ngIf="question && !answered">
        <div class="sbmp__counter">Round {{ roundIndex + 1 }} / {{ totalRounds }}</div>
        <div class="sbmp__translation" *ngIf="question.translation">
          <mat-icon>translate</mat-icon> {{ question.translation }}
        </div>
        <div class="sbmp__dropzone" cdkDropList id="mp-drop" [cdkDropListData]="arranged"
          [cdkDropListConnectedTo]="['mp-bank']" (cdkDropListDropped)="drop($event)">
          <div class="sbmp__hint" *ngIf="!arranged.length">Drag words to build the sentence</div>
          <div cdkDrag class="sbmp__token sbmp__token--placed" *ngFor="let t of arranged"
            [class.sbmp__token--correct]="feedback === 'correct'"
            [class.sbmp__token--wrong]="feedback === 'wrong'">{{ t }}</div>
        </div>
        <div class="sbmp__bank" cdkDropList id="mp-bank" [cdkDropListData]="bank"
          [cdkDropListConnectedTo]="['mp-drop']" (cdkDropListDropped)="drop($event)">
          <div cdkDrag class="sbmp__token sbmp__token--bank" *ngFor="let t of bank">{{ t }}</div>
        </div>
        <div class="sbmp__feedback sbmp__feedback--correct" *ngIf="feedback === 'correct'">
          <mat-icon>check_circle</mat-icon> +{{ lastPoints }} pts
          <span *ngIf="comboStreak >= 3" class="sbmp__combo">🔥 Combo x{{ comboStreak }}</span>
        </div>
        <div class="sbmp__feedback sbmp__feedback--wrong" *ngIf="feedback === 'wrong'">
          <mat-icon>cancel</mat-icon> {{ revealSentence || 'Try again next round' }}
        </div>
        <div class="sbmp__actions">
          <button mat-stroked-button (click)="clearArranged()" [disabled]="!!feedback">Reset</button>
          <button mat-raised-button color="primary" (click)="check()" [disabled]="!arranged.length || !!feedback || submitting">
            Check
          </button>
        </div>
      </div>

      <div class="sbmp__waiting" *ngIf="answered">Waiting for next round…</div>
      <app-xp-float [xp]="lastPoints" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .sbmp { position: relative; display: flex; flex-direction: column; gap: 12px; }
    .sbmp__board { background: #fff; border-radius: 20px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,.1); }
    .sbmp__counter { text-align: center; font-size: 13px; color: #888; font-weight: 600; }
    .sbmp__translation { display: flex; align-items: center; gap: 6px; font-size: 14px; color: #555; background: #f8f9fa; padding: 8px 12px; border-radius: 10px; }
    .sbmp__dropzone { min-height: 72px; border: 2px dashed #c8d8e8; border-radius: 14px; padding: 12px; display: flex; flex-wrap: wrap; gap: 8px; background: #f0f5ff; }
    .sbmp__hint { color: #aaa; width: 100%; text-align: center; }
    .sbmp__bank { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px; border: 2px solid #e8ecf0; border-radius: 14px; margin-top: 12px; }
    .sbmp__token { padding: 8px 14px; border-radius: 20px; font-weight: 600; cursor: grab; }
    .sbmp__token--bank { background: #e8edf5; color: #405980; }
    .sbmp__token--placed { background: #405980; color: #fff; }
    .sbmp__token--correct { background: #2e7d32 !important; }
    .sbmp__token--wrong { background: #c62828 !important; }
    .sbmp__feedback { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 10px; border-radius: 10px; font-weight: 600; }
    .sbmp__feedback--correct { background: #e8f5e9; color: #2e7d32; }
    .sbmp__feedback--wrong { background: #fce4ec; color: #b71c1c; }
    .sbmp__combo { margin-left: 8px; font-size: 13px; }
    .sbmp__actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; }
    .sbmp__waiting { text-align: center; color: #888; padding: 24px; font-style: italic; }
  `]
})
export class SentenceBuilderMpComponent implements OnChanges, OnDestroy {
  @Input() round: ArenaBattleRound | null = null;
  @Input() localScore = 0;
  @Input() answerResult: ArenaBattleAnswerResult | null = null;
  @Output() submitAnswer = new EventEmitter<{ orderedTokens: string[] }>();

  question: ArenaBattleSentenceQuestion | null = null;
  roundIndex = 0;
  totalRounds = 10;
  arranged: string[] = [];
  bank: string[] = [];
  feedback: 'correct' | 'wrong' | null = null;
  answered = false;
  submitting = false;
  lastPoints = 0;
  comboStreak = 0;
  revealSentence = '';
  xpTrigger = 0;
  showConfetti = false;

  constructor(readonly audio: GameAudioService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['round'] && this.round) this.loadRound(this.round);
    if (changes['answerResult'] && this.answerResult) this.applyResult(this.answerResult);
  }

  ngOnDestroy() {}

  loadRound(round: ArenaBattleRound) {
    this.question = round.question as ArenaBattleSentenceQuestion;
    this.roundIndex = round.roundIndex;
    this.totalRounds = round.totalRounds;
    this.arranged = [];
    this.bank = [...(this.question.shuffledTokens || [])];
    this.feedback = null;
    this.answered = false;
    this.submitting = false;
    this.revealSentence = '';
  }

  drop(event: CdkDragDrop<string[]>) {
    if (this.feedback) return;
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(event.previousContainer.data, event.container.data, event.previousIndex, event.currentIndex);
    }
  }

  clearArranged() {
    this.bank = [...this.bank, ...this.arranged];
    this.arranged = [];
  }

  check() {
    if (!this.arranged.length || this.feedback || this.answered) return;
    this.submitting = true;
    this.answered = true;
    this.submitAnswer.emit({ orderedTokens: [...this.arranged] });
  }

  applyResult(r: ArenaBattleAnswerResult) {
    this.submitting = false;
    this.feedback = r.isCorrect ? 'correct' : 'wrong';
    this.lastPoints = r.points;
    this.comboStreak = r.comboStreak || 0;
    this.revealSentence = r.correctAnswer?.sentence || '';
    if (r.isCorrect) {
      this.audio.playCorrect();
      this.xpTrigger++;
      this.showConfetti = true;
      setTimeout(() => this.showConfetti = false, 1500);
    } else {
      this.audio.playWrong();
    }
  }
}
