import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { GameHudComponent } from '../../shared/game-hud/game-hud.component';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { GameAudioService } from '../../services/game-audio.service';
import {
  ArenaBattleRound, ArenaBattleJumbledWordsQuestion, ArenaBattleAnswerResult,
} from '../../glueck-arena.types';

interface MpSlot {
  index: number;
  letter: string | null;
}

interface MpTile {
  uid: number;
  letter: string;
  slotIndex: number | null;
}

@Component({
  selector: 'app-jumbled-words-mp',
  standalone: true,
  imports: [CommonModule, MaterialModule, GameHudComponent, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="jwmp">
      <app-game-hud
        [score]="localScore"
        [current]="roundIndex + 1"
        [total]="totalRounds"
        [showLives]="false"
      ></app-game-hud>

      <div class="jwmp__board" *ngIf="question && !answered">
        <div class="jwmp__counter">Round {{ roundIndex + 1 }} / {{ totalRounds }}</div>
        <div class="jwmp__picture-area" *ngIf="question.imageUrl">
          <img [src]="question.imageUrl" alt="" class="jwmp__picture">
        </div>
        <p class="jwmp__hint" *ngIf="question.hint">{{ question.hint }}</p>

        <div class="jwmp__timer-bar">
          <div class="jwmp__timer-fill" [style.width.%]="timerPercent"></div>
        </div>

        <div class="jwmp__slots-row">
          <div class="jwmp__slot" *ngFor="let slot of slots; let i = index"
            [class.jwmp__slot--filled]="slot.letter !== null"
            [class.jwmp__slot--correct]="feedback === 'correct'"
            [class.jwmp__slot--wrong]="feedback === 'wrong'"
            (click)="onSlotClick(i)">
            <span *ngIf="slot.letter" class="jwmp__slot-letter">{{ slot.letter }}</span>
            <span *ngIf="!slot.letter" class="jwmp__slot-index">{{ i + 1 }}</span>
          </div>
        </div>

        <div class="jwmp__tiles-row">
          <div class="jwmp__tile" *ngFor="let tile of availableTiles"
            (click)="onTileClick(tile)">
            {{ tile.letter }}
          </div>
        </div>

        <div class="jwmp__actions">
          <button mat-raised-button color="primary" (click)="submit()"
            [disabled]="!allSlotsFilled || !!feedback">
            <mat-icon>check</mat-icon> Check
          </button>
        </div>

        <div class="jwmp__feedback jwmp__feedback--correct" *ngIf="feedback === 'correct'">
          <mat-icon>check_circle</mat-icon> +{{ lastPoints }} pts
          <span *ngIf="lastFastest" class="jwmp__bonus"> Fastest!</span>
        </div>
        <div class="jwmp__feedback jwmp__feedback--wrong" *ngIf="feedback === 'wrong'">
          <mat-icon>cancel</mat-icon> {{ revealWord || 'Wrong' }}
        </div>
      </div>

      <div class="jwmp__waiting" *ngIf="answered">Waiting for next round…</div>

      <app-xp-float [xp]="lastPoints" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .jwmp { position: relative; display: flex; flex-direction: column; gap: 12px; }
    .jwmp__board {
      background: linear-gradient(180deg, #f0f4ff, #e8eeff); border-radius: 20px; padding: 24px;
      text-align: center; border: 2px solid #c8d8e8; min-height: 320px;
      display: flex; flex-direction: column; align-items: center; gap: 14px;
    }
    .jwmp__counter { font-size: 13px; font-weight: 600; color: #666; }
    .jwmp__picture-area {
      width: 140px; height: 105px; border-radius: 12px; overflow: hidden;
      border: 1px solid #e2e8f0; background: #f8fafc;
    }
    .jwmp__picture { width: 100%; height: 100%; object-fit: cover; }
    .jwmp__hint { color: #666; font-size: 14px; margin: 0; }
    .jwmp__timer-bar { height: 6px; background: #e0e0e0; border-radius: 3px; width: 100%; overflow: hidden; }
    .jwmp__timer-fill { height: 100%; background: linear-gradient(90deg,#405980,#5c7cfa); transition: width .1s linear; }
    .jwmp__slots-row { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
    .jwmp__slot {
      width: 42px; height: 46px; border-radius: 8px;
      border: 2px dashed #cbd5e1; background: #f8fafc;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 800; color: #1e293b;
      cursor: pointer; user-select: none; transition: all 0.12s;
    }
    .jwmp__slot--filled { border-style: solid; border-color: #6366f1; background: #eef2ff; }
    .jwmp__slot--correct { border-color: #16a34a; background: #dcfce7; }
    .jwmp__slot--wrong { border-color: #dc2626; background: #fef2f2; animation: jwShake 0.3s ease; }
    .jwmp__slot-letter { text-transform: uppercase; }
    .jwmp__slot-index { font-size: 11px; color: #94a3b8; font-weight: 600; }
    .jwmp__tiles-row { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; min-height: 46px; }
    .jwmp__tile {
      width: 42px; height: 46px; border-radius: 8px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
      font-size: 18px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; user-select: none; text-transform: uppercase;
      transition: transform 0.12s; box-shadow: 0 2px 8px rgba(99,102,241,0.3);
    }
    .jwmp__tile:hover { transform: translateY(-2px); }
    .jwmp__actions { margin-top: 4px; }
    .jwmp__feedback {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 10px; border-radius: 12px; font-weight: 700; width: 100%;
    }
    .jwmp__feedback--correct { background: #e8f5e9; color: #2e7d32; }
    .jwmp__feedback--wrong { background: #fce4ec; color: #b71c1c; }
    .jwmp__bonus { font-size: 13px; }
    .jwmp__waiting { text-align: center; padding: 48px; color: #888; font-style: italic; background: #f8fafc; border-radius: 20px; }
    @keyframes jwShake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(6px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(4px); }
    }
  `]
})
export class JumbledWordsMpComponent implements OnChanges, OnDestroy {
  @Input() round: ArenaBattleRound | null = null;
  @Input() localScore = 0;
  @Input() answerResult: ArenaBattleAnswerResult | null = null;
  @Output() submitAnswer = new EventEmitter<{ typedWord: string }>();

  question: ArenaBattleJumbledWordsQuestion | null = null;
  roundIndex = 0;
  totalRounds = 10;
  feedback: 'correct' | 'wrong' | null = null;
  answered = false;
  timerPercent = 100;
  lastPoints = 0;
  lastFastest = false;
  revealWord = '';
  xpTrigger = 0;
  showConfetti = false;

  slots: MpSlot[] = [];
  tiles: MpTile[] = [];
  private uidCounter = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(readonly audio: GameAudioService) {}

  get availableTiles(): MpTile[] {
    return this.tiles.filter(t => t.slotIndex === null);
  }

  get allSlotsFilled(): boolean {
    return this.slots.every(s => s.letter !== null);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['round'] && this.round) {
      this.loadRound();
    }
    if (changes['answerResult'] && this.answerResult) {
      this.onAnswerResult(this.answerResult);
    }
  }

  ngOnDestroy() {
    if (this.timerId) clearInterval(this.timerId);
  }

  private loadRound() {
    this.feedback = null;
    this.answered = false;
    this.revealWord = '';
    this.clearTimer();
    if (!this.round) return;
    this.roundIndex = this.round.roundIndex;
    this.totalRounds = this.round.totalRounds;
    this.question = this.round.question as ArenaBattleJumbledWordsQuestion;
    if (!this.question) return;
    const letters = this.question.jumbledLetters || [];
    this.slots = letters.map((_, i) => ({ index: i, letter: null }));
    this.tiles = letters.map(letter => ({
      uid: this.uidCounter++,
      letter,
      slotIndex: null,
    }));
    this.startTimer();
  }

  private startTimer() {
    const duration = this.round?.roundDurationMs || 30000;
    const step = 50;
    const interval = duration / 100 * step;
    let elapsed = 0;
    this.timerId = setInterval(() => {
      elapsed += step;
      this.timerPercent = Math.max(0, 100 - (elapsed / duration) * 100);
      if (elapsed >= duration) {
        this.clearTimer();
        this.timerPercent = 0;
      }
    }, step);
  }

  private clearTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  onTileClick(tile: MpTile) {
    if (this.feedback) return;
    const emptySlot = this.slots.find(s => s.letter === null);
    if (emptySlot) {
      this.placeTile(tile, emptySlot.index);
    }
  }

  onSlotClick(slotIndex: number) {
    if (this.feedback) return;
    const slot = this.slots[slotIndex];
    if (!slot || !slot.letter) return;
    const tile = this.tiles.find(t => t.slotIndex === slotIndex);
    if (tile) tile.slotIndex = null;
    slot.letter = null;
  }

  private placeTile(tile: MpTile, slotIndex: number) {
    if (this.feedback) return;
    const slot = this.slots[slotIndex];
    if (!slot) return;
    if (tile.slotIndex !== null) {
      const oldSlot = this.slots[tile.slotIndex];
      if (oldSlot) oldSlot.letter = null;
    }
    if (slot.letter !== null) {
      const occupyingTile = this.tiles.find(t => t.slotIndex === slotIndex);
      if (occupyingTile) occupyingTile.slotIndex = null;
    }
    tile.slotIndex = slotIndex;
    slot.letter = tile.letter;
  }

  submit() {
    if (!this.allSlotsFilled || this.feedback) return;
    const word = this.slots.map(s => s.letter || '').join('');
    this.submitAnswer.emit({ typedWord: word });
  }

  private onAnswerResult(result: ArenaBattleAnswerResult) {
    this.clearTimer();
    if (result.isCorrect) {
      this.feedback = 'correct';
      this.lastPoints = result.points;
      this.lastFastest = !!result.fastest;
      this.xpTrigger++;
      this.audio.playCorrect();
    } else {
      this.feedback = 'wrong';
      this.revealWord = result.correctAnswer?.word
        ? `The word was: ${result.correctAnswer.word}` : 'Wrong';
      this.audio.playWrong();
    }
    setTimeout(() => {
      this.answered = true;
    }, 1200);
  }
}
