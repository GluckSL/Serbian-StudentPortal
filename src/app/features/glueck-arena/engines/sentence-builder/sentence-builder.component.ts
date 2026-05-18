import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule, CdkDragDrop, transferArrayItem } from '@angular/cdk/drag-drop';
import { MaterialModule } from '../../../../shared/material.module';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { GameAudioService } from '../../services/game-audio.service';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { SentenceQuestion, GameAttempt, GameSet } from '../../glueck-arena.types';

export interface SBResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
}

@Component({
  selector: 'app-sentence-builder',
  standalone: true,
  imports: [CommonModule, DragDropModule, MaterialModule, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="sb-layout">
      <main class="sb-play">
        <header class="sb-play__top">
          <div class="sb-play__score">
            <mat-icon>star</mat-icon>
            <span>{{ score }}</span>
          </div>
          <div class="sb-play__progress">Question {{ currentIndex + 1 }} / {{ questions.length }}</div>
          <div class="sb-play__timer">
            <mat-icon>timer</mat-icon>
            <span>{{ formatElapsed(sessionElapsedSeconds) }}</span>
          </div>
          <button mat-icon-button type="button" (click)="onPause()" aria-label="Pause"><mat-icon>pause</mat-icon></button>
        </header>

        <div class="sb-board" *ngIf="currentQ && phase === 'playing'">
          <div class="sb-board__prompt">
            <div class="sb-board__prompt-row">
              <mat-icon>translate</mat-icon>
              <p>{{ currentQ.translation || 'Put the words in the correct order' }}</p>
              <button *ngIf="currentQ.sentenceAudioUrl" mat-icon-button type="button"
                (click)="audio.unlock(); audio.playUrl(currentQ.sentenceAudioUrl!)">
                <mat-icon>volume_up</mat-icon>
              </button>
            </div>
            <p class="sb-hint">
              Drag a word to begin — right spot turns <span class="sb-hint__green">green</span> instantly, wrong spot <span class="sb-hint__red">red</span>.
            </p>
            <div class="sb-progress-chips">
              <span class="sb-progress-chips__label">{{ lockedCount }} / {{ slotCount }} locked</span>
            </div>
          </div>

          <div class="sb-row-wrap" [class.sb-row-wrap--complete]="allLocked">
            <div class="sb-row">
              <div
                *ngFor="let i of slotIndices"
                class="sb-pos"
                [class.sb-pos--locked]="slotLocked[i]"
                cdkDropList
                [id]="slotId(i)"
                [cdkDropListData]="positionSlots[i]"
                [cdkDropListConnectedTo]="dropListIds"
                [cdkDropListDisabled]="slotLocked[i] || allLocked"
                (cdkDropListDropped)="onSlotDrop($event, i)">
                <div
                  *ngIf="positionSlots[i].length"
                  class="sb-word"
                  cdkDrag
                  [cdkDragDisabled]="slotLocked[i] || allLocked">
                  <span
                    class="sb-word__pill"
                    [class.sb-word__pill--locked]="slotLocked[i]"
                    [class.sb-word__pill--wrong]="wrongFlash[i]">
                    <span class="sb-word__pos">{{ i + 1 }}</span>
                    {{ positionSlots[i][0] }}
                    <mat-icon class="sb-word__tick" *ngIf="slotLocked[i]">check_circle</mat-icon>
                  </span>
                </div>
              </div>
            </div>
            <div class="sb-row__blast" *ngIf="allLocked" aria-hidden="true"></div>
          </div>

          <p class="sb-flash sb-flash--wrong" *ngIf="lastWrongHint">{{ lastWrongHint }}</p>

        </div>

        <div class="sb-complete" *ngIf="phase === 'complete'">
          <mat-icon>emoji_events</mat-icon>
          <h2>Session complete</h2>
          <p>Score <strong>{{ score }}</strong> · Time <strong>{{ formatElapsed(sessionElapsedSeconds) }}</strong> · Accuracy <strong>{{ accuracy }}%</strong></p>
          <button mat-raised-button color="primary" (click)="onComplete.emit(buildResult())">Collect XP</button>
        </div>
      </main>

      <aside class="sb-panel" *ngIf="gameSet">
        <div class="sb-panel__game">
          <div class="sb-panel__icon" [style.background]="typeGradient">
            <mat-icon>{{ gameSet.icon || 'sports_esports' }}</mat-icon>
          </div>
          <h2>{{ gameSet.title }}</h2>
          <p class="sb-panel__type">Sentence Builder</p>
        </div>

        <div class="sb-panel__timer-card">
          <mat-icon>timer</mat-icon>
          <div>
            <span class="sb-panel__timer-val">{{ formatElapsed(sessionElapsedSeconds) }}</span>
            <span class="sb-panel__timer-lbl">elapsed</span>
          </div>
          <small>Timer runs until you finish all sentences</small>
        </div>

        <section class="sb-panel__block">
          <h3><mat-icon>info</mat-icon> How it works</h3>
          <ol>
            <li>Each numbered spot is a fixed position in the sentence.</li>
            <li>Drag a word into a spot — if it belongs there, it turns green and locks.</li>
            <li>Wrong spot? The word shakes red — try a different position.</li>
            <li>Lock every word in each sentence, then move to the next.</li>
          </ol>
        </section>

        <section class="sb-panel__block sb-panel__block--score">
          <h3><mat-icon>leaderboard</mat-icon> Scoring</h3>
          <ul>
            <li><strong>+10 pts</strong> per correct word position</li>
            <li>Fastest total time ranks higher on the leaderboard</li>
          </ul>
        </section>
      </aside>

      <app-xp-float [xp]="xpPerAnswer" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .sb-layout {
      display: grid;
      grid-template-columns: 1fr 300px;
      gap: 24px;
      max-width: 1100px;
      margin: 0 auto;
      padding: 16px;
      align-items: start;
    }
    @media (max-width: 900px) {
      .sb-layout { grid-template-columns: 1fr; }
      .sb-panel { order: -1; }
    }

    .sb-play {
      background: #fff;
      border-radius: 20px;
      box-shadow: 0 8px 32px rgba(15, 23, 42, 0.1);
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }
    .sb-play__top {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 18px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
    }
    .sb-play__score {
      display: flex; align-items: center; gap: 4px;
      font-size: 20px; font-weight: 800; color: #f59e0b;
    }
    .sb-play__score mat-icon { color: #f59e0b; }
    .sb-play__progress { flex: 1; text-align: center; font-size: 13px; font-weight: 600; color: #64748b; }
    .sb-play__timer {
      display: flex; align-items: center; gap: 4px;
      font-weight: 700; color: #1e3a5f; padding: 6px 12px;
      background: #e0f2fe; border-radius: 999px; font-size: 14px;
    }
    .sb-play__timer--urgent { background: #fee2e2; color: #b91c1c; animation: pulse 0.8s infinite; }
    @keyframes pulse { 50% { opacity: 0.7; } }

    .sb-board { padding: 24px 22px 28px; }
    .sb-board__prompt {
      padding: 16px 18px; margin-bottom: 20px;
      background: linear-gradient(135deg, #eff6ff, #f0fdf4);
      border-radius: 14px; border: 1px solid #dbeafe;
    }
    .sb-board__prompt-row {
      display: flex; align-items: flex-start; gap: 10px;
    }
    .sb-board__prompt-row mat-icon { color: #2563eb; margin-top: 2px; }
    .sb-board__prompt-row p { margin: 0; flex: 1; font-size: 16px; font-weight: 600; color: #1e293b; line-height: 1.45; }
    .sb-hint {
      margin: 12px 0 8px; font-size: 13px; color: #64748b; text-align: center;
    }
    .sb-hint__green { color: #16a34a; font-weight: 700; }
    .sb-hint__red { color: #dc2626; font-weight: 700; }
    .sb-progress-chips { text-align: center; }
    .sb-progress-chips__label {
      font-size: 12px; font-weight: 700; color: #405980;
      background: rgba(64, 89, 128, 0.08); padding: 4px 12px; border-radius: 999px;
    }

    .sb-row-wrap {
      position: relative;
      padding: 16px 12px;
      background: #f8fafc;
      border-radius: 16px;
      border: 2px solid #e2e8f0;
    }
    .sb-row-wrap--complete {
      border-color: #22c55e;
      background: #f0fdf4;
    }

    .sb-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
      align-items: stretch;
    }

    .sb-pos {
      min-width: 72px;
      min-height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 14px;
      border: 2px dashed transparent;
      transition: border-color 0.2s, background 0.2s;
    }
    .sb-pos.cdk-drop-list-dragging,
    .sb-pos.cdk-drop-list-receiving {
      border-color: #6366f1;
      background: rgba(99, 102, 241, 0.06);
    }
    .sb-pos--locked {
      border-color: rgba(34, 197, 94, 0.35);
    }

    .sb-word { cursor: grab; }
    .sb-word:active { cursor: grabbing; }
    .sb-word.cdk-drag-disabled { cursor: default; }

    .sb-word__pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px 10px 12px;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 700;
      background: linear-gradient(145deg, #6366f1, #4f46e5);
      color: #fff;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.35);
      user-select: none;
      white-space: nowrap;
      transition: box-shadow 0.15s ease;
    }

    .sb-word__pos {
      font-size: 10px;
      font-weight: 800;
      opacity: 0.75;
      background: rgba(0,0,0,.15);
      width: 18px; height: 18px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .sb-word__pill--locked {
      background: linear-gradient(145deg, #22c55e, #15803d) !important;
      box-shadow: 0 4px 18px rgba(34, 197, 94, 0.5) !important;
      animation: pill-lock-pop 0.18s ease-out;
    }

    .sb-word__pill--wrong {
      background: linear-gradient(145deg, #ef4444, #b91c1c) !important;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.6) !important;
      animation: pill-wrong-shake 0.35s ease-in-out;
    }

    .sb-word__tick {
      font-size: 18px !important;
      width: 18px !important;
      height: 18px !important;
    }

    .sb-row__blast {
      position: absolute;
      inset: 0;
      border-radius: 14px;
      background: radial-gradient(circle at center, rgba(129, 199, 132, 0.45) 0%, transparent 70%);
      animation: blast-fade 0.9s ease-out forwards;
      pointer-events: none;
    }

    @keyframes pill-lock-pop {
      0% { transform: scale(0.92); }
      60% { transform: scale(1.08); }
      100% { transform: scale(1); }
    }
    @keyframes pill-wrong-shake {
      0% { transform: translateX(0); }
      18% { transform: translateX(-9px); }
      36% { transform: translateX(9px); }
      54% { transform: translateX(-6px); }
      72% { transform: translateX(6px); }
      100% { transform: translateX(0); }
    }
    @keyframes blast-fade {
      0% { opacity: 1; }
      100% { opacity: 0; }
    }

    .sb-flash { margin: 14px 0 0; font-size: 13px; font-weight: 600; text-align: center; }
    .sb-flash--wrong { color: #b91c1c; }

    .sb-speed-toast {
      margin-top: 16px; padding: 12px 16px; border-radius: 12px;
      background: linear-gradient(90deg, #fef3c7, #fde68a);
      color: #92400e; font-weight: 700; display: flex; align-items: center; gap: 8px;
    }

    .sb-complete { text-align: center; padding: 48px 24px; }
    .sb-complete mat-icon { font-size: 64px; width: 64px; height: 64px; color: #f59e0b; }

    .sb-panel {
      background: #fff; border-radius: 20px; padding: 22px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 8px 32px rgba(15, 23, 42, 0.08);
      position: sticky; top: 16px;
    }
    .sb-panel__game { text-align: center; margin-bottom: 20px; }
    .sb-panel__icon {
      width: 64px; height: 64px; border-radius: 16px; margin: 0 auto 12px;
      display: flex; align-items: center; justify-content: center;
    }
    .sb-panel__icon mat-icon { font-size: 32px; width: 32px; height: 32px; color: #fff; }
    .sb-panel h2 { margin: 0 0 4px; font-size: 18px; color: #1e293b; }
    .sb-panel__type { margin: 0; font-size: 12px; color: #6366f1; font-weight: 700; text-transform: uppercase; }
    .sb-panel__timer-card {
      display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
      padding: 16px; border-radius: 14px; margin-bottom: 18px;
      background: linear-gradient(135deg, #1e3a5f, #2563eb); color: #fff;
    }
    .sb-panel__timer-card mat-icon { font-size: 36px; width: 36px; height: 36px; opacity: 0.9; }
    .sb-panel__timer-val { display: block; font-size: 28px; font-weight: 800; line-height: 1; }
    .sb-panel__timer-lbl { font-size: 12px; opacity: 0.85; }
    .sb-panel__timer-card small { width: 100%; opacity: 0.75; font-size: 11px; }
    .sb-panel__block { margin-bottom: 18px; }
    .sb-panel__block h3 {
      display: flex; align-items: center; gap: 6px;
      margin: 0 0 10px; font-size: 13px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.04em; color: #475569;
    }
    .sb-panel__block h3 mat-icon { font-size: 18px; width: 18px; height: 18px; color: #6366f1; }
    .sb-panel__block ol { margin: 0; padding-left: 18px; font-size: 13px; color: #64748b; line-height: 1.55; }
    .sb-panel__block ol li { margin-bottom: 8px; }
    .sb-panel__block--score {
      background: #f8fafc; border-radius: 12px; padding: 14px;
      border: 1px solid #e2e8f0;
    }
    .sb-panel__block--score ul { margin: 0; padding-left: 18px; font-size: 13px; color: #64748b; }
  `]
})
export class SentenceBuilderComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() questions: SentenceQuestion[] = [];
  @Input() gameSet!: GameSet;
  @Output() onComplete = new EventEmitter<SBResult>();

  currentIndex = 0;
  /** One word per fixed position — slot i always means position i+1 in the sentence */
  positionSlots: string[][] = [];
  slotIndices: number[] = [];
  slotLocked: boolean[] = [];
  wrongFlash: boolean[] = [];
  score = 0;
  correctCount = 0;
  phase: 'playing' | 'complete' = 'playing';

  sessionElapsedSeconds = 0;
  lastWrongHint = '';

  xpPerAnswer = 5;
  xpTrigger = 0;
  showConfetti = false;

  /** No validation until the student drags a word at least once */
  hasUserInteracted = false;
  private pendingAdvance = false;
  private serverSyncCount = 0;
  private sessionStartedAt = Date.now();
  private timerHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private svc: InteractiveGameService, readonly audio: GameAudioService) {}

  get currentQ(): SentenceQuestion | null { return this.questions[this.currentIndex] ?? null; }
  get typeGradient(): string { return 'linear-gradient(145deg, #15803d, #22c55e)'; }
  get slotCount(): number { return this.positionSlots.length; }
  get lockedCount(): number { return this.slotLocked.filter(Boolean).length; }
  get allLocked(): boolean {
    return this.slotCount > 0 && this.lockedCount === this.slotCount;
  }
  get dropListIds(): string[] {
    return this.slotIndices.map(i => this.slotId(i));
  }
  get accuracy(): number {
    return this.questions.length ? Math.round((this.correctCount / this.questions.length) * 100) : 0;
  }

  slotId(i: number): string { return `sb-pos-${i}`; }

  parseSlotId(id: string): number {
    return parseInt(id.replace('sb-pos-', ''), 10);
  }

  ngOnInit() {
    this.audio.loadMutePreference();
    this.sessionStartedAt = Date.now();
    this.loadQuestion();
    this.startSessionTimer();
  }

  ngOnDestroy() {
    if (this.timerHandle) clearInterval(this.timerHandle);
  }

  loadQuestion() {
    if (!this.currentQ) { this.phase = 'complete'; return; }
    const shuffled = [...(this.currentQ.shuffledTokens || [])];
    const n = shuffled.length;
    this.positionSlots = shuffled.map(token => [token]);
    this.slotIndices = Array.from({ length: n }, (_, i) => i);
    this.slotLocked = Array(n).fill(false);
    this.wrongFlash = Array(n).fill(false);
    this.lastWrongHint = '';
    if (this.currentQ.sentenceAudioUrl) this.audio.preload(this.currentQ.sentenceAudioUrl);
    this.hasUserInteracted = false;
    this.pendingAdvance = false;
    this.serverSyncCount = 0;
  }

  startSessionTimer() {
    if (this.timerHandle) clearInterval(this.timerHandle);
    this.timerHandle = setInterval(() => {
      if (this.phase !== 'playing') return;
      this.sessionElapsedSeconds = Math.floor((Date.now() - this.sessionStartedAt) / 1000);
    }, 1000);
  }

  formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  }

  onSlotDrop(event: CdkDragDrop<string[]>, targetIndex: number) {
    if (this.allLocked) return;
    if (this.slotLocked[targetIndex]) return;

    const fromIndex = this.parseSlotId(event.previousContainer.id);
    if (Number.isNaN(fromIndex) || this.slotLocked[fromIndex]) return;
    if (event.previousContainer === event.container) return;

    this.hasUserInteracted = true;

    const fromList = event.previousContainer.data;
    const toList = event.container.data;

    if (fromList.length && toList.length) {
      const temp = fromList[0];
      fromList[0] = toList[0];
      toList[0] = temp;
    } else if (fromList.length) {
      transferArrayItem(fromList, toList, event.previousIndex, event.currentIndex);
    }

    this.feedbackInstant(targetIndex);
    if (fromIndex !== targetIndex) {
      this.feedbackInstant(fromIndex);
    }

    // A word might already be on its correct numbered slot due to shuffle; if neither
    // endpoint of this swap was evaluated as correct above, lock those silently.
    this.lockSilentAlreadyCorrectSlots();
    if (this.allLocked) {
      this.onAllSlotsLockedLocal();
    }
  }

  private normaliseToken(t: string): string {
    return (t || '').trim().toLowerCase().replace(/[.!?,;:]+$/g, '');
  }

  private tokensMatch(a: string, b: string): boolean {
    const na = this.normaliseToken(a);
    const nb = this.normaliseToken(b);
    return na === nb;
  }

  isSlotCorrect(index: number): boolean {
    const expected = this.currentQ?.correctTokens?.[index];
    const actual = this.positionSlots[index]?.[0];
    if (!expected || !actual) return false;
    return this.tokensMatch(actual, expected);
  }

  /** Instant green/red on drop; server sync runs in background for score */
  feedbackInstant(index: number) {
    if (!this.hasUserInteracted || !this.currentQ || this.slotLocked[index]) return;

    const token = this.positionSlots[index]?.[0];
    if (!token) return;

    if (!this.currentQ.correctTokens?.length) {
      this.syncSlotToServer(index, token);
      return;
    }

    if (this.isSlotCorrect(index)) {
      // Lock this slot (+ sound); also lock other slots already correct —
      // the shuffle sometimes leaves a token in the right place and students
      // never drag that slot, so it stayed purple/unlocked until now.
      this.tryLockSlotIfCorrect(index, true);
      this.lockSilentAlreadyCorrectSlots();
      this.flashMisplacedSlots();

      if (this.allLocked) {
        this.onAllSlotsLockedLocal();
      }
    } else {
      this.wrongFlash[index] = true;
      this.lastWrongHint = `"${token}" is not correct in position ${index + 1}.`;
      this.audio.playWrong();
      setTimeout(() => { this.wrongFlash[index] = false; }, 350);
    }
  }

  /**
   * Lock one slot when it matches correctTokens[slotIndex].
   * @param playSound only for the drag the student just resolved (avoid a burst when several lock at once).
   */
  private tryLockSlotIfCorrect(index: number, playSound: boolean): boolean {
    if (!this.currentQ?.correctTokens?.length) return false;
    if (this.slotLocked[index]) return false;
    const t = this.positionSlots[index]?.[0];
    if (!t || !this.isSlotCorrect(index)) return false;
    this.slotLocked[index] = true;
    this.wrongFlash[index] = false;
    this.lastWrongHint = '';
    if (playSound) this.audio.playCorrect();
    this.syncSlotToServer(index, t);
    return true;
  }

  /** Lock every unlocked slot whose token already matches — no sfx (shuffle luck). */
  private lockSilentAlreadyCorrectSlots(): void {
    for (let i = 0; i < this.slotCount; i++) {
      this.tryLockSlotIfCorrect(i, false);
    }
  }

  /** Shake red any unlocked word that sits in the wrong numbered position. */
  private flashMisplacedSlots(): void {
    for (let i = 0; i < this.slotCount; i++) {
      if (this.slotLocked[i]) continue;
      const tok = this.positionSlots[i]?.[0];
      if (!tok) continue;
      if (!this.isSlotCorrect(i)) {
        this.wrongFlash[i] = true;
        setTimeout(() => { this.wrongFlash[i] = false; }, 350);
      }
    }
  }

  private syncSlotToServer(index: number, token: string) {
    const elapsed = Date.now() - this.sessionStartedAt;
    this.serverSyncCount++;

    this.svc.submitSentenceSlot(this.attempt._id, {
      questionId: this.currentQ!._id,
      slotIndex: index,
      token,
      responseTimeMs: elapsed,
    }).subscribe({
      next: (r) => {
        this.serverSyncCount = Math.max(0, this.serverSyncCount - 1);
        if (r.isCorrect) {
          this.score += r.pointsEarned ?? 0;
          this.xpTrigger++;
          if (r.questionComplete) {
            this.correctCount++;
          }
        }
        this.tryAdvanceAfterSync();
      },
      error: (err) => {
        this.serverSyncCount = Math.max(0, this.serverSyncCount - 1);
        const msg = err?.error?.message || '';
        if (err?.status === 409 || msg.includes('already correct')) {
          this.slotLocked[index] = true;
        }
        this.tryAdvanceAfterSync();
      },
    });
  }

  private onAllSlotsLockedLocal() {
    if (this.pendingAdvance) return;
    this.pendingAdvance = true;
    this.triggerConfetti();
    this.tryAdvanceAfterSync();
  }

  private tryAdvanceAfterSync() {
    if (!this.pendingAdvance || this.serverSyncCount > 0) return;
    setTimeout(() => {
      if (this.pendingAdvance && this.serverSyncCount === 0) {
        this.pendingAdvance = false;
        this.advanceQuestion();
      }
    }, 600);
  }

  advanceQuestion() {
    this.currentIndex++;
    if (this.currentIndex >= this.questions.length) {
      this.phase = 'complete';
      if (this.timerHandle) clearInterval(this.timerHandle);
    } else {
      this.loadQuestion();
    }
  }

  onPause() {}

  buildResult(): SBResult {
    return {
      score: this.score,
      xpEarned: 0,
      accuracy: this.accuracy,
      timeSpentSeconds: Math.round((Date.now() - this.sessionStartedAt) / 1000),
    };
  }

  triggerConfetti() {
    this.showConfetti = true;
    setTimeout(() => this.showConfetti = false, 2000);
  }
}
