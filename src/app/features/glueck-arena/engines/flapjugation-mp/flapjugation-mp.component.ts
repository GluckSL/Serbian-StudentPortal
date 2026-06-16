import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit, OnDestroy, NgZone, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';
import { GameAudioService } from '../../services/game-audio.service';
import { ArenaBattleRound, ArenaBattleAnswerResult, ArenaBattleFlapjugationQuestion } from '../../glueck-arena.types';

const PRONOUN_CYCLE = ['ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'Sie'] as const;
const PRONOUN_TO_TOKEN_INDEX: Record<string, number> = {
  ich: 0, du: 1, er: 2, sie: 2, es: 2, wir: 3, ihr: 4, Sie: 5,
};
const HITS_PER_PRONOUN = 5;
const GRAVITY = 0.4;
const FLAP_VELOCITY = -6.5;
const CARD_SPEED_BASE = 2.5;
const SPAWN_INTERVAL = 90;
const CARD_WIDTH = 130;
const CARD_HEIGHT = 44;
const BIRD_RADIUS = 18;
const GROUND_HEIGHT = 50;

interface FormCard {
  x: number;
  y: number;
  form: string;
  isCorrect: boolean;
  collected: boolean;
  opacity: number;
  hitState: 'none' | 'hit';
  hitCorrect: boolean;
  hitTimer: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

interface Cloud {
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
  opacity: number;
}

interface Fragment {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rotation: number;
  rotSpeed: number;
  life: number;
  maxLife: number;
  color: string;
  strokeColor: string;
}

@Component({
  selector: 'app-flapjugation-mp',
  standalone: true,
  imports: [CommonModule, XpFloatComponent],
  template: `
    <div class="fjmp" #container>
      <div class="fjmp__header" #header [style.display]="phase === 'idle' ? 'none' : ''">
        <div class="fjmp__header-left">
          <div class="fjmp__pronoun">{{ currentPronoun }}</div>
          <div class="fjmp__infinitive">{{ infinitive }}</div>
        </div>
        <div class="fjmp__header-center">
          <div class="fjmp__meter">
            <div class="fjmp__meter-fill" [style.width.%]="(pronounProgress / HITS_PER_PRONOUN) * 100"></div>
          </div>
          <div class="fjmp__progress" *ngIf="showTranslation">{{ translation }}</div>
        </div>
        <div class="fjmp__header-right">
          <div class="fjmp__status" *ngIf="feedbackText">{{ feedbackText }}</div>
        </div>
      </div>
      <div class="fjmp__body">
        <canvas #canvas class="fjmp__canvas"></canvas>
        <div class="fjmp__start" *ngIf="phase === 'idle'">
          <p>Loading flapjugation…</p>
        </div>
        <app-xp-float [xp]="xpBurst" [trigger]="xpTrigger"></app-xp-float>
      </div>
    </div>
  `,
  styles: [`
    .fjmp { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 400px; border-radius: 12px; overflow: hidden; }
    .fjmp__header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; background: rgba(0,0,0,.45); backdrop-filter: blur(6px); min-height: 52px; gap: 12px; z-index: 10; flex-shrink: 0; }
    .fjmp__header-left { display: flex; align-items: center; gap: 10px; }
    .fjmp__header-center { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .fjmp__header-right { display: flex; align-items: center; }
    .fjmp__pronoun { font-size: 22px; font-weight: 800; color: #fff; text-shadow: 0 1px 6px rgba(0,0,0,.5); background: rgba(255,255,255,.12); padding: 2px 14px; border-radius: 8px; }
    .fjmp__infinitive { font-size: 13px; color: #e0e0e0; background: rgba(255,255,255,.08); padding: 2px 10px; border-radius: 6px; }
    .fjmp__progress { font-size: 11px; color: #b0bec5; }
    .fjmp__meter { width: 100px; height: 5px; background: rgba(255,255,255,.15); border-radius: 3px; overflow: hidden; }
    .fjmp__meter-fill { height: 100%; background: #22c55e; border-radius: 3px; transition: width .3s; }
    .fjmp__status { font-size: 13px; font-weight: 600; color: #ef5350; padding: 2px 10px; border-radius: 6px; background: rgba(239,83,80,.15); animation: fjmpFadeIn .3s; }
    .fjmp__body { position: relative; flex: 1; min-height: 0; }
    .fjmp__canvas { display: block; width: 100%; height: 100%; }
    .fjmp__start { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #b0bec5; font-size: 16px; }
    @keyframes fjmpFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  `]
})
export class FlapjugationMpComponent implements AfterViewInit, OnDestroy, OnChanges {
  @Input() round: ArenaBattleRound | null = null;
  @Input() localScore = 0;
  @Input() answerResult: ArenaBattleAnswerResult | null = null;
  @Output() submitAnswer = new EventEmitter<{ typedWord: string; pronoun: string }>();

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('container', { static: true }) containerRef!: ElementRef<HTMLElement>;
  @ViewChild('header', { static: true }) headerRef!: ElementRef<HTMLElement>;

  readonly HITS_PER_PRONOUN = HITS_PER_PRONOUN;

  phase: 'idle' | 'playing' | 'feedback' | 'done' = 'idle';
  currentPronoun = 'ich';
  infinitive = '';
  translation = '';
  pronounProgress = 0;
  feedbackText = '';
  showTranslation = false;
  xpBurst = 0;
  xpTrigger = 0;

  private ctx!: CanvasRenderingContext2D;
  private animFrameId = 0;
  private bird = { x: 80, y: 250, vy: 0 };
  private cards: FormCard[] = [];
  private particles: Particle[] = [];
  private fragments: Fragment[] = [];
  private clouds: Cloud[] = [];
  private pronounCycleIndex = 0;
  private correctHitsThisPronoun = 0;
  private totalCorrectHits = 0;
  private spawnTimer = 0;
  private frameCount = 0;
  private canvasW = 0;
  private canvasH = 0;
  private scaleFactor = 1;
  private flapPressed = false;
  private feedbackTimer = 0;
  private shakeIntensity = 0;
  private flashTimer = 0;
  private boomRingX = 0;
  private boomRingY = 0;
  private boomRingRadius = 0;
  private boomRingAlpha = 0;
  private question!: ArenaBattleFlapjugationQuestion;

  constructor(private ngZone: NgZone, readonly audio: GameAudioService) {}

  ngAfterViewInit() {
    this.ctx = this.canvasRef.nativeElement.getContext('2d')!;
    this.audio.loadMutePreference();
    this.resizeCanvas();
    this.initGame();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['round'] && this.round) {
      this.initGame();
    }
    if (changes['answerResult'] && this.answerResult && !this.answerResult.isCorrect) {
      this.showFeedback('Miss!', '#ef4444');
    }
  }

  ngOnDestroy() {
    this.stopLoop();
  }

  private resizeCanvas() {
    const container = this.containerRef.nativeElement;
    const rect = container.getBoundingClientRect();
    const headerEl = this.headerRef?.nativeElement;
    const headerH = headerEl ? headerEl.offsetHeight : 0;
    const dpr = window.devicePixelRatio || 1;
    this.canvasW = rect.width;
    this.canvasH = Math.max(rect.height - headerH, 350);
    const canvas = this.canvasRef.nativeElement;
    canvas.width = this.canvasW * dpr;
    canvas.height = this.canvasH * dpr;
    canvas.style.width = this.canvasW + 'px';
    canvas.style.height = this.canvasH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scaleFactor = this.canvasW / 600;
  }

  private initGame() {
    if (!this.round) return;
    const q = this.round.question as ArenaBattleFlapjugationQuestion;
    if (!q || !q.forms || q.forms.length < 6) return;
    this.question = q;
    this.infinitive = q.infinitive;
    this.translation = q.translation || '';
    this.showTranslation = !!q.translation;
    this.pronounCycleIndex = 0;
    this.currentPronoun = PRONOUN_CYCLE[0];
    this.correctHitsThisPronoun = 0;
    this.totalCorrectHits = 0;
    this.pronounProgress = 0;
    this.bird = { x: this.canvasW * 0.3, y: 250, vy: 0 };
    this.cards = [];
    this.particles = [];
    this.fragments = [];
    this.clouds = this.initClouds();
    this.spawnTimer = 0;
    this.phase = 'playing';
    this.feedbackText = '';
    requestAnimationFrame(() => this.resizeCanvas());
    this.startLoop();
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
  }

  onFlap() {
    if (this.phase !== 'playing') return;
    this.bird.vy = FLAP_VELOCITY * Math.sqrt(this.scaleFactor);
    this.flapPressed = true;
  }

  onContainerClick() {
    this.audio.unlock();
    this.onFlap();
  }

  onKeydown(e: KeyboardEvent) {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      this.onFlap();
    }
  }

  private update() {
    if (this.phase !== 'playing') {
      if (this.phase === 'feedback') {
        this.feedbackTimer--;
        if (this.feedbackTimer <= 0) {
          this.phase = 'playing';
          this.feedbackText = '';
        }
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
    if (this.bird.y > groundY) {
      this.bird.y = groundY;
      this.bird.vy = 0;
    }
    if (this.bird.y < BIRD_RADIUS * s) {
      this.bird.y = BIRD_RADIUS * s;
      this.bird.vy = 0;
    }

    const hasActiveCard = this.cards.some(c => !(c.collected && c.hitTimer <= 0) && c.x + CARD_WIDTH * s > -50);
    if (!hasActiveCard) {
      this.spawnCards();
    }

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

    if (this.boomRingAlpha > 0) {
      this.boomRingRadius += 4 * s;
      this.boomRingAlpha *= 0.96;
      if (this.boomRingAlpha < 0.01) this.boomRingAlpha = 0;
    }

    this.flapPressed = false;
    this.updateClouds();
    this.updateFragments();
    this.updateParticles();
  }

  private spawnCards() {
    const s = this.scaleFactor;
    const forms = this.question.forms;
    const tokenIndex = PRONOUN_TO_TOKEN_INDEX[this.currentPronoun];
    const correctForm = forms[tokenIndex] || '';

    const otherForms = forms.filter((f, i) => i !== tokenIndex && f !== correctForm);
    const uniqueOthers = [...new Set(otherForms)];

    const isCorrect = Math.random() < 0.35;
    const form = isCorrect ? correctForm : (uniqueOthers[Math.floor(Math.random() * uniqueOthers.length)] || correctForm);
    if (!form) return;

    const minY = 120 * s + CARD_HEIGHT * s;
    const maxY = this.canvasH - GROUND_HEIGHT * s - CARD_HEIGHT * s - 20 * s;
    const y = minY + Math.random() * (maxY - minY);

    this.cards.push({
      x: this.canvasW + 20,
      y,
      form,
      isCorrect,
      collected: false,
      opacity: 1,
      hitState: 'none',
      hitCorrect: false,
      hitTimer: 0,
    });
  }

  private checkCollisions() {
    const s = this.scaleFactor;
    const bx = this.bird.x;
    const by = this.bird.y;
    const br = BIRD_RADIUS * s;

    for (const card of this.cards) {
      if (card.collected) continue;
      const cx = card.x;
      const cy = card.y;
      const cw = CARD_WIDTH * s;
      const ch = CARD_HEIGHT * s;

      const closestX = Math.max(cx, Math.min(bx, cx + cw));
      const closestY = Math.max(cy, Math.min(by, cy + ch));
      const dx = bx - closestX;
      const dy = by - closestY;

      if (dx * dx + dy * dy < br * br) {
        card.collected = true;
        if (card.isCorrect) {
          this.onCorrectHit(card);
        } else {
          this.onWrongHit(card);
        }
        break;
      }
    }
  }

  private onCorrectHit(card: FormCard) {
    this.audio.playCorrect();
    card.hitState = 'hit';
    card.hitCorrect = true;
    card.hitTimer = 30;
    this.spawnParticles(card.x + (CARD_WIDTH * this.scaleFactor) / 2, card.y + (CARD_HEIGHT * this.scaleFactor) / 2, '#22c55e', 14);
    this.submitAnswer.emit({ typedWord: card.form, pronoun: this.currentPronoun });
    this.correctHitsThisPronoun++;
    this.totalCorrectHits++;
    this.pronounProgress = Math.round((this.correctHitsThisPronoun / HITS_PER_PRONOUN) * 100);
    this.xpBurst = 10;
    this.xpTrigger++;
    this.audio.playXpGain();

    this.showFeedback('✓', '#22c55e');
    this.phase = 'feedback';
    this.feedbackTimer = 30;

    if (this.correctHitsThisPronoun >= HITS_PER_PRONOUN) {
      this.advancePronoun();
    }
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

  private onWrongHit(card: FormCard) {
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
    this.showFeedback('✗', '#ef4444');
    this.phase = 'feedback';
    this.feedbackTimer = 25;
  }

  private advancePronoun() {
    this.pronounCycleIndex++;
    if (this.pronounCycleIndex >= PRONOUN_CYCLE.length) {
      this.phase = 'done';
      this.feedbackText = 'All pronouns covered!';
      return;
    }
    this.currentPronoun = PRONOUN_CYCLE[this.pronounCycleIndex];
    this.correctHitsThisPronoun = 0;
    this.pronounProgress = 0;
  }

  private showFeedback(text: string, color: string) {
    this.feedbackText = text;
  }

  private spawnParticles(x: number, y: number, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        life: 30 + Math.random() * 20,
        maxLife: 50,
        color,
      });
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

  private updateParticles() {
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.life--;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  private updateFragments() {
    for (const f of this.fragments) {
      f.x += f.vx;
      f.y += f.vy;
      f.vy += 0.15;
      f.rotation += f.rotSpeed;
      f.life--;
    }
    this.fragments = this.fragments.filter(f => f.life > 0);
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

  private draw() {
    const ctx = this.ctx;
    const w = this.canvasW;
    const h = this.canvasH;
    const s = this.scaleFactor;
    const groundY = h - GROUND_HEIGHT * s;

    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, '#4fc3f7');
    skyGrad.addColorStop(0.5, '#81d4fa');
    skyGrad.addColorStop(1, '#b3e5fc');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    const sunX = w - 60 * s;
    const sunY = 55 * s;
    const sunR = 28 * s;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,235,59,0.12)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,235,59,0.25)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fillStyle = '#ffeb3b';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = '#fff9c4';
    ctx.fill();

    for (const cloud of this.clouds) {
      this.drawCloud(cloud);
    }

    ctx.fillStyle = '#4caf50';
    ctx.fillRect(0, groundY, w, GROUND_HEIGHT * s);
    ctx.fillStyle = '#66bb6a';
    ctx.fillRect(0, groundY, w, 4 * s);
    ctx.fillStyle = '#388e3c';
    for (let i = 0; i < w; i += 40 * s) {
      ctx.fillRect(i, groundY, 2 * s, 6 * s);
      ctx.fillRect(i + 20 * s, groundY + 8 * s, 2 * s, 6 * s);
    }

    ctx.save();
    if (this.shakeIntensity > 0.5) {
      const shakeX = (Math.random() - 0.5) * this.shakeIntensity * 2 * s;
      const shakeY = (Math.random() - 0.5) * this.shakeIntensity * 2 * s;
      ctx.translate(shakeX, shakeY);
    }

    for (const card of this.cards) {
      if (card.collected && card.hitTimer <= 0) continue;
      const cx = card.x;
      const cy = card.y;
      const cw = CARD_WIDTH * s;
      const ch = CARD_HEIGHT * s;

      ctx.globalAlpha = card.opacity;

      const radius = 8 * s;
      ctx.beginPath();
      ctx.roundRect(cx, cy, cw, ch, radius);

      if (card.hitState === 'hit') {
        const isCorrectHit = card.hitCorrect;
        ctx.fillStyle = isCorrectHit ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)';
        ctx.fill();
        ctx.strokeStyle = isCorrectHit ? '#22c55e' : '#ef4444';
        ctx.lineWidth = 2.5 * s;
        ctx.stroke();
        ctx.fillStyle = isCorrectHit ? '#bbf7d0' : '#fecaca';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fill();
        ctx.strokeStyle = '#90a4ae';
        ctx.lineWidth = 2 * s;
        ctx.stroke();
        ctx.fillStyle = '#37474f';
      }

      ctx.font = `bold ${Math.round(14 * s)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(card.form, cx + cw / 2, cy + ch / 2);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    const bx = this.bird.x;
    const by = this.bird.y;
    const br = BIRD_RADIUS * s;

    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = '#fdd835';
    ctx.fill();
    ctx.strokeStyle = '#f9a825';
    ctx.lineWidth = 2 * s;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(bx + br * 0.3, by - br * 0.2, br * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#1c1917';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(bx + br * 0.45, by - br * 0.2, br * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(bx + br * 0.6, by - br * 0.4);
    ctx.lineTo(bx + br * 1.3, by - br * 0.6);
    ctx.lineTo(bx + br * 0.7, by - br * 0.1);
    ctx.fillStyle = '#f9a825';
    ctx.fill();

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
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * s * alpha, 0, Math.PI * 2);
      ctx.fill();
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

    if (this.phase === 'feedback' && this.feedbackText) {
      ctx.font = `bold ${Math.round(28 * s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.feedbackText.startsWith('✓') ? '#22c55e' : '#ef4444';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.fillText(this.feedbackText, w / 2, h / 2);
      ctx.shadowBlur = 0;
    }

    if (this.phase === 'done') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `bold ${Math.round(24 * s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#22c55e';
      ctx.fillText('✓ Round Complete!', w / 2, h / 2);
    }
  }
}
