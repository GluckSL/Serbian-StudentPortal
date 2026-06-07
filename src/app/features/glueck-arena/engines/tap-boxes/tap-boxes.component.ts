import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy, AfterViewInit,
  ElementRef, ViewChild, ChangeDetectorRef,
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
        <div class="tb__wall" aria-hidden="true"></div>

        <div
          class="tb__board"
          [class.tb__board--custom-bg]="!!boardBackgroundUrl"
          [ngStyle]="boardBackgroundStyle"
        >
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
          <div class="tb__grid-panel" #gridPanel *ngIf="phase !== 'done'" [ngStyle]="gridPanelStyle">
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
                  [class.tb__tile--hover]="hoverId === box.id && phase === 'grid' && !box.revealed"
                  [disabled]="box.revealed || phase === 'zoom' || phase === 'reveal'"
                  (click)="openBox(box)"
                  (mouseenter)="hoverId = box.id"
                  (mouseleave)="hoverId = null"
                  [attr.aria-label]="box.revealed ? 'Opened: ' + box.phrase : 'Open box ' + box.number"
                >
                  <!-- Closed: Wordwall-style pill + peel sticker -->
                  <ng-container *ngIf="!box.revealed">
                    <span
                      class="tb__pill-tile"
                      [style.--pill-rim]="box.theme.rim"
                      [style.--pill-light]="box.theme.fillLight"
                      [style.--pill-deep]="box.theme.rimDark"
                    >
                      <span class="tb__pill-frame" aria-hidden="true">
                        <span class="tb__pill-bevel"></span>
                        <span class="tb__pill-gloss"></span>
                      </span>
                      <span
                        class="tb__sticker"
                        [class.tb__sticker--peel]="hoverId === box.id && phase === 'grid'"
                      >
                        <span class="tb__num">{{ box.number }}</span>
                        <span class="tb__corner" aria-hidden="true">
                          <span class="tb__corner-under"></span>
                          <span class="tb__corner-flap"></span>
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
      max-width: 100%;
      margin: 0 auto;
    }

    .tb__stage {
      position: relative;
      border-radius: 12px;
      overflow: hidden;
      min-height: min(72vh, 640px);
      box-shadow:
        0 0 0 1px rgba(30, 58, 95, 0.1),
        0 16px 40px rgba(30, 58, 95, 0.14);
    }

    .tb__wall {
      position: absolute;
      inset: 0;
      background: linear-gradient(165deg, #eef4fb 0%, #e2ecf6 45%, #d8e6f2 100%);
    }

    /* Full-height chalkboard — no desk strip */
    .tb__board {
      position: absolute;
      inset: 14px;
      z-index: 1;
      display: flex;
      flex-direction: column;
      border-radius: 10px;
      border: 12px solid #4a5568;
      outline: 2px solid #2d3748;
      background-color: #264035;
      background-repeat: no-repeat;
      background-position: center;
      background-size: cover;
      background-image:
        radial-gradient(ellipse 90% 60% at 50% 15%, rgba(255,255,255,0.06) 0%, transparent 50%),
        linear-gradient(168deg, #3d5c4f 0%, #2f4a40 40%, #264035 100%);
      box-shadow:
        inset 0 4px 20px rgba(0, 0, 0, 0.35),
        0 8px 24px rgba(30, 58, 95, 0.2);
    }
    .tb__board--custom-bg {
      background-image:
        linear-gradient(180deg, rgba(0, 0, 0, 0.12) 0%, rgba(0, 0, 0, 0.28) 100%),
        var(--tb-board-photo, none);
    }

    .tb__hud {
      flex-shrink: 0;
      display: grid;
      grid-template-columns: 88px 1fr 88px;
      align-items: center;
      padding: 16px 20px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      pointer-events: none;
    }
    .tb__timer-val {
      font-size: 24px;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: 0.03em;
      font-variant-numeric: tabular-nums;
    }
    .tb__timer-val--warn { color: #fca5a5; }
    .tb__instruction {
      margin: 0;
      text-align: center;
      font-size: 19px;
      font-weight: 600;
      color: rgba(248, 250, 252, 0.92);
      letter-spacing: 0.02em;
    }
    .tb__hud-right { text-align: right; }
    .tb__score {
      font-size: 15px;
      font-weight: 800;
      color: #fef3c7;
      background: rgba(15, 23, 42, 0.35);
      padding: 5px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }

    .tb__play {
      position: relative;
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px clamp(8px, 2vw, 20px) 16px;
      overflow-x: auto;
      overflow-y: hidden;
    }
    .tb__play--focus .tb__grid-panel {
      filter: blur(3px) brightness(0.75);
      opacity: 0.45;
      pointer-events: none;
      transition: filter 0.4s ease, opacity 0.4s ease;
    }

    .tb__grid-panel {
      width: 100%;
      max-width: 100%;
      padding: 4px 0;
      box-sizing: border-box;
      --tb-gap: 14px;
      --tb-tile: 112px;
      transition: filter 0.4s ease, opacity 0.4s ease;
    }
    .tb__grid {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: clamp(10px, 2.2vw, 22px);
      width: 100%;
      max-width: 100%;
    }
    .tb__row {
      display: flex;
      flex-wrap: nowrap;
      justify-content: center;
      align-items: center;
      gap: var(--tb-gap);
      max-width: 100%;
    }
    .tb__row--stagger {
      padding-left: calc(var(--tb-tile) * 0.5 + 6px);
      box-sizing: border-box;
    }

    /* ── Tile button ───────────────────────────────────── */
    .tb__tile {
      position: relative;
      width: var(--tb-tile);
      height: var(--tb-tile);
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
      flex: 0 0 var(--tb-tile);
      -webkit-tap-highlight-color: transparent;
      transition: transform 0.22s cubic-bezier(0.34, 1.25, 0.64, 1), opacity 0.3s ease, filter 0.3s ease;
    }
    .tb__tile:disabled:not(.tb__tile--open) { cursor: default; }
    .tb__tile--hover:not(:disabled) {
      z-index: 3;
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

    /* ── Wordwall pill tile (closed) ───────────────────── */
    .tb__pill-tile {
      --pill-stroke: #1a1a2e;
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 22%;
      border: 4px solid var(--pill-stroke);
      background: var(--pill-rim, #facc15);
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.18);
      transition: transform 0.25s cubic-bezier(0.34, 1.2, 0.64, 1), box-shadow 0.25s ease;
    }
    .tb__tile--hover .tb__pill-tile {
      transform: translateY(-3px) scale(1.03);
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
    }

    .tb__pill-frame {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      pointer-events: none;
      overflow: hidden;
    }
    .tb__pill-bevel {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background:
        linear-gradient(145deg, var(--pill-light, #fde68a) 0%, transparent 42%),
        linear-gradient(320deg, rgba(255,255,255,0.35) 0%, transparent 38%),
        radial-gradient(ellipse 70% 55% at 18% 88%, rgba(255,255,255,0.45) 0%, transparent 55%);
    }
    .tb__pill-gloss::before,
    .tb__pill-gloss::after {
      content: '';
      position: absolute;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.55);
      filter: blur(0.5px);
    }
    .tb__pill-gloss::before {
      width: 14%;
      height: 10%;
      right: 8%;
      bottom: 10%;
    }
    .tb__pill-gloss::after {
      width: 8%;
      height: 6%;
      right: 18%;
      bottom: 6%;
      opacity: 0.75;
    }

    .tb__sticker {
      position: absolute;
      top: 9%;
      left: 9%;
      right: 9%;
      bottom: 9%;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 16%;
      background: #ffffff;
      border: 3px solid var(--pill-stroke);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
      overflow: hidden;
      transition: overflow 0.2s ease;
    }
    .tb__sticker--peel {
      overflow: visible;
    }

    .tb__num {
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: calc(var(--tb-tile) * 0.42);
      font-weight: 700;
      color: #0a0a0a;
      line-height: 1;
      user-select: none;
      z-index: 1;
      letter-spacing: -0.02em;
    }

    /* Corner peel: small fold at rest → big curl on hover */
    .tb__corner {
      position: absolute;
      right: -1px;
      bottom: -1px;
      width: 42%;
      height: 42%;
      z-index: 4;
      pointer-events: none;
      transform-origin: 100% 100%;
      transition: transform 0.32s cubic-bezier(0.34, 1.35, 0.64, 1);
    }
    .tb__corner-under {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(140deg, #b8b0a8 0%, #8b8278 45%, #6d6560 100%);
      clip-path: polygon(100% 0, 0 100%, 100% 100%);
      border-radius: 0 0 4px 0;
    }
    .tb__corner-flap {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(160deg, #ffffff 0%, #f8fafc 55%, #e8ecf0 100%);
      border-left: 2px solid rgba(26, 26, 46, 0.15);
      border-top: 2px solid rgba(26, 26, 46, 0.08);
      clip-path: polygon(100% 0, 12% 88%, 100% 100%);
      box-shadow: -3px -3px 6px rgba(0, 0, 0, 0.12);
      transform-origin: 100% 100%;
      transition: transform 0.32s cubic-bezier(0.34, 1.35, 0.64, 1);
    }

    /* Rest: subtle dog-ear (first screenshot) */
    .tb__corner {
      transform: scale(0.52);
    }
    .tb__corner-flap {
      transform: rotate(-6deg) translate(1px, 1px);
    }

    /* Hover: full page curl (second screenshot) */
    .tb__sticker--peel .tb__corner {
      transform: scale(1.05);
    }
    .tb__sticker--peel .tb__corner-flap {
      transform: rotate(-38deg) translate(-6%, -8%) scale(1.08);
      box-shadow: -6px -8px 14px rgba(0, 0, 0, 0.18);
    }

    /* Open: soft 3D cushion tile */
    .tb__shell {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: 22%;
      padding: 5px;
      background: #1a1a2e;
      border: 4px solid #1a1a2e;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.18);
    }
    .tb__shell--open {
      padding: 5px;
      border-radius: 22%;
    }
    .tb__pillow {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      border-radius: 12px;
      padding: 10px 8px;
      box-shadow:
        inset 0 4px 14px rgba(255,255,255,0.5),
        inset 0 -6px 14px rgba(0,0,0,0.14),
        0 2px 0 rgba(255,255,255,0.2);
    }
    .tb__pillow::before {
      content: '';
      position: absolute;
      inset: 4px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.35);
      pointer-events: none;
    }
    .tb__pillow-shine {
      position: absolute;
      left: 10%;
      right: 10%;
      height: 8px;
      border-radius: 50%;
      background: rgba(255,255,255,0.6);
      pointer-events: none;
    }
    .tb__pillow-shine--top { top: 8px; }
    .tb__pillow-shine--bot {
      bottom: 8px;
      opacity: 0.4;
      background: rgba(0,0,0,0.1);
      height: 5px;
    }
    .tb__open-label {
      position: relative;
      z-index: 1;
      font-size: calc(var(--tb-tile) * 0.105);
      font-weight: 700;
      line-height: 1.3;
      color: #0f172a;
      text-align: center;
      display: -webkit-box;
      -webkit-line-clamp: 5;
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
      width: min(92%, 480px);
      min-height: 220px;
      padding: 40px 36px;
      border-radius: 22px;
      border: 7px solid #1a2744;
      box-shadow:
        inset 0 6px 20px rgba(255,255,255,0.45),
        inset 0 -8px 18px rgba(0,0,0,0.12),
        0 1px 0 rgba(255,255,255,0.35),
        0 14px 0 #0c1222,
        0 28px 52px rgba(0, 0, 0, 0.38);
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
      padding: 0;
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
    .tb__focus-close mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
      line-height: 1;
    }

    /* ── Done & footer ─────────────────────────────────── */
    .tb__done {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 48px 24px;
      color: #f8fafc;
    }
    .tb__done mat-icon {
      font-size: 56px;
      width: 56px;
      height: 56px;
      color: #f59e0b;
    }
    .tb__done h2 { margin: 8px 0; font-size: 26px; color: #fff; }
    .tb__done p { color: rgba(248, 250, 252, 0.85); font-size: 17px; }
    .tb__done strong { color: #fde68a; font-size: 20px; }
    .tb__done mat-icon { color: #fde68a !important; }

    .tb__bar {
      flex-shrink: 0;
      display: flex;
      justify-content: center;
      padding: 0 16px 16px;
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

    @media (max-width: 900px) {
      .tb__stage { min-height: 520px; }
      .tb__board { inset: 10px; border-width: 10px; }
    }
    @media (max-width: 720px) {
      .tb__instruction { font-size: 16px; }
      .tb__hud { grid-template-columns: 72px 1fr 56px; padding: 12px 10px 10px; }
      .tb__timer-val { font-size: 20px; }
      .tb__board { inset: 8px; border-width: 8px; }
    }
    @media (max-width: 480px) {
      .tb__stage { min-height: 460px; }
      .tb__board { inset: 6px; border-width: 6px; }
      .tb__hud { padding: 10px 8px 8px; }
    }
    @media (min-width: 1100px) {
      .tb__stage { min-height: 660px; }
    }
  `],
})
export class TapBoxesComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() gameSet!: GameSet;
  @Input() questions: TapBoxesQuestion[] = [];
  @Output() onComplete = new EventEmitter<TBResult>();
  @ViewChild('gridPanel') gridPanel?: ElementRef<HTMLElement>;

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
  tileSizePx = 112;
  gapPx = 14;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private elapsedId: ReturnType<typeof setInterval> | null = null;
  private gridResizeObserver: ResizeObserver | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  get boardBackgroundUrl(): string | null {
    const url = this.gameSet?.tapBoxesSettings?.backgroundUrl;
    return url && String(url).trim() ? String(url).trim() : null;
  }

  get boardBackgroundStyle(): Record<string, string> | null {
    const url = this.boardBackgroundUrl;
    if (!url) return null;
    return { '--tb-board-photo': `url("${url.replace(/"/g, '%22')}")` };
  }

  get hudHint(): string {
    if (this.phase === 'reveal') return 'Tap one to open';
    if (this.revealedCount > 0 && this.revealedCount < this.boxes.length) {
      return 'Tap one to open';
    }
    return 'Tap one to open';
  }

  get gridPanelStyle(): Record<string, string> {
    return {
      '--tb-tile': `${this.tileSizePx}px`,
      '--tb-gap': `${this.gapPx}px`,
    };
  }

  ngAfterViewInit(): void {
    this.attachGridObserver();
  }

  ngOnDestroy(): void {
    if (this.timerId) clearInterval(this.timerId);
    if (this.elapsedId) clearInterval(this.elapsedId);
    this.detachGridObserver();
  }

  private attachGridObserver(): void {
    this.detachGridObserver();
    const el = this.gridPanel?.nativeElement;
    if (!el) return;
    this.gridResizeObserver = new ResizeObserver(() => {
      this.updateTileSize(el);
    });
    this.gridResizeObserver.observe(el);
    this.updateTileSize(el);
  }

  private detachGridObserver(): void {
    if (this.gridResizeObserver) {
      this.gridResizeObserver.disconnect();
      this.gridResizeObserver = null;
    }
  }

  private updateTileSize(container: HTMLElement): void {
    const width = container.clientWidth;
    if (!width) return;

    const maxCount = Math.max(1, ...this.rows.map(r => r.length));
    const hasStagger = this.rows.length > 1;
    const gap = width < 420 ? 8 : width < 640 ? 10 : width < 900 ? 12 : 16;
    const staggerPad = hasStagger ? 6 : 0;
    const divisor = maxCount + (hasStagger ? 0.5 : 0);
    const usable = width - (maxCount - 1) * gap - staggerPad;
    const nextTile = Math.min(136, Math.max(72, Math.floor(usable / divisor)));

    if (nextTile !== this.tileSizePx || gap !== this.gapPx) {
      this.tileSizePx = nextTile;
      this.gapPx = gap;
      this.cdr.markForCheck();
    }
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

  buildRows(): void {
    const sizes = layoutRowSizes(this.boxes.length);
    this.rows = [];
    let idx = 0;
    for (const size of sizes) {
      this.rows.push(this.boxes.slice(idx, idx + size));
      idx += size;
    }
    queueMicrotask(() => {
      const el = this.gridPanel?.nativeElement;
      if (el) this.updateTileSize(el);
    });
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
