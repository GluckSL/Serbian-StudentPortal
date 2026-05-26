import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../shared/material.module';
import { ArenaSocketService } from '../../services/arena-socket.service';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { BattlefieldChatComponent } from '../../shared/battlefield-chat/battlefield-chat.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { ScrambleRushMpComponent } from '../../engines/scramble-rush-mp/scramble-rush-mp.component';
import { SentenceBuilderMpComponent } from '../../engines/sentence-builder-mp/sentence-builder-mp.component';
import { ImageMatchingMpComponent } from '../../engines/image-matching-mp/image-matching-mp.component';
import { GenderStackMpComponent } from '../../engines/gender-stack-mp/gender-stack-mp.component';
import { FlashCardsMpComponent } from '../../engines/flash-cards-mp/flash-cards-mp.component';
import { MatchingMpComponent } from '../../engines/matching-mp/matching-mp.component';
import { FlapjugationMpComponent } from '../../engines/flapjugation-mp/flapjugation-mp.component';
import { WhackawortMpComponent } from '../../engines/whackawort-mp/whackawort-mp.component';
import {
  ArenaRoomState, ArenaLeaderboardEntry, ArenaBattleRound, ArenaBattleAnswerResult,
  ChatMessage,
} from '../../glueck-arena.types';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../../services/auth.service';

@Component({
  selector: 'app-battlefield-room',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule, MaterialModule,
    BattlefieldChatComponent, ConfettiBurstComponent,
    ScrambleRushMpComponent, SentenceBuilderMpComponent,
    ImageMatchingMpComponent, GenderStackMpComponent,
    FlashCardsMpComponent, MatchingMpComponent, FlapjugationMpComponent,
    WhackawortMpComponent,
  ],
  template: `
    <div class="bfroom">
      <!-- Loading -->
      <div class="bfroom__loading" *ngIf="!room">
        <mat-spinner diameter="40"></mat-spinner>
        <span>Joining room…</span>
      </div>

      <ng-container *ngIf="room">
        <!-- Top bar -->
        <div class="bfroom__topbar">
          <button mat-icon-button (click)="leave()" aria-label="Back">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <div class="bfroom__topbar-info">
            <span class="bfroom__topbar-name">{{ room.roomName || 'Battle Room' }}</span>
            <span class="bfroom__topbar-code">Code: {{ room.inviteCode }}</span>
          </div>
          <div class="bfroom__topbar-status">
            <span class="bfroom__status-badge" [class.bfroom__status-badge--playing]="phase === 'playing'">
              {{ phase | titlecase }}
            </span>
          </div>
          <span class="bfroom__copied" *ngIf="copiedInvite">Link copied!</span>
          <button mat-stroked-button (click)="copyInvite()" class="bfroom__invite-btn">
            <mat-icon>link</mat-icon> Invite
          </button>
        </div>

        <!-- 3-column layout -->
        <div class="bfroom__layout" [class.bfroom__layout--finished]="phase === 'finished'">
          <!-- LEFT: Game Info -->
          <aside class="bfroom__left">
            <div class="bfroom__info-card">
              <h3><mat-icon>info</mat-icon> Game Info</h3>
              <div class="bfroom__info-row">
                <span class="bfroom__info-label">Game</span>
                <span class="bfroom__info-value">{{ formatGameType(room.gameType) }}</span>
              </div>
              <div class="bfroom__info-row">
                <span class="bfroom__info-label">Host</span>
                <span class="bfroom__info-value">{{ hostName }}</span>
              </div>
              <div class="bfroom__info-row" *ngIf="phase === 'playing' && currentRound">
                <span class="bfroom__info-label">Round</span>
                <span class="bfroom__info-value">{{ currentRound.roundIndex + 1 }} / {{ currentRound.totalRounds }}</span>
              </div>
            </div>

            <div class="bfroom__scoreboard">
              <h3><mat-icon>leaderboard</mat-icon> Scores</h3>
              <div class="bfroom__score-row" *ngFor="let p of sortedPlayers; let i = index"
                [class.bfroom__score-row--me]="p.studentId === userId"
                [class.bfroom__score-row--host]="p.studentId === room.hostId">
                <span class="bfroom__score-rank">#{{ i + 1 }}</span>
                <span class="bfroom__score-name">{{ p.name }}</span>
                <span class="bfroom__score-pts">{{ p.score }}</span>
                <span class="bfroom__score-status">
                  <span class="bfroom__conn-dot" [class.bfroom__conn-dot--off]="!p.isConnected"></span>
                </span>
              </div>
              <div class="bfroom__score-empty" *ngIf="!sortedPlayers.length">
                <mat-icon>people_outline</mat-icon> No players yet
              </div>
            </div>

            <!-- Lobby controls -->
            <div class="bfroom__lobby-controls" *ngIf="phase === 'lobby' || phase === 'countdown'">
              <button mat-raised-button
                [color]="isReady ? 'warn' : 'primary'"
                (click)="toggleReady()"
                [disabled]="phase === 'countdown'">
                {{ isReady ? 'Not Ready' : 'Ready' }}
              </button>
              <button mat-raised-button color="accent"
                *ngIf="isHost"
                (click)="startGame()"
                [disabled]="phase !== 'lobby' || !allReady">
                <mat-icon>play_arrow</mat-icon> Start Battle
              </button>
              <button mat-stroked-button color="warn"
                *ngIf="isHost"
                (click)="cancelGame()">
                <mat-icon>cancel</mat-icon> Cancel Room
              </button>
            </div>
          </aside>

          <!-- CENTER: Game Area -->
          <main class="bfroom__center">
            <!-- Lobby phase -->
            <div class="bfroom__lobby" *ngIf="phase === 'lobby'">
              <div class="bfroom__lobby-card">
                <mat-icon class="bfroom__lobby-icon">sports_esports</mat-icon>
                <h2>Waiting for players…</h2>
                <p>Share the invite code <strong>{{ room.inviteCode }}</strong> to let others join</p>
                <div class="bfroom__lobby-players">
                  <div class="bfroom__lobby-player" *ngFor="let p of room.players">
                    <div class="bfroom__lobby-avatar">{{ p.name.charAt(0).toUpperCase() }}</div>
                    <div class="bfroom__lobby-pinfo">
                      <span class="bfroom__lobby-pname">{{ p.name }}</span>
                      <span class="bfroom__lobby-pstatus">{{ p.isReady ? 'Ready' : 'Not ready' }}</span>
                    </div>
                    <span class="bfroom__lobby-badge" *ngIf="p.studentId === room.hostId">HOST</span>
                    <mat-icon class="bfroom__lobby-check"
                      [class.bfroom__lobby-check--ok]="p.isReady"
                      [class.bfroom__lobby-check--pending]="!p.isReady">
                      {{ p.isReady ? 'check_circle' : 'hourglass_empty' }}
                    </mat-icon>
                  </div>
                </div>
                <div class="bfroom__lobby-hint" *ngIf="room.players.length < 2">
                  <mat-icon>info</mat-icon> Need at least 2 players to start
                </div>
              </div>
            </div>

            <!-- Countdown phase -->
            <div class="bfroom__countdown" *ngIf="phase === 'countdown'">
              <div class="bfroom__countdown-num">{{ countdown }}</div>
              <span>Get ready!</span>
            </div>

            <!-- Playing phase - Game Engine Rendered Here -->
            <div class="bfroom__game" *ngIf="phase === 'playing'">
              <!-- Engine placeholder - actual component loaded dynamically -->
              <div class="bfroom__engine-wrapper">
                <ng-container [ngSwitch]="room.gameType">
                  <app-scramble-rush-mp *ngSwitchCase="'scramble_rush'"
                    [round]="currentRound" [localScore]="myScore" [answerResult]="lastResult"
                    (submitAnswer)="onAnswer($event)">
                  </app-scramble-rush-mp>
                  <app-sentence-builder-mp *ngSwitchCase="'sentence_builder'"
                    [round]="currentRound" [localScore]="myScore" [answerResult]="lastResult"
                    (submitAnswer)="onAnswer($event)">
                  </app-sentence-builder-mp>
                  <app-image-matching-mp *ngSwitchCase="'image_matching'"
                    [round]="currentRound" [localScore]="myScore" [answerResult]="lastResult"
                    (submitAnswer)="onAnswer($event)">
                  </app-image-matching-mp>
                  <app-gender-stack-mp *ngSwitchCase="'gender_stack'"
                    [round]="currentRound" [localScore]="myScore" [answerResult]="lastResult"
                    (submitAnswer)="onAnswer($event)">
                  </app-gender-stack-mp>
                  <app-flash-cards-mp *ngSwitchCase="'flashcards'"
                    [round]="currentRound" [localScore]="myScore" [answerResult]="lastResult"
                    (submitAnswer)="onAnswer($event)">
                  </app-flash-cards-mp>
                  <app-matching-mp *ngSwitchCase="'matching'"
                    [round]="currentRound" [localScore]="myScore" [answerResult]="lastResult"
                    (submitAnswer)="onAnswer($event)">
                  </app-matching-mp>
                  <app-flapjugation-mp *ngSwitchCase="'flapjugation'"
                    [round]="currentRound" [localScore]="myScore" [answerResult]="lastResult"
                    (submitAnswer)="onAnswer($event)">
                  </app-flapjugation-mp>
                  <app-whackawort-mp *ngSwitchCase="'whackawort'"
                    [round]="currentRound" [localScore]="myScore" [answerResult]="lastResult"
                    (submitAnswer)="onAnswer($event)">
                  </app-whackawort-mp>
                </ng-container>
                <div class="bfroom__engine-fallback" *ngIf="!currentRound">
                  <mat-spinner diameter="32"></mat-spinner>
                  <span>Waiting for round…</span>
                </div>
              </div>
            </div>

            <!-- Finished phase -->
            <div class="bfroom__finished" *ngIf="phase === 'finished'">
              <mat-icon class="bfroom__finished-icon">emoji_events</mat-icon>
              <h2>Battle Complete!</h2>
              <div class="bfroom__podium">
                <div class="bfroom__podium-item bfroom__podium-item--1" *ngIf="sortedPlayers[0]">
                  <span class="bfroom__podium-medal">🥇</span>
                  <span class="bfroom__podium-name">{{ sortedPlayers[0].name }}</span>
                  <span class="bfroom__podium-score">{{ sortedPlayers[0].score }} pts</span>
                </div>
                <div class="bfroom__podium-item bfroom__podium-item--2" *ngIf="sortedPlayers[1]">
                  <span class="bfroom__podium-medal">🥈</span>
                  <span class="bfroom__podium-name">{{ sortedPlayers[1].name }}</span>
                  <span class="bfroom__podium-score">{{ sortedPlayers[1].score }} pts</span>
                </div>
                <div class="bfroom__podium-item bfroom__podium-item--3" *ngIf="sortedPlayers[2]">
                  <span class="bfroom__podium-medal">🥉</span>
                  <span class="bfroom__podium-name">{{ sortedPlayers[2].name }}</span>
                  <span class="bfroom__podium-score">{{ sortedPlayers[2].score }} pts</span>
                </div>
              </div>
              <div class="bfroom__finished-actions">
                <button mat-raised-button color="primary" (click)="rematch()">
                  <mat-icon>replay</mat-icon> Rematch
                </button>
                <button mat-stroked-button (click)="leave()">
                  <mat-icon>exit_to_app</mat-icon> Leave
                </button>
              </div>
            </div>
          </main>

          <!-- RIGHT: Chat -->
          <aside class="bfroom__right">
            <app-battlefield-chat
              [messages]="chatMessages"
              [currentUserId]="userId"
              (sendMessage)="onSendMessage($event)">
            </app-battlefield-chat>
          </aside>
        </div>
      </ng-container>

      <app-confetti-burst [active]="showConfetti"></app-confetti-burst>
    </div>
  `,
  styles: [`
    .bfroom { display: flex; flex-direction: column; height: calc(100vh - 64px); max-height: calc(100vh - 64px); overflow: hidden; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 14px; }
    .bfroom__loading { display: flex; align-items: center; justify-content: center; gap: 12px; height: 100%; color: #64748b; font-size: 16px; }

    .bfroom__topbar { display: flex; align-items: center; gap: 12px; padding: 8px 16px; background: #fff; border-bottom: 1px solid #e2e8f0; z-index: 2; }
    .bfroom__topbar-info { flex: 1; }
    .bfroom__topbar-name { display: block; font-size: 16px; font-weight: 700; color: #1e293b; }
    .bfroom__topbar-code { font-size: 12px; color: #64748b; font-family: monospace; }
    .bfroom__topbar-status { margin-right: 8px; }
    .bfroom__status-badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; background: #f1f5f9; color: #64748b; }
    .bfroom__status-badge--playing { background: #dcfce7; color: #15803d; }
    .bfroom__invite-btn mat-icon { font-size: 18px; }
    .bfroom__copied { font-size: 12px; color: #15803d; font-weight: 700; animation: fade-in 0.2s ease; }
    @keyframes fade-in { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; transform: translateX(0); } }

    .bfroom__layout { display: grid; grid-template-columns: 240px 1fr 280px; gap: 0; flex: 1; overflow: hidden; }
    .bfroom__layout--finished { grid-template-columns: 240px 1fr 280px; }

    /* LEFT */
    .bfroom__left { display: flex; flex-direction: column; gap: 0; overflow-y: auto; background: #fff; border-right: 1px solid #e2e8f0; }
    .bfroom__info-card { padding: 16px; border-bottom: 1px solid #f1f5f9; }
    .bfroom__info-card h3, .bfroom__scoreboard h3 { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 12px; }
    .bfroom__info-card h3 mat-icon, .bfroom__scoreboard h3 mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .bfroom__info-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid #f8fafc; }
    .bfroom__info-label { color: #94a3b8; }
    .bfroom__info-value { font-weight: 600; color: #1e293b; }

    .bfroom__scoreboard { padding: 16px; flex: 1; }
    .bfroom__score-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; margin-bottom: 4px; font-size: 13px; }
    .bfroom__score-row--me { background: #eff6ff; }
    .bfroom__score-row--host { border-left: 3px solid #ff8f00; }
    .bfroom__score-rank { font-weight: 800; color: #94a3b8; min-width: 24px; }
    .bfroom__score-name { flex: 1; font-weight: 600; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bfroom__score-pts { font-weight: 800; color: #405980; }
    .bfroom__score-status { display: flex; }
    .bfroom__conn-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; display: inline-block; }
    .bfroom__conn-dot--off { background: #ef4444; }
    .bfroom__score-empty { display: flex; align-items: center; gap: 6px; padding: 24px 0; color: #94a3b8; font-size: 13px; justify-content: center; }
    .bfroom__score-empty mat-icon { font-size: 20px; width: 20px; height: 20px; }

    .bfroom__lobby-controls { padding: 16px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid #f1f5f9; }

    /* CENTER */
    .bfroom__center { display: flex; flex-direction: column; align-items: center; overflow-y: auto; padding: 24px; flex: 1; }
    .bfroom__lobby { flex: 1; display: flex; align-items: center; justify-content: center; }
    .bfroom__countdown { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .bfroom__game { flex: 1; display: flex; flex-direction: column; width: 100%; max-width: 800px; }
    .bfroom__engine-wrapper { flex: 1; display: flex; align-items: center; justify-content: center; }
    .bfroom__finished { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .bfroom__lobby-card { text-align: center; max-width: 420px; width: 100%; }
    .bfroom__lobby-icon { font-size: 64px; width: 64px; height: 64px; color: #405980; }
    .bfroom__lobby-card h2 { margin: 16px 0 8px; font-size: 22px; color: #1e293b; }
    .bfroom__lobby-card p { color: #64748b; font-size: 14px; }
    .bfroom__lobby-players { margin: 24px 0; display: flex; flex-direction: column; gap: 8px; }
    .bfroom__lobby-player { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #f8fafc; border-radius: 12px; }
    .bfroom__lobby-avatar { width: 40px; height: 40px; border-radius: 50%; background: #405980; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; }
    .bfroom__lobby-pinfo { flex: 1; text-align: left; }
    .bfroom__lobby-pname { display: block; font-weight: 700; font-size: 14px; color: #1e293b; }
    .bfroom__lobby-pstatus { font-size: 12px; color: #94a3b8; }
    .bfroom__lobby-badge { font-size: 10px; font-weight: 800; color: #ff8f00; background: #fffbeb; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em; }
    .bfroom__lobby-check { color: #94a3b8; }
    .bfroom__lobby-check--ok { color: #22c55e; }
    .bfroom__lobby-check--pending { color: #f59e0b; }
    .bfroom__lobby-hint { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #94a3b8; justify-content: center; }

    .bfroom__countdown { display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .bfroom__countdown-num { font-size: 96px; font-weight: 900; color: #405980; animation: count-pop 0.5s ease; }
    @keyframes count-pop { 0% { transform: scale(1.5); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }

    .bfroom__engine-fallback { display: flex; flex-direction: column; align-items: center; gap: 12px; color: #94a3b8; padding: 48px; }

    .bfroom__finished { text-align: center; padding: 32px; }
    .bfroom__finished-icon { font-size: 72px; width: 72px; height: 72px; color: #ff8f00; }
    .bfroom__finished h2 { margin: 16px 0 24px; font-size: 28px; color: #1e293b; }
    .bfroom__podium { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 24px; }
    .bfroom__podium-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 20px; background: #fff; border-radius: 16px; min-width: 120px; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
    .bfroom__podium-item--1 { background: linear-gradient(180deg, #fef3c7, #fff); border: 2px solid #f59e0b; }
    .bfroom__podium-item--2 { background: linear-gradient(180deg, #f1f5f9, #fff); border: 2px solid #cbd5e1; }
    .bfroom__podium-item--3 { background: linear-gradient(180deg, #fef2f2, #fff); border: 2px solid #fca5a5; }
    .bfroom__podium-medal { font-size: 32px; }
    .bfroom__podium-name { font-weight: 700; font-size: 16px; color: #1e293b; }
    .bfroom__podium-score { font-weight: 800; color: #405980; font-size: 18px; }
    .bfroom__finished-actions { display: flex; gap: 12px; justify-content: center; }

    /* RIGHT */
    .bfroom__right { background: #fff; border-left: 1px solid #e2e8f0; display: flex; flex-direction: column; overflow: hidden; }

    @media (max-width: 1024px) {
      .bfroom__layout { grid-template-columns: 200px 1fr; grid-template-rows: 1fr 280px; }
      .bfroom__right { grid-column: 1 / -1; border-left: none; border-top: 1px solid #e2e8f0; }
    }
    @media (max-width: 640px) {
      .bfroom__layout { grid-template-columns: 1fr; grid-template-rows: auto 80dvh 260px; overflow-y: auto; }
      .bfroom__left { border-right: none; border-bottom: 1px solid #e2e8f0; max-height: 200px; }
      .bfroom__center { padding: 16px; }
    }
  `]
})
export class BattlefieldRoomComponent implements OnInit, OnDestroy {
  room: ArenaRoomState | null = null;
  phase: string = 'lobby';
  countdown: number | null = null;
  userId = '';
  isReady = false;
  currentRound: ArenaBattleRound | null = null;
  lastResult: ArenaBattleAnswerResult | null = null;
  chatMessages: ChatMessage[] = [];
  showConfetti = false;
  copiedInvite = false;

  private subs: Subscription[] = [];
  private code = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private socket: ArenaSocketService,
    private svc: InteractiveGameService,
    private auth: AuthService,
  ) {}

  get isHost(): boolean {
    return this.room?.hostId === this.userId;
  }

  get hostName(): string {
    const host = this.room?.players?.find(p => p.studentId === this.room?.hostId);
    return host?.name || 'Unknown';
  }

  get myScore(): number {
    const me = this.room?.players?.find(p => p.studentId === this.userId);
    return me?.score || 0;
  }

  get sortedPlayers(): any[] {
    return [...(this.room?.players || [])].sort((a, b) => b.score - a.score);
  }

  get allReady(): boolean {
    const players = this.room?.players;
    return players ? players.length >= 2 && players.every(p => p.isReady) : false;
  }

  ngOnInit() {
    this.code = this.route.snapshot.paramMap.get('code') || '';
    if (!this.code) {
      this.router.navigate(['/glueck-arena/battlefield']);
      return;
    }

    this.socket.connect();

    setTimeout(() => {
      if (!this.room) this.router.navigate(['/glueck-arena/battlefield']);
    }, 5000);

    this.subs.push(this.socket.room$.subscribe(room => {
      this.room = room;
      if (room) {
        this.phase = room.status;
        this.sortedPlayers; // trigger re-evaluation
      }
    }));

    this.subs.push(this.socket.phase$.subscribe(p => this.phase = p));

    this.subs.push(this.socket.countdown$.subscribe(c => this.countdown = c));

    this.subs.push(this.socket.battleRound$.subscribe(r => {
      this.currentRound = r;
      this.lastResult = null;
    }));

    this.subs.push(this.socket.battleAnswerAck$.subscribe(ack => {
      if (ack.result) {
        this.lastResult = ack.result;
      }
    }));

    this.subs.push(this.socket.finished$.subscribe(() => {
      this.showConfetti = true;
      setTimeout(() => this.showConfetti = false, 3000);
    }));

    this.subs.push(this.socket.chatMessage$.subscribe(msg => {
      this.chatMessages = [...this.chatMessages, msg];
    }));

    this.subs.push(this.socket.chatHistory$.subscribe(history => {
      if (history?.length) this.chatMessages = history;
    }));

    this.subs.push(this.socket.error$.subscribe(err => {
      console.error('[battlefield]', err);
      if (/not found|not exist|expired|cannot start/i.test(err)) {
        this.router.navigate(['/glueck-arena/battlefield']);
      }
    }));

    this.subs.push(this.socket.room$.subscribe(room => {
      if (!room && this.room) this.leave();
    }));

    this.subs.push(this.auth.currentUser$.subscribe(u => {
      if (u) this.userId = (u as any)._id || '';
    }));

    this.socket.joinRoom(this.code);
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.socket.disconnect();
  }

  toggleReady() {
    this.isReady = !this.isReady;
    this.socket.setReady(this.isReady);
  }

  startGame() {
    this.socket.startGame();
  }

  cancelGame() {
    this.socket.cancelRoom();
  }

  onAnswer(payload: any) {
    this.socket.submitBattleAnswer(payload);
  }

  rematch() {
    this.socket.requestRematch();
  }

  leave() {
    this.socket.disconnect();
    this.router.navigate(['/glueck-arena/battlefield']);
  }

  copyInvite() {
    const code = this.code || this.room?.inviteCode || '';
    const url = `${window.location.origin}/glueck-arena/battlefield/room/${code}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    this.copiedInvite = true;
    setTimeout(() => this.copiedInvite = false, 2000);
  }

  onSendMessage(msg: string) {
    this.socket.sendChatMessage(msg);
  }

  formatGameType(gt: string): string {
    return gt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
