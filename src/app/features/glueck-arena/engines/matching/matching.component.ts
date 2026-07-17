import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { forkJoin } from 'rxjs';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { GameAudioService } from '../../services/game-audio.service';
import { MatchingQuestion, GameAttempt } from '../../glueck-arena.types';

export interface MatchResult {
  score: number;
  accuracy: number;
  timeSpentSeconds: number;
  correctCount: number;
  totalPairs: number;
}

interface MatchPair {
  questionId: string;
  left: string;
  right: string;
  selectedRight: string | null;
  isCorrect: boolean | null;
}

@Component({
  selector: 'app-matching',
  standalone: true,
  imports: [CommonModule, MaterialModule, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="mc">
      <header class="mc__hud">
        <div class="mc__score">{{ score }}</div>
        <div class="mc__timer">{{ formatTime(elapsed) }}</div>
      </header>

      <div class="mc__board" *ngIf="phase === 'playing'">
        <p class="mc__instruction">Match each item on the left with the correct item on the right</p>

        <div class="mc__pairs" *ngFor="let pair of pairs; let i = index">
          <div class="mc__left">{{ pair.left }}</div>
          <div class="mc__arrow">
            <mat-icon *ngIf="pair.isCorrect === null">arrow_forward</mat-icon>
            <mat-icon *ngIf="pair.isCorrect === true" style="color:#22c55e">check_circle</mat-icon>
            <mat-icon *ngIf="pair.isCorrect === false" style="color:#ef4444">cancel</mat-icon>
          </div>
          <select class="mc__select"
            [value]="pair.selectedRight || ''"
            (change)="selectMatch(i, $event)"
            [disabled]="pair.isCorrect !== null">
            <option value="" disabled>Choose translation</option>
            <option *ngFor="let opt of rightOptions" [value]="opt">{{ opt }}</option>
          </select>

        </div>

        <div class="mc__actions">
          <button mat-raised-button color="primary" (click)="checkAll()"
            [disabled]="!allSelected || phase !== 'playing' || checked">
            <mat-icon>check</mat-icon> Check All
          </button>
          <button mat-raised-button color="accent" class="mc__continue-btn"
            *ngIf="checked" (click)="finish()">
            <mat-icon>arrow_forward</mat-icon> Continue
          </button>
        </div>
      </div>

      <div class="mc__complete" *ngIf="phase === 'complete'">
        <mat-icon class="mc__complete-icon">emoji_events</mat-icon>
        <h3>Matching Complete!</h3>
        <div class="mc__stats">
          <div class="mc__stat">
            <span class="mc__stat-val">{{ score }}</span>
            <span class="mc__stat-lbl">Rezultat</span>
          </div>
          <div class="mc__stat">
            <span class="mc__stat-val">{{ accuracy }}%</span>
            <span class="mc__stat-lbl">Accuracy</span>
          </div>
          <div class="mc__stat">
            <span class="mc__stat-val">{{ correctCount }}/{{ totalPairs }}</span>
            <span class="mc__stat-lbl">Matched</span>
          </div>
        </div>
      </div>

      <app-xp-float [xp]="xpBurst" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .mc { position: relative; max-width: 600px; margin: 0 auto; }
    .mc__hud { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #fff; border-radius: 16px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
    .mc__score { font-size: 24px; font-weight: 800; color: #f59e0b; }
    .mc__timer { font-size: 14px; font-weight: 700; color: #64748b; background: #f1f5f9; padding: 6px 14px; border-radius: 999px; }
    .mc__board { background: #fff; border-radius: 20px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
    .mc__instruction { text-align: center; color: #64748b; font-size: 14px; margin-bottom: 20px; }
    .mc__pairs { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    .mc__left { flex: 1; min-width: 100px; padding: 12px 16px; background: #e8edf5; border-radius: 10px; font-weight: 700; color: #405980; text-align: center; }
    .mc__arrow { color: #94a3b8; display: flex; align-items: center; }
    .mc__select { flex: 1; min-width: 120px; padding: 10px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 14px; font-weight: 600; background: #fff; }
    .mc__select:focus { border-color: #405980; }
    .mc__actions { text-align: center; margin-top: 20px; }
    .mc__continue-btn { margin-left: 12px; }
    .mc__complete { text-align: center; padding: 40px 24px; }
    .mc__complete-icon { font-size: 72px; width: 72px; height: 72px; color: #ff8f00; }
    .mc__complete h3 { font-size: 24px; color: #1e293b; margin: 16px 0; }
    .mc__stats { display: flex; gap: 32px; justify-content: center; }
    .mc__stat { display: flex; flex-direction: column; align-items: center; }
    .mc__stat-val { font-size: 28px; font-weight: 800; color: #405980; }
    .mc__stat-lbl { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
  `]
})
export class MatchingComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() questions: MatchingQuestion[] = [];
  @Input() shuffledRightOptions: string[] = [];
  @Output() onComplete = new EventEmitter<MatchResult>();

  phase: 'playing' | 'complete' = 'playing';
  checked = false;
  pairs: MatchPair[] = [];
  rightOptions: string[] = [];
  score = 0;
  correctCount = 0;
  elapsed = 0;
  xpBurst = 0;
  xpTrigger = 0;
  showConfetti = false;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private startedAt = Date.now();

  get totalPairs() { return this.pairs.length; }
  get allSelected() { return this.pairs.length > 0 && this.pairs.every(p => p.selectedRight !== null); }
  get accuracy(): number {
    return this.totalPairs > 0 ? Math.round((this.correctCount / this.totalPairs) * 100) : 0;
  }

  constructor(
    private svc: InteractiveGameService,
    readonly audio: GameAudioService,
  ) {}

  ngOnInit() {
    this.audio.loadMutePreference();
    this.startedAt = Date.now();
    this.buildPairs();
    this.startTimer();
  }

  ngOnDestroy() {
    if (this.timerHandle) clearInterval(this.timerHandle);
  }

  buildPairs() {
    const pool = [...this.questions];
    this.pairs = pool.map(q => ({
      questionId: q._id,
      left: q.word,
      right: (q as any).hint || q.translation,
      selectedRight: null,
      isCorrect: null,
    }));
    const allOptions = this.shuffledRightOptions.length
      ? [...this.shuffledRightOptions]
      : pool.map(q => (q as any).hint || q.translation);
    this.rightOptions = this.shuffle([...new Set(allOptions)]);
  }

  selectMatch(index: number, event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    if (index >= 0 && index < this.pairs.length) {
      this.pairs[index].selectedRight = val;
    }
  }

  checkAll() {
    if (!this.allSelected || this.phase !== 'playing') return;
    let correct = 0;
    for (const pair of this.pairs) {
      pair.isCorrect = pair.selectedRight?.trim().toLowerCase() === pair.right?.trim().toLowerCase();
      if (pair.isCorrect) correct++;
    }
    this.correctCount = correct;
    this.score = correct * 10;
    this.xpBurst = correct * 10;
    if (this.xpBurst > 0) this.xpTrigger++;
    this.audio.playXpGain();
    if (correct === this.pairs.length) {
      this.audio.playCorrect();
      this.showConfetti = true;
    } else {
      this.audio.playWrong();
    }
    this.checked = true;
  }

  finish() {
    this.phase = 'complete';
    if (this.timerHandle) clearInterval(this.timerHandle);
    this.onComplete.emit({
      score: this.score,
      accuracy: this.accuracy,
      timeSpentSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      correctCount: this.correctCount,
      totalPairs: this.totalPairs,
    });
  }

  startTimer() {
    this.timerHandle = setInterval(() => {
      this.elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    }, 1000);
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  }

  private shuffle<T>(arr: T[]): T[] {
    const r = [...arr];
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  }
}
