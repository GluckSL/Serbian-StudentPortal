import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy, HostListener, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { GameAudioService } from '../../services/game-audio.service';
import {
  GenderStackQuestion, GameAttempt, ArticleGender, GameSet, GenderStackSettings,
} from '../../glueck-arena.types';

export interface GSResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
  livesRemaining: number;
}

interface StackBlock {
  uid: number;
  question: GenderStackQuestion;
  state: 'falling' | 'landed';
  y: number;
  targetY: number;
  spawnedAt: number;
}

const MAX_LIVES = 5;
const MAX_STACK = 8;
const BLOCK_HEIGHT = 54;
const PLAYFIELD_HEIGHT = 360;
const DEFAULT_SETTINGS: GenderStackSettings = {
  spawnIntervalSeconds: 4,
  fallDurationSeconds: 1.2,
};

@Component({
  selector: 'app-gender-stack',
  standalone: true,
  imports: [CommonModule, MaterialModule, XpFloatComponent, ConfettiBurstComponent],
  template: `
    <div class="gs">
      <header class="gs__hud">
        <div class="gs__lives" aria-label="Životi">
          <mat-icon
            *ngFor="let h of lifeSlots"
            class="gs__heart"
            [class.gs__heart--off]="h > lives">favorite</mat-icon>
        </div>
        <div class="gs__score">{{ score }}</div>
        <button mat-icon-button type="button" (click)="onPause()" aria-label="Pauza">
          <mat-icon>pause</mat-icon>
        </button>
      </header>

      <div class="gs__sky">
        <div class="gs__sun"></div>
        <div class="gs__cloud gs__cloud--1"></div>
        <div class="gs__cloud gs__cloud--2"></div>
        <div class="gs__cloud gs__cloud--3"></div>

        <div class="gs__ceiling" [class.gs__ceiling--danger]="totalBlocks >= MAX_STACK - 1">
          <span *ngIf="totalBlocks >= MAX_STACK - 1">Gomila je skoro puna!</span>
        </div>

        <div class="gs__playfield" [style.height.px]="playfieldHeight">
          <div
            class="gs__block"
            *ngFor="let block of blocks"
            [class.gs__block--falling]="block.state === 'falling'"
            [class.gs__block--landed]="block.state === 'landed'"
            [class.gs__block--dragging]="draggingUid === block.uid"
            [class.gs__block--shake]="wrongFlashUid === block.uid"
            [style.transform]="blockTransform(block)"
            (pointerdown)="startDrag($event, block)"
            (pointerup)="onBlockPointerUp($event, block)"
            (lostpointercapture)="onBlockLostCapture($event)">
            <strong>{{ block.question.word }}</strong>
            <span>{{ block.question.translation }}</span>
          </div>
        </div>

        <div class="gs__feedback" *ngIf="feedback">
          <mat-icon>{{ feedback.correct ? 'check_circle' : 'cancel' }}</mat-icon>
          <span>{{ feedback.text }}</span>
        </div>

        <div class="gs__shelf"></div>
        <p class="gs__hint">Prevucite reč na DER, DIE ili DAS</p>
        <div class="gs__controls">
          <button
            type="button"
            id="gs-bucket-der"
            class="gs__btn gs__btn--der"
            [class.gs__btn--hover]="hoverBucket === 'der'"
            [disabled]="busy && !dragBlock"
            (pointerenter)="onBucketHover('der')"
            (pointerleave)="onBucketLeave()"
            (pointerup)="onBucketPointerUp($event, 'der')"
            (mouseup)="onBucketMouseUp($event, 'der')">DER</button>
          <button
            type="button"
            id="gs-bucket-die"
            class="gs__btn gs__btn--die"
            [class.gs__btn--hover]="hoverBucket === 'die'"
            [disabled]="busy && !dragBlock"
            (pointerenter)="onBucketHover('die')"
            (pointerleave)="onBucketLeave()"
            (pointerup)="onBucketPointerUp($event, 'die')"
            (mouseup)="onBucketMouseUp($event, 'die')">DIE</button>
          <button
            type="button"
            id="gs-bucket-das"
            class="gs__btn gs__btn--das"
            [class.gs__btn--hover]="hoverBucket === 'das'"
            [disabled]="busy && !dragBlock"
            (pointerenter)="onBucketHover('das')"
            (pointerleave)="onBucketLeave()"
            (pointerup)="onBucketPointerUp($event, 'das')"
            (mouseup)="onBucketMouseUp($event, 'das')">DAS</button>
        </div>
      </div>

      <div
        class="gs__ghost"
        *ngIf="dragBlock"
        [style.left.px]="ghostX"
        [style.top.px]="ghostY">
        <div class="gs__block gs__block--ghost">
          <strong>{{ dragBlock.question.word }}</strong>
          <span>{{ dragBlock.question.translation }}</span>
        </div>
      </div>

      <div class="gs__overlay gs__overlay--dim" *ngIf="phase === 'paused'">
        <button class="gs__play-btn" type="button" (click)="resume()" aria-label="Nastavi">
          <mat-icon>play_arrow</mat-icon>
        </button>
      </div>

      <div class="gs__overlay gs__overlay--dim" *ngIf="phase === 'gameover'">
        <mat-icon>{{ won ? 'emoji_events' : 'heart_broken' }}</mat-icon>
        <h3>{{ won ? 'Odlično!' : 'Gomila se prelila!' }}</h3>
        <p>Rezultat: {{ score }} · {{ accuracy }}% tačnost</p>
      </div>

      <app-xp-float [xp]="xpBurst" [trigger]="xpTrigger"></app-xp-float>
      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .gs {
      position: relative; width: 100%; border-radius: 20px; overflow: hidden;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.15); border: 1px solid #0ea5e9;
      --gs-pad: 12px;
      --gs-gap: 10px;
      --gs-card-w: calc((100% - 2 * var(--gs-pad) - 2 * var(--gs-gap)) / 3);
    }
    .gs__hud {
      position: relative; display: flex; align-items: center; justify-content: center;
      padding: 10px 14px; background: rgba(255,255,255,0.95); border-bottom: 1px solid #e2e8f0;
    }
    .gs__lives { position: absolute; left: 14px; display: flex; gap: 2px; }
    .gs__heart { font-size: 22px; width: 22px; height: 22px; color: #ef4444; }
    .gs__heart--off { color: #fecaca; }
    .gs__hud button { position: absolute; right: 14px; }
    .gs__score { font-size: 22px; font-weight: 800; color: #0f172a; }

    .gs__sky {
      position: relative;
      background: linear-gradient(180deg, #7dd3fc 0%, #bae6fd 55%, #86efac 100%);
      padding-bottom: 12px;
    }
    .gs__sun {
      position: absolute; top: 18px; right: 22px; width: 52px; height: 52px;
      border-radius: 50%; background: #fde047; box-shadow: 0 0 24px rgba(253, 224, 71, 0.7);
      pointer-events: none;
    }
    .gs__cloud {
      position: absolute; border-radius: 999px; pointer-events: none;
    }
    .gs__cloud::before, .gs__cloud::after {
      content: ''; position: absolute; border-radius: 50%; background: inherit;
    }
    .gs__cloud--1 {
      width: 110px; height: 28px; top: 28px; left: 8%;
      background: #fff; opacity: 0.9;
      animation: gs-cloud-drift 4s ease-in-out infinite;
    }
    .gs__cloud--1::before {
      width: 52px; height: 52px; top: -28px; left: 14px;
    }
    .gs__cloud--1::after {
      width: 40px; height: 40px; top: -20px; left: 52px;
    }
    .gs__cloud--2 {
      width: 84px; height: 24px; top: 66px; left: 50%;
      background: #fff; opacity: 0.75;
      animation: gs-cloud-drift 5s ease-in-out 1s infinite;
    }
    .gs__cloud--2::before {
      width: 38px; height: 38px; top: -20px; left: 10px;
    }
    .gs__cloud--2::after {
      width: 30px; height: 30px; top: -14px; left: 38px;
    }
    .gs__cloud--3 {
      width: 64px; height: 20px; top: 44px; left: 76%;
      background: #fff; opacity: 0.6;
      animation: gs-cloud-drift 3.5s ease-in-out 0.5s infinite;
    }
    .gs__cloud--3::before {
      width: 30px; height: 30px; top: -16px; left: 8px;
    }
    .gs__cloud--3::after {
      width: 22px; height: 22px; top: -10px; left: 28px;
    }
    @keyframes gs-cloud-drift {
      0%, 100% { transform: translateX(0); }
      50% { transform: translateX(10px); }
    }

    .gs__ceiling {
      text-align: center; min-height: 22px; padding: 6px;
      font-size: 11px; font-weight: 700; color: transparent; transition: color 0.2s;
    }
    .gs__ceiling--danger { color: #b91c1c; }

    .gs__playfield {
      position: relative; margin: 0 var(--gs-pad);
      overflow: visible;
    }
    .gs__block {
      position: absolute; left: 50%;
      width: var(--gs-card-w); max-width: 120px; min-width: 88px;
      padding: 8px 10px; border-radius: 10px;
      background: #fff; border: 2px solid #bae6fd;
      box-shadow: 0 3px 10px rgba(15, 23, 42, 0.14);
      text-align: center; touch-action: none; cursor: grab; user-select: none;
      will-change: transform; box-sizing: border-box;
    }
    .gs__block strong {
      display: block; font-size: 15px; line-height: 1.2;
      color: #0f172a; pointer-events: none;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .gs__block span {
      display: block; font-size: 11px; color: #64748b; margin-top: 2px; pointer-events: none;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .gs__block--landed { cursor: grab; z-index: 2; }
    .gs__block--falling { cursor: default; z-index: 1; pointer-events: none; }
    .gs__block--dragging { opacity: 0.35; }
    .gs__block--ghost {
      position: static; margin: 0; cursor: grabbing;
      outline: 3px solid #38bdf8; outline-offset: 2px;
    }
    .gs__block--shake { animation: gs-shake 0.45s ease; }
    @keyframes gs-shake {
      0%, 100% { transform: translateX(-50%) translateX(0); }
      25% { transform: translateX(-50%) translateX(-6px); }
      75% { transform: translateX(-50%) translateX(6px); }
    }

    .gs__ghost {
      position: fixed; z-index: 10000; pointer-events: none;
      transform: translate(-50%, -50%);
      width: var(--gs-card-w); max-width: 120px; min-width: 88px;
    }
    .gs__ghost .gs__block { width: 100%; }

    .gs__feedback {
      position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%);
      display: flex; align-items: center; gap: 8px; padding: 10px 16px;
      background: rgba(15, 23, 42, 0.88); color: #fff; border-radius: 12px;
      font-weight: 700; font-size: 14px; z-index: 5; pointer-events: none;
    }
    .gs__feedback mat-icon { font-size: 22px; width: 22px; height: 22px; }

    .gs__shelf {
      height: 10px; margin: 0 var(--gs-pad) 6px;
      background: linear-gradient(180deg, #92400e, #78350f);
      border-radius: 4px;
    }
    .gs__hint {
      margin: 0 0 8px; padding: 0 var(--gs-pad);
      text-align: center; font-size: 11px; font-weight: 600; color: #0f4c6a;
    }
    .gs__controls {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: var(--gs-gap); padding: 0 var(--gs-pad) 16px;
      position: relative; z-index: 6;
    }
    .gs__btn {
      border: none; border-radius: 14px; padding: 20px 6px;
      font-size: 17px; font-weight: 900; color: #fff; cursor: pointer;
      touch-action: none;
      letter-spacing: 0.06em; transition: transform 0.12s, filter 0.12s, box-shadow 0.12s;
      box-shadow: 0 6px 0 rgba(0,0,0,0.2);
    }
    .gs__btn:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 2px 0 rgba(0,0,0,0.2); }
    .gs__btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .gs__btn--hover:not(:disabled) {
      filter: brightness(1.08);
      box-shadow: 0 0 0 4px rgba(255,255,255,0.55), 0 6px 0 rgba(0,0,0,0.2);
    }
    .gs__btn--der { background: #ef4444; }
    .gs__btn--die { background: #22c55e; }
    .gs__btn--das { background: #3b82f6; }

    .gs__overlay {
      position: absolute; inset: 0; z-index: 10;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
      background: rgba(15, 23, 42, 0.75); color: #fff; text-align: center; padding: 24px;
    }
    .gs__overlay--dim { background: rgba(15, 23, 42, 0.4); }
    .gs__play-btn {
      width: 72px; height: 72px; border-radius: 50%; border: none;
      background: rgba(255,255,255,0.25); backdrop-filter: blur(4px);
      color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, transform 0.15s;
    }
    .gs__play-btn:hover { background: rgba(255,255,255,0.4); transform: scale(1.08); }
    .gs__play-btn mat-icon { font-size: 40px; width: 40px; height: 40px; }
    .gs__overlay mat-icon { font-size: 56px; width: 56px; height: 56px; }
    .gs__overlay h3 { margin: 0; font-size: 22px; }
    .gs__overlay p { margin: 0; opacity: 0.9; }
  `],
})
export class GenderStackComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() gameSet: GameSet | null = null;
  @Input() questions: GenderStackQuestion[] = [];
  @Output() onComplete = new EventEmitter<GSResult>();

  phase: 'playing' | 'paused' | 'gameover' = 'playing';
  blocks: StackBlock[] = [];
  lives = MAX_LIVES;
  readonly lifeSlots = [1, 2, 3, 4, 5];
  readonly MAX_STACK = MAX_STACK;
  readonly playfieldHeight = PLAYFIELD_HEIGHT;
  score = 0;
  busy = false;
  wrongFlashUid: number | null = null;
  feedback: { correct: boolean; text: string } | null = null;
  xpBurst = 0;
  xpTrigger = 0;
  showConfetti = false;
  won = false;
  accuracy = 0;

  draggingUid: number | null = null;
  dragBlock: StackBlock | null = null;
  ghostX = 0;
  ghostY = 0;
  hoverBucket: ArticleGender | null = null;

  private queue: GenderStackQuestion[] = [];
  private answered = 0;
  private correctCount = 0;
  private uid = 0;
  private spawnTimer: ReturnType<typeof setInterval> | null = null;
  private animFrame: number | null = null;
  private lastAnimAt = 0;
  private startedAt = Date.now();
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private settings: GenderStackSettings = { ...DEFAULT_SETTINGS };
  private activePointerId: number | null = null;
  private dropCommitted = false;
  private dragSourceEl: HTMLElement | null = null;
  private readonly dropHitPadding = 36;

  constructor(
    private svc: InteractiveGameService,
    private cdr: ChangeDetectorRef,
    readonly audio: GameAudioService,
  ) {}

  get totalBlocks(): number {
    return this.blocks.length;
  }

  ngOnInit() {
    this.audio.unlock();
    this.settings = this.resolveSettings();
    this.queue = this.shuffle([...this.questions]);
    this.spawnOne();
    this.startSpawner();
    this.startAnimation();
  }

  ngOnDestroy() {
    this.stopSpawner();
    this.stopAnimation();
    this.cancelDrag();
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
  }

  blockTransform(block: StackBlock): string {
    const x = 'translateX(-50%)';
    if (block.state === 'falling') {
      return `${x} translateY(${block.y}px)`;
    }
    return `${x} translateY(${block.y}px)`;
  }

  onPause() {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.stopSpawner();
    this.stopAnimation();
    this.cancelDrag();
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.lastAnimAt = 0;
    this.startSpawner();
    this.startAnimation();
  }

  startDrag(event: PointerEvent, block: StackBlock) {
    if (this.phase !== 'playing' || !this.canDragBlock(block) || this.busy || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    this.dropCommitted = false;
    this.draggingUid = block.uid;
    this.dragBlock = this.findBlock(block.uid) ?? block;
    this.activePointerId = event.pointerId;
    this.dragSourceEl = event.currentTarget as HTMLElement;
    try {
      this.dragSourceEl.setPointerCapture(event.pointerId);
    } catch { /* unsupported */ }

    this.ghostX = event.clientX;
    this.ghostY = event.clientY;
    this.hoverBucket = this.bucketAtPoint(event.clientX, event.clientY);
    this.cdr.detectChanges();
  }

  onBlockPointerUp(event: PointerEvent, block: StackBlock) {
    if (!this.dragBlock || this.dragBlock.uid !== block.uid || this.dropCommitted) return;
    event.preventDefault();
    const bucket = this.hoverBucket ?? this.bucketAtPoint(event.clientX, event.clientY);
    this.releasePointerCapture(event.pointerId);
    this.finishDrag(bucket);
  }

  onBlockLostCapture(event: PointerEvent) {
    if (!this.dragBlock || this.dropCommitted || this.activePointerId !== event.pointerId) return;
    const bucket = this.hoverBucket ?? this.bucketAtPoint(event.clientX, event.clientY);
    this.finishDrag(bucket);
  }

  onBucketHover(gender: ArticleGender) {
    if (this.dragBlock) this.hoverBucket = gender;
  }

  onBucketLeave() {
    if (this.dragBlock) this.hoverBucket = null;
  }

  onBucketPointerUp(event: PointerEvent, gender: ArticleGender) {
    if (!this.dragBlock || this.dropCommitted) return;
    event.preventDefault();
    event.stopPropagation();
    this.releasePointerCapture(event.pointerId);
    this.finishDrag(gender);
  }

  onBucketMouseUp(event: MouseEvent, gender: ArticleGender) {
    if (!this.dragBlock || this.dropCommitted || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.finishDrag(gender);
  }

  @HostListener('window:pointermove', ['$event'])
  onWindowPointerMove(event: PointerEvent) {
    if (!this.dragBlock || this.activePointerId !== event.pointerId) return;
    this.ghostX = event.clientX;
    this.ghostY = event.clientY;
    this.hoverBucket = this.bucketAtPoint(event.clientX, event.clientY);
    this.cdr.detectChanges();
  }

  @HostListener('window:pointerup', ['$event'])
  @HostListener('window:pointercancel', ['$event'])
  onWindowPointerEnd(event: PointerEvent) {
    if (!this.dragBlock || this.dropCommitted) return;
    if (this.activePointerId != null && event.pointerId !== this.activePointerId) return;
    const bucket = this.hoverBucket ?? this.bucketAtPoint(event.clientX, event.clientY);
    this.releasePointerCapture(event.pointerId);
    this.finishDrag(bucket);
  }

  @HostListener('window:mouseup', ['$event'])
  onWindowMouseUp(event: MouseEvent) {
    if (!this.dragBlock || this.dropCommitted || event.button !== 0) return;
    const bucket = this.hoverBucket ?? this.bucketAtPoint(event.clientX, event.clientY);
    this.finishDrag(bucket);
  }

  private finishDrag(gender: ArticleGender | null) {
    if (this.dropCommitted || !this.dragBlock) return;
    this.dropCommitted = true;

    const block = this.findBlock(this.dragBlock.uid) ?? this.dragBlock;
    this.draggingUid = null;
    this.dragBlock = null;
    this.hoverBucket = null;
    this.activePointerId = null;
    this.dragSourceEl = null;

    if (gender) {
      this.pick(block, gender);
    }
    this.cdr.markForCheck();
  }

  private cancelDrag() {
    this.releasePointerCapture();
    this.draggingUid = null;
    this.dragBlock = null;
    this.hoverBucket = null;
    this.activePointerId = null;
    this.dragSourceEl = null;
    this.dropCommitted = false;
  }

  private releasePointerCapture(pointerId?: number) {
    if (!this.dragSourceEl) return;
    try {
      if (pointerId != null && this.dragSourceEl.hasPointerCapture(pointerId)) {
        this.dragSourceEl.releasePointerCapture(pointerId);
      }
    } catch { /* ignore */ }
  }

  private canDragBlock(block: StackBlock): boolean {
    return block.state === 'landed' || block.y >= block.targetY - 4;
  }

  private findBlock(uid: number): StackBlock | undefined {
    return this.blocks.find(b => b.uid === uid);
  }

  private bucketAtPoint(clientX: number, clientY: number): ArticleGender | null {
    const fromDom = document.elementFromPoint(clientX, clientY);
    if (fromDom) {
      const btn = fromDom.closest('[id^="gs-bucket-"]') as HTMLElement | null;
      if (btn?.id === 'gs-bucket-der') return 'der';
      if (btn?.id === 'gs-bucket-die') return 'die';
      if (btn?.id === 'gs-bucket-das') return 'das';
    }

    const pad = this.dropHitPadding;
    const ids: ArticleGender[] = ['der', 'die', 'das'];
    for (const g of ids) {
      const el = document.getElementById(`gs-bucket-${g}`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (
        clientX >= r.left - pad && clientX <= r.right + pad &&
        clientY >= r.top - pad && clientY <= r.bottom + pad
      ) {
        return g;
      }
    }
    return null;
  }

  pick(block: StackBlock, gender: ArticleGender) {
    this.audio.unlock();
    const live = this.findBlock(block.uid) ?? block;
    if (this.busy || this.phase !== 'playing' || !this.canDragBlock(live)) return;
    this.busy = true;

    const t0 = Date.now();
    this.svc.submitAnswer(this.attempt._id, {
      questionId: live.question._id,
      articleGender: gender,
      responseTimeMs: Date.now() - t0,
    }).subscribe({
      next: (r) => {
        this.answered++;
        if (r.isCorrect) {
          this.audio.playCorrect();
          this.correctCount++;
          this.score += r.pointsEarned || 10;
          this.xpBurst = r.pointsEarned || 10;
          this.xpTrigger++;
          this.audio.playXpGain();
          this.removeBlock(live.uid);
          this.showFeedback(true, 'Tačno!');
          this.checkWin();
        } else {
          this.audio.playWrong();
          this.lives--;
          this.wrongFlashUid = live.uid;
          const art = r.correctAnswer?.articleGender || '?';
          this.showFeedback(false, `${art.toUpperCase()} — ${live.question.word}`);
          setTimeout(() => {
            this.wrongFlashUid = null;
            this.cdr.markForCheck();
          }, 500);
          this.removeBlock(live.uid);
          if (this.lives <= 0) {
            this.audio.playLost();
            this.endGame(false);
          }
        }
        this.busy = false;
        this.relayoutLanded();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.busy = false;
        const msg = err?.error?.message || 'Nije moguće poslati — pokušajte ponovo';
        this.showFeedback(false, msg);
        this.cdr.markForCheck();
      },
    });
  }

  private showFeedback(correct: boolean, text: string) {
    this.feedback = { correct, text };
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => {
      this.feedback = null;
      this.cdr.markForCheck();
    }, 900);
  }

  private removeBlock(uid: number) {
    this.blocks = this.blocks.filter(b => b.uid !== uid);
  }

  private landedBlocks(): StackBlock[] {
    return this.blocks.filter(b => b.state === 'landed');
  }

  private targetYForSlot(slotIndex: number): number {
    return PLAYFIELD_HEIGHT - BLOCK_HEIGHT - slotIndex * BLOCK_HEIGHT;
  }

  private relayoutLanded() {
    const landed = this.landedBlocks().sort((a, b) => a.spawnedAt - b.spawnedAt);
    landed.forEach((b, i) => {
      if (this.draggingUid === b.uid) return;
      b.targetY = this.targetYForSlot(i);
      b.y = b.targetY;
    });
    const falling = this.blocks
      .filter(b => b.state === 'falling')
      .sort((a, b) => a.spawnedAt - b.spawnedAt);
    falling.forEach((b, i) => {
      b.targetY = this.targetYForSlot(landed.length + i);
    });
  }

  private spawnOne() {
    if (!this.queue.length) return;
    if (this.blocks.length >= MAX_STACK) {
      this.endGame(false);
      return;
    }
    const q = this.queue.shift()!;
    const slot = this.blocks.length;
    const block: StackBlock = {
      uid: ++this.uid,
      question: q,
      state: 'falling',
      y: 0,
      targetY: this.targetYForSlot(slot),
      spawnedAt: Date.now(),
    };
    this.blocks.push(block);
    this.relayoutLanded();
    if (this.blocks.length >= MAX_STACK) {
      setTimeout(() => {
        if (this.phase === 'playing' && this.blocks.length >= MAX_STACK) {
          this.endGame(false);
        }
      }, this.settings.fallDurationSeconds * 1000 + 200);
    }
  }

  private spawnIntervalMs(): number {
    return Math.round(this.settings.spawnIntervalSeconds * 1000);
  }

  private startSpawner() {
    this.stopSpawner();
    this.spawnTimer = setInterval(() => {
      if (this.phase !== 'playing') return;
      this.spawnOne();
      if (this.queue.length === 0 && this.blocks.length === 0 && this.answered >= this.questions.length) {
        this.checkWin();
      }
    }, this.spawnIntervalMs());
  }

  private stopSpawner() {
    if (this.spawnTimer) {
      clearInterval(this.spawnTimer);
      this.spawnTimer = null;
    }
  }

  private startAnimation() {
    this.stopAnimation();
    this.lastAnimAt = 0;
    const tick = (now: number) => {
      if (this.phase !== 'playing') return;
      if (!this.lastAnimAt) this.lastAnimAt = now;
      const dt = Math.min(32, now - this.lastAnimAt);
      this.lastAnimAt = now;
      this.stepFall(dt);
      this.animFrame = requestAnimationFrame(tick);
    };
    this.animFrame = requestAnimationFrame(tick);
  }

  private stopAnimation() {
    if (this.animFrame != null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  private stepFall(dtMs: number) {
    const fallMs = this.settings.fallDurationSeconds * 1000;
    let changed = false;

    this.blocks = this.blocks.map((block) => {
      if (block.state !== 'falling') return block;

      const totalDist = Math.max(1, block.targetY);
      const fallStep = (totalDist / fallMs) * dtMs;
      const newY = Math.min(block.targetY, block.y + fallStep);

      if (newY >= block.targetY - 0.5) {
        changed = true;
        return { ...block, y: block.targetY, state: 'landed' as const };
      }
      if (newY !== block.y) changed = true;
      return { ...block, y: newY };
    });

    if (changed) {
      this.relayoutLanded();
      this.cdr.markForCheck();
    }
  }

  private checkWin() {
    if (this.answered >= this.questions.length && this.blocks.length === 0 && this.lives > 0) {
      this.endGame(true);
    }
  }

  private endGame(won: boolean) {
    if (this.phase === 'gameover') return;
    this.phase = 'gameover';
    this.won = won;
    this.stopSpawner();
    this.stopAnimation();
    this.cancelDrag();
    if (won) this.showConfetti = true;
    this.accuracy = this.answered > 0 ? Math.round((this.correctCount / this.answered) * 100) : 0;
    const timeSpentSeconds = Math.round((Date.now() - this.startedAt) / 1000);
    setTimeout(() => {
      this.onComplete.emit({
        score: this.score,
        xpEarned: 0,
        accuracy: this.accuracy,
        timeSpentSeconds,
        livesRemaining: this.lives,
      });
    }, won ? 1200 : 800);
  }

  private resolveSettings(): GenderStackSettings {
    const raw = this.gameSet?.genderStackSettings;
    return {
      spawnIntervalSeconds: Math.min(5, Math.max(3, raw?.spawnIntervalSeconds ?? DEFAULT_SETTINGS.spawnIntervalSeconds)),
      fallDurationSeconds: Math.min(3, Math.max(0.5, raw?.fallDurationSeconds ?? DEFAULT_SETTINGS.fallDurationSeconds)),
    };
  }

  private shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
