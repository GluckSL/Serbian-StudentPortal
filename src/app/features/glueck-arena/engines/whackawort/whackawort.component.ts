import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameAttempt, WhackawortQuestion } from '../../glueck-arena.types';
import { GameAudioService } from '../../services/game-audio.service';
import { XpFloatComponent } from '../../shared/xp-float/xp-float.component';

export interface WWResult {
  score: number;
  xpEarned: number;
  accuracy: number;
  timeSpentSeconds: number;
  livesRemaining: number;
}

interface Burrow {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Sign {
  word: string;
  translation: string;
  category: string;
  burrowIndex: number;
  visible: boolean;
  opacity: number;
  target: boolean;
  tapped: boolean;
  correct: boolean;
  popProgress: number;
}

@Component({
  selector: 'app-whackawort',
  standalone: true,
  imports: [CommonModule, XpFloatComponent],
  template: `
    <div class="ww-wrap" #wrap>
      <canvas #canvas class="ww-canvas"></canvas>
      <app-xp-float [xp]="xpAmount" [trigger]="xpTrigger"></app-xp-float>
    </div>
  `,
  styles: [`
    .ww-wrap { position: relative; width: 100%; aspect-ratio: 1; max-width: 800px; margin: 0 auto; }
    .ww-canvas { display: block; width: 100%; height: 100%; border-radius: 12px; cursor: pointer; }
  `]
})
export class WhackawortComponent implements OnInit, OnDestroy {
  @Input() attempt!: GameAttempt;
  @Input() questions: WhackawortQuestion[] = [];
  @Output() onComplete = new EventEmitter<WWResult>();

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('wrap', { static: true }) wrapRef!: ElementRef<HTMLDivElement>;
  @ViewChild(XpFloatComponent) xpFloat!: XpFloatComponent;

  private ctx!: CanvasRenderingContext2D;
  private animId = 0;
  private lastTime = 0;
  private startTime = 0;
  private categoryTimer = 0;

  private burrows: Burrow[] = [];
  private signs: Sign[] = [];
  private currentTargetCategory = '';
  private categoryBannerOpacity = 1;

  private score = 0;
  private xpEarned = 0;
  private correctCount = 0;
  private totalTaps = 0;
  private lives = 5;
  private combo = 0;
  private bestCombo = 0;

  private questionIndex = 0;
  private roundWords: WhackawortQuestion[] = [];
  private gridWords: WhackawortQuestion[] = [];

  private boomFragments: any[] = [];
  private boomShakeIntensity = 0;
  private boomFlashOpacity = 0;
  private boomRingRadius = 0;
  private boomRingOpacity = 0;

  private confettiFragments: any[] = [];

  private gridArea = { x: 0, y: 0, w: 0, h: 0 };

  xpAmount = 3;
  xpTrigger = 0;

  private readonly COLS = 3;
  private readonly ROWS = 3;
  private readonly SIGN_POP_DURATION = 300;
  private readonly CATEGORY_CYCLE_SEC = 30;
  private readonly BASE_POINTS = 10;
  private readonly XP_PER_CORRECT = 3;

  constructor(readonly audio: GameAudioService) {}

  ngOnInit() {
    this.startTime = Date.now();
    this.lives = this.attempt?.livesRemaining ?? 5;
    this.buildGrid();
    this.initCanvas();
    setTimeout(() => this.showSigns(), 500);
    this.loop(0);
  }

  ngOnDestroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
  }

  private buildGrid() {
    if (!this.questions.length) return;
    this.questionIndex = 0;
    this.pickRound();
  }

  private pickRound() {
    if (this.questionIndex >= this.questions.length) {
      this.finish();
      return;
    }
    const q = this.questions[this.questionIndex];
    this.currentTargetCategory = q.category;
    const same = this.questions.filter(x => x.category === q.category);
    const diff = this.questions.filter(x => x.category !== q.category);
    const pool: WhackawortQuestion[] = [];
    const correct = q;
    pool.push(correct);
    const shuffledDiff = [...diff].sort(() => Math.random() - 0.5);
    const needed = this.COLS * this.ROWS - 1;
    for (let i = 0; i < needed && i < shuffledDiff.length; i++) {
      pool.push(shuffledDiff[i]);
    }
    while (pool.length < this.COLS * this.ROWS) {
      pool.push({ _id: '', gameType: 'whackawort', order: 0, word: '---', translation: '', category: '' });
    }
    this.gridWords = [...pool].sort(() => Math.random() - 0.5);
    this.questionIndex++;
  }

  private initCanvas() {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.resize);
    canvas.addEventListener('click', this.onCanvasClick);
  }

  private resize = () => {
    const wrap = this.wrapRef.nativeElement;
    const canvas = this.canvasRef.nativeElement;
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
    this.layout(rect.width, rect.height);
  };

  private layout(w: number, h: number) {
    const headerH = 56;
    const bannerH = 40;
    const gridTop = headerH + bannerH + 12;
    const gridSize = Math.min(w, h - gridTop - 8);
    const gap = 6;
    const cellW = (gridSize - gap * (this.COLS + 1)) / this.COLS;
    const cellH = (gridSize - gap * (this.ROWS + 1)) / this.ROWS;
    const gridX = (w - gridSize) / 2;
    const gridY = gridTop + ((h - gridTop - 8) - gridSize) / 2;
    this.gridArea = { x: gridX, y: gridY, w: gridSize, h: gridSize };
    this.burrows = [];
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        this.burrows.push({
          x: gridX + gap + c * (cellW + gap),
          y: gridY + gap + r * (cellH + gap),
          w: cellW,
          h: cellH,
        });
      }
    }
    this.initSigns();
  }

  private initSigns() {
    this.signs = [];
    for (let i = 0; i < this.gridWords.length && i < this.burrows.length; i++) {
      const w = this.gridWords[i];
      const isTarget = w.category === this.currentTargetCategory;
      this.signs.push({
        word: w.word,
        translation: w.translation,
        category: w.category,
        burrowIndex: i,
        visible: false,
        opacity: 0,
        target: isTarget,
        tapped: false,
        correct: false,
        popProgress: 0,
      });
    }
  }

  private showSigns() {
    const shuffled = [...this.signs].sort(() => Math.random() - 0.5);
    shuffled.forEach((s, i) => {
      setTimeout(() => {
        s.visible = true;
        s.popProgress = 0;
      }, i * 80);
    });
  }

  private onCanvasClick = (e: MouseEvent) => {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!this.canTap(x, y)) return;

    for (const s of this.signs) {
      if (!s.visible || s.tapped) continue;
      if (s.word === '---') continue;
      const b = this.burrows[s.burrowIndex];
      if (!b) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        s.tapped = true;
        this.totalTaps++;
        if (s.target) {
          s.correct = true;
          this.correctCount++;
          this.combo++;
          if (this.combo > this.bestCombo) this.bestCombo = this.combo;
          this.score += this.BASE_POINTS + Math.min(this.combo - 1, 5) * 2;
          this.xpEarned += this.XP_PER_CORRECT;
          this.xpAmount = this.XP_PER_CORRECT;
          this.xpTrigger++;
          this.audio.playXpGain();
          this.triggerConfetti(x, y);
          this.audio.playCorrect();
          setTimeout(() => this.nextRound(), 600);
        } else {
          this.lives--;
          this.combo = 0;
          this.triggerBoom(x, y);
          this.audio.playWrong();
          if (this.lives <= 0) {
            setTimeout(() => this.finish(), 800);
          }
        }
        break;
      }
    }
  };

  private canTap(x: number, y: number): boolean {
    if (this.lives <= 0 || this.questionIndex > this.questions.length) return false;
    return true;
  }

  private triggerBoom(x: number, y: number) {
    this.boomShakeIntensity = 12;
    this.boomFlashOpacity = 1;
    this.boomRingRadius = 0;
    this.boomRingOpacity = 1;
    this.boomFragments = [];
    for (let i = 0; i < 24; i++) {
      const angle = (Math.PI * 2 * i) / 24;
      const speed = 80 + Math.random() * 120;
      this.boomFragments.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: 1,
        size: 6 + Math.random() * 8,
        color: `hsl(${Math.random() * 20}, 90%, 55%)`,
      });
    }
  }

  private triggerConfetti(x: number, y: number) {
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 160;
      this.confettiFragments.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 100,
        life: 1,
        size: 4 + Math.random() * 6,
        color: `hsl(${Math.random() * 360}, 90%, 60%)`,
      });
    }
  }

  private nextRound() {
    this.pickRound();
    this.initSigns();
    setTimeout(() => this.showSigns(), 300);
  }

  private finish() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    this.onComplete.emit({
      score: this.score,
      xpEarned: this.xpEarned,
      accuracy: this.totalTaps > 0 ? Math.round((this.correctCount / this.totalTaps) * 100) : 0,
      timeSpentSeconds: Math.round(elapsed),
      livesRemaining: Math.max(0, this.lives),
    });
  }

  private loop = (time: number) => {
    const dt = this.lastTime ? (time - this.lastTime) / 1000 : 0.016;
    this.lastTime = time;
    this.update(dt);
    this.draw();
    this.animId = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const prevCat = Math.floor((elapsed - dt) / this.CATEGORY_CYCLE_SEC);
    const curCat = Math.floor(elapsed / this.CATEGORY_CYCLE_SEC);
    if (curCat > prevCat) {
      this.categoryBannerOpacity = 0;
    }
    this.categoryBannerOpacity = Math.min(1, this.categoryBannerOpacity + dt * 2);

    for (const s of this.signs) {
      if (!s.visible) continue;
      if (s.popProgress < 1) {
        s.popProgress = Math.min(1, s.popProgress + dt * (1000 / this.SIGN_POP_DURATION));
      }
    }

    if (this.boomShakeIntensity > 0) {
      this.boomShakeIntensity *= 0.92;
      if (this.boomShakeIntensity < 0.5) this.boomShakeIntensity = 0;
    }
    if (this.boomFlashOpacity > 0) {
      this.boomFlashOpacity -= dt * 3;
      if (this.boomFlashOpacity < 0) this.boomFlashOpacity = 0;
    }
    if (this.boomRingOpacity > 0) {
      this.boomRingRadius += dt * 200;
      this.boomRingOpacity -= dt * 2;
      if (this.boomRingOpacity < 0) this.boomRingOpacity = 0;
    }
    for (const f of this.boomFragments) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 400 * dt;
      f.life -= dt * 1.5;
    }
    this.boomFragments = this.boomFragments.filter(f => f.life > 0);

    for (const f of this.confettiFragments) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 300 * dt;
      f.life -= dt * 1.2;
    }
    this.confettiFragments = this.confettiFragments.filter(f => f.life > 0);
  }

  private draw() {
    const canvas = this.canvasRef.nativeElement;
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    const ctx = this.ctx;

    ctx.save();
    if (this.boomShakeIntensity > 0) {
      const sx = (Math.random() - 0.5) * this.boomShakeIntensity;
      const sy = (Math.random() - 0.5) * this.boomShakeIntensity;
      ctx.translate(sx, sy);
    }

    this.drawBackground(ctx, w, h);
    this.drawHeader(ctx, w);
    this.drawCategoryBanner(ctx, w);
    this.drawGridLines(ctx, w, h);
    this.drawSigns(ctx);
    this.drawBoomEffects(ctx);
    this.drawConfetti(ctx);
    ctx.restore();
  }

  private drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const mud = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, w * 0.7);
    mud.addColorStop(0, '#6B4423');
    mud.addColorStop(0.5, '#5C3A1E');
    mud.addColorStop(1, '#3E2512');
    ctx.fillStyle = mud;
    ctx.fillRect(0, 0, w, h);
  }

  private drawGridLines(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const g = this.gridArea;
    if (!g.w) return;
    ctx.strokeStyle = '#2A1A0E';
    ctx.lineWidth = 12;

    const x1 = g.x + g.w / 3;
    const x2 = g.x + (g.w * 2) / 3;
    const y1 = g.y + g.h / 3;
    const y2 = g.y + (g.h * 2) / 3;

    ctx.beginPath();
    ctx.moveTo(x1, g.y); ctx.lineTo(x1, g.y + g.h);
    ctx.moveTo(x2, g.y); ctx.lineTo(x2, g.y + g.h);
    ctx.moveTo(g.x, y1); ctx.lineTo(g.x + g.w, y1);
    ctx.moveTo(g.x, y2); ctx.lineTo(g.x + g.w, y2);
    ctx.stroke();
  }

  private drawHeader(ctx: CanvasRenderingContext2D, w: number) {
    const h = 56;
    ctx.fillStyle = '#3E2512';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5C3A1E';
    ctx.fillRect(0, h - 2, w, 2);

    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u{1F3AF} Whack-a-Wort', 12, h / 2);

    ctx.textAlign = 'center';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#E8D5B7';
    ctx.fillText('Score: ' + this.score, w * 0.55, 16);
    ctx.fillStyle = '#A8D8EA';
    ctx.fillText('Combo: x' + this.combo, w * 0.55, 40);

    ctx.textAlign = 'right';
    let lx = w - 12;
    for (let i = 0; i < this.lives; i++) {
      ctx.fillStyle = '#ef4444';
      ctx.font = '18px sans-serif';
      ctx.fillText('\u2764', lx, h / 2);
      lx -= 24;
    }
  }

  private drawCategoryBanner(ctx: CanvasRenderingContext2D, w: number) {
    const y = 58;
    const h = 38;
    ctx.save();
    ctx.globalAlpha = this.categoryBannerOpacity;
    ctx.fillStyle = '#5C3A1E';
    ctx.fillRect(0, y, w, h);
    ctx.fillStyle = '#E8D5B7';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\uD83D\uDD0D Find: ' + this.currentTargetCategory, w / 2, y + h / 2);
    ctx.restore();
  }

  private drawBurrows(ctx: CanvasRenderingContext2D) {
    for (const b of this.burrows) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h * 0.7;
      const rx = b.w * 0.4;
      const ry = b.h * 0.15;

      ctx.fillStyle = '#2A1A0E';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 4, rx + 4, ry + 3, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1A0E06';
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0D0703';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, rx - 4, ry - 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSigns(ctx: CanvasRenderingContext2D) {
    for (let i = 0; i < this.signs.length; i++) {
      const s = this.signs[i];
      if (!s.visible || s.word === '---') continue;
      const b = this.burrows[s.burrowIndex];
      if (!b) continue;

      const cardW = b.w * 0.78;
      const cardH = b.h * 0.6;
      const cx = b.x + b.w / 2;
      const centerY = b.y + (b.h - cardH) / 2;

      const progress = s.popProgress;
      const eased = 1 - Math.pow(1 - progress, 3);
      const cy = centerY + cardH * (1 - eased);

      ctx.save();
      if (s.tapped) {
        ctx.globalAlpha = Math.max(0, 1 - (Date.now() - (this.lastTime as any)) / 400);
      }

      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;

      ctx.fillStyle = '#F5DEB3';
      ctx.strokeStyle = '#8B6914';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(cx - cardW / 2, cy, cardW, cardH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#8B6914';
      ctx.fillRect(cx - cardW / 2 + 8, cy + cardH - 4, cardW - 16, 3);

      ctx.fillStyle = '#4A3728';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.word, cx, cy + cardH * 0.35);

      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#888';
      ctx.fillText(s.translation, cx, cy + cardH * 0.65);

      ctx.restore();
    }
  }

  private drawBoomEffects(ctx: CanvasRenderingContext2D) {
    if (this.boomFlashOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = this.boomFlashOpacity * 0.3;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, this.canvasRef.nativeElement.width / devicePixelRatio, this.canvasRef.nativeElement.height / devicePixelRatio);
      ctx.restore();
    }
    if (this.boomRingOpacity > 0) {
      ctx.save();
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 3;
      ctx.globalAlpha = this.boomRingOpacity;
      ctx.beginPath();
      ctx.arc(0, 0, this.boomRingRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const f of this.boomFragments) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
      ctx.restore();
    }
  }

  private drawConfetti(ctx: CanvasRenderingContext2D) {
    for (const f of this.confettiFragments) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

}
