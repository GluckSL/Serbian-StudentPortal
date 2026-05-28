import { Component, Input, Output, EventEmitter, OnChanges, OnInit, SimpleChanges, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ArenaBattleRound, ArenaBattleAnswerResult, ArenaBattleWhackawortQuestion } from '../../glueck-arena.types';

interface GridWord {
  word: string;
  translation: string;
  category: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

@Component({
  selector: 'app-whackawort-mp',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="wwmp-wrap" #wrap>
      <canvas #canvas class="wwmp-canvas"></canvas>
    </div>
  `,
  styles: [`
    .wwmp-wrap { position: relative; width: 100%; max-width: 600px; margin: 0 auto; }
    .wwmp-canvas { display: block; width: 100%; aspect-ratio: 1; border-radius: 12px; cursor: pointer; }
  `]
})
export class WhackawortMpComponent implements OnInit, OnChanges {
  @Input() round!: ArenaBattleRound | null;
  @Input() localScore = 0;
  @Input() answerResult: ArenaBattleAnswerResult | null = null;
  @Output() submitAnswer = new EventEmitter<{ word: string; category: string }>();

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('wrap', { static: true }) wrapRef!: ElementRef<HTMLDivElement>;

  private ctx!: CanvasRenderingContext2D;
  private animId = 0;
  private gridWords: GridWord[] = [];
  private q?: ArenaBattleWhackawortQuestion;
  private countdown = 0;
  private roundStart = 0;
  private canTap = true;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['round'] && this.round?.question) {
      this.setupRound();
    }
    if (changes['answerResult'] && this.answerResult) {
      this.canTap = false;
      setTimeout(() => {
        if (this.round?.question) {
          this.canTap = true;
          this.setupRound();
        }
      }, 600);
    }
  }

  ngOnDestroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
  }

  private setupRound() {
    this.q = this.round?.question as ArenaBattleWhackawortQuestion;
    if (!this.q) return;
    this.countdown = this.q.duration || 60;
    this.roundStart = Date.now();
    this.canTap = true;
    this.buildGrid();
  }

  private buildGrid() {
    if (!this.q) return;
    this.gridWords = [];
    const words = this.q.words || [];
    const canvas = this.canvasRef.nativeElement;
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    const cols = 3;
    const rows = 3;
    const gap = 8;
    const cellW = (w - gap * (cols + 1)) / cols;
    const cellH = (h - gap * (rows + 1)) / rows;

    const headerH = 50;
    const startY = headerH + gap;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= words.length) break;
        const word = words[idx];
        this.gridWords.push({
          word: word.word,
          translation: word.translation,
          category: word.category,
          x: gap + c * (cellW + gap),
          y: startY + r * (cellH + gap),
          w: cellW,
          h: cellH,
        });
      }
    }
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
    const size = Math.min(rect.width, 600);
    canvas.width = size * devicePixelRatio;
    canvas.height = size * devicePixelRatio;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
    if (this.q) this.buildGrid();
  };

  private onCanvasClick = (e: MouseEvent) => {
    if (!this.canTap || !this.q) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (const gw of this.gridWords) {
      if (x >= gw.x && x <= gw.x + gw.w && y >= gw.y && y <= gw.y + gw.h) {
        this.canTap = false;
        this.submitAnswer.emit({ word: gw.word, category: gw.category });
        return;
      }
    }
  };

  ngOnInit() {
    this.initCanvas();
    this.loop(0);
  }

  private loop = (time: number) => {
    this.draw();
    this.animId = requestAnimationFrame(this.loop);
  };

  private draw() {
    const canvas = this.canvasRef.nativeElement;
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    const ctx = this.ctx;

    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#5DBE5D';
    ctx.fillRect(0, h - 20, w, 20);

    ctx.fillStyle = 'rgba(30,58,95,0.92)';
    ctx.fillRect(0, 0, w, 50);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Find: ' + (this.q?.targetCategory || ''), w / 2, 25);

    const scoreW = Math.min(100, w * 0.25);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.roundRect(w - scoreW - 8, 6, scoreW, 38, 6);
    ctx.fill();
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('' + this.localScore, w - 14, 25);

    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    const rem = this.countdown - Math.floor((Date.now() - this.roundStart) / 1000);
    ctx.fillText('' + Math.max(0, rem) + 's', 14, 25);

    for (const gw of this.gridWords) {
      ctx.fillStyle = '#F5DEB3';
      ctx.strokeStyle = '#8B4513';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(gw.x, gw.y, gw.w, gw.h, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#4A3728';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(gw.word, gw.x + gw.w / 2, gw.y + gw.h * 0.4);

      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#888';
      ctx.fillText(gw.translation, gw.x + gw.w / 2, gw.y + gw.h * 0.7);
    }
  }
}
