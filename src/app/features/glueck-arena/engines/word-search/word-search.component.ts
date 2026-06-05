import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy, HostListener,
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

interface CellPos {
  row: number;
  col: number;
}

type Feedback = 'idle' | 'correct' | 'wrong';

const SELECTING_COLOR = '#fbbf24';

interface WordHighlight {
  bg: string;
  fg: string;
}

/** Each found word gets the next colour in order */
const HIGHLIGHT_COLORS: WordHighlight[] = [
  { bg: '#22c55e', fg: '#ffffff' }, // green
  { bg: '#7dd3fc', fg: '#0c4a6e' }, // light blue
  { bg: '#d1d5db', fg: '#374151' }, // light grey
  { bg: '#c4b5fd', fg: '#4c1d95' }, // lavender
  { bg: '#fda4af', fg: '#9f1239' }, // rose
  { bg: '#fcd34d', fg: '#78350f' }, // gold
  { bg: '#5eead4', fg: '#134e4a' }, // mint
  { bg: '#fdba74', fg: '#7c2d12' }, // peach
  { bg: '#a5b4fc', fg: '#312e81' }, // periwinkle
  { bg: '#86efac', fg: '#14532d' }, // light green
  { bg: '#f9a8d4', fg: '#831843' }, // pink
  { bg: '#93c5fd', fg: '#1e3a8a' }, // sky blue
];

const TOTAL_LIVES = 5;
const POINTS_PER_WORD = 100;
const DEFAULT_SESSION_SECONDS = 300;

@Component({
  selector: 'app-word-search',
  standalone: true,
  imports: [CommonModule, MaterialModule, ConfettiBurstComponent],
  template: `
    <div class="ws">
      <div class="ws__canvas">
        <div class="ws__pattern" aria-hidden="true"></div>

        <div class="ws__status" *ngIf="phase === 'playing'">
          <div class="ws__timer">{{ formatTime(displaySeconds) }}</div>
          <div class="ws__status-right">
            <div class="ws__lives" aria-label="Lives remaining">
              <mat-icon
                *ngFor="let _ of hearts; let i = index"
                [class.ws__heart--lost]="i >= remainingLives"
              >favorite</mat-icon>
            </div>
            <div class="ws__score" aria-label="Words found">
              <mat-icon>check</mat-icon>
              <span>{{ foundCount }}</span>
            </div>
          </div>
        </div>

        <h2
          class="ws__prompt"
          *ngIf="phase === 'playing'"
          [class.ws__prompt--correct]="feedback === 'correct'"
          [class.ws__prompt--wrong]="feedback === 'wrong'"
        >{{ promptText }}</h2>

        <div class="ws__play" *ngIf="phase === 'playing'">
          <div class="ws__grid-shell">
            <div
              class="ws__grid"
              [style.--ws-cols]="gridCols"
              [style.--ws-cell]="cellPx + 'px'"
              (pointermove)="onGridPointerMove($event)"
              (pointerup)="onGridPointerUp($event)"
              (pointercancel)="onGridPointerUp($event)"
            >
              <ng-container *ngFor="let row of grid; let ri = index; trackBy: trackRow">
                <ng-container *ngFor="let letter of row; let ci = index; trackBy: trackCol">
                  <span
                    class="ws__cell"
                    *ngIf="isPlayable(letter)"
                    [attr.data-ws-row]="ri"
                    [attr.data-ws-col]="ci"
                    [class.ws__cell--found]="cellHighlight(ri, ci)"
                    [style.--ws-highlight]="cellColor(ri, ci)"
                    [attr.aria-label]="'Letter ' + letter"
                    (click)="onCellTap(ri, ci)"
                  >
                    <span>{{ letter }}</span>
                  </span>
                  <span
                    class="ws__gap"
                    *ngIf="!isPlayable(letter)"
                    aria-hidden="true"
                  ></span>
                </ng-container>
              </ng-container>
            </div>

            <div class="ws__fx ws__fx--correct" *ngIf="feedback === 'correct'" aria-hidden="true">
              <svg viewBox="0 0 120 120" class="ws__fx-icon">
                <defs>
                  <linearGradient id="wsCheckGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#4ade80"/>
                    <stop offset="100%" stop-color="#16a34a"/>
                  </linearGradient>
                </defs>
                <circle cx="60" cy="60" r="54" fill="url(#wsCheckGrad)" opacity="0.95"/>
                <path d="M34 62 L52 80 L88 38" fill="none" stroke="#fff" stroke-width="10"
                  stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="ws__fx ws__fx--wrong" *ngIf="feedback === 'wrong'" aria-hidden="true">
              <svg viewBox="0 0 120 120" class="ws__fx-icon">
                <circle cx="60" cy="60" r="54" fill="#ef4444" opacity="0.92"/>
                <path d="M42 42 L78 78 M78 42 L42 78" stroke="#fff" stroke-width="10"
                  stroke-linecap="round"/>
              </svg>
            </div>
          </div>
        </div>

        <div class="ws__complete" *ngIf="phase === 'complete'">
          <svg viewBox="0 0 80 80" class="ws__complete-icon" aria-hidden="true">
            <circle cx="40" cy="40" r="36" fill="#22c55e"/>
            <path d="M22 42 L36 56 L60 28" fill="none" stroke="#fff" stroke-width="6"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <h2>All words found!</h2>
          <p>Score <strong>{{ score }}</strong></p>
        </div>

      </div>

      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .ws {
      width: 100%;
      display: flex;
      justify-content: center;
    }

    .ws__canvas {
      position: relative;
      width: 100%;
      max-width: 560px;
      min-height: 520px;
      border-radius: 4px;
      overflow: hidden;
      box-shadow:
        0 4px 24px rgba(120, 53, 15, 0.18),
        0 0 0 1px rgba(180, 83, 9, 0.12);
      background: linear-gradient(165deg, #fde68a 0%, #fcd34d 28%, #fb923c 62%, #f97316 100%);
    }

    .ws__pattern {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0.45;
      background:
        linear-gradient(135deg, transparent 42%, rgba(255,255,255,0.14) 50%, transparent 58%),
        repeating-linear-gradient(
          60deg,
          transparent,
          transparent 48px,
          rgba(255, 255, 255, 0.07) 48px,
          rgba(255, 255, 255, 0.07) 96px
        ),
        repeating-linear-gradient(
          -60deg,
          transparent,
          transparent 48px,
          rgba(0, 0, 0, 0.04) 48px,
          rgba(0, 0, 0, 0.04) 96px
        );
    }

    .ws__status {
      position: relative;
      z-index: 2;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 16px 20px 0;
    }

    .ws__timer {
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 22px;
      font-weight: 700;
      color: #3d2914;
      letter-spacing: 0.02em;
      line-height: 1;
    }

    .ws__status-right {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .ws__lives {
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .ws__lives mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: #1c1917;
      transition: color 0.3s ease, opacity 0.3s ease;
    }

    .ws__heart--lost {
      color: rgba(28, 25, 23, 0.2) !important;
    }

    .ws__score {
      display: flex;
      align-items: center;
      gap: 4px;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 20px;
      font-weight: 700;
      color: #3d2914;
    }

    .ws__score mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: #3d2914;
    }

    .ws__prompt {
      position: relative;
      z-index: 2;
      margin: 18px 16px 14px;
      text-align: center;
      font-family: Georgia, 'Palatino Linotype', 'Times New Roman', serif;
      font-size: clamp(20px, 4.5vw, 26px);
      font-weight: 400;
      font-style: normal;
      color: #5c4033;
      letter-spacing: 0.01em;
      line-height: 1.25;
      transition: color 0.2s ease, transform 0.25s ease;
    }

    .ws__prompt--correct {
      color: #14532d;
      font-weight: 600;
      transform: scale(1.02);
    }

    .ws__prompt--wrong {
      color: #7f1d1d;
      font-weight: 600;
      transform: scale(1.02);
    }

    .ws__play {
      position: relative;
      z-index: 2;
      display: flex;
      justify-content: center;
      padding: 0 12px 12px;
    }

    .ws__grid-shell {
      width: 100%;
      max-width: 100%;
      display: flex;
      justify-content: center;
    }

    .ws__grid {
      display: grid;
      grid-template-columns: repeat(var(--ws-cols, 11), var(--ws-cell, 40px));
      gap: 3px;
      justify-content: center;
      overflow: hidden;
      touch-action: none;
      user-select: none;
    }

    .ws__cell,
    .ws__gap {
      width: var(--ws-cell, 40px);
      height: var(--ws-cell, 40px);
    }

    .ws__cell {
      border: none;
      border-radius: 7px;
      background: #3f3f46;
      color: #fafafa;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: calc(var(--ws-cell, 40px) * 0.38);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      box-shadow:
        0 2px 4px rgba(0, 0, 0, 0.28),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
      transition:
        transform 0.1s ease,
        background 0.2s ease,
        box-shadow 0.2s ease;
    }

    .ws__cell span {
      user-select: none;
      line-height: 1;
    }

    .ws__cell:hover:not(.ws__cell--found) {
      background: #52525b;
      transform: translateY(-1px);
    }

    .ws__cell:active {
      transform: scale(0.96);
    }

    .ws__cell--selecting {
      background: var(--ws-highlight, #fbbf24) !important;
      color: #1c1917;
      box-shadow:
        0 2px 6px rgba(0, 0, 0, 0.22),
        inset 0 1px 0 rgba(255, 255, 255, 0.35);
    }

    .ws__cell--found {
      background: var(--ws-highlight, #22c55e) !important;
      color: var(--ws-highlight-fg, #fff);
      cursor: default;
      box-shadow:
        0 2px 6px rgba(0, 0, 0, 0.22),
        inset 0 1px 0 rgba(255, 255, 255, 0.2);
    }

    .ws__gap {
      display: block;
      visibility: hidden;
      pointer-events: none;
    }

    .ws__fx {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: clamp(88px, 28vw, 130px);
      height: clamp(88px, 28vw, 130px);
      pointer-events: none;
      animation: wsFxPop 0.45s cubic-bezier(0.34, 1.4, 0.64, 1);
      filter: drop-shadow(0 10px 28px rgba(0, 0, 0, 0.28));
    }

    .ws__fx--wrong {
      top: 50%;
      left: 50%;
      right: auto;
      bottom: auto;
    }

    .ws__fx-icon {
      width: 100%;
      height: 100%;
      display: block;
    }

    @keyframes wsFxPop {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(0.35) rotate(-8deg); }
      55% { opacity: 1; transform: translate(-50%, -50%) scale(1.12) rotate(2deg); }
      100% { transform: translate(-50%, -50%) scale(1) rotate(0); }
    }

    .ws__complete {
      position: relative;
      z-index: 2;
      text-align: center;
      padding: 56px 24px 40px;
      color: #5c4033;
      font-family: Georgia, serif;
    }

    .ws__complete-icon {
      width: 72px;
      height: 72px;
      margin: 0 auto 16px;
      display: block;
      filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.2));
    }

    .ws__complete h2 {
      margin: 0 0 10px;
      font-size: 26px;
      font-weight: 600;
      color: #3d2914;
    }

    .ws__complete p {
      margin: 0;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 18px;
      color: #5c4033;
    }

    .ws__complete strong {
      font-weight: 800;
      color: #1c1917;
    }

    @media (max-width: 420px) {
      .ws__canvas { min-height: 460px; }
      .ws__status { padding: 12px 14px 0; }
      .ws__timer { font-size: 18px; }
      .ws__lives mat-icon,
      .ws__score mat-icon { font-size: 18px; width: 18px; height: 18px; }
      .ws__score { font-size: 17px; }
      .ws__play { padding: 0 0 10px; }
      .ws__grid { gap: 2.5px; }
    }

    @media (min-width: 500px) {
      .ws__grid { gap: 5px; }
    }
  `],
})
export class WordSearchComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() gameSet!: GameSet;
  @Input() questions: WordSearchQuestion[] = [];
  @Output() onComplete = new EventEmitter<WSResult>();

  phase: 'playing' | 'complete' = 'playing';
  feedback: Feedback = 'idle';
  promptText = 'Find words across, down, or diagonally';

  grid: string[][] = [];
  gridRows = 10;
  gridCols = 10;
  cellPx = 40;
  placements: Placement[] = [];
  foundIds = new Set<string>();
  highlightByCell = new Map<string, WordHighlight>();
  selection: CellPos[] = [];
  private isPointerDown = false;
  private didDrag = false;
  private suppressClick = false;
  private pointerAnchor: CellPos | null = null;

  score = 0;
  foundCount = 0;
  remainingLives = TOTAL_LIVES;
  hearts = Array(TOTAL_LIVES).fill(0);

  sessionLimitSeconds = DEFAULT_SESSION_SECONDS;
  remainingSeconds = DEFAULT_SESSION_SECONDS;
  displaySeconds = DEFAULT_SESSION_SECONDS;
  sessionElapsedSeconds = 0;
  showConfetti = false;

  private puzzleIndex = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private elapsedId: ReturnType<typeof setInterval> | null = null;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private totalWordsInGame = 0;
  private wordsFoundInGame = 0;
  private audioUnlocked = false;

  constructor(private audio: GameAudioService) {}

  ngOnInit(): void {
    const limit = this.gameSet.timerSettings?.sessionLimitSeconds;
    this.sessionLimitSeconds = limit != null && limit > 0 ? limit : DEFAULT_SESSION_SECONDS;
    this.remainingSeconds = this.sessionLimitSeconds;
    this.displaySeconds = this.remainingSeconds;
    this.totalWordsInGame = this.questions.reduce(
      (n, q) => n + (q.totalWords || q.placements?.length || 0),
      0,
    );
    this.updateCellSize();
    this.loadPuzzle(0);
    this.startTimers();
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  trackRow = (i: number) => i;
  trackCol = (i: number) => i;

  isPlayable(letter: string): boolean {
    return !!letter && letter.trim().length > 0;
  }

  private updateCellSize(): void {
    const cols = Math.max(this.gridSize, 8);
    const gap = window.innerWidth >= 500 ? 5 : 2.5;
    const availWidth = Math.min(480, window.innerWidth - 48);
    this.cellPx = Math.min(42, Math.floor((availWidth - gap * (cols - 1)) / cols));
    this.cellPx = Math.max(22, this.cellPx);
  }

  private loadPuzzle(index: number): void {
    const q = this.questions[index];
    if (!q?.grid?.length) {
      this.finishGame();
      return;
    }
    this.grid = q.grid.map(row => [...row]);
    this.gridRows = q.gridRows || q.grid.length;
    this.gridCols = q.gridCols || q.grid[0]?.length || q.grid.length;
    this.updateCellSize();
    this.placements = (q.placements || []).map(p => ({
      id: p.id,
      cells: p.cells.map(c => ({ row: c.row, col: c.col })),
    }));
    this.foundIds.clear();
    this.highlightByCell.clear();
    this.clearSelection();
    this.foundCount = this.wordsFoundInGame;
    this.feedback = 'idle';
    this.promptText = 'Find words across, down, or diagonally';
  }

  private startTimers(): void {
    this.timerId = setInterval(() => {
      if (this.sessionLimitSeconds > 0) {
        this.remainingSeconds = Math.max(0, this.remainingSeconds - 1);
        this.displaySeconds = this.remainingSeconds;
        if (this.remainingSeconds <= 0) this.onTimeUp();
      } else {
        this.displaySeconds = this.sessionElapsedSeconds;
      }
    }, 1000);
    this.elapsedId = setInterval(() => {
      this.sessionElapsedSeconds++;
      if (!this.sessionLimitSeconds) {
        this.displaySeconds = this.sessionElapsedSeconds;
      }
    }, 1000);
  }

  private clearTimers(): void {
    if (this.timerId) clearInterval(this.timerId);
    if (this.elapsedId) clearInterval(this.elapsedId);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateCellSize();
  }

  cellKey(row: number, col: number): string {
    return `${row},${col}`;
  }

  cellHighlight(row: number, col: number): boolean {
    return this.highlightByCell.has(this.cellKey(row, col));
  }

  cellSelecting(row: number, col: number): boolean {
    return this.selection.some(c => c.row === row && c.col === col);
  }

  cellDisplayColor(row: number, col: number): string {
    const key = this.cellKey(row, col);
    const found = this.highlightByCell.get(key);
    if (found) return found.bg;
    if (this.cellSelecting(row, col)) return SELECTING_COLOR;
    return '';
  }

  cellDisplayTextColor(row: number, col: number): string {
    return this.highlightByCell.get(this.cellKey(row, col))?.fg || '';
  }

  onCellPointerDown(event: PointerEvent, row: number, col: number): void {
    if (this.feedback !== 'idle' || this.phase !== 'playing') return;
    if (!this.audioUnlocked) { this.audio.unlock(); this.audioUnlocked = true; }
    if (this.cellHighlight(row, col)) return;

    event.preventDefault();
    (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
    this.isPointerDown = true;
    this.didDrag = false;
    this.suppressClick = false;
    this.pointerAnchor = { row, col };
  }

  onGridPointerMove(event: PointerEvent): void {
    if (!this.isPointerDown || this.feedback !== 'idle' || this.phase !== 'playing') return;
    if (!this.pointerAnchor) return;

    const cell = this.cellAtPoint(event.clientX, event.clientY);
    if (!cell) return;
    this.updateDragSelection(cell.row, cell.col);
  }

  onGridPointerUp(event: PointerEvent): void {
    if (!this.isPointerDown) return;
    (event.target as HTMLElement)?.releasePointerCapture?.(event.pointerId);
    this.isPointerDown = false;

    if (this.didDrag) {
      this.suppressClick = true;
      this.tryCompleteSelection();
    }
    this.pointerAnchor = null;
  }

  private cellAtPoint(clientX: number, clientY: number): CellPos | null {
    const el = document.elementFromPoint(clientX, clientY)?.closest('.ws__cell') as HTMLElement | null;
    if (!el) return null;
    const row = parseInt(el.getAttribute('data-ws-row') || '', 10);
    const col = parseInt(el.getAttribute('data-ws-col') || '', 10);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
    if (this.cellHighlight(row, col)) return null;
    return { row, col };
  }

  private updateDragSelection(row: number, col: number): void {
    if (!this.pointerAnchor) return;
    if (this.pointerAnchor.row === row && this.pointerAnchor.col === col) {
      this.selection = [{ ...this.pointerAnchor }];
      return;
    }

    const line = this.getStraightLine(this.pointerAnchor, { row, col });
    if (!line) return;

    this.didDrag = true;
    this.selection = line;
  }

  onCellClick(row: number, col: number): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (this.feedback !== 'idle' || this.phase !== 'playing') return;
    if (this.cellHighlight(row, col)) return;

    if (this.selection.length === 0) {
      this.selection = [{ row, col }];
      return;
    }

    const last = this.selection[this.selection.length - 1];
    if (last.row === row && last.col === col) return;

    if (this.selection.length === 1) {
      const line = this.getStraightLine(this.selection[0], { row, col });
      if (line && line.length >= 2) {
        this.selection = line;
        const match = this.findMatchingPlacement(this.selection);
        if (match) {
          this.clearSelection();
          this.showCorrect(match);
          return;
        }
        if (this.isFailedWordAttempt(this.selection)) {
          this.clearSelection();
          this.showWrong();
          return;
        }
        return;
      }
    }

    if (this.selection.length >= 2) {
      const prev = this.selection[this.selection.length - 2];
      if (prev.row === row && prev.col === col) {
        this.selection.pop();
        return;
      }
    }

    if (!this.extendSelection(row, col)) {
      this.clearSelection();
      this.selection = [{ row, col }];
      return;
    }

    const match = this.findMatchingPlacement(this.selection);
    if (match) {
      this.clearSelection();
      this.showCorrect(match);
      return;
    }

    if (this.isFailedWordAttempt(this.selection)) {
      this.clearSelection();
      this.showWrong();
    }
  }

  private isFailedWordAttempt(path: CellPos[]): boolean {
    const len = path.length;
    const hasUnfoundOfLen = this.placements.some(
      p => !this.foundIds.has(p.id) && p.cells.length === len,
    );
    return hasUnfoundOfLen && !this.findMatchingPlacement(path);
  }

  private clearSelection(): void {
    this.selection = [];
    this.isPointerDown = false;
    this.didDrag = false;
    this.pointerAnchor = null;
  }

  /** All cells on a straight horizontal, vertical, or diagonal line. */
  private getStraightLine(start: CellPos, end: CellPos): CellPos[] | null {
    const dr = end.row - start.row;
    const dc = end.col - start.col;
    if (dr === 0 && dc === 0) return [start];

    const ndr = dr === 0 ? 0 : Math.sign(dr);
    const ndc = dc === 0 ? 0 : Math.sign(dc);
    const steps = Math.max(Math.abs(dr), Math.abs(dc));

    if (start.row + ndr * steps !== end.row || start.col + ndc * steps !== end.col) {
      return null;
    }

    const rows = this.grid.length;
    const cols = this.grid[0]?.length ?? 0;
    const line: CellPos[] = [];
    for (let i = 0; i <= steps; i++) {
      const row = start.row + ndr * i;
      const col = start.col + ndc * i;
      if (row < 0 || col < 0 || row >= rows || col >= cols) return null;
      line.push({ row, col });
    }
    return line;
  }

  private cellDirection(from: CellPos, to: CellPos): [number, number] | null {
    const dr = to.row - from.row;
    const dc = to.col - from.col;
    if (dr === 0 && dc === 0) return null;
    if (Math.abs(dr) > 1 || Math.abs(dc) > 1) return null;
    const ndr = dr === 0 ? 0 : dr / Math.abs(dr);
    const ndc = dc === 0 ? 0 : dc / Math.abs(dc);
    return [ndr, ndc];
  }

  private canExtendSelection(path: CellPos[], cell: CellPos): boolean {
    if (!path.length) return true;
    const last = path[path.length - 1];
    if (last.row === cell.row && last.col === cell.col) return false;

    if (path.length === 1) {
      return this.cellDirection(path[0], cell) !== null;
    }

    const [dr, dc] = this.cellDirection(path[0], path[1])!;
    return last.row + dr === cell.row && last.col + dc === cell.col;
  }

  private extendSelection(row: number, col: number): boolean {
    const cell = { row, col };
    const last = this.selection[this.selection.length - 1];
    if (last?.row === row && last?.col === col) return true;

    if (this.selection.length >= 2) {
      const prev = this.selection[this.selection.length - 2];
      if (prev.row === row && prev.col === col) {
        this.selection.pop();
        return true;
      }
    }

    if (!this.canExtendSelection(this.selection, cell)) {
      return false;
    }

    this.selection = [...this.selection, cell];
    return true;
  }

  private pathsMatch(a: CellPos[], b: CellPos[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((c, i) => c.row === b[i].row && c.col === b[i].col);
  }

  private findMatchingPlacement(path: CellPos[]): Placement | null {
    if (path.length < 2) return null;
    const reversed = [...path].reverse();
    return this.placements.find(
      p => !this.foundIds.has(p.id)
        && (this.pathsMatch(path, p.cells) || this.pathsMatch(reversed, p.cells)),
    ) || null;
  }

  private tryCompleteSelection(): void {
    if (this.selection.length < 2) {
      this.clearSelection();
      return;
    }

    const match = this.findMatchingPlacement(this.selection);
    this.clearSelection();
    if (match) {
      this.showCorrect(match);
      return;
    }
    this.showWrong();
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
    this.audio.playXpGain();

    this.feedbackTimer = setTimeout(() => {
      this.feedback = 'idle';
      this.promptText = 'Find words across, down, or diagonally';
      if (this.foundIds.size >= this.placements.length) {
        this.advancePuzzle();
      }
    }, 1100);
  }

  private showWrong(): void {
    this.feedback = 'wrong';
    this.promptText = 'Wrong!';
    this.audio.playWrong();
    this.remainingLives--;

    this.feedbackTimer = setTimeout(() => {
      this.feedback = 'idle';
      this.promptText = 'Find words across, down, or diagonally';
      if (this.remainingLives <= 0) {
        this.finishGame();
      }
    }, 1100);
  }

  private advancePuzzle(): void {
    if (this.puzzleIndex + 1 < this.questions.length) {
      this.puzzleIndex++;
      this.loadPuzzle(this.puzzleIndex);
      return;
    }
    this.showConfetti = true;
    this.phase = 'complete';
    setTimeout(() => this.finishGame(), 1400);
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
