import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { GameAudioService } from '../../services/game-audio.service';
import { MemoryGameQuestion, GameAttempt, GameSet } from '../../glueck-arena.types';

export interface MemoryResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
}

interface MemoryCard {
  id: string;
  pairIndex: number;
  type: 'image' | 'word';
  imageUrl: string;
  word: string;
  questionId: string;
  flipped: boolean;
  matched: boolean;
  wrongFlash: boolean;
}

@Component({
  selector: 'app-memory-game',
  standalone: true,
  imports: [CommonModule, MaterialModule, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="mg-layout">
      <main class="mg-play">
        <header class="mg-play__top">
          <div class="mg-play__score">
            <mat-icon>star</mat-icon>
            <span>{{ score }}</span>
          </div>
          <div class="mg-play__progress">Board {{ currentQuestionIndex + 1 }} / {{ questions.length }}</div>
          <div class="mg-play__pairs">{{ matchedCount }} / {{ totalPairsInBoard }} matched</div>
          <div class="mg-play__timer">
            <mat-icon>timer</mat-icon>
            <span>{{ formatElapsed(sessionElapsedSeconds) }}</span>
          </div>
          <button mat-icon-button type="button" (click)="onPause()" aria-label="Pause"><mat-icon>pause</mat-icon></button>
        </header>

        <div class="mg-board" *ngIf="phase === 'playing'">
          <div class="mg-board__prompt" [class.mg-board__prompt--preview]="previewing">
            <p *ngIf="previewing">Memorize the cards! Game starts in 3 seconds…</p>
            <p *ngIf="!previewing">Flip cards to find matching picture-word pairs. Match all pairs to complete the board!</p>
          </div>

          <div class="mg-grid" [style.grid-template-columns]="'repeat(' + columns + ', 1fr)'">
            <button
              *ngFor="let card of cards"
              class="mg-card"
              [class.mg-card--flipped]="card.flipped || card.matched"
              [class.mg-card--matched]="card.matched"
              [class.mg-card--wrong]="card.wrongFlash"
              (click)="onCardClick(card)"
              [disabled]="card.matched || isProcessing || card.flipped">
              <div class="mg-card__inner">
                <div class="mg-card__front">
                  <mat-icon>help_outline</mat-icon>
                </div>
                <div class="mg-card__back">
                  <img *ngIf="card.type === 'image' && card.imageUrl" [src]="card.imageUrl" alt="" class="mg-card__img">
                  <span *ngIf="card.type === 'image' && !card.imageUrl" class="mg-card__no-img">
                    <mat-icon>image</mat-icon>
                  </span>
                  <span *ngIf="card.type === 'word'" class="mg-card__word">{{ card.word }}</span>
                </div>
              </div>
            </button>
          </div>
        </div>

        <div class="mg-complete" *ngIf="phase === 'complete'">
          <mat-icon class="mg-complete__spinner">hourglass_top</mat-icon>
          <span class="mg-complete__calc">Calculating results...</span>
        </div>
      </main>

      <app-xp-float [xp]="xpPerMatch" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .mg-layout { position: relative; margin: 0 auto; }
    .mg-play {
      position: relative;
      background: #fff;
      border-radius: 20px;
      box-shadow: 0 8px 32px rgba(15, 23, 42, 0.1);
      border: 1px solid #e2e8f0;
    }
    .mg-play__top {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 18px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      border-radius: 20px 20px 0 0;
    }
    .mg-play__score { display: flex; align-items: center; gap: 4px; font-size: 20px; font-weight: 800; color: #f59e0b; }
    .mg-play__progress { flex: 1; text-align: center; font-size: 13px; font-weight: 600; color: #64748b; }
    .mg-play__pairs { font-size: 12px; font-weight: 700; color: #405980; background: rgba(64, 89, 128, 0.08); padding: 4px 12px; border-radius: 999px; }
    .mg-play__timer { display: flex; align-items: center; gap: 4px; font-weight: 700; color: #1e3a5f; padding: 6px 12px; background: #e0f2fe; border-radius: 999px; font-size: 14px; }

    .mg-board { padding: 24px 22px 28px; }
    .mg-board__prompt { padding: 16px 18px; margin-bottom: 20px; background: linear-gradient(135deg, #faf5ff, #f0fdf4); border-radius: 14px; border: 1px solid #e9d5ff; }
    .mg-board__prompt--preview { background: linear-gradient(135deg, #fef3c7, #fde68a); border-color: #f59e0b; }
    .mg-board__prompt p { margin: 0; color: #334155; font-size: 15px; }

    .mg-grid {
      display: grid;
      gap: 10px;
      max-width: 520px;
      margin: 0 auto;
      justify-content: center;
    }

    .mg-card {
      position: relative;
      aspect-ratio: 1;
      min-width: 64px;
      min-height: 72px;
      border: none;
      background: transparent;
      padding: 0;
      cursor: pointer;
      perspective: 600px;
      outline: none;
    }
    .mg-card:focus-visible { outline: 2px solid #6366f1; border-radius: 12px; }

    .mg-card__inner {
      position: relative;
      width: 100%;
      height: 100%;
      transition: transform 0.35s ease;
      transform-style: preserve-3d;
      border-radius: 12px;
    }
    .mg-card--flipped .mg-card__inner,
    .mg-card--matched .mg-card__inner {
      transform: rotateY(180deg);
    }

    .mg-card__front,
    .mg-card__back {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
    }

    .mg-card__front {
      background: linear-gradient(145deg, #6366f1, #4f46e5);
      color: #fff;
      z-index: 2;
    }
    .mg-card__front mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: rgba(255, 255, 255, 0.7);
    }

    .mg-card__back {
      background: #fff;
      border: 2px solid #e2e8f0;
      transform: rotateY(180deg);
      flex-direction: column;
      padding: 6px;
      box-sizing: border-box;
      overflow: hidden;
    }
    .mg-card--matched .mg-card__back {
      border-color: #22c55e;
      box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.3);
    }
    .mg-card--wrong .mg-card__back {
      border-color: #ef4444;
      box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.3);
      animation: mg-shake 0.35s ease;
    }

    .mg-card__img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .mg-card__no-img mat-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      color: #cbd5e1;
    }
    .mg-card__word {
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
      text-align: center;
      word-break: break-word;
      padding: 4px;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .mg-complete { text-align: center; padding: 48px 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .mg-complete__spinner { font-size: 48px !important; width: 48px !important; height: 48px !important; color: #6366f1; animation: mg-spin 1s linear infinite; }
    .mg-complete__calc { font-size: 18px; font-weight: 600; color: #64748b; }

    @keyframes mg-spin { to { transform: rotate(360deg); } }
    @keyframes mg-shake {
      0%, 100% { transform: rotateY(180deg) translateX(0); }
      25% { transform: rotateY(180deg) translateX(-4px); }
      75% { transform: rotateY(180deg) translateX(4px); }
    }
  `]
})
export class MemoryGameComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() questions: MemoryGameQuestion[] = [];
  @Input() gameSet!: GameSet;
  @Output() onComplete = new EventEmitter<MemoryResult>();

  currentQuestionIndex = 0;
  cards: MemoryCard[] = [];
  score = 0;
  correctCount = 0;
  phase: 'playing' | 'complete' = 'playing';
  previewing = false;
  sessionElapsedSeconds = 0;
  xpPerMatch = 5;
  xpTrigger = 0;
  showConfetti = false;
  isProcessing = false;

  private firstCard: MemoryCard | null = null;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private sessionStartedAt = Date.now();
  private flipTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private previewTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  get columns(): number {
    const total = this.cards.length;
    if (total <= 4) return 2;
    if (total <= 6) return 3;
    return 4;
  }

  get totalPairsInBoard(): number {
    return this.cards.length / 2;
  }

  get matchedCount(): number {
    return this.cards.filter(c => c.matched).length / 2;
  }

  constructor(
    private svc: InteractiveGameService,
    private cdr: ChangeDetectorRef,
    readonly audio: GameAudioService,
  ) {}

  ngOnInit() {
    this.audio.unlock();
    this.sessionStartedAt = Date.now();
    this.loadBoard(0);
    this.startSessionTimer();
  }

  ngOnDestroy() {
    if (this.timerHandle) clearInterval(this.timerHandle);
    if (this.flipTimeoutHandle) clearTimeout(this.flipTimeoutHandle);
    if (this.previewTimeoutHandle) clearTimeout(this.previewTimeoutHandle);
  }

  loadBoard(index: number) {
    if (index >= this.questions.length) {
      this.phase = 'complete';
      this.onComplete.emit(this.buildResult());
      return;
    }
    this.currentQuestionIndex = index;
    this.firstCard = null;
    this.isProcessing = false;
    const q = this.questions[index];
    const built: MemoryCard[] = [];
    if (q.pairs) {
      q.pairs.forEach((p, pairIndex) => {
        built.push({
          id: `img-${q._id}-${pairIndex}`,
          pairIndex,
          type: 'image',
          imageUrl: p.imageUrl || '',
          word: p.word,
          questionId: q._id,
          flipped: true,
          matched: false,
          wrongFlash: false,
        });
        built.push({
          id: `word-${q._id}-${pairIndex}`,
          pairIndex,
          type: 'word',
          imageUrl: '',
          word: p.word,
          questionId: q._id,
          flipped: true,
          matched: false,
          wrongFlash: false,
        });
      });
    }
    this.cards = this.shuffle(built);
    this.previewing = true;
    if (this.previewTimeoutHandle) clearTimeout(this.previewTimeoutHandle);
    this.previewTimeoutHandle = setTimeout(() => {
      this.cards.forEach(c => { c.flipped = false; });
      this.previewing = false;
      this.cdr.detectChanges();
    }, 3000);
  }

  private shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  onCardClick(card: MemoryCard) {
    this.audio.unlock();
    if (this.isProcessing || card.matched || card.flipped) return;
    card.flipped = true;
    this.cdr.detectChanges();

    if (!this.firstCard) {
      this.firstCard = card;
      return;
    }

    const first = this.firstCard;
    this.firstCard = null;
    this.isProcessing = true;

    if (first.pairIndex === card.pairIndex && first.type !== card.type) {
      this.validateMatch(first, card);
    } else {
      this.flipTimeoutHandle = setTimeout(() => {
        first.flipped = false;
        card.flipped = false;
        this.isProcessing = false;
        this.cdr.detectChanges();
      }, 800);
    }
  }

  private validateMatch(imgCard: MemoryCard, wordCard: MemoryCard) {
    const word = wordCard.word;
    this.svc.submitMemoryMatch(this.attempt._id, {
      questionId: wordCard.questionId,
      pairIndex: wordCard.pairIndex,
      word,
      responseTimeMs: 0,
    }).subscribe({
      next: (r) => {
        this.isProcessing = false;
        if (r.isCorrect) {
          this.audio.playCorrect();
          imgCard.matched = true;
          wordCard.matched = true;
          imgCard.wrongFlash = false;
          wordCard.wrongFlash = false;
          this.score += r.pointsEarned || 10;
          this.correctCount++;
          this.xpPerMatch = r.pointsEarned || 5;
          this.xpTrigger = Date.now();
          this.audio.playXpGain();

          if (this.matchedCount === this.totalPairsInBoard) {
            setTimeout(() => this.loadBoard(this.currentQuestionIndex + 1), 600);
          }
        } else {
          this.audio.playWrong();
          imgCard.flipped = false;
          wordCard.flipped = false;
          imgCard.wrongFlash = true;
          wordCard.wrongFlash = true;
          setTimeout(() => {
            imgCard.wrongFlash = false;
            wordCard.wrongFlash = false;
            this.cdr.detectChanges();
          }, 450);
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.isProcessing = false;
        imgCard.flipped = false;
        wordCard.flipped = false;
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

  buildResult(): MemoryResult {
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
