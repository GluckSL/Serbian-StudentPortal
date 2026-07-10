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
          <div class="sb-play__progress">Pitanje {{ currentIndex + 1 }} / {{ questions.length }}</div>
          <div class="sb-play__timer">
            <mat-icon>timer</mat-icon>
            <span>{{ formatElapsed(sessionElapsedSeconds) }}</span>
          </div>
          <button mat-icon-button type="button" (click)="onPause()" aria-label="Pauza"><mat-icon>pause</mat-icon></button>
        </header>

        <div class="sb-board" *ngIf="currentQ && phase === 'playing'">
          <div class="sb-board__prompt">
            <div class="sb-board__prompt-row">
              <mat-icon>translate</mat-icon>
              <p>{{ currentQ.translation || 'Složite reči u tačan redosled' }}</p>
              <button *ngIf="currentQ.sentenceAudioUrl" mat-icon-button type="button"
                (click)="audio.unlock(); audio.playUrl(currentQ.sentenceAudioUrl!)">
                <mat-icon>volume_up</mat-icon>
              </button>
            </div>
            <p class="sb-hint">
              Prevucite reč da počnete — tačno mesto odmah postaje <span class="sb-hint__green">zeleno</span>, pogrešno <span class="sb-hint__red">crveno</span>.
            </p>
            <div class="sb-progress-chips">
              <span class="sb-progress-chips__label">{{ lockedCount }} / {{ slotCount }} zaključano</span>
            </div>
          </div>

          <div
            class="sb-bank"
            cdkDropList
            [id]="bankId"
            [cdkDropListData]="wordBank"
            [cdkDropListConnectedTo]="dropListIds"
            [cdkDropListDisabled]="allLocked"
            (cdkDropListDropped)="onBankDrop($event)"
          >
            <div class="sb-word" cdkDrag *ngFor="let word of wordBank" [cdkDragDisabled]="allLocked">
              <span class="sb-word__pill">{{ word }}</span>
            </div>
          </div>

          <div class="sb-row-wrap" [class.sb-row-wrap--complete]="allLocked">
            <div class="sb-row-wrap__title">
              <mat-icon>south</mat-icon>
              <span>Spustite reči ovde da formirate rečenicu</span>
            </div>
            <div class="sb-row">
              <div
                *ngFor="let i of slotIndices"
                class="sb-pos"
                [class.sb-pos--empty]="!positionSlots[i].length"
                [class.sb-pos--locked]="slotLocked[i]"
                cdkDropList
                [id]="slotId(i)"
                [cdkDropListData]="positionSlots[i]"
                [cdkDropListConnectedTo]="dropListIds"
                [cdkDropListDisabled]="slotLocked[i] || allLocked"
                (cdkDropListDropped)="onSlotDrop($event, i)">
                <span class="sb-pos__placeholder" *ngIf="!positionSlots[i].length">{{ i + 1 }}</span>
                <div
                  *ngIf="positionSlots[i].length"
                  class="sb-word"
                  cdkDrag
                  [cdkDragDisabled]="slotLocked[i] || allLocked">
                  <span
                    class="sb-word__pill"
                    [class.sb-word__pill--locked]="slotLocked[i]"
                    [class.sb-word__pill--wrong]="wrongFlash[i]">
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
          <mat-icon class="sb-complete__spinner">hourglass_top</mat-icon>
          <span class="sb-complete__calc">Računanje rezultata…</span>
        </div>
      </main>

      <app-xp-float [xp]="xpPerAnswer" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .sb-layout {
      position: relative;
      margin: 0 auto;
    }

    .sb-play {
      position: relative;
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

    .sb-bank {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
      min-height: 72px;
      padding: 16px 14px;
      margin-bottom: 18px;
      background: #fff;
      border: 2px solid #e2e8f0;
      border-radius: 16px;
    }
    .sb-bank.cdk-drop-list-dragging,
    .sb-bank.cdk-drop-list-receiving {
      border-color: #a5b4fc;
      background: #f8faff;
    }

    .sb-row-wrap {
      position: relative;
      min-height: 170px;
      padding: 18px 16px 22px;
      background: #f8fafc;
      border-radius: 16px;
      border: 2px dashed #94a3b8;
    }
    .sb-row-wrap--complete {
      border-color: #22c55e;
      background: #f0fdf4;
    }

    .sb-row-wrap__title {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 16px;
      color: #64748b;
      font-size: 13px;
      font-weight: 700;
    }
    .sb-row-wrap__title mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
      color: #6366f1;
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
      border: 2px dashed #cbd5e1;
      background: rgba(255, 255, 255, 0.72);
      transition: border-color 0.2s, background 0.2s;
    }
    .sb-pos--empty {
      min-width: 84px;
    }
    .sb-pos.cdk-drop-list-dragging,
    .sb-pos.cdk-drop-list-receiving {
      border-color: #6366f1;
      background: rgba(99, 102, 241, 0.06);
    }
    .sb-pos--locked {
      border-color: rgba(34, 197, 94, 0.35);
    }
    .sb-pos__placeholder {
      color: #94a3b8;
      font-size: 13px;
      font-weight: 800;
    }

    .sb-word { cursor: grab; }
    .sb-word:active { cursor: grabbing; }
    .sb-word.cdk-drag-disabled { cursor: default; }

    .sb-word__pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
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

    .sb-complete { text-align: center; padding: 48px 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .sb-complete__spinner { font-size: 48px !important; width: 48px !important; height: 48px !important; color: #6366f1; animation: sb-spin 1s linear infinite; }
    @keyframes sb-spin { to { transform: rotate(360deg); } }
    .sb-complete__calc { font-size: 18px; font-weight: 600; color: #64748b; }


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
  wordBank: string[] = [];
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
  readonly bankId = 'sb-word-bank';
  get dropListIds(): string[] {
    return [this.bankId, ...this.slotIndices.map(i => this.slotId(i))];
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
    this.wordBank = shuffled;
    this.positionSlots = Array.from({ length: n }, () => []);
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
    this.audio.unlock();
    if (this.allLocked) return;
    if (this.slotLocked[targetIndex]) return;

    if (event.previousContainer === event.container) return;

    this.hasUserInteracted = true;

    const fromList = event.previousContainer.data;
    const toList = event.container.data;
    const fromBank = event.previousContainer.id === this.bankId;
    const fromIndex = fromBank ? -1 : this.parseSlotId(event.previousContainer.id);
    if (!fromBank && (Number.isNaN(fromIndex) || this.slotLocked[fromIndex])) return;

    if (fromList.length && toList.length) {
      const incoming = fromList[event.previousIndex] ?? fromList[0];
      const existing = toList[0];
      toList[0] = incoming;
      if (fromBank) {
        fromList.splice(event.previousIndex, 1, existing);
      } else {
        fromList[0] = existing;
      }
    } else if (fromList.length) {
      transferArrayItem(fromList, toList, event.previousIndex, event.currentIndex);
    }

    this.feedbackInstant(targetIndex);
    if (!fromBank && fromIndex !== targetIndex) {
      this.feedbackInstant(fromIndex);
    }

    if (this.allLocked) {
      this.onAllSlotsLockedLocal();
    }
  }

  onBankDrop(event: CdkDragDrop<string[]>) {
    this.audio.unlock();
    if (this.allLocked) return;
    if (event.previousContainer === event.container) return;
    const fromIndex = this.parseSlotId(event.previousContainer.id);
    if (Number.isNaN(fromIndex) || this.slotLocked[fromIndex]) return;
    transferArrayItem(event.previousContainer.data, event.container.data, event.previousIndex, event.currentIndex);
    this.hasUserInteracted = true;
    this.lastWrongHint = '';
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
      this.lastWrongHint = `"${token}" nije tačan na poziciji ${index + 1}.`;
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

    if (this.allLocked) {
      this.onAllSlotsLockedLocal();
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
          this.audio.playXpGain();
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
    this.showConfetti = true; setTimeout(() => this.showConfetti = false, 2000);
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
      setTimeout(() => this.onComplete.emit(this.buildResult()), 600);
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
}
