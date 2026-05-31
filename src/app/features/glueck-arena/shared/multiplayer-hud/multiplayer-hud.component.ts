import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { ArenaLeaderboardEntry } from '../../glueck-arena.types';

@Component({
  selector: 'app-multiplayer-hud',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  template: `
    <div class="mph">
      <div class="mph__status" *ngIf="countdown !== null">
        <span class="mph__countdown">{{ countdown }}</span>
      </div>
      <div class="mph__live" *ngIf="connected">
        <span class="mph__dot"></span> Live
      </div>
      <div class="mph__reconnect" *ngIf="reconnecting">Reconnecting…</div>
      <div class="mph__board">
        <div *ngFor="let p of leaderboard; let i = index" class="mph__row"
          [class.mph__row--me]="p.isMe" [class.mph__row--top]="i < 3">
          <span class="mph__rank">#{{ p.rank || i + 1 }}</span>
          <span class="mph__name">{{ p.name }}</span>
          <span class="mph__presence" [class.mph__presence--off]="p.isConnected === false">●</span>
          <span class="mph__score">{{ p.score }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .mph { background: rgba(255,255,255,.95); border-radius: 16px; padding: 12px 16px; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
    .mph__countdown { font-size: 48px; font-weight: 800; color: #ff8f00; display: block; text-align: center; animation: pulse 1s infinite; }
    .mph__live { font-size: 12px; color: #2e7d32; display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .mph__dot { width: 8px; height: 8px; background: #2e7d32; border-radius: 50%; animation: blink 1.2s infinite; }
    .mph__reconnect { color: #e65100; font-size: 13px; margin-bottom: 8px; }
    .mph__row { display: grid; grid-template-columns: 36px 1fr 16px 48px; gap: 8px; padding: 6px 0; border-bottom: 1px solid #eee; align-items: center; transition: transform .2s; }
    .mph__row--me { background: #e3f2fd; border-radius: 8px; padding: 6px 8px; }
    .mph__row--top .mph__rank { color: #ff8f00; font-weight: 800; }
    .mph__presence { color: #2e7d32; font-size: 10px; }
    .mph__presence--off { color: #bbb; }
    .mph__score { font-weight: 700; text-align: right; }
    @keyframes pulse { 0%,100%{ transform: scale(1); } 50%{ transform: scale(1.1); } }
    @keyframes blink { 0%,100%{ opacity: 1; } 50%{ opacity: .4; } }
  `]
})
export class MultiplayerHudComponent {
  @Input() leaderboard: ArenaLeaderboardEntry[] = [];
  @Input() countdown: number | null = null;
  @Input() connected = false;
  @Input() reconnecting = false;
}
