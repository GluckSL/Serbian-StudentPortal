import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule, CdkDragDrop, transferArrayItem } from '@angular/cdk/drag-drop';
import { MaterialModule } from '../../../../shared/material.module';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { InteractiveGameService } from '../../services/interactive-game.service';
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
}

@Component({
  selector: 'app-image-matching',
  standalone: true,
  imports: [CommonModule, DragDropModule, MaterialModule, XpFloatComponent, ConfettiBurstComponent],
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
          <button mat-icon-button type="button" (click)="onPause()" aria-label="Pause"><mat-icon>pause</mat-icon></button>
        </header>

        <div class="im-board" *ngIf="phase === 'playing' && currentPairs.length">
          <div class="im-board__prompt">
            <p>Drag each word onto its matching image. Correct matches turn <span class="im-hint__green">green</span>!</p>
            <div class="im-progress-chips">
              <span class="im-progress-chips__label">{{ matchedCount }} / {{ currentPairs.length }} matched</span>
            </div>
          </div>

          <!-- Word pool -->
          <div
            class="im-pool"
            cdkDropList
            id="word-pool"
            [cdkDropListData]="availableWords"
            [cdkDropListConnectedTo]="slotIds"
            (cdkDropListDropped)="onWordPoolDrop($event)">
            <div *ngFor="let word of availableWords" class="im-pool__word" cdkDrag [cdkDragData]="word">
              <span class="im-pool__pill">{{ word }}</span>
              <div *cdkDragPlaceholder class="im-pool__placeholder"></div>
            </div>
          </div>

          <!-- Image grid — drop words directly onto images -->
          <div class="im-grid">
            <div *ngFor="let pair of currentPairs" class="im-card">
              <div
                class="im-card__target"
                [class.im-card__target--matched]="pair.matched"
                [class.im-card__target--placed]="!pair.matched && slotData[pair.slotId].length"
                [id]="pair.slotId"
                cdkDropList
                cdkDropListSortingDisabled
                [cdkDropListData]="slotData[pair.slotId]"
                [cdkDropListConnectedTo]="['word-pool']"
                [cdkDropListDisabled]="isSlotDisabled(pair)"
                (cdkDropListDropped)="onSlotDrop($event, pair)">
                <img [src]="pair.imageUrl" alt="" draggable="false">
                <div class="im-card__overlay" *ngIf="pair.matched || slotData[pair.slotId]?.length">
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
    .im-play { position: relative; background: #fff; border-radius: 20px; box-shadow: 0 8px 32px rgba(15, 23, 42, 0.1); overflow: hidden; border: 1px solid #e2e8f0; }
    .im-play__top { display: flex; align-items: center; gap: 12px; padding: 12px 18px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .im-play__score { display: flex; align-items: center; gap: 4px; font-size: 20px; font-weight: 800; color: #f59e0b; }
    .im-play__progress { flex: 1; text-align: center; font-size: 13px; font-weight: 600; color: #64748b; }
    .im-play__timer { display: flex; align-items: center; gap: 4px; font-weight: 700; color: #1e3a5f; padding: 6px 12px; background: #e0f2fe; border-radius: 999px; font-size: 14px; }

    .im-board { padding: 24px 22px 28px; }
    .im-board__prompt { padding: 16px 18px; margin-bottom: 20px; background: linear-gradient(135deg, #eff6ff, #f0fdf4); border-radius: 14px; border: 1px solid #dbeafe; }
    .im-board__prompt p { margin: 0 0 8px; color: #334155; font-size: 15px; }
    .im-hint__green { color: #22c55e; font-weight: 700; }
    .im-progress-chips { text-align: center; }
    .im-progress-chips__label { font-size: 12px; font-weight: 700; color: #405980; background: rgba(64, 89, 128, 0.08); padding: 4px 12px; border-radius: 999px; }

    /* Word pool */
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
    .im-pool.cdk-drop-list-dragging .im-pool__word:not(.cdk-drag-placeholder) {
      transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
    }
    .im-pool__word { cursor: grab; }
    .im-pool__word:active { cursor: grabbing; }

    .im-pool__pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 18px;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 700;
      background: linear-gradient(145deg, #6366f1, #4f46e5);
      color: #fff;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.35);
      user-select: none;
      transition: box-shadow 0.15s ease;
    }
    .im-pool__placeholder {
      width: 80px;
      height: 42px;
      border: 2px dashed #94a3b8;
      border-radius: 999px;
      background: rgba(255,255,255,0.5);
    }

    /* Image grid */
    .im-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      max-width: 860px;
      margin: 0 auto;
    }
    @media (max-width: 700px) { .im-grid { grid-template-columns: repeat(2, 1fr); } }

    .im-card {
      position: relative;
    }

    /* Image is the drop target */
    .im-card__target {
      position: relative;
      width: 100%;
      aspect-ratio: 1;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid #e2e8f0;
      background: #f1f5f9;
      transition: border-color 0.2s, box-shadow 0.2s;
      cursor: default;
    }
    .im-card__target img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      pointer-events: none;
      display: block;
    }
    .im-pool.cdk-drop-list-dragging .im-card__target:not(.im-card__target--matched):not(.im-card__target--placed) {
      border-color: #a5b4fc;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
    }
    .im-card__target.cdk-drop-list-receiving {
      border-color: #6366f1;
      border-style: solid;
      box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.25);
    }
    .im-card__target--matched {
      border-color: #22c55e;
      box-shadow: 0 4px 18px rgba(34, 197, 94, 0.35);
    }

    .im-card__overlay {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 10px 8px;
      display: flex;
      justify-content: center;
      background: linear-gradient(transparent, rgba(15, 23, 42, 0.55));
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
      background: rgba(255, 255, 255, 0.92);
      color: #475569;
    }
    .im-card__word--correct {
      background: linear-gradient(145deg, #22c55e, #15803d) !important;
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
    .im-complete__calc { font-size: 18px; font-weight: 600; color: #64748b; }

    @keyframes pill-pop {
      0% { transform: scale(0.92); }
      60% { transform: scale(1.08); }
      100% { transform: scale(1); }
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
  score = 0;
  correctCount = 0;
  phase: 'playing' | 'complete' = 'playing';
  sessionElapsedSeconds = 0;
  xpPerMatch = 5;
  xpTrigger = 0;
  showConfetti = false;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private sessionStartedAt = Date.now();

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.questions.length / this.pageSize));
  }

  get matchedCount(): number {
    return this.currentPairs.filter(p => p.matched).length;
  }

  get slotIds(): string[] {
    return this.currentPairs.map(p => p.slotId);
  }

  constructor(private svc: InteractiveGameService) {}

  ngOnInit() {
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
    const start = index * this.pageSize;
    const end = Math.min(start + this.pageSize, this.questions.length);
    const pageQuestions = this.questions.slice(start, end);

    let pairIndex = 0;
    this.currentPairs = [];
    this.slotData = {};
    pageQuestions.forEach(q => {
      if (!q.pairs) return;
      q.pairs.forEach(p => {
        const slotId = `slot-${q._id}-${pairIndex}`;
        this.currentPairs.push({
          questionId: q._id,
          pairIndex,
          imageUrl: p.imageUrl || '',
          slotId,
          matched: false,
          matchedWord: '',
          validating: false,
        });
        this.slotData[slotId] = [];
        pairIndex++;
      });
    });
  }

  private shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  isSlotDisabled(pair: DisplayPair): boolean {
    return pair.matched || pair.validating || (this.slotData[pair.slotId]?.length ?? 0) > 0;
  }

  onWordPoolDrop(event: CdkDragDrop<string[]>) {
    if (event.previousContainer === event.container) return;
    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex,
    );
  }

  onSlotDrop(event: CdkDragDrop<string[]>, pair: DisplayPair) {
    if (event.previousContainer === event.container) return;
    if (this.isSlotDisabled(pair)) return;

    const word = event.item.data as string;
    if (!word) return;

    pair.validating = true;
    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      0,
    );

    this.validateMatch(pair, word);
  }

  private validateMatch(pair: DisplayPair, word: string) {
    this.svc.submitImageMatchSlot(this.attempt._id, {
      questionId: pair.questionId,
      pairIndex: pair.pairIndex,
      word,
      responseTimeMs: 0
    }).subscribe({
      next: (r) => {
        pair.validating = false;
        if (r.isCorrect) {
          pair.matched = true;
          pair.matchedWord = word;
          this.score += r.pointsEarned || 10;
          this.correctCount++;
          this.xpPerMatch = r.pointsEarned || 5;
          this.xpTrigger = Date.now();

          if (this.matchedCount === this.currentPairs.length) {
            setTimeout(() => this.loadPage(this.currentPageIndex + 1), 500);
          }
        } else {
          // Wrong — return word to pool
          const slotArr = this.slotData[pair.slotId] || [];
          const si = slotArr.indexOf(word);
          if (si !== -1) {
            slotArr.splice(si, 1);
            this.availableWords.push(word);
            this.availableWords = [...this.availableWords];
          }
        }
      },
      error: () => {
        pair.validating = false;
        // On error, also return the word to the pool
        const slotArr = this.slotData[pair.slotId] || [];
        const si = slotArr.indexOf(word);
        if (si !== -1) {
          slotArr.splice(si, 1);
          this.availableWords.push(word);
          this.availableWords = [...this.availableWords];
        }
      }
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
      timeSpentSeconds: this.sessionElapsedSeconds
    };
  }
}
