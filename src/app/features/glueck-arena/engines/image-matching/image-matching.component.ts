import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { GameAudioService } from '../../services/game-audio.service';
import { ImageMatchingQuestion, GameAttempt, GameSet } from '../../glueck-arena.types';

export interface IMResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
}

interface DisplayPair {
  questionId: string;
  pairIndex: number;
  imageUrl: string;
  slotId: string;
  matched: boolean;
  matchedWord: string;
  validating: boolean;
  wrongFlash: boolean;
}

@Component({
  selector: 'app-image-matching',
  standalone: true,
  imports: [CommonModule, MaterialModule, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="im-layout">
      <main class="im-play">
        <header class="im-play__top">
          <div class="im-play__score">
            <mat-icon>star</mat-icon>
            <span>{{ score }}</span>
          </div>
          <div class="im-play__progress">Page {{ currentPageIndex + 1 }} / {{ totalPages }}</div>
          <div class="im-play__timer">
            <mat-icon>timer</mat-icon>
            <span>{{ formatElapsed(sessionElapsedSeconds) }}</span>
          </div>
          <button mat-icon-button type="button" (click)="onPause()" aria-label="Pauza"><mat-icon>pause</mat-icon></button>
        </header>

        <div
          class="im-board"
          [class.im-board--dragging]="!!draggingWord"
          [class.im-board--word-selected]="selectedWordIndex !== null"
          *ngIf="phase === 'playing' && currentPairs.length">
          <div class="im-board__prompt">
            <p>Prevucite ili dodirnite reč, zatim dodirnite odgovarajuću sliku. Tačni parovi postaju <span class="im-hint__green">zeleni</span>!</p>
            <div class="im-progress-chips">
              <span class="im-progress-chips__label">{{ matchedCount }} / {{ currentPairs.length }} matched</span>
            </div>
          </div>

          <div class="im-pool" (click)="clearSelection()">
            <button
              type="button"
              *ngFor="let word of availableWords; let i = index"
              class="im-pool__word"
              [class.im-pool__word--dragging]="draggingWordIndex === i"
              [class.im-pool__word--selected]="selectedWordIndex === i"
              (pointerdown)="onWordPointerDown($event, i)">
              <span class="im-pool__pill">{{ word }}</span>
            </button>
          </div>

          <div class="im-grid">
            <div *ngFor="let pair of currentPairs" class="im-card">
              <div
                class="im-card__target"
                [id]="pair.slotId"
                [class.im-card__target--matched]="pair.matched"
                [class.im-card__target--placed]="!pair.matched && slotHasWord(pair)"
                [class.im-card__target--hover]="hoveredSlotId === pair.slotId"
                [class.im-card__target--tap-ready]="selectedWordIndex !== null && canAcceptDrop(pair)"
                [class.im-card__target--wrong]="pair.wrongFlash"
                (click)="placeWord(pair)">
                <img [src]="pair.imageUrl" alt="" draggable="false">
                <div class="im-card__overlay" *ngIf="pair.matched || slotHasWord(pair)">
                  <span
                    class="im-card__word"
                    [class.im-card__word--correct]="pair.matched"
                    [class.im-card__word--placed]="!pair.matched">
                    {{ pair.matched ? pair.matchedWord : slotData[pair.slotId][0] }}
                  </span>
                </div>
              </div>
              <mat-icon *ngIf="pair.matched" class="im-card__check">check_circle</mat-icon>
            </div>
          </div>
        </div>

        <div class="im-complete" *ngIf="phase === 'complete'">
          <mat-icon class="im-complete__spinner">hourglass_top</mat-icon>
          <span class="im-complete__calc">Calculating results…</span>
        </div>
      </main>

      <app-xp-float [xp]="xpPerMatch" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .im-layout { position: relative; margin: 0 auto; }
    .im-play {
      position: relative;
      background: #fff;
      border-radius: 20px;
      box-shadow: 0 8px 32px rgba(15, 23, 42, 0.1);
      border: 1px solid #e2e8f0;
    }
    .im-play__top {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 18px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      border-radius: 20px 20px 0 0;
    }
    .im-play__score { display: flex; align-items: center; gap: 4px; font-size: 20px; font-weight: 800; color: #f59e0b; }
    .im-play__progress { flex: 1; text-align: center; font-size: 13px; font-weight: 600; color: #64748b; }
    .im-play__timer { display: flex; align-items: center; gap: 4px; font-weight: 700; color: #1e3a5f; padding: 6px 12px; background: #e0f2fe; border-radius: 999px; font-size: 14px; }

    .im-board {
      padding: 24px 22px calc(28px + env(safe-area-inset-bottom, 0px));
      touch-action: pan-y;
      user-select: none;
    }
    .im-board--dragging { touch-action: none; }
    .im-board--dragging .im-card__target:not(.im-card__target--matched):not(.im-card__target--placed) {
      pointer-events: auto;
    }
    .im-board__prompt { padding: 16px 18px; margin-bottom: 20px; background: linear-gradient(135deg, #eff6ff, #f0fdf4); border-radius: 14px; border: 1px solid #dbeafe; }
    .im-board__prompt p { margin: 0 0 8px; color: #334155; font-size: 15px; }
    .im-hint__green { color: #22c55e; font-weight: 700; }
    .im-progress-chips { text-align: center; }
    .im-progress-chips__label { font-size: 12px; font-weight: 700; color: #405980; background: rgba(64, 89, 128, 0.08); padding: 4px 12px; border-radius: 999px; }

    .im-pool {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: center;
      min-height: 54px;
      padding: 14px 16px;
      margin-bottom: 24px;
      background: #f8fafc;
      border-radius: 14px;
      border: 2px solid #e2e8f0;
    }
    .im-pool__word {
      border: none;
      background: transparent;
      padding: 0;
      cursor: pointer;
      touch-action: manipulation;
    }
    .im-pool__word:active { cursor: grabbing; }
    .im-pool__word--dragging { opacity: 0.35; }
    .im-pool__word--selected .im-pool__pill {
      box-shadow: 0 0 0 3px #fff, 0 0 0 6px #6366f1, 0 4px 14px rgba(79, 70, 229, 0.45);
      transform: scale(1.06);
    }

    .im-pool__pill {
      display: inline-flex;
      align-items: center;
      padding: 10px 18px;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 700;
      background: linear-gradient(145deg, #6366f1, #4f46e5);
      color: #fff;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.35);
      user-select: none;
      pointer-events: none;
    }

    .im-grid {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 20px;
      max-width: 560px;
      margin: 0 auto;
    }

    .im-card {
      position: relative;
      flex: 0 1 calc(50% - 10px);
      min-width: 140px;
      max-width: 260px;
    }

    .im-card__target {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 160px;
      max-height: 240px;
      padding: 8px;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid #e2e8f0;
      background: #f1f5f9;
      transition: border-color 0.15s, box-shadow 0.15s;
      box-sizing: border-box;
    }
    .im-card__target img {
      max-width: 100%;
      max-height: 220px;
      width: auto;
      height: auto;
      object-fit: contain;
      object-position: center;
      pointer-events: none;
      display: block;
    }
    .im-card__target--hover:not(.im-card__target--matched):not(.im-card__target--placed),
    .im-card__target--tap-ready {
      border-color: #6366f1;
      border-width: 3px;
      box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.35);
      cursor: pointer;
    }
    .im-board--word-selected .im-card__target--tap-ready {
      animation: im-pulse 1.2s ease-in-out infinite;
    }
    .im-card__target--matched {
      border-color: #22c55e;
      box-shadow: 0 4px 18px rgba(34, 197, 94, 0.35);
    }
    .im-card__target--wrong {
      border-color: #ef4444;
      box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.25);
      animation: im-shake 0.35s ease;
    }

    .im-card__overlay {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 12px 10px;
      display: flex;
      justify-content: center;
      background: linear-gradient(transparent, rgba(15, 23, 42, 0.6));
      pointer-events: none;
    }

    .im-card__word {
      display: inline-flex;
      align-items: center;
      padding: 8px 16px;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 700;
      user-select: none;
    }
    .im-card__word--placed {
      background: rgba(255, 255, 255, 0.95);
      color: #475569;
    }
    .im-card__word--correct {
      background: linear-gradient(145deg, #22c55e, #15803d);
      color: #fff;
      box-shadow: 0 4px 18px rgba(34, 197, 94, 0.5);
      animation: pill-pop 0.18s ease-out;
    }

    .im-card__check {
      position: absolute;
      top: -8px;
      right: -8px;
      color: #22c55e;
      font-size: 24px !important;
      width: 24px !important;
      height: 24px !important;
      z-index: 2;
    }

    .im-complete { text-align: center; padding: 48px 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .im-complete__spinner { font-size: 48px !important; width: 48px !important; height: 48px !important; color: #6366f1; animation: im-spin 1s linear infinite; }
    @keyframes im-spin { to { transform: rotate(360deg); } }
    @keyframes pill-pop {
      0% { transform: scale(0.92); }
      60% { transform: scale(1.08); }
      100% { transform: scale(1); }
    }
    @keyframes im-shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-4px); }
      75% { transform: translateX(4px); }
    }
    @keyframes im-pulse {
      0%, 100% { box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.35); }
      50% { box-shadow: 0 0 0 7px rgba(99, 102, 241, 0.2); }
    }
  `]
})
export class ImageMatchingComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() questions: ImageMatchingQuestion[] = [];
  @Input() shuffledWords: string[] = [];
  @Input() gameSet!: GameSet;
  @Output() onComplete = new EventEmitter<IMResult>();

  currentPageIndex = 0;
  pageSize = 8;
  currentPairs: DisplayPair[] = [];
  availableWords: string[] = [];
  slotData: Record<string, string[]> = {};
  hoveredSlotId: string | null = null;
  selectedWordIndex: number | null = null;
  draggingWord: string | null = null;
  draggingWordIndex: number | null = null;
  ghostX = 0;
  ghostY = 0;
  score = 0;
  correctCount = 0;
  phase: 'playing' | 'complete' = 'playing';
  sessionElapsedSeconds = 0;
  xpPerMatch = 5;
  xpTrigger = 0;
  showConfetti = false;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private sessionStartedAt = Date.now();
  private activePointerId: number | null = null;
  private pendingWordIndex: number | null = null;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private dragStarted = false;
  private dropCommitted = false;
  private readonly dropHitPadding = 20;
  private readonly dragThreshold = 10;

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.questions.length / this.pageSize));
  }

  get matchedCount(): number {
    return this.currentPairs.filter(p => p.matched).length;
  }

  constructor(
    private svc: InteractiveGameService,
    private cdr: ChangeDetectorRef,
    readonly audio: GameAudioService,
  ) {}

  ngOnInit() {
    this.audio.unlock();
    this.sessionStartedAt = Date.now();
    this.availableWords = this.shuffle([...this.shuffledWords]);
    this.loadPage(0);
    this.startSessionTimer();
  }

  ngOnDestroy() {
    if (this.timerHandle) clearInterval(this.timerHandle);
  }

  loadPage(index: number) {
    if (index >= this.totalPages) {
      this.phase = 'complete';
      this.onComplete.emit(this.buildResult());
      return;
    }
    this.currentPageIndex = index;
    this.hoveredSlotId = null;
    this.selectedWordIndex = null;
    this.cancelDrag();
    const start = index * this.pageSize;
    const end = Math.min(start + this.pageSize, this.questions.length);
    const pageQuestions = this.questions.slice(start, end);

    this.currentPairs = [];
    this.slotData = {};
    pageQuestions.forEach(q => {
      if (!q.pairs?.length) return;
      q.pairs.forEach((p, pairIndex) => {
        const slotId = `slot-${q._id}-${pairIndex}`;
        this.currentPairs.push({
          questionId: q._id,
          pairIndex,
          imageUrl: p.imageUrl || '',
          slotId,
          matched: false,
          matchedWord: '',
          validating: false,
          wrongFlash: false,
        });
        this.slotData[slotId] = [];
      });
    });
  }

  slotHasWord(pair: DisplayPair): boolean {
    return (this.slotData[pair.slotId]?.length ?? 0) > 0;
  }

  canAcceptDrop(pair: DisplayPair): boolean {
    return !pair.matched && !pair.validating && !this.slotHasWord(pair);
  }

  clearSelection() {
    this.selectedWordIndex = null;
    this.cdr.detectChanges();
  }

  placeWord(pair: DisplayPair) {
    if (this.selectedWordIndex == null || !this.canAcceptDrop(pair)) return;
    this.placeWordOnSlot(pair, this.selectedWordIndex);
  }

  private shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /** Hit-test using each image's on-screen box (with padding for easier drops). */
  private slotIdAtPoint(clientX: number, clientY: number): string | null {
    const pad = this.dropHitPadding;
    let bestId: string | null = null;
    let bestArea = Infinity;

    for (const pair of this.currentPairs) {
      if (!this.canAcceptDrop(pair)) continue;
      const el = document.getElementById(pair.slotId);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (
        clientX < r.left - pad ||
        clientX > r.right + pad ||
        clientY < r.top - pad ||
        clientY > r.bottom + pad
      ) {
        continue;
      }
      const area = r.width * r.height;
      if (area < bestArea) {
        bestArea = area;
        bestId = pair.slotId;
      }
    }
    return bestId;
  }

  onWordPointerDown(event: PointerEvent, wordIndex: number) {
    if (this.phase !== 'playing' || event.button !== 0) return;
    const word = this.availableWords[wordIndex];
    if (!word) return;

    this.dropCommitted = false;
    this.dragStarted = false;
    this.pendingWordIndex = wordIndex;
    this.activePointerId = event.pointerId;
    this.pointerStartX = event.clientX;
    this.pointerStartY = event.clientY;
  }

  private beginDrag(wordIndex: number, clientX: number, clientY: number) {
    const word = this.availableWords[wordIndex];
    if (!word) return;

    this.dragStarted = true;
    this.selectedWordIndex = null;
    this.draggingWord = word;
    this.draggingWordIndex = wordIndex;
    this.ghostX = clientX;
    this.ghostY = clientY;
    this.hoveredSlotId = this.slotIdAtPoint(clientX, clientY);
    this.cdr.detectChanges();
  }

  private toggleWordSelection(wordIndex: number) {
    this.selectedWordIndex = this.selectedWordIndex === wordIndex ? null : wordIndex;
    this.cdr.detectChanges();
  }

  @HostListener('window:pointermove', ['$event'])
  onWindowPointerMove(event: PointerEvent) {
    if (this.activePointerId !== event.pointerId) return;

    if (this.pendingWordIndex != null && !this.dragStarted) {
      const dx = event.clientX - this.pointerStartX;
      const dy = event.clientY - this.pointerStartY;
      if (Math.hypot(dx, dy) >= this.dragThreshold) {
        event.preventDefault();
        this.beginDrag(this.pendingWordIndex, event.clientX, event.clientY);
        this.pendingWordIndex = null;
      }
      return;
    }

    if (this.draggingWord == null) return;
    event.preventDefault();
    this.ghostX = event.clientX;
    this.ghostY = event.clientY;
    this.hoveredSlotId = this.slotIdAtPoint(event.clientX, event.clientY);
    this.cdr.detectChanges();
  }

  @HostListener('window:pointerup', ['$event'])
  @HostListener('window:pointercancel', ['$event'])
  onWindowPointerEnd(event: PointerEvent) {
    if (this.activePointerId !== event.pointerId) return;

    if (this.pendingWordIndex != null && !this.dragStarted) {
      this.toggleWordSelection(this.pendingWordIndex);
      this.clearPointerState();
      return;
    }

    if (this.draggingWord == null) return;
    const slotId = this.slotIdAtPoint(event.clientX, event.clientY) ?? this.hoveredSlotId;
    this.finishDrag(slotId);
  }

  /** Fallback when pointer capture blocks pointerup (common on Windows + Chrome). */
  @HostListener('window:mouseup', ['$event'])
  onWindowMouseUp(event: MouseEvent) {
    if (this.draggingWord == null || event.button !== 0) return;
    const slotId = this.slotIdAtPoint(event.clientX, event.clientY) ?? this.hoveredSlotId;
    this.finishDrag(slotId);
  }

  onTargetPointerUp(event: PointerEvent, pair: DisplayPair) {
    if (this.draggingWord != null && this.activePointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      if (this.canAcceptDrop(pair)) {
        this.finishDrag(pair.slotId);
      }
      return;
    }

    if (this.selectedWordIndex != null && !this.dragStarted && this.canAcceptDrop(pair)) {
      event.preventDefault();
      this.placeWordOnSlot(pair, this.selectedWordIndex);
    }
  }

  private finishDrag(slotId: string | null) {
    if (this.dropCommitted || this.draggingWordIndex == null) return;
    this.dropCommitted = true;

    const wordIndex = this.draggingWordIndex;
    this.cancelDrag();

    if (!slotId) return;

    const pair = this.currentPairs.find(p => p.slotId === slotId);
    if (!pair || !this.canAcceptDrop(pair)) return;

    this.placeWordOnSlot(pair, wordIndex);
  }

  private placeWordOnSlot(pair: DisplayPair, wordIndex: number) {
    const word = this.availableWords[wordIndex];
    if (!word?.trim() || !this.canAcceptDrop(pair)) return;

    this.availableWords.splice(wordIndex, 1);
    this.availableWords = [...this.availableWords];
    this.selectedWordIndex = null;
    this.slotData[pair.slotId] = [word];
    pair.validating = true;
    this.cdr.detectChanges();

    this.validateMatch(pair, word);
  }

  private clearPointerState() {
    this.pendingWordIndex = null;
    this.activePointerId = null;
    this.pointerStartX = 0;
    this.pointerStartY = 0;
    this.dragStarted = false;
    this.cdr.detectChanges();
  }

  private cancelDrag() {
    this.draggingWord = null;
    this.draggingWordIndex = null;
    this.pendingWordIndex = null;
    this.activePointerId = null;
    this.pointerStartX = 0;
    this.pointerStartY = 0;
    this.dragStarted = false;
    this.hoveredSlotId = null;
    this.cdr.detectChanges();
  }

  private returnWordToPool(pair: DisplayPair, word: string) {
    const slotArr = this.slotData[pair.slotId];
    if (!slotArr?.length) return;
    const idx = slotArr.indexOf(word);
    if (idx === -1) return;
    slotArr.splice(idx, 1);
    this.availableWords = [...this.availableWords, word];
    this.cdr.detectChanges();
  }

  private validateMatch(pair: DisplayPair, word: string) {
    this.svc.submitImageMatchSlot(this.attempt._id, {
      questionId: pair.questionId,
      pairIndex: pair.pairIndex,
      word,
      responseTimeMs: 0,
    }).subscribe({
      next: (r) => {
        pair.validating = false;
        if (r.isCorrect) {
          this.audio.playCorrect();
          pair.matched = true;
          pair.matchedWord = word;
          pair.wrongFlash = false;
          this.score += r.pointsEarned || 10;
          this.correctCount++;
          this.xpPerMatch = r.pointsEarned || 5;
          this.xpTrigger = Date.now();
          this.audio.playXpGain();

          if (this.matchedCount === this.currentPairs.length) {
            setTimeout(() => this.loadPage(this.currentPageIndex + 1), 500);
          }
        } else {
          this.audio.playWrong();
          pair.wrongFlash = true;
          this.returnWordToPool(pair, word);
          setTimeout(() => { pair.wrongFlash = false; }, 450);
        }
        this.cdr.detectChanges();
      },
      error: () => {
        pair.validating = false;
        this.returnWordToPool(pair, word);
        this.cdr.detectChanges();
      },
    });
  }

  private startSessionTimer() {
    this.timerHandle = setInterval(() => {
      this.sessionElapsedSeconds = Math.floor((Date.now() - this.sessionStartedAt) / 1000);
    }, 1000);
  }

  formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  }

  onPause() {}

  buildResult(): IMResult {
    const totalPairs = this.questions.reduce((sum, q) => sum + (q.pairs?.length || 0), 0);
    const accuracy = totalPairs > 0 ? Math.round((this.correctCount / totalPairs) * 100) : 0;
    return {
      score: this.score,
      xpEarned: this.correctCount * (this.gameSet?.xpReward || 50),
      accuracy,
      timeSpentSeconds: this.sessionElapsedSeconds,
    };
  }
}
