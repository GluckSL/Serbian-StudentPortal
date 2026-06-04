import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { GameAttempt, GameSet, SpinWheelQuestion } from '../../glueck-arena.types';

export interface SWResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
}

interface WheelSegment {
  id: string;
  phrase: string;
  color: string;
  colorDark: string;
}

/** Pointer sits on the left (9 o'clock); winning wedge center aligns here. */
const POINTER_DEG = 270;
const WHEEL_PALETTE: { base: string; dark: string }[] = [
  { base: '#ef4444', dark: '#b91c1c' },
  { base: '#f97316', dark: '#c2410c' },
  { base: '#22c55e', dark: '#15803d' },
  { base: '#a855f7', dark: '#7e22ce' },
  { base: '#3b82f6', dark: '#1d4ed8' },
  { base: '#14b8a6', dark: '#0f766e' },
  { base: '#ec4899', dark: '#be185d' },
  { base: '#eab308', dark: '#a16207' },
];

@Component({
  selector: 'app-spin-wheel',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  template: `
    <div class="sw">
      <div class="sw__board">
        <header class="sw__hud">
          <div class="sw__hud-item">
            <span class="sw__hud-icon sw__hud-icon--segments"><mat-icon>donut_large</mat-icon></span>
            <div>
              <span class="sw__hud-val">{{ activeCount }}</span>
              <span class="sw__hud-lbl">on wheel</span>
            </div>
          </div>
          <div class="sw__hud-item">
            <span class="sw__hud-icon sw__hud-icon--score"><mat-icon>star</mat-icon></span>
            <div>
              <span class="sw__hud-val">{{ score }}</span>
              <span class="sw__hud-lbl">score</span>
            </div>
          </div>
          <div class="sw__hud-item" *ngIf="totalSegments">
            <span class="sw__hud-icon sw__hud-icon--progress"><mat-icon>check_circle</mat-icon></span>
            <div>
              <span class="sw__hud-val">{{ eliminateCount }}/{{ totalSegments - 1 }}</span>
              <span class="sw__hud-lbl">eliminated</span>
            </div>
          </div>
          <div class="sw__hud-item" *ngIf="sessionLimitSeconds">
            <span class="sw__hud-icon sw__hud-icon--timer"><mat-icon>timer</mat-icon></span>
            <div>
              <span class="sw__hud-val" [class.sw__hud-val--warn]="remainingSeconds <= 10">{{ formatTime(remainingSeconds) }}</span>
              <span class="sw__hud-lbl">time left</span>
            </div>
          </div>
        </header>

        <div class="sw__play" *ngIf="phase !== 'done'">
          <div class="sw__arena">
            <div class="sw__pointer-slot" aria-hidden="true">
              <div class="sw__pointer">
                <svg viewBox="0 0 56 56" class="sw__pointer-svg">
                  <defs>
                    <linearGradient id="ptr-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#64748b"/>
                      <stop offset="100%" stop-color="#334155"/>
                    </linearGradient>
                  </defs>
                  <circle cx="28" cy="28" r="26" fill="#fff" stroke="#e2e8f0" stroke-width="2"/>
                  <path d="M38 28 L14 18 L14 38 Z" fill="url(#ptr-grad)"/>
                </svg>
              </div>
            </div>

            <div class="sw__wheel-outer" [class.sw__wheel-outer--spinning]="phase === 'spinning'">
              <div class="sw__wheel-ring"></div>
              <svg
                class="sw__wheel"
                [class.sw__wheel--spinning]="phase === 'spinning'"
                viewBox="0 0 400 400"
                [style.transform]="'rotate(' + rotationDeg + 'deg)'"
                role="img"
                [attr.aria-label]="'Spin wheel with ' + activeCount + ' options'"
              >
                <defs>
                  <filter id="sw-shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.25"/>
                  </filter>
                  <ng-container *ngFor="let seg of segments; let i = index">
                    <linearGradient [attr.id]="'sw-grad-' + i" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" [attr.stop-color]="seg.color"/>
                      <stop offset="100%" [attr.stop-color]="seg.colorDark"/>
                    </linearGradient>
                  </ng-container>
                </defs>
                <circle cx="200" cy="200" r="199" fill="#f8fafc"/>
                <g *ngFor="let seg of segments; let i = index">
                  <path
                    [attr.d]="segmentPath(i)"
                    [attr.fill]="'url(#sw-grad-' + i + ')'"
                    stroke="#fff"
                    stroke-width="3"
                    [class.sw__seg-path--selected]="isHighlighted(i)"
                    [attr.filter]="isHighlighted(i) ? 'url(#sw-shadow)' : null"
                  />
                  <text
                    [attr.transform]="segmentTextTransform(i)"
                    class="sw__seg-text"
                    text-anchor="middle"
                    dominant-baseline="middle"
                  >
                    {{ wheelLabel(seg.phrase, i) }}
                  </text>
                </g>
              </svg>
              <div class="sw__hub" [class.sw__hub--pulse]="phase === 'spinning'">
                <mat-icon class="sw__hub-icon">casino</mat-icon>
                <span class="sw__hub-text">{{ centerLabel }}</span>
              </div>
              <div class="sw__spin-overlay" *ngIf="phase === 'spinning'">
                <span class="sw__spin-overlay-text">Spinning…</span>
              </div>
            </div>
          </div>

          <div class="sw__result" *ngIf="phase === 'result' && selectedSegment">
            <span class="sw__result-chip" [style.background]="selectedSegment.color">Landed</span>
            <p class="sw__result-phrase">{{ selectedSegment.phrase }}</p>
            <p class="sw__result-hint">Keep this phrase on the wheel or remove it?</p>
          </div>

          <div class="sw__idle-hint" *ngIf="phase === 'idle' && activeCount > 1">
            <mat-icon>touch_app</mat-icon>
            <span>Tap <strong>Spin</strong> to pick a random phrase</span>
          </div>
        </div>

        <div class="sw__winner" *ngIf="phase === 'done'">
          <div class="sw__winner-glow"></div>
          <mat-icon>emoji_events</mat-icon>
          <h2>Great job!</h2>
          <p class="sw__winner-sub">Last phrase on the wheel</p>
          <p class="sw__winner-phrase" *ngIf="lastSegment">{{ lastSegment.phrase }}</p>
          <p class="sw__winner-score">Final score: <strong>{{ score }}</strong></p>
        </div>

        <footer class="sw__controls">
          <button
            *ngIf="phase === 'idle' && activeCount > 1"
            type="button"
            class="sw__btn sw__btn--spin"
            (click)="spin()"
          >
            <span class="sw__btn-row"><mat-icon>casino</mat-icon> Spin</span>
          </button>

          <ng-container *ngIf="phase === 'result'">
            <button type="button" class="sw__btn sw__btn--resume" (click)="resume()">
              <span class="sw__btn-row"><mat-icon>replay</mat-icon> Resume</span>
              <small>Keep on wheel</small>
            </button>
            <button type="button" class="sw__btn sw__btn--eliminate" (click)="eliminate()" [disabled]="activeCount <= 1">
              <span class="sw__btn-row"><mat-icon>close</mat-icon> Eliminate</span>
              <small>Remove phrase</small>
            </button>
          </ng-container>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    .sw {
      width: 100%;
      max-width: 640px;
      margin: 0 auto;
      padding: 0 8px 16px;
    }

    .sw__board {
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      border-radius: 20px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 8px 32px rgba(15, 23, 42, 0.08);
      overflow: hidden;
    }

    .sw__hud {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 8px;
      padding: 14px 16px;
      background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
    }
    .sw__hud-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(6px);
    }
    .sw__hud-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .sw__hud-icon mat-icon { font-size: 20px; width: 20px; height: 20px; color: #fff; }
    .sw__hud-icon--segments { background: rgba(99, 102, 241, 0.5); }
    .sw__hud-icon--score { background: rgba(245, 158, 11, 0.45); }
    .sw__hud-icon--progress { background: rgba(34, 197, 94, 0.45); }
    .sw__hud-icon--timer { background: rgba(239, 68, 68, 0.4); }
    .sw__hud-item > div { display: flex; flex-direction: column; min-width: 0; }
    .sw__hud-val {
      font-size: 17px;
      font-weight: 800;
      color: #fff;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }
    .sw__hud-val--warn { color: #fecaca; animation: sw-pulse 0.8s ease-in-out infinite; }
    .sw__hud-lbl {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: rgba(255, 255, 255, 0.65);
    }
    @keyframes sw-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    .sw__play { padding: 20px 16px 8px; }

    .sw__arena {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0;
      margin: 0 auto;
      max-width: 100%;
      position: relative;
    }

    .sw__pointer-slot {
      flex-shrink: 0;
      z-index: 4;
      margin-right: -12px;
      padding: 4px 0;
    }
    .sw__pointer {
      width: clamp(44px, 12vw, 56px);
      filter: drop-shadow(0 4px 12px rgba(15, 23, 42, 0.2));
    }
    .sw__pointer-svg { width: 100%; height: auto; display: block; }

    .sw__wheel-outer {
      position: relative;
      width: min(85vw, 380px);
      aspect-ratio: 1;
      flex: 1;
      max-width: 380px;
    }
    .sw__wheel-ring {
      position: absolute;
      inset: -6px;
      border-radius: 50%;
      background: linear-gradient(145deg, #e2e8f0, #94a3b8, #cbd5e1, #f1f5f9);
      box-shadow: 0 16px 48px rgba(15, 23, 42, 0.15);
      z-index: 0;
    }
    .sw__wheel {
      position: relative;
      z-index: 1;
      width: 100%;
      height: 100%;
      display: block;
      border-radius: 50%;
      transition: none;
      transform-origin: center center;
    }
    .sw__wheel--spinning {
      transition: transform 4s cubic-bezier(0.12, 0.84, 0.22, 1);
    }
    .sw__wheel-outer--spinning .sw__wheel-ring {
      animation: sw-ring-glow 1s ease-in-out infinite alternate;
    }
    @keyframes sw-ring-glow {
      from { box-shadow: 0 16px 48px rgba(37, 99, 235, 0.2); }
      to { box-shadow: 0 20px 56px rgba(37, 99, 235, 0.35); }
    }

    .sw__seg-path--selected {
      stroke: #fef08a !important;
      stroke-width: 5 !important;
    }
    .sw__seg-text {
      fill: #fff;
      font-size: 12px;
      font-weight: 800;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      pointer-events: none;
      paint-order: stroke fill;
      stroke: rgba(0, 0, 0, 0.35);
      stroke-width: 2px;
    }

    .sw__hub {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 30%;
      aspect-ratio: 1;
      max-width: 110px;
      border-radius: 50%;
      background: #fff;
      box-shadow:
        0 4px 24px rgba(0, 0, 0, 0.12),
        inset 0 0 0 4px #f1f5f9,
        inset 0 -4px 12px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 8px;
      z-index: 3;
      pointer-events: none;
      text-align: center;
    }
    .sw__hub--pulse { animation: sw-hub-pulse 0.6s ease-in-out infinite; }
    @keyframes sw-hub-pulse {
      0%, 100% { transform: translate(-50%, -50%) scale(1); }
      50% { transform: translate(-50%, -50%) scale(1.04); }
    }
    .sw__hub-icon {
      font-size: 22px !important;
      width: 22px !important;
      height: 22px !important;
      color: #6366f1;
    }
    .sw__hub-text {
      font-size: clamp(9px, 2.4vw, 11px);
      font-weight: 800;
      color: #0f172a;
      line-height: 1.2;
      max-width: 90%;
    }

    .sw__spin-overlay {
      position: absolute;
      inset: 0;
      z-index: 5;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.35);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
    .sw__spin-overlay-text {
      font-size: 15px;
      font-weight: 800;
      color: #1e3a5f;
      padding: 8px 16px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }

    .sw__result {
      margin-top: 20px;
      padding: 18px 20px;
      text-align: center;
      border-radius: 16px;
      background: linear-gradient(135deg, #faf5ff 0%, #eef2ff 100%);
      border: 2px solid #c4b5fd;
      box-shadow: 0 4px 20px rgba(99, 102, 241, 0.12);
      animation: sw-fade-in 0.35s ease;
    }
    @keyframes sw-fade-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .sw__result-chip {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #fff;
      margin-bottom: 10px;
    }
    .sw__result-phrase {
      margin: 0 0 8px;
      font-size: clamp(17px, 4.5vw, 22px);
      font-weight: 800;
      color: #0f172a;
      line-height: 1.45;
    }
    .sw__result-hint {
      margin: 0;
      font-size: 13px;
      color: #64748b;
      font-weight: 500;
    }

    .sw__idle-hint {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 16px;
      font-size: 13px;
      color: #64748b;
    }
    .sw__idle-hint mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: #94a3b8;
    }

    .sw__winner {
      position: relative;
      text-align: center;
      padding: 36px 24px 28px;
      overflow: hidden;
    }
    .sw__winner-glow {
      position: absolute;
      top: -40%;
      left: 50%;
      transform: translateX(-50%);
      width: 280px;
      height: 280px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(251, 191, 36, 0.25) 0%, transparent 70%);
      pointer-events: none;
    }
    .sw__winner mat-icon {
      position: relative;
      font-size: 56px;
      width: 56px;
      height: 56px;
      color: #f59e0b;
      margin-bottom: 8px;
    }
    .sw__winner h2 {
      position: relative;
      margin: 0 0 4px;
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
    }
    .sw__winner-sub {
      position: relative;
      margin: 0 0 12px;
      font-size: 13px;
      color: #64748b;
      font-weight: 600;
    }
    .sw__winner-phrase {
      position: relative;
      margin: 0 0 16px;
      font-size: 20px;
      font-weight: 700;
      color: #1e293b;
      line-height: 1.45;
      padding: 14px 18px;
      background: #fff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
    }
    .sw__winner-score {
      position: relative;
      margin: 0;
      font-size: 15px;
      color: #475569;
    }
    .sw__winner-score strong { color: #b45309; font-size: 18px; }

    .sw__controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: center;
      padding: 16px 16px 20px;
      border-top: 1px solid #f1f5f9;
      background: #fafafa;
    }
    .sw__btn {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      min-width: 130px;
      padding: 14px 20px 12px;
      border: none;
      border-radius: 14px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .sw__btn-row { display: flex; align-items: center; gap: 6px; }
    .sw__btn small {
      font-size: 10px;
      font-weight: 600;
      opacity: 0.85;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .sw__btn mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .sw__btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none !important; }
    .sw__btn:not(:disabled):hover { transform: translateY(-2px); }

    .sw__btn--spin {
      flex: 1;
      max-width: 280px;
      flex-direction: row;
      gap: 8px;
      padding: 16px 28px;
      color: #fff;
      background: linear-gradient(135deg, #4f46e5 0%, #2563eb 100%);
      box-shadow: 0 8px 24px rgba(79, 70, 229, 0.4);
      font-size: 17px;
    }
    .sw__btn--spin:hover:not(:disabled) {
      box-shadow: 0 12px 32px rgba(79, 70, 229, 0.5);
    }

    .sw__btn--resume {
      flex: 1;
      min-width: 140px;
      color: #334155;
      background: #fff;
      border: 2px solid #e2e8f0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }
    .sw__btn--resume:hover:not(:disabled) {
      border-color: #6366f1;
      color: #4f46e5;
    }

    .sw__btn--eliminate {
      flex: 1;
      min-width: 140px;
      color: #fff;
      background: linear-gradient(135deg, #dc2626, #ef4444);
      box-shadow: 0 6px 20px rgba(239, 68, 68, 0.35);
    }

    @media (max-width: 520px) {
      .sw__hud { grid-template-columns: repeat(2, 1fr); }
      .sw__pointer-slot { margin-right: -8px; }
      .sw__wheel-outer { width: min(78vw, 320px); }
      .sw__seg-text { font-size: 10px; }
      .sw__controls { flex-direction: column; }
      .sw__btn { width: 100%; max-width: none; flex-direction: row; justify-content: center; }
      .sw__btn small { display: none; }
      .sw__btn--spin { max-width: none; }
    }

    @media (min-width: 521px) and (max-width: 720px) {
      .sw { max-width: 100%; }
    }
  `],
})
export class SpinWheelComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() gameSet!: GameSet;
  @Input() questions: SpinWheelQuestion[] = [];
  @Output() onComplete = new EventEmitter<SWResult>();

  segments: WheelSegment[] = [];
  phase: 'idle' | 'spinning' | 'result' | 'done' = 'idle';
  rotationDeg = 0;
  selectedSegment: WheelSegment | null = null;
  selectedIndex: number | null = null;
  lastSegment: WheelSegment | null = null;
  score = 0;
  spinCount = 0;
  eliminateCount = 0;
  totalSegments = 0;
  startedAt = Date.now();
  sessionLimitSeconds: number | null = null;
  remainingSeconds = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private spinEndTimer: ReturnType<typeof setTimeout> | null = null;

  get centerLabel(): string {
    return this.gameSet.spinWheelSettings?.centerLabel?.trim() || 'ergänze den Satz!';
  }

  get activeCount(): number {
    return this.segments.length;
  }

  ngOnInit(): void {
    this.initSegments();
    this.totalSegments = this.segments.length;
    this.sessionLimitSeconds = this.gameSet.timerSettings?.sessionLimitSeconds ?? null;
    if (this.sessionLimitSeconds) {
      this.remainingSeconds = this.sessionLimitSeconds;
      this.timerId = setInterval(() => {
        this.remainingSeconds = Math.max(0, this.remainingSeconds - 1);
        if (this.remainingSeconds <= 0) this.finishGame();
      }, 1000);
    }
    if (this.segments.length <= 1) {
      this.phase = 'done';
      this.lastSegment = this.segments[0] ?? null;
    }
  }

  ngOnDestroy(): void {
    if (this.timerId) clearInterval(this.timerId);
    if (this.spinEndTimer) clearTimeout(this.spinEndTimer);
  }

  private initSegments(): void {
    this.segments = this.questions.map((q, i) => {
      const pal = WHEEL_PALETTE[i % WHEEL_PALETTE.length];
      return {
        id: q._id,
        phrase: (q.phrase || '').trim(),
        color: pal.base,
        colorDark: pal.dark,
      };
    }).filter(s => s.phrase);
  }

  isHighlighted(index: number): boolean {
    return this.phase === 'result' && this.selectedIndex === index;
  }

  wheelLabel(phrase: string, index: number): string {
    const n = this.segments.length;
    const max = n <= 4 ? 22 : n <= 6 ? 16 : n <= 10 ? 12 : 9;
    if (phrase.length <= max) return phrase;
    return phrase.slice(0, max - 1) + '…';
  }

  segmentPath(index: number): string {
    const n = this.segments.length;
    if (!n) return '';
    const cx = 200;
    const cy = 200;
    const r = 196;
    const seg = 360 / n;
    const start = index * seg;
    const end = start + seg;
    return this.describeWedge(cx, cy, r, start, end);
  }

  segmentTextTransform(index: number): string {
    const n = this.segments.length;
    const seg = 360 / n;
    const mid = index * seg + seg / 2;
    const rad = ((mid - 90) * Math.PI) / 180;
    const dist = n <= 4 ? 128 : n <= 6 ? 120 : n <= 10 ? 110 : 100;
    const x = 200 + dist * Math.cos(rad);
    const y = 200 + dist * Math.sin(rad);
    const flip = mid > 90 && mid < 270;
    const rotate = flip ? mid + 180 : mid;
    return `translate(${x}, ${y}) rotate(${rotate})`;
  }

  spin(): void {
    if (this.phase !== 'idle' || this.segments.length < 2) return;
    const n = this.segments.length;
    const segAngle = 360 / n;
    const targetIndex = Math.floor(Math.random() * n);
    const extraSpins = 5 + Math.floor(Math.random() * 3);
    const targetCenter = (targetIndex + 0.5) * segAngle;
    const currentMod = ((this.rotationDeg % 360) + 360) % 360;
    let delta = POINTER_DEG - targetCenter - currentMod;
    delta = ((delta % 360) + 360) % 360;
    const nextRotation = this.rotationDeg + extraSpins * 360 + delta;

    this.spinCount += 1;
    this.selectedIndex = null;
    this.selectedSegment = null;
    this.phase = 'spinning';

    if (this.spinEndTimer) clearTimeout(this.spinEndTimer);
    // Enable transition first, then apply rotation on next frame so only Spin animates.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.rotationDeg = nextRotation;
        this.spinEndTimer = setTimeout(() => {
          this.selectedSegment = this.segments[targetIndex];
          this.selectedIndex = targetIndex;
          this.phase = 'result';
        }, 4100);
      });
    });
  }

  resume(): void {
    this.selectedSegment = null;
    this.selectedIndex = null;
    this.phase = 'idle';
  }

  eliminate(): void {
    if (!this.selectedSegment || this.phase !== 'result') return;
    const idx = this.segments.findIndex(s => s.id === this.selectedSegment!.id);
    if (idx < 0) return;
    this.segments.splice(idx, 1);
    this.eliminateCount += 1;
    this.score += 100;
    this.selectedSegment = null;
    this.selectedIndex = null;
    this.phase = 'idle';

    if (this.segments.length <= 1) {
      this.lastSegment = this.segments[0] ?? null;
      this.score += 250;
      this.finishGame();
    }
  }

  private finishGame(): void {
    this.phase = 'done';
    const total = this.questions.length;
    const accuracy = total
      ? Math.round((this.eliminateCount / Math.max(this.spinCount, 1)) * 100)
      : 100;
    const timeSpentSeconds = Math.round((Date.now() - this.startedAt) / 1000);
    this.onComplete.emit({
      score: this.score,
      xpEarned: 0,
      accuracy: Math.min(100, accuracy),
      timeSpentSeconds,
    });
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private describeWedge(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
    const start = this.polar(cx, cy, r, endAngle);
    const end = this.polar(cx, cy, r, startAngle);
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y} Z`;
  }

  private polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }
}
