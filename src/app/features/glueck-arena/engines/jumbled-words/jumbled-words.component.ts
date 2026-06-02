import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy, HostListener, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { JumbledWordsQuestion, GameAttempt, GameSet } from '../../glueck-arena.types';

export interface JWResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
}

interface LetterSlot {
  index: number;
  letter: string | null;
  locked: boolean;
}

interface LetterTile {
  uid: number;
  letter: string;
  slotIndex: number | null;
}

@Component({
  selector: 'app-jumbled-words',
  standalone: true,
  imports: [CommonModule, MaterialModule, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="jw">
      <header class="jw__top">
        <div class="jw__score">
          <mat-icon>star</mat-icon>
          <span>{{ score }}</span>
        </div>
        <div class="jw__progress">Word {{ currentIndex + 1 }} / {{ questions.length }}</div>
        <div class="jw__timer">
          <mat-icon>timer</mat-icon>
          <span>{{ formatElapsed(sessionElapsedSeconds) }}</span>
        </div>
        <button mat-icon-button type="button" (click)="onPause()" aria-label="Pause">
          <mat-icon>pause</mat-icon>
        </button>
      </header>

      <div class="jw__body" *ngIf="phase === 'playing' && currentQuestion">

        <div class="jw__picture-area" *ngIf="currentQuestion.imageUrl">
          <div class="jw__picture">
            <img [src]="currentQuestion.imageUrl" alt="" class="jw__picture-img">
          </div>
        </div>

        <div class="jw__slots-row">
          <div
            class="jw__slot"
            *ngFor="let slot of slots; let i = index"
            [class.jw__slot--filled]="slot.letter !== null"
            [class.jw__slot--locked]="slot.locked"
            [class.jw__slot--wrong]="slotWrong === i"
            [class.jw__slot--drag-over]="dragOverSlot === i"
            (dragover)="onDragOver($event, i)"
            (dragleave)="onDragLeave(i)"
            (drop)="onDrop($event, i)"
            (click)="onSlotClick(i)"
          >
            <span *ngIf="slot.letter" class="jw__slot-letter">{{ slot.letter }}</span>
            <mat-icon class="jw__slot-icon" *ngIf="slot.locked">check_circle</mat-icon>
            <mat-icon class="jw__slot-icon jw__slot-icon--wrong" *ngIf="slotWrong === i">cancel</mat-icon>
          </div>
        </div>

        <div class="jw__tiles-row">
          <div
            class="jw__tile"
            *ngFor="let tile of availableTiles"
            [attr.draggable]="true"
            (dragstart)="onDragStart($event, tile)"
            (dragend)="onDragEnd()"
            (click)="onTileClick(tile)"
          >
            {{ tile.letter }}
          </div>
        </div>

        <div class="jw__actions">
          <button class="jw__btn jw__btn--clear" (click)="clearSlots()"
            [disabled]="allLocked">
            <mat-icon>undo</mat-icon> Clear
          </button>
        </div>
      </div>

      <div class="jw-complete" *ngIf="phase === 'complete'">
        <mat-icon class="jw-complete__spinner">hourglass_top</mat-icon>
        <span class="jw-complete__calc">Calculating results...</span>
      </div>

      <app-xp-float [xp]="lastXp" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .jw { position: relative; display: flex; flex-direction: column; gap: 16px; }
    .jw__top {
      display: flex; align-items: center; gap: 24px; padding: 12px 20px;
      background: #fff; border-radius: 16px; border: 1px solid #e2e8f0;
    }
    .jw__score { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 18px; color: #f59e0b; }
    .jw__progress { font-size: 14px; font-weight: 600; color: #64748b; }
    .jw__timer { display: flex; align-items: center; gap: 4px; margin-left: auto; font-size: 16px; font-weight: 700; color: #1e293b; }
    .jw__timer mat-icon { font-size: 20px; width: 20px; height: 20px; color: #64748b; }
    .jw__body {
      display: flex; flex-direction: column; align-items: center; gap: 20px;
      padding: 24px; background: #fff; border-radius: 20px; border: 1px solid #e2e8f0;
      min-height: 400px;
    }
    .jw__picture-area {
      width: 100%; max-width: 320px; aspect-ratio: 4/3;
      border-radius: 16px; overflow: hidden;
    }
    .jw__picture {
      width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
      background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;
    }
    .jw__picture-img { width: 100%; height: 100%; object-fit: cover; }
    .jw__slots-row {
      display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; padding: 12px 0;
    }
    .jw__slot {
      position: relative;
      width: 48px; height: 52px; border-radius: 10px;
      border: 2px dashed #cbd5e1; background: #f8fafc;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 800; color: #1e293b;
      transition: all 0.15s ease; cursor: pointer; user-select: none;
    }
    .jw__slot--filled {
      border-style: solid; border-color: #6366f1; background: #eef2ff;
    }
    .jw__slot--locked {
      border-color: #16a34a; background: #dcfce7;
    }
    .jw__slot--wrong {
      border-color: #dc2626; background: #fef2f2; animation: jwShake 0.3s ease;
    }
    .jw__slot--drag-over { border-color: #2563eb; background: #dbeafe; transform: scale(1.05); }
    .jw__slot-letter { text-transform: uppercase; }
    .jw__slot-icon {
      position: absolute; top: -8px; right: -8px;
      font-size: 18px; width: 18px; height: 18px;
      color: #16a34a; background: #fff; border-radius: 50%;
    }
    .jw__slot-icon--wrong { color: #dc2626; }
    .jw__tiles-row {
      display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; padding: 8px 0; min-height: 52px;
    }
    .jw__tile {
      width: 48px; height: 52px; border-radius: 10px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff; font-size: 22px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      cursor: grab; user-select: none; text-transform: uppercase;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
      box-shadow: 0 2px 8px rgba(99,102,241,0.3);
    }
    .jw__tile:active { cursor: grabbing; transform: scale(0.92); }
    .jw__tile:hover { transform: translateY(-2px); box-shadow: 0 4px 14px rgba(99,102,241,0.4); }
    .jw__actions { display: flex; gap: 12px; }
    .jw__btn {
      display: flex; align-items: center; gap: 6px; padding: 10px 24px;
      border: none; border-radius: 12px; cursor: pointer;
      font-size: 14px; font-weight: 700; transition: transform 0.12s;
    }
    .jw__btn:hover { transform: translateY(-1px); }
    .jw__btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .jw__btn--clear { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }
    .jw-complete {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      padding: 48px; color: #64748b;
    }
    .jw-complete__spinner { font-size: 40px; width: 40px; height: 40px; color: #6366f1; }
    .jw-complete__calc { font-size: 16px; font-weight: 600; }
    @keyframes jwShake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(6px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(4px); }
    }
  `]
})
export class JumbledWordsComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() questions!: JumbledWordsQuestion[];
  @Input() gameSet!: GameSet;
  @Output() onComplete = new EventEmitter<JWResult>();

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
  dragOverSlot: number | null = null;
  slotWrong: number | null = null;
  sessionElapsedSeconds = 0;
  private draggedTile: LetterTile | null = null;

  slots: LetterSlot[] = [];
  tiles: LetterTile[] = [];
  private uidCounter = 0;
  private startTime = 0;
  private correctWord = '';
  private sessionTimerHandle: ReturnType<typeof setInterval> | null = null;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private svc: InteractiveGameService,
    private cdr: ChangeDetectorRef
  ) {}

  get currentQuestion(): JumbledWordsQuestion | null {
    return this.questions[this.currentIndex] ?? null;
  }

  get availableTiles(): LetterTile[] {
    return this.tiles.filter(t => t.slotIndex === null);
  }

  get allLocked(): boolean {
    return this.slots.length > 0 && this.slots.every(s => s.locked);
  }

  ngOnInit() {
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
    this.slotWrong = null;
    this.clearFeedbackTimer();
    const q = this.currentQuestion;
    if (!q) return;
    this.correctWord = ((q as any).word || '').toUpperCase();
    const letters = q.jumbledLetters || [];
    this.slots = letters.map((_, i) => ({ index: i, letter: null, locked: false }));
    this.tiles = letters.map(letter => ({
      uid: this.uidCounter++,
      letter,
      slotIndex: null,
    }));
  }

  onPause() {}

  onDragStart(event: DragEvent, tile: LetterTile) {
    this.draggedTile = tile;
    event.dataTransfer?.setData('text/plain', String(tile.uid));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragEnd() {
    this.draggedTile = null;
  }

  onDragOver(event: DragEvent, slotIndex: number) {
    event.preventDefault();
    if (this.slots[slotIndex]?.locked) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOverSlot = slotIndex;
  }

  onDragLeave(_slotIndex: number) {
    this.dragOverSlot = null;
  }

  onDrop(event: DragEvent, slotIndex: number) {
    event.preventDefault();
    this.dragOverSlot = null;
    if (!this.draggedTile) return;
    if (this.slots[slotIndex]?.locked) return;
    this.tryPlaceTile(this.draggedTile, slotIndex);
    this.draggedTile = null;
  }

  onTileClick(tile: LetterTile) {
    if (this.slotWrong !== null) return;
    const emptySlot = this.slots.find(s => s.letter === null && !s.locked);
    if (emptySlot) {
      this.tryPlaceTile(tile, emptySlot.index);
    }
  }

  onSlotClick(slotIndex: number) {
    if (this.slotWrong !== null) return;
    const slot = this.slots[slotIndex];
    if (!slot || slot.locked || !slot.letter) return;
    const tile = this.tiles.find(t => t.slotIndex === slotIndex);
    if (tile) tile.slotIndex = null;
    slot.letter = null;
  }

  private tryPlaceTile(tile: LetterTile, slotIndex: number) {
    const slot = this.slots[slotIndex];
    if (!slot) return;

    if (tile.letter === this.correctWord[slotIndex]) {
      this.placeAndLockTile(tile, slotIndex);
    } else {
      this.showWrong(slotIndex);
    }
  }

  private placeAndLockTile(tile: LetterTile, slotIndex: number) {
    const slot = this.slots[slotIndex];
    if (tile.slotIndex !== null) {
      const oldSlot = this.slots[tile.slotIndex];
      if (oldSlot) { oldSlot.letter = null; oldSlot.locked = false; }
    }
    if (slot.letter !== null) {
      const occupyingTile = this.tiles.find(t => t.slotIndex === slotIndex);
      if (occupyingTile) occupyingTile.slotIndex = null;
    }
    tile.slotIndex = slotIndex;
    slot.letter = tile.letter;
    slot.locked = true;

    if (this.allLocked) {
      this.feedbackTimer = setTimeout(() => this.submitWord(), 400);
    }
  }

  private showWrong(slotIndex: number) {
    this.slotWrong = slotIndex;
    this.feedbackTimer = setTimeout(() => {
      this.slotWrong = null;
      this.cdr.detectChanges();
    }, 500);
  }

  clearSlots() {
    if (this.slotWrong !== null) return;
    this.tiles.forEach(t => {
      if (t.slotIndex !== null && !this.slots[t.slotIndex]?.locked) {
        t.slotIndex = null;
      }
    });
    this.slots.forEach(s => {
      if (!s.locked) s.letter = null;
    });
  }

  private submitWord() {
    if (this.submitting) return;
    this.submitting = true;
    const q = this.currentQuestion;
    if (!q) return;
    const word = this.slots.map(s => s.letter || '').join('');
    this.svc.submitAnswer(this.attempt._id, {
      questionId: q._id,
      typedWord: word,
      orderedTokens: word.split(''),
      responseTimeMs: Date.now() - this.startTime,
    }).subscribe({
      next: (r) => {
        this.submitting = false;
        this.lastPoints = r.pointsEarned;
        this.lastXp = r.pointsEarned ? 4 : 0;
        this.xpTrigger++;
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
