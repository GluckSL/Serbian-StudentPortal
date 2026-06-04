import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { GameAudioService } from '../../services/game-audio.service';
import { GameAttempt, GameSet, WordSearchQuestion } from '../../glueck-arena.types';

export interface WSResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
}

interface Placement {
  id: string;
  cells: { row: number; col: number }[];
}

type Feedback = 'idle' | 'correct' | 'wrong';

const HIGHLIGHT_COLORS = [
  '#22c55e', '#a16207', '#dc2626', '#7c3aed', '#0891b2',
  '#ea580c', '#be185d', '#15803d', '#4338ca', '#0d9488',
];

const TOTAL_LIVES = 5;
const POINTS_PER_WORD = 100;

@Component({
  selector: 'app-word-search',
  standalone: true,
  imports: [CommonModule, MaterialModule, ConfettiBurstComponent],
  template: `
    <div class="ws">
      <div class="ws__board">
        <header class="ws__hud">
          <div class="ws__timer" *ngIf="sessionLimitSeconds">
            <mat-icon>timer</mat-icon>
            <span [class.ws__timer--warn]="remainingSeconds <= 30">{{ formatTime(remainingSeconds) }}</span>
          </div>
          <div class="ws__lives">
            <mat-icon *ngFor="let _ of hearts; let i = index"
              [class.ws__lives--lost]="i >= remainingLives">favorite</mat-icon>
          </div>
          <p class="ws__prompt" [class.ws__prompt--correct]="feedback === 'correct'"
            [class.ws__prompt--wrong]="feedback === 'wrong'">{{ promptText }}</p>
          <div class="ws__found">
            <mat-icon>check_circle</mat-icon>
            <span>{{ foundCount }}</span>
          </div>
        </header>

        <div class="ws__grid-area" *ngIf="phase === 'playing'">
          <div class="ws__grid" [style.--ws-cols]="gridSize">
            <ng-container *ngFor="let row of grid; let ri = index">
              <button
                type="button"
                class="ws__cell"
                *ngFor="let letter of row; let ci = index"
                [class.ws__cell--empty]="!letter.trim()"
                [class.ws__cell--found]="cellHighlight(ri, ci)"
                [style.--ws-highlight]="cellColor(ri, ci)"
                [disabled]="feedback !== 'idle' || !letter.trim()"
                (click)="onCellTap(ri, ci)"
                [attr.aria-label]="letter ? 'Letter ' + letter : 'Empty'"
              >
                <span>{{ letter }}</span>
              </button>
            </ng-container>
          </div>

          <div class="ws__overlay ws__overlay--correct" *ngIf="feedback === 'correct'">
            <mat-icon>check_circle</mat-icon>
          </div>
          <div class="ws__overlay ws__overlay--wrong" *ngIf="feedback === 'wrong'">
            <mat-icon>close</mat-icon>
          </div>
        </div>

        <div class="ws__complete" *ngIf="phase === 'complete'">
          <mat-icon>emoji_events</mat-icon>
          <h2>All words found!</h2>
          <p>Score: <strong>{{ score }}</strong></p>
        </div>
      </div>

      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .ws { width: 100%; max-width: 640px; margin: 0 auto; }
    .ws__board {
      border-radius: 20px; overflow: hidden;
      border: 1px solid #fbbf24;
      box-shadow: 0 12px 40px rgba(180, 83, 9, 0.2);
      background: linear-gradient(145deg, #fef08a 0%, #fdba74 45%, #fb923c 100%);
      position: relative;
    }
    .ws__board::before {
      content: '';
      position: absolute; inset: 0;
      background:
        linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%),
        repeating-linear-gradient(45deg, transparent, transparent 28px, rgba(255,255,255,0.06) 28px, rgba(255,255,255,0.06) 56px);
      pointer-events: none;
    }

    .ws__hud {
      position: relative; z-index: 2;
      display: flex; align-items: center; gap: 12px;
      padding: 14px 16px;
      background: rgba(255, 255, 255, 0.88);
      border-bottom: 1px solid rgba(251, 191, 36, 0.5);
      backdrop-filter: blur(6px);
    }
    .ws__timer {
      display: flex; align-items: center; gap: 4px;
      font-weight: 800; font-size: 17px; color: #78350f; min-width: 64px;
    }
    .ws__timer mat-icon { font-size: 18px; width: 18px; height: 18px; color: #a16207; }
    .ws__timer--warn { color: #dc2626; }
    .ws__lives { display: flex; gap: 2px; }
    .ws__lives mat-icon {
      font-size: 20px; width: 20px; height: 20px; color: #ef4444;
      transition: color 0.25s, transform 0.25s;
    }
    .ws__lives--lost { color: #fde68a !important; transform: scale(0.85); }
    .ws__prompt {
      flex: 1; margin: 0; text-align: center;
      font-size: 15px; font-weight: 700; color: #92400e;
      font-family: Georgia, 'Times New Roman', serif;
      transition: color 0.2s;
    }
    .ws__prompt--correct { color: #166534; }
    .ws__prompt--wrong { color: #991b1b; }
    .ws__found {
      display: flex; align-items: center; gap: 4px;
      font-weight: 800; font-size: 17px; color: #78350f;
      min-width: 48px; justify-content: flex-end;
    }
    .ws__found mat-icon { font-size: 20px; width: 20px; height: 20px; color: #16a34a; }

    .ws__grid-area {
      position: relative; z-index: 1;
      padding: 20px 14px 28px;
      display: flex; justify-content: center;
    }
    .ws__grid {
      display: grid;
      grid-template-columns: repeat(var(--ws-cols, 11), 1fr);
      gap: 6px;
      max-width: 100%;
    }
    .ws__cell {
      aspect-ratio: 1;
      min-width: 0;
      border: none;
      border-radius: 8px;
      background: #334155;
      color: #fff;
      font-size: clamp(12px, 2.8vw, 17px);
      font-weight: 800;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: transform 0.12s ease, background 0.2s ease, box-shadow 0.2s ease;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.25);
    }
    .ws__cell:hover:not(:disabled):not(.ws__cell--found) {
      transform: scale(1.06);
      background: #475569;
    }
    .ws__cell--empty {
      background: transparent;
      box-shadow: none;
      cursor: default;
      pointer-events: none;
    }
    .ws__cell--found {
      background: var(--ws-highlight, #22c55e) !important;
      color: #fff;
      cursor: default;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }
    .ws__cell:active:not(:disabled) { transform: scale(0.95); }

    .ws__overlay {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none;
      animation: wsOverlayIn 0.35s ease;
    }
    .ws__overlay mat-icon {
      font-size: 120px; width: 120px; height: 120px;
      filter: drop-shadow(0 8px 24px rgba(0,0,0,0.25));
    }
    .ws__overlay--correct mat-icon { color: #22c55e; }
    .ws__overlay--wrong mat-icon { color: #ef4444; }
    @keyframes wsOverlayIn {
      0% { opacity: 0; transform: scale(0.5); }
      60% { opacity: 1; transform: scale(1.08); }
      100% { transform: scale(1); }
    }

    .ws__complete {
      position: relative; z-index: 2;
      text-align: center; padding: 48px 24px; color: #78350f;
    }
    .ws__complete mat-icon { font-size: 56px; width: 56px; height: 56px; color: #ca8a04; }
    .ws__complete h2 { margin: 12px 0 8px; font-size: 22px; }
  `],
})
export class WordSearchComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() gameSet!: GameSet;
  @Input() questions: WordSearchQuestion[] = [];
  @Output() onComplete = new EventEmitter<WSResult>();

  phase: 'playing' | 'complete' = 'playing';
  feedback: Feedback = 'idle';
  promptText = 'Tap a hidden word';

  grid: string[][] = [];
  gridSize = 11;
  placements: Placement[] = [];
  foundIds = new Set<string>();
  highlightByCell = new Map<string, string>();

  score = 0;
  foundCount = 0;
  remainingLives = TOTAL_LIVES;
  hearts = Array(TOTAL_LIVES).fill(0);

  sessionLimitSeconds = 0;
  remainingSeconds = 0;
  sessionElapsedSeconds = 0;
  showConfetti = false;

  private puzzleIndex = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private elapsedId: ReturnType<typeof setInterval> | null = null;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private totalWordsInGame = 0;
  private wordsFoundInGame = 0;
  private wrongGuesses = 0;

  constructor(
    private audio: GameAudioService,
  ) {}

  ngOnInit(): void {
    this.sessionLimitSeconds = this.gameSet.timerSettings?.sessionLimitSeconds ?? 300;
    this.remainingSeconds = this.sessionLimitSeconds;
    this.totalWordsInGame = this.questions.reduce((n, q) => n + (q.totalWords || q.placements?.length || 0), 0);
    this.loadPuzzle(0);
    this.startTimers();
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  private loadPuzzle(index: number): void {
    const q = this.questions[index];
    if (!q?.grid?.length) {
      this.finishGame();
      return;
    }
    this.grid = q.grid.map(row => [...row]);
    this.gridSize = q.gridSize || q.grid.length;
    this.placements = (q.placements || []).map(p => ({
      id: p.id,
      cells: p.cells.map(c => ({ row: c.row, col: c.col })),
    }));
    this.foundIds.clear();
    this.highlightByCell.clear();
    this.foundCount = this.wordsFoundInGame;
    this.feedback = 'idle';
    this.promptText = 'Tap a hidden word';
  }

  private startTimers(): void {
    if (this.sessionLimitSeconds > 0) {
      this.timerId = setInterval(() => {
        this.remainingSeconds = Math.max(0, this.remainingSeconds - 1);
        if (this.remainingSeconds <= 0) this.onTimeUp();
      }, 1000);
    }
    this.elapsedId = setInterval(() => {
      this.sessionElapsedSeconds++;
    }, 1000);
  }

  private clearTimers(): void {
    if (this.timerId) clearInterval(this.timerId);
    if (this.elapsedId) clearInterval(this.elapsedId);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
  }

  cellKey(row: number, col: number): string {
    return `${row},${col}`;
  }

  cellHighlight(row: number, col: number): boolean {
    return this.highlightByCell.has(this.cellKey(row, col));
  }

  cellColor(row: number, col: number): string {
    return this.highlightByCell.get(this.cellKey(row, col)) || '';
  }

  onCellTap(row: number, col: number): void {
    if (this.feedback !== 'idle' || this.phase !== 'playing') return;

    const match = this.placements.find(
      p => !this.foundIds.has(p.id) && p.cells.some(c => c.row === row && c.col === col),
    );

    if (!match) {
      this.showWrong();
      return;
    }

    this.showCorrect(match);
  }

  private showCorrect(placement: Placement): void {
    this.feedback = 'correct';
    this.promptText = 'Correct!';
    this.audio.playCorrect();
    const color = HIGHLIGHT_COLORS[this.foundIds.size % HIGHLIGHT_COLORS.length];
    for (const c of placement.cells) {
      this.highlightByCell.set(this.cellKey(c.row, c.col), color);
    }
    this.foundIds.add(placement.id);
    this.wordsFoundInGame++;
    this.foundCount = this.wordsFoundInGame;
    this.score += POINTS_PER_WORD;

    this.feedbackTimer = setTimeout(() => {
      this.feedback = 'idle';
      this.promptText = 'Tap a hidden word';
      if (this.foundIds.size >= this.placements.length) {
        this.advancePuzzle();
      }
    }, 900);
  }

  private showWrong(): void {
    this.feedback = 'wrong';
    this.promptText = 'Wrong!';
    this.audio.playWrong();
    this.remainingLives--;
    this.wrongGuesses++;

    this.feedbackTimer = setTimeout(() => {
      this.feedback = 'idle';
      this.promptText = 'Tap a hidden word';
      if (this.remainingLives <= 0) {
        this.finishGame();
      }
    }, 900);
  }

  private advancePuzzle(): void {
    if (this.puzzleIndex + 1 < this.questions.length) {
      this.puzzleIndex++;
      this.loadPuzzle(this.puzzleIndex);
      return;
    }
    this.showConfetti = true;
    this.phase = 'complete';
    setTimeout(() => this.finishGame(), 1200);
  }

  private onTimeUp(): void {
    this.finishGame();
  }

  private finishGame(): void {
    this.clearTimers();
    const total = Math.max(this.totalWordsInGame, 1);
    const accuracy = Math.round((this.wordsFoundInGame / total) * 100);
    const xpEarned = this.wordsFoundInGame * 3;
    this.onComplete.emit({
      score: this.score,
      xpEarned,
      accuracy,
      timeSpentSeconds: this.sessionElapsedSeconds,
    });
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
