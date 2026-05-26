import { Component, OnDestroy, OnInit } from '@angular/core';

import { CommonModule } from '@angular/common';

import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { MaterialModule } from '../../../../shared/material.module';

import { ArenaSocketService } from '../../services/arena-socket.service';

import { MultiplayerHudComponent } from '../../shared/multiplayer-hud/multiplayer-hud.component';

import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';

import { ScrambleRushMpComponent } from '../../engines/scramble-rush-mp/scramble-rush-mp.component';

import { SentenceBuilderMpComponent } from '../../engines/sentence-builder-mp/sentence-builder-mp.component';

import { FlapjugationMpComponent } from '../../engines/flapjugation-mp/flapjugation-mp.component';
import { WhackawortMpComponent } from '../../engines/whackawort-mp/whackawort-mp.component';

import { NotificationService } from '../../../../services/notification.service';

import { AuthService } from '../../../../services/auth.service';

import { Subscription } from 'rxjs';

import {

  ArenaLeaderboardEntry,

  ArenaRoomState,

  ArenaBattleRound,

  ArenaBattleAnswerResult,

} from '../../glueck-arena.types';



@Component({

  selector: 'app-multiplayer-battle',

  standalone: true,

  imports: [

    CommonModule,

    RouterModule,

    MaterialModule,

    MultiplayerHudComponent,

    ConfettiBurstComponent,

    ScrambleRushMpComponent,

    SentenceBuilderMpComponent,

    FlapjugationMpComponent,
    WhackawortMpComponent,

  ],

  template: `

    <div class="mpb" [class.mpb--playing]="phase === 'playing'">

      <div class="mpb__top">

        <button mat-icon-button routerLink="/glueck-arena/multiplayer"><mat-icon>arrow_back</mat-icon></button>

        <h1>Battle · {{ roomCode }}</h1>

        <span class="mpb__net" [attr.data-q]="networkQuality" matTooltip="Connection quality">

          <mat-icon>{{ networkQuality === 'good' ? 'wifi' : networkQuality === 'fair' ? 'network_wifi_2_bar' : 'network_wifi_1_bar' }}</mat-icon>

        </span>

        <button mat-icon-button (click)="copyInvite()" matTooltip="Copy invite"><mat-icon>share</mat-icon></button>

      </div>



      <div class="mpb__connecting" *ngIf="!connected && !reconnecting">

        <mat-spinner diameter="40"></mat-spinner>

        <p>Connecting to arena…</p>

      </div>

      <div class="mpb__reconnect" *ngIf="reconnecting">

        <mat-icon class="mpb__spin">sync</mat-icon> Reconnecting…

      </div>



      <app-multiplayer-hud

        [leaderboard]="leaderboard"

        [countdown]="countdown"

        [connected]="connected"

        [reconnecting]="reconnecting"

      ></app-multiplayer-hud>



      <div class="mpb__lobby" *ngIf="phase === 'lobby' && room">

        <h3>{{ gameLabel }} · Players ({{ room.players.length }}/{{ room.maxPlayers }})</h3>

        <div class="mpb__player" *ngFor="let p of room.players">

          <span class="mpb__avatar">{{ p.name?.charAt(0) || '?' }}</span>

          <span>{{ p.name }}</span>

          <mat-icon *ngIf="p.isReady" color="primary">check_circle</mat-icon>

          <mat-icon *ngIf="!p.isConnected" class="mpb__offline">cloud_off</mat-icon>

        </div>

        <div class="mpb__actions">

          <button mat-raised-button color="primary" (click)="toggleReady()">

            {{ iAmReady ? 'Unready' : 'Ready' }}

          </button>

          <button mat-raised-button color="accent" *ngIf="isHost" (click)="start()" [disabled]="!allReady">

            Start battle

          </button>

        </div>

      </div>



      <div class="mpb__countdown" *ngIf="phase === 'countdown'">

        <div class="mpb__countdown-num">{{ countdown }}</div>

        <p>Get ready!</p>

      </div>



      <div class="mpb__engine" *ngIf="phase === 'playing' && battleRound">

        <app-scramble-rush-mp

          *ngIf="room?.gameType === 'scramble_rush'"

          [round]="battleRound"

          [localScore]="myScore"

          [answerResult]="lastAnswerResult"

          (submitAnswer)="onScrambleSubmit($event)"

        ></app-scramble-rush-mp>

        <app-sentence-builder-mp

          *ngIf="room?.gameType === 'sentence_builder'"

          [round]="battleRound"

          [localScore]="myScore"

          [answerResult]="lastAnswerResult"

          (submitAnswer)="onSentenceSubmit($event)"

        ></app-sentence-builder-mp>

        <app-flapjugation-mp

          *ngIf="room?.gameType === 'flapjugation'"

          [round]="battleRound"

          [localScore]="myScore"

          [answerResult]="lastAnswerResult"

          (submitAnswer)="onFlapjugationSubmit($event)"

        ></app-flapjugation-mp>

        <app-whackawort-mp

          *ngIf="room?.gameType === 'whackawort'"

          [round]="battleRound"

          [localScore]="myScore"

          [answerResult]="lastAnswerResult"

          (submitAnswer)="onWhackawortSubmit($event)"

        ></app-whackawort-mp>

      </div>



      <div class="mpb__between" *ngIf="phase === 'playing' && !battleRound">

        <mat-spinner diameter="32"></mat-spinner>

        <p>Loading next round…</p>

      </div>



      <div class="mpb__results" *ngIf="phase === 'finished' && results.length">

        <app-confetti-burst [active]="true"></app-confetti-burst>

        <h2>Victory!</h2>

        <div class="mpb__podium">

          <div *ngFor="let r of results.slice(0, 3); let i = index"

            class="mpb__podium-place" [class.mpb__podium-place--winner]="i === 0"

            [style.animation-delay.ms]="i * 120">

            <span class="mpb__medal">{{ i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉' }}</span>

            <strong>{{ r.name }}</strong>

            <span>{{ r.score }} pts</span>

          </div>

        </div>

        <div class="mpb__actions">

          <button mat-raised-button color="primary" (click)="rematch()">Rematch</button>

          <button mat-stroked-button routerLink="/glueck-arena">Back to games</button>

        </div>

      </div>

    </div>

  `,

  styles: [`

    .mpb { max-width: 720px; margin: 0 auto; padding: 16px; }

    .mpb__top { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }

    .mpb__top h1 { flex: 1; margin: 0; font-size: 18px; }

    .mpb__net[data-q="good"] mat-icon { color: #2e7d32; }

    .mpb__net[data-q="fair"] mat-icon { color: #f9a825; }

    .mpb__net[data-q="poor"] mat-icon { color: #c62828; }

    .mpb__connecting, .mpb__reconnect { text-align: center; padding: 24px; color: #666; }

    .mpb__spin { animation: spin 1s linear infinite; }

    @keyframes spin { to { transform: rotate(360deg); } }

    .mpb__player { display: flex; align-items: center; gap: 10px; padding: 10px; background: #f5f5f5; border-radius: 10px; margin-bottom: 6px; }

    .mpb__avatar { width: 32px; height: 32px; border-radius: 50%; background: #405980; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }

    .mpb__offline { color: #999; font-size: 18px; width: 18px; height: 18px; }

    .mpb__actions { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }

    .mpb__countdown { text-align: center; padding: 48px 0; }

    .mpb__countdown-num { font-size: 72px; font-weight: 800; color: #405980; animation: pulse 1s ease-in-out infinite; }

    @keyframes pulse { 50% { transform: scale(1.08); } }

    .mpb__between { text-align: center; padding: 32px; color: #888; }

    .mpb__results { text-align: center; padding: 24px 0; }

    .mpb__podium { display: flex; justify-content: center; align-items: flex-end; gap: 12px; margin: 24px 0; flex-wrap: wrap; }

    .mpb__podium-place { padding: 16px; background: #fff8e1; border-radius: 12px; min-width: 100px; animation: podium-in .5s ease-out both; }

    .mpb__podium-place--winner { transform: scale(1.08); background: linear-gradient(180deg,#fff8e1,#ffe082); box-shadow: 0 8px 24px rgba(255,193,7,.35); }

    @keyframes podium-in { from { opacity: 0; transform: translateY(20px); } }

    .mpb__medal { font-size: 32px; display: block; }

    @media (max-width: 480px) { .mpb { padding: 12px; } .mpb__countdown-num { font-size: 56px; } }

  `]

})

export class MultiplayerBattleComponent implements OnInit, OnDestroy {

  roomCode = '';

  room: ArenaRoomState | null = null;

  phase: string = 'lobby';

  countdown: number | null = null;

  leaderboard: ArenaLeaderboardEntry[] = [];

  results: ArenaLeaderboardEntry[] = [];

  battleRound: ArenaBattleRound | null = null;

  lastAnswerResult: ArenaBattleAnswerResult | null = null;

  connected = false;

  reconnecting = false;

  networkQuality: 'good' | 'fair' | 'poor' = 'good';

  iAmReady = false;

  isHost = false;

  allReady = false;

  myScore = 0;

  private myId = '';

  private subs: Subscription[] = [];



  get gameLabel(): string {

    if (this.room?.gameType === 'scramble_rush') return 'Scramble Rush';

    if (this.room?.gameType === 'sentence_builder') return 'Sentence Builder';

    if (this.room?.gameType === 'whackawort') return 'Whack-a-Wort';

    return 'Battle';

  }



  constructor(

    private route: ActivatedRoute,

    private router: Router,

    private socket: ArenaSocketService,

    private auth: AuthService,

    private notify: NotificationService

  ) {}



  ngOnInit() {

    this.roomCode = (this.route.snapshot.queryParamMap.get('code') || '').toUpperCase();

    const user = this.auth.getSnapshotUser();

    this.myId = String(user?._id || user?.id || '');



    if (!this.roomCode) {

      this.router.navigate(['/glueck-arena/multiplayer']);

      return;

    }



    this.socket.connect();

    this.socket.joinRoom(this.roomCode);



    this.subs.push(

      this.socket.connected$.subscribe(v => this.connected = v),

      this.socket.reconnecting$.subscribe(v => this.reconnecting = v),

      this.socket.networkQuality$.subscribe(q => this.networkQuality = q),

      this.socket.room$.subscribe(r => {

        this.room = r;

        if (r) {

          this.isHost = String(r.hostId) === this.myId;

          this.allReady = r.players?.length > 0 && r.players.every(p => p.isReady);

          const me = r.players?.find(p => String(p.studentId) === this.myId);

          if (me) this.myScore = me.score;

        }

      }),

      this.socket.phase$.subscribe(p => this.phase = p),

      this.socket.countdown$.subscribe(c => this.countdown = c),

      this.socket.leaderboard$.subscribe(lb => {

        this.leaderboard = lb.map(e => ({ ...e, isMe: String(e.studentId) === this.myId }));

        const me = lb.find(e => String(e.studentId) === this.myId);

        if (me) this.myScore = me.score;

      }),

      this.socket.battleRound$.subscribe(round => {

        this.battleRound = round;

        this.lastAnswerResult = null;

      }),

      this.socket.battleAnswerAck$.subscribe(ack => {

        this.lastAnswerResult = ack.result;

      }),

      this.socket.finished$.subscribe(f => {

        this.results = f.results.map(e => ({ ...e, isMe: String(e.studentId) === this.myId }));

        this.battleRound = null;

      }),

      this.socket.error$.subscribe(msg => this.notify.error(msg))

    );

  }



  ngOnDestroy() {

    this.subs.forEach(s => s.unsubscribe());

    this.socket.disconnect();

  }



  toggleReady() {

    this.iAmReady = !this.iAmReady;

    this.socket.setReady(this.iAmReady);

  }



  start() { this.socket.startGame(); }

  rematch() { this.socket.requestRematch(); }



  onScrambleSubmit(e: { typedWord: string }) {

    if (!this.battleRound) return;

    this.socket.submitBattleAnswer({

      roundIndex: this.battleRound.roundIndex,

      typedWord: e.typedWord,

    });

  }



  onSentenceSubmit(e: { orderedTokens: string[] }) {

    if (!this.battleRound) return;

    this.socket.submitBattleAnswer({

      roundIndex: this.battleRound.roundIndex,

      orderedTokens: e.orderedTokens,

    });

  }

  onFlapjugationSubmit(e: { typedWord: string; pronoun: string }) {

    if (!this.battleRound) return;

    this.socket.submitBattleAnswer({

      roundIndex: this.battleRound.roundIndex,

      typedWord: e.typedWord,

      pronoun: e.pronoun,

    });

  }

  onWhackawortSubmit(e: { word: string; category: string }) {

    if (!this.battleRound) return;

    this.socket.submitBattleAnswer({

      roundIndex: this.battleRound.roundIndex,

      word: e.word,

      category: e.category,

    });

  }

  copyInvite() {

    const url = `${window.location.origin}/glueck-arena/multiplayer/battle?code=${this.roomCode}`;

    navigator.clipboard?.writeText(url);

    this.notify.success('Invite link copied!');

  }

}

