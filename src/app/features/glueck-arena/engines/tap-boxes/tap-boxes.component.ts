import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { GameAttempt, GameSet, TapBoxesQuestion } from '../../glueck-arena.types';

export interface TBResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
}

interface BoxTheme {
  rim: string;
  rimDark: string;
  fill: string;
  fillLight: string;
}

interface BoxItem {
  id: string;
  number: number;
  phrase: string;
  theme: BoxTheme;
  revealed: boolean;
}

type PlayPhase = 'grid' | 'zoom' | 'reveal' | 'done';

/** Wordwall-style rim colours (orange → yellow → green → blue → pink). */
const BOX_THEMES: BoxTheme[] = [
  { rim: '#f97316', rimDark: '#c2410c', fill: '#fb923c', fillLight: '#fdba74' },
  { rim: '#eab308', rimDark: '#a16207', fill: '#facc15', fillLight: '#fde68a' },
  { rim: '#22c55e', rimDark: '#15803d', fill: '#4ade80', fillLight: '#86efac' },
  { rim: '#3b82f6', rimDark: '#1d4ed8', fill: '#60a5fa', fillLight: '#93c5fd' },
  { rim: '#ec4899', rimDark: '#be185d', fill: '#f472b6', fillLight: '#f9a8d4' },
];

function layoutRowSizes(count: number): number[] {
  if (count <= 8) return [count];
  if (count <= 15) {
    const top = Math.ceil(count / 2);
    return [top, count - top];
  }
  const third = Math.min(8, count - 15);
  const second = Math.min(7, count - 8 - third);
  const first = count - second - third;
  return [first, second, third].filter(n => n > 0);
}

@Component({
  selector: 'app-tap-boxes',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  template: `
    <div class="tb">
      <div class="tb__stage">
        <!-- Classroom backdrop -->
        <div class="tb__room" aria-hidden="true">
          <div class="tb__sky"></div>
          <ul class="tb__pennants">
            <li *ngFor="let c of pennantColors" [style.background]="c"></li>
          </ul>
          <div class="tb__wall-map"></div>
          <div class="tb__chalkboard"></div>
          <div class="tb__desk">
            <span class="tb__desk-paper"></span>
            <span class="tb__desk-book"></span>
          </div>
        </div>

        <!-- HUD (floating, like Wordwall) -->
        <header class="tb__hud">
          <div class="tb__timer">
            <span class="tb__timer-val" [class.tb__timer-val--warn]="sessionLimitSeconds && remainingSeconds <= 10">
              {{ sessionLimitSeconds ? formatTime(remainingSeconds) : formatTime(elapsedSeconds) }}
            </span>
          </div>
          <p class="tb__instruction">{{ hudHint }}</p>
          <div class="tb__hud-right">
            <span class="tb__score" *ngIf="score > 0">{{ score }}</span>
          </div>
        </header>

        <div
          class="tb__play"
          [class.tb__play--focus]="phase === 'zoom' || phase === 'reveal'"
        >
          <div class="tb__grid-panel" *ngIf="phase !== 'done'">
            <div class="tb__grid">
              <div
                class="tb__row"
                *ngFor="let row of rows; let ri = index"
                [class.tb__row--stagger]="ri === 1 && rows.length > 1"
              >
                <button
                  type="button"
                  class="tb__tile"
                  *ngFor="let box of row"
                  [class.tb__tile--open]="box.revealed"
                  [class.tb__tile--zooming]="zoomTarget?.id === box.id && phase === 'zoom'"
                  [class.tb__tile--ghost]="zoomTarget?.id === box.id && phase === 'reveal'"
                  [class.tb__tile--dim]="zoomTarget && zoomTarget.id !== box.id && (phase === 'zoom' || phase === 'reveal')"
                  [class.tb__tile--lift]="hoverId === box.id && phase === 'grid' && !box.revealed"
                  [disabled]="box.revealed || phase === 'zoom' || phase === 'reveal'"
                  (click)="openBox(box)"
                  (mouseenter)="hoverId = box.id"
                  (mouseleave)="hoverId = null"
                  [attr.aria-label]="box.revealed ? 'Opened: ' + box.phrase : 'Open box ' + box.number"
                >
                  <!-- Closed: 3D numbered card -->
                  <ng-container *ngIf="!box.revealed">
                    <span class="tb__shell">
                      <span class="tb__rim" [style.background]="box.theme.rim">
                        <span class="tb__sheet">
                          <span class="tb__num">{{ box.number }}</span>
                          <span class="tb__peel" [class.tb__peel--curl]="hoverId === box.id && phase === 'grid'">
                            <span class="tb__peel-under"></span>
                            <span class="tb__peel-flap"></span>
                          </span>
                        </span>
                      </span>
                    </span>
                  </ng-container>

                  <!-- Open on grid: solid pillow tile -->
                  <ng-container *ngIf="box.revealed && phase === 'grid'">
                    <span class="tb__shell tb__shell--open">
                      <span
                        class="tb__pillow"
                        [style.background]="'linear-gradient(180deg, ' + box.theme.fillLight + ' 0%, ' + box.theme.fill + ' 42%, ' + box.theme.fill + ' 58%, ' + box.theme.fillLight + ' 100%)'"
                      >
                        <span class="tb__pillow-shine tb__pillow-shine--top"></span>
                        <span class="tb__pillow-shine tb__pillow-shine--bot"></span>
                        <span class="tb__open-label">{{ box.phrase }}</span>
                      </span>
                    </span>
                  </ng-container>
                </button>
              </div>
            </div>
          </div>

          <!-- Cinematic zoom reveal -->
          <div class="tb__focus" *ngIf="phase === 'reveal' && zoomTarget">
            <div class="tb__focus-backdrop" (click)="backToGrid()"></div>
            <article
              class="tb__focus-card"
              [style.background]="'linear-gradient(180deg, ' + zoomTarget.theme.fillLight + ' 0%, ' + zoomTarget.theme.fill + ' 38%, ' + zoomTarget.theme.fill + ' 62%, ' + zoomTarget.theme.rimDark + ' 100%)'"
            >
              <span class="tb__focus-card-rim" [style.borderColor]="zoomTarget.theme.rim"></span>
              <span class="tb__focus-shine tb__focus-shine--top"></span>
              <span class="tb__focus-shine tb__focus-shine--bot"></span>
              <p class="tb__focus-text">{{ zoomTarget.phrase }}</p>
            </article>
            <button type="button" class="tb__focus-close" (click)="backToGrid()">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        </div>

        <div class="tb__done" *ngIf="phase === 'done'">
          <mat-icon>emoji_events</mat-icon>
          <h2>All boxes opened!</h2>
          <p>Score <strong>{{ score }}</strong></p>
        </div>

        <footer class="tb__bar" *ngIf="phase === 'reveal'">
          <button type="button" class="tb__bar-btn" (click)="backToGrid()">
            <mat-icon>apps</mat-icon>
            Back to grid
          </button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    }

    .tb {
      width: 100%;
      max-width: 1000px;
      margin: 0 auto;
    }

    .tb__stage {
      position: relative;
      border-radius: 4px;
      overflow: hidden;
      min-height: 520px;
      box-shadow:
        0 0 0 1px rgba(15, 23, 42, 0.08),
        0 20px 50px rgba(15, 23, 42, 0.18);
    }

    /* ── Classroom ───────────────────────────────────────── */
    .tb__room {
      position: absolute;
      inset: 0;
      z-index: 0;
      overflow: hidden;
    }
    .tb__sky {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, #b8d4e8 0%, #d4e4f0 28%, #e8dcc8 72%, #c4a574 100%);
    }
    .tb__pennants {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px 0;
      margin: 0;
      list-style: none;
      z-index: 1;
    }
    .tb__pennants li {
      width: 28px;
      height: 22px;
      clip-path: polygon(50% 100%, 0 0, 100% 0);
      opacity: 0.95;
      filter: drop-shadow(0 1px 1px rgba(0,0,0,0.15));
    }
    .tb__wall-map {
      position: absolute;
      top: 12%;
      left: 4%;
      width: 22%;
      height: 18%;
      border-radius: 4px;
      background: linear-gradient(135deg, #93c5fd 0%, #fef08a 50%, #86efac 100%);
      opacity: 0.45;
      border: 2px solid rgba(255,255,255,0.5);
    }
    .tb__chalkboard {
      position: absolute;
      top: 14%;
      left: 50%;
      transform: translateX(-50%);
      width: 88%;
      height: 52%;
      background: linear-gradient(180deg, #3d4f3f 0%, #2a3830 50%, #1f2a24 100%);
      border-radius: 6px;
      box-shadow:
        inset 0 2px 8px rgba(0,0,0,0.35),
        0 4px 12px rgba(0,0,0,0.2);
      border: 6px solid #5c4a32;
    }
    .tb__desk {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 22%;
      background: linear-gradient(180deg, transparent 0%, #a67c52 35%, #8b6914 100%);
    }
    .tb__desk-paper {
      position: absolute;
      bottom: 28%;
      left: 12%;
      width: 18%;
      height: 35%;
      background: #fff;
      border-radius: 2px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      transform: rotate(-4deg);
      opacity: 0.7;
    }
    .tb__desk-book {
      position: absolute;
      bottom: 32%;
      right: 14%;
      width: 14%;
      height: 28%;
      background: linear-gradient(90deg, #dc2626, #b91c1c);
      border-radius: 2px 6px 6px 2px;
      box-shadow: 0 3px 8px rgba(0,0,0,0.2);
      opacity: 0.75;
    }

    /* ── HUD ─────────────────────────────────────────────── */
    .tb__hud {
      position: relative;
      z-index: 4;
      display: grid;
      grid-template-columns: 80px 1fr 80px;
      align-items: center;
      padding: 14px 20px 8px;
      pointer-events: none;
    }
    .tb__timer-val {
      font-size: 22px;
      font-weight: 700;
      color: #1e293b;
      letter-spacing: 0.02em;
      text-shadow: 0 1px 0 rgba(255,255,255,0.8);
    }
    .tb__timer-val--warn { color: #dc2626; }
    .tb__instruction {
      margin: 0;
      text-align: center;
      font-size: 17px;
      font-weight: 600;
      color: #475569;
      text-shadow: 0 1px 0 rgba(255,255,255,0.9);
    }
    .tb__hud-right { text-align: right; }
    .tb__score {
      font-size: 15px;
      font-weight: 800;
      color: #b45309;
      background: rgba(255,255,255,0.85);
      padding: 4px 10px;
      border-radius: 8px;
    }

    /* ── Play area (tiles on chalkboard) ───────────────── */
    .tb__play {
      position: relative;
      z-index: 2;
      min-height: 400px;
      padding: 8px 16px 28px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tb__play--focus .tb__grid-panel {
      filter: blur(3px) brightness(0.75);
      opacity: 0.45;
      pointer-events: none;
      transition: filter 0.4s ease, opacity 0.4s ease;
    }

    .tb__grid-panel {
      width: 100%;
      max-width: 820px;
      padding: 12px 8px 16px;
      transition: filter 0.4s ease, opacity 0.4s ease;
    }
    .tb__grid {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }
    .tb__row {
      display: flex;
      flex-wrap: nowrap;
      justify-content: center;
      align-items: center;
      gap: 12px;
    }
    .tb__row--stagger {
      padding-left: calc(var(--tb-tile) / 2 + 6px);
    }

    /* ── Tile button ───────────────────────────────────── */
    .tb__tile {
      --tb-tile: 78px;
      position: relative;
      width: var(--tb-tile);
      height: var(--tb-tile);
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
      flex-shrink: 0;
      -webkit-tap-highlight-color: transparent;
      transition: transform 0.22s cubic-bezier(0.34, 1.25, 0.64, 1), opacity 0.3s ease, filter 0.3s ease;
    }
    .tb__tile:disabled:not(.tb__tile--open) { cursor: default; }
    .tb__tile--lift:not(:disabled) {
      transform: translateY(-5px) scale(1.05);
      z-index: 2;
    }
    .tb__tile--dim {
      opacity: 0.25;
      transform: scale(0.94);
      filter: saturate(0.5);
    }
    .tb__tile--zooming {
      z-index: 15;
      transform: scale(2.85) translateY(6%);
      transition: transform 0.48s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .tb__tile--ghost {
      opacity: 0;
      pointer-events: none;
    }

    /* Navy 3D shell */
    .tb__shell {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: 14px;
      padding: 5px;
      background: #1a2744;
      box-shadow:
        0 1px 0 rgba(255,255,255,0.12) inset,
        0 5px 0 #0c1222,
        0 8px 14px rgba(0, 0, 0, 0.28);
      transition: box-shadow 0.2s ease, transform 0.2s ease;
    }
    .tb__tile--lift .tb__shell {
      box-shadow:
        0 1px 0 rgba(255,255,255,0.15) inset,
        0 7px 0 #0c1222,
        0 14px 22px rgba(0, 0, 0, 0.32);
    }

    /* Coloured rim */
    .tb__rim {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: 10px;
      padding: 5px;
      box-shadow:
        inset 0 2px 0 rgba(255,255,255,0.35),
        inset 0 -2px 0 rgba(0,0,0,0.12);
    }

    /* White paper face */
    .tb__sheet {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      border-radius: 6px;
      background: #ffffff;
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.06);
      overflow: hidden;
    }
    .tb__num {
      font-size: 36px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1;
      user-select: none;
      z-index: 1;
    }

    /* Peel corner */
    .tb__peel {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 38%;
      height: 38%;
      z-index: 2;
      pointer-events: none;
      transition: transform 0.28s cubic-bezier(0.34, 1.45, 0.64, 1);
      transform-origin: 100% 100%;
    }
    .tb__peel-under {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, #a8a29e 0%, #78716c 55%, #9ca3af 100%);
      clip-path: polygon(100% 0, 0 100%, 100% 100%);
    }
    .tb__peel-flap {
      position: absolute;
      right: 1px;
      bottom: 1px;
      width: 88%;
      height: 88%;
      background: linear-gradient(145deg, #f8fafc 0%, #e2e8f0 60%, #cbd5e1 100%);
      clip-path: polygon(100% 0, 8% 92%, 100% 100%);
      box-shadow: -2px -2px 4px rgba(0,0,0,0.1);
    }
    .tb__peel--curl {
      transform: rotate(-18deg) scale(1.12) translate(-2px, -2px);
    }

    /* Open pillow tile on grid */
    .tb__shell--open {
      padding: 4px;
      background: #1a2744;
    }
    .tb__pillow {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      border-radius: 10px;
      padding: 8px 6px;
      box-shadow:
        inset 0 3px 8px rgba(255,255,255,0.45),
        inset 0 -4px 10px rgba(0,0,0,0.12);
    }
    .tb__pillow-shine {
      position: absolute;
      left: 8%;
      right: 8%;
      height: 6px;
      border-radius: 50%;
      background: rgba(255,255,255,0.55);
      pointer-events: none;
    }
    .tb__pillow-shine--top { top: 6px; }
    .tb__pillow-shine--bot {
      bottom: 6px;
      opacity: 0.35;
      background: rgba(0,0,0,0.08);
    }
    .tb__open-label {
      position: relative;
      z-index: 1;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.25;
      color: #0f172a;
      text-align: center;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }

    /* ── Zoom / reveal overlay ─────────────────────────── */
    .tb__focus {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      animation: tb-fade-in 0.35s ease;
    }
    @keyframes tb-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .tb__focus-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.35);
      cursor: pointer;
    }
    .tb__focus-card {
      position: relative;
      z-index: 1;
      width: min(88%, 440px);
      min-height: 200px;
      padding: 36px 32px;
      border-radius: 18px;
      border: 6px solid #1a2744;
      box-shadow:
        0 1px 0 rgba(255,255,255,0.4) inset,
        0 12px 0 #0c1222,
        0 24px 48px rgba(0, 0, 0, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: tb-card-pop 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    }
    @keyframes tb-card-pop {
      0% { opacity: 0; transform: scale(0.35); }
      70% { transform: scale(1.04); }
      100% { opacity: 1; transform: scale(1); }
    }
    .tb__focus-card-rim {
      position: absolute;
      inset: 8px;
      border: 4px solid;
      border-radius: 12px;
      opacity: 0.5;
      pointer-events: none;
    }
    .tb__focus-shine {
      position: absolute;
      left: 10%;
      right: 10%;
      height: 10px;
      border-radius: 50%;
      pointer-events: none;
    }
    .tb__focus-shine--top {
      top: 14px;
      background: rgba(255,255,255,0.65);
    }
    .tb__focus-shine--bot {
      bottom: 14px;
      background: rgba(0,0,0,0.08);
    }
    .tb__focus-text {
      position: relative;
      z-index: 2;
      margin: 0;
      font-size: clamp(22px, 5vw, 32px);
      font-weight: 800;
      color: #0f172a;
      text-align: center;
      line-height: 1.35;
      text-shadow: 0 1px 0 rgba(255,255,255,0.4);
    }
    .tb__focus-close {
      position: absolute;
      top: 16px;
      right: 16px;
      z-index: 3;
      width: 40px;
      height: 40px;
      border: 3px solid #1a2744;
      border-radius: 10px;
      background: #fff;
      color: #1e293b;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 0 #0c1222;
      transition: transform 0.15s;
    }
    .tb__focus-close:hover { transform: translateY(-2px); }
    .tb__focus-close mat-icon { font-size: 22px; width: 22px; height: 22px; }

    /* ── Done & footer ─────────────────────────────────── */
    .tb__done {
      position: relative;
      z-index: 3;
      text-align: center;
      padding: 56px 24px;
      background: rgba(255,255,255,0.92);
    }
    .tb__done mat-icon {
      font-size: 56px;
      width: 56px;
      height: 56px;
      color: #f59e0b;
    }
    .tb__done h2 { margin: 8px 0; font-size: 26px; color: #0f172a; }
    .tb__done p { color: #475569; font-size: 17px; }
    .tb__done strong { color: #b45309; font-size: 20px; }

    .tb__bar {
      position: relative;
      z-index: 5;
      display: flex;
      justify-content: center;
      padding: 0 16px 18px;
    }
    .tb__bar-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 22px;
      border: 3px solid #1a2744;
      border-radius: 12px;
      background: #fff;
      color: #1e293b;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 5px 0 #0c1222;
      transition: transform 0.15s;
    }
    .tb__bar-btn:hover { transform: translateY(-2px); }
    .tb__bar-btn mat-icon { font-size: 20px; width: 20px; height: 20px; }

    /* ── Responsive tile sizing ────────────────────────── */
    @media (max-width: 720px) {
      .tb__tile { --tb-tile: 68px; }
      .tb__num { font-size: 30px; }
      .tb__row { gap: 10px; }
      .tb__grid { gap: 12px; }
      .tb__instruction { font-size: 15px; }
    }
    @media (max-width: 480px) {
      .tb__tile { --tb-tile: 58px; }
      .tb__num { font-size: 26px; }
      .tb__row { gap: 8px; }
      .tb__row--stagger { padding-left: calc(var(--tb-tile) / 2 + 4px); }
      .tb__open-label { font-size: 9px; }
      .tb__hud { grid-template-columns: 64px 1fr 48px; padding: 10px 12px 6px; }
      .tb__timer-val { font-size: 18px; }
    }
    @media (min-width: 900px) {
      .tb__tile { --tb-tile: 84px; }
      .tb__num { font-size: 40px; }
      .tb__open-label { font-size: 12px; }
      .tb__row { gap: 14px; }
    }
  `],
})
export class TapBoxesComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() gameSet!: GameSet;
  @Input() questions: TapBoxesQuestion[] = [];
  @Output() onComplete = new EventEmitter<TBResult>();

  boxes: BoxItem[] = [];
  rows: BoxItem[][] = [];
  phase: PlayPhase = 'grid';
  zoomTarget: BoxItem | null = null;
  hoverId: string | null = null;
  score = 0;
  revealedCount = 0;
  startedAt = Date.now();
  elapsedSeconds = 0;
  sessionLimitSeconds: number | null = null;
  remainingSeconds = 0;
  pennantColors = ['#f97316', '#eab308', '#22c55e', '#3b82f6', '#ec4899', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#ec4899', '#f97316', '#eab308'];
  private timerId: ReturnType<typeof setInterval> | null = null;
  private elapsedId: ReturnType<typeof setInterval> | null = null;

  get hudHint(): string {
    if (this.phase === 'reveal') return 'Tap one to open';
    if (this.revealedCount > 0 && this.revealedCount < this.boxes.length) {
      return 'Tap one to open';
    }
    return 'Tap one to open';
  }

  ngOnInit(): void {
    const phrases = (this.questions || [])
      .map(q => String(q.phrase || '').trim())
      .filter(Boolean);
    this.boxes = phrases.map((phrase, i) => ({
      id: `box-${i}`,
      number: i + 1,
      phrase,
      theme: BOX_THEMES[i % BOX_THEMES.length],
      revealed: false,
    }));
    this.buildRows();

    this.elapsedId = setInterval(() => {
      this.elapsedSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
    }, 1000);

    const limit = this.gameSet?.timerSettings?.sessionLimitSeconds;
    if (limit && limit > 0) {
      this.sessionLimitSeconds = limit;
      this.remainingSeconds = limit;
      this.timerId = setInterval(() => this.tickTimer(), 1000);
    }
  }

  ngOnDestroy(): void {
    if (this.timerId) clearInterval(this.timerId);
    if (this.elapsedId) clearInterval(this.elapsedId);
  }

  buildRows(): void {
    const sizes = layoutRowSizes(this.boxes.length);
    this.rows = [];
    let idx = 0;
    for (const size of sizes) {
      this.rows.push(this.boxes.slice(idx, idx + size));
      idx += size;
    }
  }

  openBox(box: BoxItem): void {
    if (this.phase !== 'grid' || box.revealed) return;
    this.zoomTarget = box;
    this.phase = 'zoom';
    window.setTimeout(() => {
      box.revealed = true;
      this.revealedCount += 1;
      this.score += 10;
      this.phase = 'reveal';
    }, 480);
  }

  backToGrid(): void {
    this.zoomTarget = null;
    this.phase = 'grid';
    if (this.revealedCount >= this.boxes.length) {
      window.setTimeout(() => this.finish(), 500);
    }
  }

  tickTimer(): void {
    if (this.remainingSeconds <= 0) return;
    this.remainingSeconds -= 1;
    if (this.remainingSeconds <= 0 && this.phase !== 'done') {
      this.finish();
    }
  }

  finish(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.elapsedId) {
      clearInterval(this.elapsedId);
      this.elapsedId = null;
    }
    const timeSpentSeconds = Math.round((Date.now() - this.startedAt) / 1000);
    const total = this.boxes.length || 1;
    const accuracy = Math.round((this.revealedCount / total) * 100);
    const xpEarned = this.revealedCount * 3;
    window.setTimeout(() => {
      this.onComplete.emit({
        score: this.score,
        xpEarned,
        accuracy,
        timeSpentSeconds,
      });
    }, 1400);
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
