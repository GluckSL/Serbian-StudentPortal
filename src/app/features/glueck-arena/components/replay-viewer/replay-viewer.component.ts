import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { ArenaReplayDto } from '../../glueck-arena.types';

@Component({
  selector: 'app-replay-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MaterialModule],
  template: `
    <div class="rv" *ngIf="replay">
      <div class="rv__head">
        <button mat-icon-button routerLink="/glueck-arena"><mat-icon>arrow_back</mat-icon></button>
        <h1>Battle Replay</h1>
        <button mat-stroked-button (click)="copyShare()"><mat-icon>share</mat-icon> Share</button>
      </div>

      <div class="rv__meta">
        <span>{{ replay.gameType | titlecase }}</span>
        <span>{{ replay.durationMs / 1000 | number:'1.0-0' }}s</span>
        <span *ngIf="replay.highlights?.length">Highlights: {{ (replay.highlights || []).join(', ') }}</span>
      </div>

      <div class="rv__controls">
        <button mat-icon-button (click)="togglePlay()">
          <mat-icon>{{ playing ? 'pause' : 'play_arrow' }}</mat-icon>
        </button>
        <input type="range" class="rv__slider" min="0" [max]="replay.durationMs" step="100"
          [(ngModel)]="playheadMs" (ngModelChange)="seek($event)">
        <span>{{ playheadMs / 1000 | number:'1.1-1' }}s</span>
      </div>

      <div class="rv__timeline">
        <div class="rv__event" *ngFor="let e of visibleEvents"
          [class.rv__event--highlight]="isHighlight(e.type)"
          [style.left.%]="(e.t / replay.durationMs) * 100">
          <mat-icon>{{ iconFor(e.type) }}</mat-icon>
          <span>{{ e.type }}</span>
        </div>
      </div>

      <mat-card class="rv__now" *ngIf="currentEvent">
        <mat-card-content>{{ currentEvent.type }} at {{ currentEvent.t / 1000 | number:'1.1-1' }}s</mat-card-content>
      </mat-card>
    </div>
    <mat-spinner *ngIf="loading" class="rv__spin"></mat-spinner>
  `,
  styles: [`
    .rv { max-width: 800px; margin: 0 auto; padding: 16px; }
    .rv__head { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    .rv__head h1 { flex: 1; margin: 0; }
    .rv__meta { display: flex; gap: 16px; flex-wrap: wrap; color: #666; margin-bottom: 16px; font-size: 14px; }
    .rv__controls { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .rv__slider { flex: 1; }
    .rv__timeline { position: relative; height: 80px; background: #f0f5ff; border-radius: 12px; margin-bottom: 16px; overflow: hidden; }
    .rv__event { position: absolute; top: 8px; transform: translateX(-50%); font-size: 10px; text-align: center; }
    .rv__event mat-icon { font-size: 18px; width: 18px; height: 18px; display: block; margin: 0 auto; }
    .rv__event--highlight mat-icon { color: #ff8f00; }
    .rv__spin { margin: 48px auto; display: block; }
  `]
})
export class ReplayViewerComponent implements OnInit, OnDestroy {
  replay: ArenaReplayDto | null = null;
  loading = true;
  playing = false;
  playheadMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private route: ActivatedRoute, private svc: InteractiveGameService) {}

  get visibleEvents() {
    if (!this.replay) return [];
    return this.replay.events.filter(e => e.t <= this.playheadMs);
  }

  get currentEvent() {
    const ev = this.visibleEvents;
    return ev.length ? ev[ev.length - 1] : null;
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('idOrToken') || '';
    this.svc.getReplay(id).subscribe({
      next: r => {
        this.replay = { ...r.replay, id: r.replay.id || id };
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  ngOnDestroy() {
    this.stopTimer();
  }

  togglePlay() {
    this.playing = !this.playing;
    if (this.playing) {
      this.timer = setInterval(() => {
        if (!this.replay) return;
        this.playheadMs += 200;
        if (this.playheadMs >= this.replay.durationMs) {
          this.playheadMs = this.replay.durationMs;
          this.stopTimer();
          this.playing = false;
        }
      }, 200);
    } else {
      this.stopTimer();
    }
  }

  seek(ms: number) {
    this.playheadMs = ms;
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isHighlight(type: string) {
    return ['fastest_answer', 'combo_streak', 'battle_finish'].includes(type);
  }

  iconFor(type: string): string {
    const m: Record<string, string> = {
      round_start: 'flag',
      answer: 'check',
      fastest_answer: 'bolt',
      battle_finish: 'emoji_events',
    };
    return m[type] || 'circle';
  }

  copyShare() {
    if (!this.replay?.shareToken) return;
    const url = `${window.location.origin}/glueck-arena/replays/${this.replay.shareToken}`;
    navigator.clipboard?.writeText(url);
  }
}
