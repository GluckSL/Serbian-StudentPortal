import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { ArenaSocketService } from '../../services/arena-socket.service';
import { MultiplayerHudComponent } from '../../shared/multiplayer-hud/multiplayer-hud.component';
import { ScrambleRushMpComponent } from '../../engines/scramble-rush-mp/scramble-rush-mp.component';
import { SentenceBuilderMpComponent } from '../../engines/sentence-builder-mp/sentence-builder-mp.component';
import {
  ArenaRoomState,
  ArenaBattleRound,
  ArenaLeaderboardEntry,
} from '../../glueck-arena.types';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-spectator-watch',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule, MultiplayerHudComponent, ScrambleRushMpComponent, SentenceBuilderMpComponent],
  template: `
    <div class="sw">
      <div class="sw__head">
        <button mat-icon-button routerLink="/glueck-arena/multiplayer"><mat-icon>arrow_back</mat-icon></button>
        <h1>Spectating · {{ roomCode }}</h1>
        <span class="sw__live" *ngIf="phase === 'playing'"><span class="sw__dot"></span> LIVE</span>
        <span class="sw__delay" *ngIf="delayed">Delayed feed (anti-cheat)</span>
      </div>

      <app-multiplayer-hud [leaderboard]="leaderboard" [connected]="connected" [reconnecting]="false"></app-multiplayer-hud>

      <div class="sw__waiting" *ngIf="!battleRound && phase !== 'finished'">
        <mat-spinner diameter="36"></mat-spinner>
        <p>Connecting to battle…</p>
      </div>

      <div class="sw__engine" *ngIf="battleRound && room">
        <app-scramble-rush-mp *ngIf="room.gameType === 'scramble_rush'"
          [round]="battleRound" [localScore]="0" [answerResult]="null"></app-scramble-rush-mp>
        <app-sentence-builder-mp *ngIf="room.gameType === 'sentence_builder'"
          [round]="battleRound" [localScore]="0" [answerResult]="null"></app-sentence-builder-mp>
        <p class="sw__readonly"><mat-icon>visibility</mat-icon> Read-only spectator view</p>
      </div>

      <div class="sw__results" *ngIf="phase === 'finished'">
        <h2>Battle finished</h2>
        <div *ngFor="let r of results">{{ r.rank }}. {{ r.name }} — {{ r.score }} pts</div>
      </div>
    </div>
  `,
  styles: [`
    .sw { max-width: 720px; margin: 0 auto; padding: 16px; }
    .sw__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .sw__head h1 { flex: 1; margin: 0; font-size: 18px; }
    .sw__live { color: #c62828; font-weight: 700; font-size: 13px; display: flex; align-items: center; gap: 6px; }
    .sw__dot { width: 8px; height: 8px; border-radius: 50%; background: #c62828; animation: pulse 1s infinite; }
    @keyframes pulse { 50% { opacity: .4; } }
    .sw__delay { font-size: 12px; color: #888; }
    .sw__waiting { text-align: center; padding: 48px; color: #666; }
    .sw__readonly { text-align: center; color: #888; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .sw__results { margin-top: 24px; text-align: center; }
  `]
})
export class SpectatorWatchComponent implements OnInit, OnDestroy {
  roomCode = '';
  room: ArenaRoomState | null = null;
  battleRound: ArenaBattleRound | null = null;
  leaderboard: ArenaLeaderboardEntry[] = [];
  results: ArenaLeaderboardEntry[] = [];
  phase = 'lobby';
  connected = false;
  delayed = false;
  private subs: Subscription[] = [];

  constructor(private route: ActivatedRoute, private socket: ArenaSocketService) {}

  ngOnInit() {
    this.roomCode = (this.route.snapshot.queryParamMap.get('code') || '').toUpperCase();
    this.socket.connect();
    this.socket.spectate(this.roomCode);

    this.subs.push(
      this.socket.connected$.subscribe(v => this.connected = v),
      this.socket.room$.subscribe(r => { this.room = r; if (r) this.phase = r.status === 'finished' ? 'finished' : this.phase; }),
      this.socket.phase$.subscribe(p => this.phase = p),
      this.socket.battleRound$.subscribe(r => this.battleRound = r),
      this.socket.leaderboard$.subscribe(lb => this.leaderboard = lb),
      this.socket.finished$.subscribe(f => { this.results = f.results; this.phase = 'finished'; }),
      this.socket.spectatorState$.subscribe(s => { this.delayed = s.delayed; }),
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.socket.disconnect();
  }
}
