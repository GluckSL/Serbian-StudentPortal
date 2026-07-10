import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, NgZone, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { GameAudioService } from '../../services/game-audio.service';
import { FlapjugationQuestion, GameSet } from '../../glueck-arena.types';

const PRONOUN_CYCLE = ['ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'Sie'] as const;
const PRONOUN_TO_TOKEN_INDEX: Record<string, number> = {
  ich: 0, du: 1, er: 2, sie: 2, es: 2, wir: 3, ihr: 4, Sie: 5,
};
const HITS_PER_PRONOUN = 1;
const GRAVITY = 0.4;
const FLAP_VELOCITY = -6.5;
const CARD_SPEED_BASE = 2.5;
const SPAWN_INTERVAL = 90;
const CARD_WIDTH = 130;
const CARD_HEIGHT = 44;
const BIRD_RADIUS = 18;
const GROUND_HEIGHT = 50;
const MAX_LIVES = 5;

interface FormCard {
  x: number; y: number; form: string; isCorrect: boolean; collected: boolean; opacity: number;
  hitState: 'none' | 'hit'; hitCorrect: boolean; hitTimer: number;
}
interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string;
}
interface Cloud {
  x: number; y: number; w: number; h: number; speed: number; opacity: number;
}
interface Fragment {
  x: number; y: number; vx: number; vy: number; w: number; h: number;
  rotation: number; rotSpeed: number; life: number; maxLife: number;
  color: string; strokeColor: string;
}

export interface FJResult {
  score: number; xpEarned: number; accuracy: number;
  timeSpentSeconds: number; livesRemaining: number;
}

@Component({
  selector: 'app-flapjugation',
  standalone: true,
  imports: [CommonModule, MaterialModule, XpFloatComponent],
  template: `
    <div class="fj" #container>
      <div class="fj__header" #header [style.display]="phase === 'idle' ? 'none' : ''">
        <div class="fj__header-center">
          <div class="fj__score">{{ score }}</div>
          <div class="fj__progress-bar">
            <div class="fj__progress-fill" [style.width.%]="overallProgress"></div>
          </div>
        </div>
        <div class="fj__header-right">
          <span class="fj__lives">
            <mat-icon *ngFor="let _ of livesArr" style="color:#ef4444;font-size:16px;vertical-align:middle">favorite</mat-icon>
            <mat-icon *ngFor="let _ of lostLivesArr" style="color:#525252;font-size:16px;vertical-align:middle">favorite_border</mat-icon>
          </span>
        </div>
      </div>
      <div class="fj__body">
        <canvas #canvas class="fj__canvas" (click)="onFlap()" (keydown)="onKeydown($event)" tabindex="0"></canvas>
        <div class="fj__prompt" *ngIf="phase === 'playing'" aria-live="polite">
          <span class="fj__pronoun">{{ currentPronoun }}</span>
          <span class="fj__infinitive">{{ currentInfinitive }}</span>
          <span class="fj__translation" *ngIf="currentTranslation">{{ currentTranslation }}</span>
        </div>
        <div class="fj__overlay" *ngIf="phase === 'idle' || phase === 'gameover' || phase === 'complete'">
          <div class="fj__overlay-card">
            <ng-container [ngSwitch]="phase">
              <ng-container *ngSwitchCase="'idle'">
                <h2>Flapjugation</h2>
                <p>Tapni za let! Leti do tačne konjugacije.</p>
                <button mat-raised-button color="primary" (click)="startGame()">Počni</button>
              </ng-container>
              <ng-container *ngSwitchCase="'gameover'">
                <h2>Igra završena</h2>
                <p>Rezultat: {{ score }}</p>
                <button mat-raised-button color="primary" (click)="startGame()">Igraj ponovo</button>
              </ng-container>
              <ng-container *ngSwitchCase="'complete'">
                <h2>Završeno!</h2>
                <p>Rezultat: {{ score }} &middot; Tačnost: {{ accuracy }}%</p>
              </ng-container>
            </ng-container>
          </div>
        </div>
      </div>
      <app-xp-float [xp]="xpBurst" [trigger]="xpTrigger"></app-xp-float>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
      width: 100%;
    }
    .fj {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      flex: 1;
      min-height: min(72vh, 720px);
      border-radius: 12px;
      overflow: hidden;
      outline: none;
    }
    .fj__header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; background: rgba(0,0,0,.45); backdrop-filter: blur(6px); min-height: 52px; gap: 12px; z-index: 10; flex-shrink: 0; }
    .fj__header-center { display: flex; align-items: center; gap: 12px; flex: 1; }
    .fj__header-right { display: flex; align-items: center; margin-left: auto; }
    .fj__prompt {
      position: absolute;
      top: clamp(16px, 10%, 72px);
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
      padding: 8px 18px;
      border-radius: 14px;
      background: rgba(30, 41, 59, 0.72);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
      pointer-events: none;
      z-index: 5;
      max-width: calc(100% - 32px);
    }
    .fj__pronoun { font-size: 26px; font-weight: 800; color: #fff; text-shadow: 0 1px 6px rgba(0,0,0,.5); background: rgba(255,255,255,.15); padding: 4px 16px; border-radius: 8px; }
    .fj__infinitive { font-size: 15px; font-weight: 600; color: #fff; background: rgba(255,255,255,.1); padding: 4px 12px; border-radius: 6px; }
    .fj__translation { font-size: 14px; color: #e2e8f0; background: rgba(255,255,255,.08); padding: 4px 12px; border-radius: 6px; font-style: italic; }
    @media (max-width: 640px) {
      .fj__prompt { flex-direction: column; gap: 6px; padding: 12px 16px; }
      .fj__pronoun { font-size: 22px; }
    }
    .fj__score { font-size: 20px; font-weight: 700; color: #fdd835; }
    .fj__lives { display: flex; gap: 2px; }
    .fj__progress-bar { width: 100px; height: 5px; background: rgba(255,255,255,.15); border-radius: 3px; overflow: hidden; }
    .fj__progress-fill { height: 100%; background: linear-gradient(90deg, #22c55e, #4ade80); border-radius: 3px; transition: width .3s; }
    .fj__body { position: relative; flex: 1; min-height: 0; }
    .fj__canvas { display: block; width: 100%; height: 100%; cursor: pointer; }
    .fj__overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.6); z-index: 20; }
    .fj__overlay-card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px 40px; text-align: center; color: #fff; }
    .fj__overlay-card h2 { margin: 0 0 8px; font-size: 24px; }
    .fj__overlay-card p { margin: 0 0 16px; color: #94a3b8; }
  `]
})
export class FlapjugationComponent implements AfterViewInit, OnDestroy {
  @Input() questions: FlapjugationQuestion[] = [];
  @Input() gameSet: GameSet | null = null;
  @Output() onComplete = new EventEmitter<FJResult>();

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('container', { static: true }) containerRef!: ElementRef<HTMLElement>;
  @ViewChild('header', { static: true }) headerRef!: ElementRef<HTMLElement>;

  phase: 'idle' | 'playing' | 'gameover' | 'complete' = 'idle';
  currentPronoun = 'ich';
  currentInfinitive = '';
  currentTranslation = '';
  score = 0;
  accuracy = 0;
  livesArr: number[] = [];
  lostLivesArr: number[] = [];
  overallProgress = 0;
  xpBurst = 0;
  xpTrigger = 0;

  private ctx!: CanvasRenderingContext2D;
  private animFrameId = 0;
  private bird = { x: 0, y: 250, vy: 0 };
  private cards: FormCard[] = [];
  private particles: Particle[] = [];
  private fragments: Fragment[] = [];
  private clouds: Cloud[] = [];
  private pronounCycleIndex = 0;
  private questionIndex = 0;
  private hitsThisPronoun = 0;
  private totalCorrect = 0;
  private totalAttempts = 0;
  private lives = MAX_LIVES;
  private spawnTimer = 0;
  private frameCount = 0;
  private canvasW = 0;
  private canvasH = 0;
  private scaleFactor = 1;
  private feedbackText = '';
  private feedbackTimer = 0;
  private feedbackColor = '#22c55e';
  private startTime = 0;
  private shakeIntensity = 0;
  private flashTimer = 0;
  private boomRingX = 0;
  private boomRingY = 0;
  private boomRingRadius = 0;
  private boomRingAlpha = 0;
  private resizeObserver?: ResizeObserver;

  constructor(private ngZone: NgZone, readonly audio: GameAudioService) {}

  ngAfterViewInit() {
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this.audio.loadMutePreference();
    this.resizeCanvas();
    this.drawIdle();
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.containerRef.nativeElement);
  }

  ngOnDestroy() {
    this.stopLoop();
    this.resizeObserver?.disconnect();
  }

  private resizeCanvas() {
    const container = this.containerRef.nativeElement;
    const rect = container.getBoundingClientRect();
    const headerEl = this.headerRef?.nativeElement;
    const headerH = headerEl ? headerEl.offsetHeight : 0;
    const dpr = window.devicePixelRatio || 1;
    this.canvasW = rect.width;
    this.canvasH = Math.max(rect.height - headerH, 480);
    const canvas = this.canvasRef.nativeElement;
    canvas.width = this.canvasW * dpr;
    canvas.height = this.canvasH * dpr;
    canvas.style.width = this.canvasW + 'px';
    canvas.style.height = this.canvasH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scaleFactor = this.canvasW / 600;
  }

  startGame() {
    if (!this.questions.length) return;
    this.score = 0;
    this.lives = MAX_LIVES;
    this.totalCorrect = 0;
    this.totalAttempts = 0;
    this.questionIndex = 0;
    this.pronounCycleIndex = 0;
    this.hitsThisPronoun = 0;
    this.currentPronoun = PRONOUN_CYCLE[0];
    this.bird.x = this.canvasW * 0.3;
    this.bird.y = 250;
    this.bird.vy = 0;
    this.startTime = Date.now();
    this.livesArr = Array(MAX_LIVES).fill(0);
    this.lostLivesArr = [];
    this.phase = 'playing';
    this.loadQuestion();
    requestAnimationFrame(() => this.resizeCanvas());
    this.startLoop();
    this.canvasRef.nativeElement.focus();
  }

  private loadQuestion() {
    const q = this.questions[this.questionIndex];
    if (!q) { this.endGame(); return; }
    this.currentInfinitive = q.word;
    this.currentTranslation = q.translation || '';
    this.pronounCycleIndex = 0;
    this.currentPronoun = PRONOUN_CYCLE[0];
    this.hitsThisPronoun = 0;
    this.cards = [];
    this.particles = [];
    this.fragments = [];
    this.clouds = this.initClouds();
    this.spawnTimer = 0;
    this.updateProgress();
  }

  private startLoop() {
    this.stopLoop();
    this.ngZone.runOutsideAngular(() => {
      const loop = () => {
        this.update();
        this.draw();
        this.animFrameId = requestAnimationFrame(loop);
      };
      this.animFrameId = requestAnimationFrame(loop);
    });
  }

  private stopLoop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }
  }

  @HostListener('window:resize')
  onResize() {
    this.resizeCanvas();
    if (this.phase === 'idle') this.drawIdle();
  }

  onFlap() {
    this.audio.unlock();
    if (this.phase !== 'playing') return;
    this.bird.vy = FLAP_VELOCITY * Math.sqrt(this.scaleFactor);
  }

  onKeydown(e: KeyboardEvent) {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      this.onFlap();
    }
  }

  private update() {
    if (this.phase !== 'playing') {
      if (this.phase === 'gameover' || this.phase === 'complete') return;
      if (this.feedbackTimer > 0) {
        this.feedbackTimer--;
        if (this.feedbackTimer <= 0) this.feedbackText = '';
      }
      this.updateParticles();
      return;
    }

    this.frameCount++;

    if (this.flashTimer > 0) this.flashTimer--;

    if (this.shakeIntensity > 0.5) {
      this.shakeIntensity *= 0.9;
    } else {
      this.shakeIntensity = 0;
    }

    const s = this.scaleFactor;
    this.bird.vy += GRAVITY * s * 0.6;
    this.bird.y += this.bird.vy;
    const groundY = this.canvasH - GROUND_HEIGHT * s - BIRD_RADIUS * s;
    if (this.bird.y > groundY) { this.bird.y = groundY; this.bird.vy = 0; }
    if (this.bird.y < BIRD_RADIUS * s) { this.bird.y = BIRD_RADIUS * s; this.bird.vy = 0; }

    const hasActiveCard = this.cards.some(c => !(c.collected && c.hitTimer <= 0) && c.x + CARD_WIDTH * s > -50);
    if (!hasActiveCard) { this.spawnCards(); }

    for (const card of this.cards) {
      if (card.hitState === 'hit') {
        card.hitTimer--;
        card.opacity = Math.max(0, card.hitTimer / 30);
      } else {
        card.x -= CARD_SPEED_BASE * s;
      }
    }
    this.cards = this.cards.filter(c => c.x + CARD_WIDTH * s > -50 && !(c.collected && c.hitTimer <= 0));
    this.checkCollisions();
    this.updateClouds();
    this.updateFragments();
    this.updateParticles();

    if (this.boomRingAlpha > 0) {
      this.boomRingRadius += 4 * s;
      this.boomRingAlpha *= 0.96;
      if (this.boomRingAlpha < 0.01) this.boomRingAlpha = 0;
    }

    if (this.feedbackTimer > 0) {
      this.feedbackTimer--;
      if (this.feedbackTimer <= 0) this.feedbackText = '';
    }
  }

  private spawnCards() {
    const s = this.scaleFactor;
    const q = this.questions[this.questionIndex];
    if (!q) return;
    const tokenIndex = PRONOUN_TO_TOKEN_INDEX[this.currentPronoun];
    const correctForm = (q.tokens || [])[tokenIndex] || '';
    const otherForms = (q.tokens || []).filter((f, i) => i !== tokenIndex && f !== correctForm);
    const uniqueOthers = [...new Set(otherForms)];

    const isCorrect = Math.random() < 0.35;
    const form = isCorrect ? correctForm : (uniqueOthers[Math.floor(Math.random() * uniqueOthers.length)] || correctForm);
    if (!form) return;

    const minY = 120 * s + CARD_HEIGHT * s;
    const maxY = this.canvasH - GROUND_HEIGHT * s - CARD_HEIGHT * s - 20 * s;
    const y = minY + Math.random() * (maxY - minY);

    this.cards.push({
      x: this.canvasW + 20, y,
      form, isCorrect, collected: false, opacity: 1,
      hitState: 'none', hitCorrect: false, hitTimer: 0,
    });
  }

  private checkCollisions() {
    const s = this.scaleFactor;
    const bx = this.bird.x, by = this.bird.y, br = BIRD_RADIUS * s;
    for (const card of this.cards) {
      if (card.collected) continue;
      const cx = card.x, cy = card.y, cw = CARD_WIDTH * s, ch = CARD_HEIGHT * s;
      const closestX = Math.max(cx, Math.min(bx, cx + cw));
      const closestY = Math.max(cy, Math.min(by, cy + ch));
      if ((bx - closestX) ** 2 + (by - closestY) ** 2 < br * br) {
        card.collected = true;
        this.totalAttempts++;
        if (card.isCorrect) {
          this.onCorrect(card);
        } else {
          this.onWrong(card);
        }
        break;
      }
    }
  }

  private onCorrect(card: FormCard) {
    this.audio.playCorrect();
    card.hitState = 'hit';
    card.hitCorrect = true;
    card.hitTimer = 30;
    this.spawnParticles(card.x + (CARD_WIDTH * this.scaleFactor) / 2, card.y + (CARD_HEIGHT * this.scaleFactor) / 2, '#22c55e', 14);
    this.score += 10;
    this.totalCorrect++;
    this.hitsThisPronoun++;
    this.xpBurst = 10;
    this.xpTrigger++;
    this.audio.playXpGain();
    this.showFeedback('✓', '#22c55e');
    if (this.hitsThisPronoun >= HITS_PER_PRONOUN) {
      this.pronounCycleIndex++;
      if (this.pronounCycleIndex >= PRONOUN_CYCLE.length) {
        this.questionIndex++;
        if (this.questionIndex >= this.questions.length) {
          this.endGame();
          return;
        }
        this.loadQuestion();
      } else {
        this.currentPronoun = PRONOUN_CYCLE[this.pronounCycleIndex];
        this.hitsThisPronoun = 0;
        this.cards = [];
      }
    }
    this.updateProgress();
  }

  private spawnFragments(cx: number, cy: number) {
    const s = this.scaleFactor;
    const fills = ['#fecaca', '#fca5a5', '#ef4444', '#fff', '#fee2e2'];
    const strokes = ['#ef4444', '#dc2626', '#b91c1c', '#fca5a5', '#ef4444'];
    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 7;
      const sizeR = Math.random();
      const w = sizeR < 0.25 ? 2 + Math.random() * 4 : 5 + Math.random() * 12;
      const h = sizeR < 0.25 ? 2 + Math.random() * 4 : 3 + Math.random() * 8;
      const ci = Math.floor(Math.random() * fills.length);
      this.fragments.push({
        x: cx + (Math.random() - 0.5) * CARD_WIDTH * s * 0.3,
        y: cy + (Math.random() - 0.5) * CARD_HEIGHT * s * 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        w, h,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.5,
        life: 35 + Math.random() * 25,
        maxLife: 60,
        color: fills[ci],
        strokeColor: strokes[ci],
      });
    }
  }

  private onWrong(card: FormCard) {
    card.hitState = 'hit';
    card.hitCorrect = false;
    card.hitTimer = 25;
    const cx = card.x + (CARD_WIDTH * this.scaleFactor) / 2;
    const cy = card.y + (CARD_HEIGHT * this.scaleFactor) / 2;
    this.audio.playWrong();
    this.spawnParticles(cx, cy, '#ef4444', 30);
    this.spawnFragments(cx, cy);
    this.boomRingX = cx;
    this.boomRingY = cy;
    this.boomRingRadius = 5;
    this.boomRingAlpha = 0.9;
    this.shakeIntensity = 14;
    this.flashTimer = 40;
    this.lives--;
    this.livesArr = Array(Math.max(0, this.lives)).fill(0);
    this.lostLivesArr = Array(MAX_LIVES - Math.max(0, this.lives)).fill(0);
    this.showFeedback('✗', '#ef4444');
    if (this.lives <= 0) {
      this.audio.playLost();
      this.endGame();
    }
  }

  private showFeedback(text: string, color: string) {
    this.feedbackText = text;
    this.feedbackColor = color;
    this.feedbackTimer = 25;
  }

  private spawnParticles(x: number, y: number, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      this.particles.push({ x, y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, life: 30 + Math.random() * 20, maxLife: 50, color });
    }
  }

  private initClouds(): Cloud[] {
    const clouds: Cloud[] = [];
    for (let i = 0; i < 5; i++) {
      clouds.push({
        x: Math.random() * this.canvasW,
        y: 30 + Math.random() * 100,
        w: 80 + Math.random() * 140,
        h: 30 + Math.random() * 25,
        speed: 0.15 + Math.random() * 0.25,
        opacity: 0.6 + Math.random() * 0.35,
      });
    }
    return clouds;
  }

  private updateClouds() {
    for (const cloud of this.clouds) {
      cloud.x += cloud.speed;
      if (cloud.x > this.canvasW + cloud.w) {
        cloud.x = -cloud.w;
        cloud.y = 30 + Math.random() * 100;
      }
    }
  }

  private drawCloud(c: Cloud) {
    const ctx = this.ctx;
    const s = this.scaleFactor;
    ctx.globalAlpha = c.opacity;
    ctx.fillStyle = '#ffffff';
    const cx = c.x, cy = c.y, cw = c.w, ch = c.h;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw * 0.3, ch * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + cw * 0.25, cy - ch * 0.2, cw * 0.35, ch * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + cw * 0.55, cy - ch * 0.1, cw * 0.3, ch * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + cw * 0.3, cy + ch * 0.1, cw * 0.4, ch * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private updateParticles() {
    for (const p of this.particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life--; }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  private updateFragments() {
    for (const f of this.fragments) { f.x += f.vx; f.y += f.vy; f.vy += 0.15; f.rotation += f.rotSpeed; f.life--; }
    this.fragments = this.fragments.filter(f => f.life > 0);
  }

  private updateProgress() {
    const totalSteps = this.questions.length * PRONOUN_CYCLE.length;
    const completedSteps = this.questionIndex * PRONOUN_CYCLE.length + this.pronounCycleIndex;
    this.overallProgress = Math.round((completedSteps / totalSteps) * 100);
  }

  private endGame() {
    this.phase = this.lives <= 0 ? 'gameover' : 'complete';
    const timeSpentSeconds = Math.round((Date.now() - this.startTime) / 1000);
    this.accuracy = this.totalAttempts > 0 ? Math.round((this.totalCorrect / this.totalAttempts) * 100) : 0;
    this.onComplete.emit({
      score: this.score,
      xpEarned: this.score,
      accuracy: this.accuracy,
      timeSpentSeconds,
      livesRemaining: Math.max(0, this.lives),
    });
  }

  private drawIdle() {
    this.draw();
  }

  private draw() {
    const ctx = this.ctx;
    const w = this.canvasW, h = this.canvasH, s = this.scaleFactor;
    const groundY = h - GROUND_HEIGHT * s;

    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, '#4fc3f7'); skyGrad.addColorStop(0.5, '#81d4fa'); skyGrad.addColorStop(1, '#b3e5fc');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, w, h);

    const sunX = w - 60 * s, sunY = 55 * s, sunR = 28 * s;
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,235,59,0.12)'; ctx.fill();
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,235,59,0.25)'; ctx.fill();
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fillStyle = '#ffeb3b'; ctx.fill();
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = '#fff9c4'; ctx.fill();

    for (const cloud of this.clouds) { this.drawCloud(cloud); }

    ctx.fillStyle = '#4caf50'; ctx.fillRect(0, groundY, w, GROUND_HEIGHT * s);
    ctx.fillStyle = '#66bb6a'; ctx.fillRect(0, groundY, w, 4 * s);
    ctx.fillStyle = '#388e3c';
    for (let i = 0; i < w; i += 40 * s) {
      ctx.fillRect(i, groundY, 2 * s, 6 * s);
      ctx.fillRect(i + 20 * s, groundY + 8 * s, 2 * s, 6 * s);
    }

    ctx.save();
    if (this.shakeIntensity > 0.5) {
      ctx.translate(
        (Math.random() - 0.5) * this.shakeIntensity * 2 * s,
        (Math.random() - 0.5) * this.shakeIntensity * 2 * s,
      );
    }

    for (const card of this.cards) {
      if (card.collected && card.hitTimer <= 0) continue;
      const cx = card.x, cy = card.y, cw = CARD_WIDTH * s, ch = CARD_HEIGHT * s;
      ctx.globalAlpha = card.opacity;
      ctx.beginPath(); ctx.roundRect(cx, cy, cw, ch, 8 * s);
      if (card.hitState === 'hit') {
        const isCorrectHit = card.hitCorrect;
        ctx.fillStyle = isCorrectHit ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';
        ctx.fill();
        ctx.strokeStyle = isCorrectHit ? '#22c55e' : '#ef4444';
        ctx.lineWidth = 2.5 * s; ctx.stroke();
        ctx.fillStyle = isCorrectHit ? '#bbf7d0' : '#fecaca';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
        ctx.strokeStyle = '#90a4ae'; ctx.lineWidth = 2 * s; ctx.stroke();
        ctx.fillStyle = '#37474f';
      }
      ctx.font = `bold ${Math.round(14 * s)}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(card.form, cx + cw / 2, cy + ch / 2);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    const bx = this.bird.x, by = this.bird.y, br = BIRD_RADIUS * s;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = '#fdd835'; ctx.fill();
    ctx.strokeStyle = '#f9a825'; ctx.lineWidth = 2 * s; ctx.stroke();
    ctx.beginPath(); ctx.arc(bx + br * 0.3, by - br * 0.2, br * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#1c1917'; ctx.fill();
    ctx.beginPath(); ctx.arc(bx + br * 0.45, by - br * 0.2, br * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + br * 0.6, by - br * 0.4);
    ctx.lineTo(bx + br * 1.3, by - br * 0.6);
    ctx.lineTo(bx + br * 0.7, by - br * 0.1);
    ctx.fillStyle = '#f9a825'; ctx.fill();

    for (const f of this.fragments) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rotation);
      const fa = f.life / f.maxLife;
      ctx.globalAlpha = fa;
      ctx.fillStyle = f.color;
      ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
      ctx.strokeStyle = f.strokeColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(-f.w / 2, -f.h / 2, f.w, f.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    if (this.boomRingAlpha > 0) {
      ctx.beginPath();
      ctx.arc(this.boomRingX, this.boomRingY, this.boomRingRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${this.boomRingAlpha})`;
      ctx.lineWidth = 2 * s;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(this.boomRingX, this.boomRingY, this.boomRingRadius * 0.7, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 80, 80, ${this.boomRingAlpha * 0.5})`;
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();
    }

    for (const p of this.particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3 * s * (p.life / p.maxLife), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this.flashTimer > 0) {
      const boomAlpha = (this.flashTimer / 40) * 0.55;
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      grad.addColorStop(0, `rgba(255, 255, 255, ${boomAlpha * 0.4})`);
      grad.addColorStop(0.3, `rgba(255, 80, 80, ${boomAlpha * 0.3})`);
      grad.addColorStop(1, 'rgba(255, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.feedbackText && this.phase === 'playing') {
      ctx.font = `bold ${Math.round(32 * s)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = this.feedbackColor;
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8;
      ctx.fillText(this.feedbackText, w / 2, h / 2 - 40 * s);
      ctx.shadowBlur = 0;
    }
  }
}
