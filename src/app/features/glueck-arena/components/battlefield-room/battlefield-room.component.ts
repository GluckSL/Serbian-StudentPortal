import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../shared/material.module';
import { ArenaSocketService } from '../../services/arena-socket.service';
import { BattlefieldGameService } from '../../services/battlefield-game.service';
import { BattlefieldChatComponent } from '../../shared/battlefield-chat/battlefield-chat.component';
import { ConfettiBurstComponent } from '../../shared/confetti-burst/confetti-burst.component';
import { ScrambleRushComponent, SRResult } from '../../engines/scramble-rush/scramble-rush.component';
import { SentenceBuilderComponent } from '../../engines/sentence-builder/sentence-builder.component';
import { ImageMatchingComponent } from '../../engines/image-matching/image-matching.component';
import { GenderStackComponent } from '../../engines/gender-stack/gender-stack.component';
import { FlashCardsComponent } from '../../engines/flash-cards/flash-cards.component';
import { MatchingComponent } from '../../engines/matching/matching.component';
import { FlapjugationComponent } from '../../engines/flapjugation/flapjugation.component';
import { WhackawortComponent } from '../../engines/whackawort/whackawort.component';
import { JumbledWordsComponent } from '../../engines/jumbled-words/jumbled-words.component';
import { HangmanGameComponent } from '../../engines/hangman-game/hangman-game.component';
import { MemoryGameComponent } from '../../engines/memory-game/memory-game.component';
import { WordPictureMatchComponent } from '../../engines/word-picture-match/word-picture-match.component';
import { MultipleChoiceComponent } from '../../engines/multiple-choice/multiple-choice.component';
import { SpinWheelComponent } from '../../engines/spin-wheel/spin-wheel.component';
import { TapBoxesComponent } from '../../engines/tap-boxes/tap-boxes.component';
import { WordSearchComponent } from '../../engines/word-search/word-search.component';
import {
  ArenaRoomState, ChatMessage, GameAttempt, GameSet, GameQuestion, GameLevel,
} from '../../glueck-arena.types';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../../services/auth.service';

@Component({
  selector: 'app-battlefield-room',
  standalone: true,
  providers: [
    BattlefieldGameService,
    { provide: InteractiveGameService, useExisting: BattlefieldGameService },
  ],
  imports: [
    CommonModule, RouterModule, FormsModule, MaterialModule,
    BattlefieldChatComponent, ConfettiBurstComponent,
    ScrambleRushComponent, SentenceBuilderComponent,
    ImageMatchingComponent, GenderStackComponent,
    FlashCardsComponent, MatchingComponent, FlapjugationComponent,
    WhackawortComponent, JumbledWordsComponent, HangmanGameComponent,
    MemoryGameComponent, WordPictureMatchComponent, MultipleChoiceComponent,
    SpinWheelComponent, TapBoxesComponent, WordSearchComponent,
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
          <!-- Mobile drawer toggles -->
          <div class="bfroom__drawer-toggles">
            <button class="bfroom__drawer-btn bfroom__drawer-btn--left" (click)="showLeftDrawer = !showLeftDrawer" aria-label="Toggle info">
              <span class="material-icons">menu</span>
            </button>
            <button class="bfroom__drawer-btn bfroom__drawer-btn--right" (click)="showRightDrawer = !showRightDrawer" aria-label="Toggle chat">
              <span class="material-icons">chat</span>
            </button>
          </div>

          <!-- LEFT: Game Info -->
          <aside class="bfroom__left" [class.bfroom__left--open]="showLeftDrawer">
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
              <div class="bfroom__info-row" *ngIf="attempt">
                <span class="bfroom__info-label">Questions</span>
                <span class="bfroom__info-value">{{ attempt.totalQuestions }}</span>
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

            <!-- Playing phase - Single-player Game Engines -->
            <div class="bfroom__game" *ngIf="phase === 'playing'">
              <div class="bfroom__engine-wrapper">
                <ng-container *ngIf="!playerCompleted && gameQuestions.length > 0">
                <app-scramble-rush
                  *ngIf="attempt && room.gameType === 'scramble_rush'"
                  [attempt]="attempt!" [questions]="gameQuestions"
                  [levels]="gameLevels"
                  (onComplete)="onGameComplete($event)">
                </app-scramble-rush>
                <app-sentence-builder
                  *ngIf="attempt && gameSet && room.gameType === 'sentence_builder'"
                  [attempt]="attempt!" [gameSet]="gameSet!"
                  [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-sentence-builder>
                <app-image-matching
                  *ngIf="attempt && gameSet && room.gameType === 'image_matching'"
                  [attempt]="attempt!" [gameSet]="gameSet!"
                  [questions]="gameQuestions" [shuffledWords]="gameShuffledWords"
                  (onComplete)="onGameComplete($event)">
                </app-image-matching>
                <app-gender-stack
                  *ngIf="attempt && gameSet && room.gameType === 'gender_stack'"
                  [attempt]="attempt!" [gameSet]="gameSet!"
                  [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-gender-stack>
                <app-flash-cards
                  *ngIf="attempt && room.gameType === 'flashcards'"
                  [attempt]="attempt!" [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-flash-cards>
                <app-matching
                  *ngIf="attempt && room.gameType === 'matching'"
                  [attempt]="attempt!" [questions]="gameQuestions"
                  [shuffledRightOptions]="gameShuffledWords"
                  (onComplete)="onGameComplete($event)">
                </app-matching>
                <app-flapjugation
                  *ngIf="gameSet && room.gameType === 'flapjugation'"
                  [gameSet]="gameSet!" [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-flapjugation>
                <app-whackawort
                  *ngIf="attempt && room.gameType === 'whackawort'"
                  [attempt]="attempt!" [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-whackawort>
                <app-jumbled-words
                  *ngIf="attempt && gameSet && room.gameType === 'jumbled_words'"
                  [attempt]="attempt!" [gameSet]="gameSet!"
                  [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-jumbled-words>
                <app-hangman-game
                  *ngIf="attempt && gameSet && room.gameType === 'hangman'"
                  [attempt]="attempt!" [gameSet]="gameSet!"
                  [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-hangman-game>
                <app-memory-game
                  *ngIf="attempt && gameSet && room.gameType === 'memory'"
                  [attempt]="attempt!" [gameSet]="gameSet!"
                  [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-memory-game>
                <app-word-picture-match
                  *ngIf="attempt && gameSet && room.gameType === 'word_picture_match'"
                  [attempt]="attempt!" [gameSet]="gameSet!"
                  [questions]="gameQuestions" [shuffledWords]="gameShuffledWords"
                  (onComplete)="onGameComplete($event)">
                </app-word-picture-match>
                <app-multiple-choice
                  *ngIf="attempt && gameSet && room.gameType === 'multiple_choice'"
                  [attempt]="attempt!" [gameSet]="gameSet!"
                  [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-multiple-choice>
                <app-spin-wheel
                  *ngIf="attempt && gameSet && room.gameType === 'spin_wheel'"
                  [attempt]="attempt!" [gameSet]="gameSet!"
                  [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-spin-wheel>
                <app-tap-boxes
                  *ngIf="attempt && gameSet && room.gameType === 'tap_boxes'"
                  [attempt]="attempt!" [gameSet]="gameSet!"
                  [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-tap-boxes>
                <app-word-search
                  *ngIf="attempt && gameSet && room.gameType === 'word_search'"
                  [attempt]="attempt!" [gameSet]="gameSet!"
                  [questions]="gameQuestions"
                  (onComplete)="onGameComplete($event)">
                </app-word-search>
                </ng-container>
                <div class="bfroom__engine-fallback" *ngIf="(!attempt || gameQuestions.length === 0) && !playerCompleted">
                  <mat-spinner diameter="32"></mat-spinner>
                  <span>Preparing game…</span>
                </div>
                <div class="bfroom__waiting" *ngIf="playerCompleted">
                  <mat-icon class="bfroom__waiting-icon">hourglass_empty</mat-icon>
                  <h3>You're done!</h3>
                  <p>Waiting for other players to finish…</p>
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
          <aside class="bfroom__right" [class.bfroom__right--open]="showRightDrawer">
            <app-battlefield-chat
              [messages]="chatMessages"
              [currentUserId]="userId"
              (sendMessage)="onSendMessage($event)">
            </app-battlefield-chat>
          </aside>
        </div>

        <!-- Mobile backdrop -->
        <div class="bfroom__backdrop" *ngIf="showLeftDrawer || showRightDrawer" (click)="showLeftDrawer = false; showRightDrawer = false"></div>
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

    .bfroom__lobby-controls { padding: 16px 0; display: flex; flex-direction: row; gap: 12px; justify-content: center; }

    /* CENTER */
    .bfroom__center { display: flex; flex-direction: column; align-items: center; overflow-y: auto; padding: 24px; flex: 1; }
    .bfroom__lobby { flex: 1; display: flex; align-items: center; justify-content: center; }
    .bfroom__countdown { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .bfroom__game { flex: 1; display: flex; flex-direction: column; width: 100%; }
    .bfroom__engine-wrapper { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .bfroom__engine-wrapper > * { flex: 1; min-height: 0; width: 100%; }
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
    .bfroom__waiting { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 48px; text-align: center; flex: 1; }
    .bfroom__waiting-icon { font-size: 64px; width: 64px; height: 64px; color: #f59e0b; }
    .bfroom__waiting h3 { font-size: 22px; color: #1e293b; margin: 8px 0 0; }
    .bfroom__waiting p { font-size: 14px; color: #64748b; }

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
    .bfroom__right { background: #fff; border-left: 1px solid #e2e8f0; display: flex; flex-direction: column; overflow: auto; }

    /* Drawer toggles — hidden on desktop */
    .bfroom__drawer-toggles { display: none; position: absolute; top: 12px; left: 12px; right: 12px; z-index: 10; justify-content: space-between; pointer-events: none; }
    .bfroom__drawer-btn { pointer-events: all; width: 40px; height: 40px; border-radius: 50%; border: none; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.15); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: #405980; }
    .bfroom__drawer-btn .material-icons { font-size: 22px; width: 22px; height: 22px; line-height: 22px; color: #405980; }
    .bfroom__drawer-btn--left { display: none; }
    .bfroom__drawer-btn--right { display: none; }

    /* Backdrop */
    .bfroom__backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 100; animation: bf-fade-in 0.2s ease; }

    @media (max-width: 994px) {
      .bfroom__layout { grid-template-columns: 1fr; position: relative; }
      .bfroom__left,
      .bfroom__right { display: none; }
      .bfroom__drawer-toggles { display: flex; }
      .bfroom__drawer-btn--left { display: flex; }
      .bfroom__drawer-btn--right { display: flex; }
      .bfroom__center { padding: 60px 16px 16px; }

      /* Drawer overlays */
      .bfroom__left--open,
      .bfroom__right--open { display: flex; position: fixed; top: 64px; bottom: 0; z-index: 110; width: 280px; background: #fff; border: none; box-shadow: 0 0 24px rgba(0,0,0,.2); animation: bf-slide-in 0.25s ease; }
      .bfroom__left--open { left: 0; border-radius: 0 12px 12px 0; }
      .bfroom__right--open { right: 0; border-radius: 12px 0 0 12px; }
    }

    @keyframes bf-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes bf-slide-in { from { transform: translateX(-20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  `]
})
export class BattlefieldRoomComponent implements OnInit, OnDestroy {
  room: ArenaRoomState | null = null;
  phase: string = 'lobby';
  countdown: number | null = null;
  userId = '';
  isReady = false;
  chatMessages: ChatMessage[] = [];
  showConfetti = false;
  copiedInvite = false;
  showLeftDrawer = false;
  showRightDrawer = false;

  attempt: GameAttempt | null = null;
  gameSet: GameSet | null = null;
  gameQuestions: any[] = [];
  gameShuffledWords: string[] = [];
  gameLevels: GameLevel[] = [];
  playerCompleted = false;

  private subs: Subscription[] = [];
  private code = '';
  private gameInitialized = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private socket: ArenaSocketService,
    private bfService: BattlefieldGameService,
    private auth: AuthService,
  ) {}

  get isHost(): boolean {
    return this.room?.hostId === this.userId;
  }

  get hostName(): string {
    const host = this.room?.players?.find(p => p.studentId === this.room?.hostId);
    return host?.name || 'Unknown';
  }

  get sortedPlayers(): any[] {
    return [...(this.room?.players || [])].sort((a, b) => b.score - a.score);
  }

  get allReady(): boolean {
    const players = this.room?.players;
    if (!players) return false;
    const connected = players.filter((p: any) => p.isConnected);
    return connected.length >= 2 && connected.every((p: any) => p.isReady);
  }

  ngOnInit() {
    this.code = this.route.snapshot.paramMap.get('code') || '';
    if (!this.code) {
      this.router.navigate(['/glueck-arena/battlefield']);
      return;
    }

    this.socket.connect();

    this.timers.push(setTimeout(() => {
      if (!this.room) this.router.navigate(['/glueck-arena/battlefield']);
    }, 5000));

    this.subs.push(this.socket.room$.subscribe(room => {
      this.room = room;
      if (room) {
        this.phase = room.status;
      }
    }));

    this.subs.push(this.socket.phase$.subscribe(p => this.phase = p));

    this.subs.push(this.socket.countdown$.subscribe(c => this.countdown = c));

    this.subs.push(this.socket.battleRound$.subscribe(r => {
      if (!r) {
        this.gameInitialized = false;
        return;
      }
      if (this.gameInitialized) return;
      if (Array.isArray(r.question)) {
        this.initGameData(r.question);
      } else if (r.question) {
        this.initGameData([r.question]);
      }
    }));

    this.subs.push(this.socket.leaderboard$.subscribe(entries => {
      if (!this.room) return;
      const players = [...(this.room.players || [])];
      for (const entry of entries) {
        const p = players.find(x => x.studentId === entry.studentId);
        if (p) p.score = entry.score;
      }
      this.room = { ...this.room, players };
    }));

    this.subs.push(this.socket.finished$.subscribe(() => {
      this.playerCompleted = false;
      this.gameInitialized = false;
      this.showConfetti = true;
      this.timers.push(setTimeout(() => this.showConfetti = false, 3000));
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
    this.timers.forEach(t => clearTimeout(t));
    this.socket.disconnect();
  }

  private initGameData(questions: any[]) {
    console.log('[battlefield] initGameData called with', questions?.length, 'questions, gameInitialized:', this.gameInitialized, 'room:', !!this.room);
    if (this.gameInitialized || !this.room) return;
    this.gameInitialized = true;

    const gt = this.room.gameType;
    const allQuestions = questions.map((q, i) => ({
      _id: q.questionId || q._id || `q_${i}`,
      gameType: gt,
      order: i,
      ...q,
    }));

    this.bfService.init(allQuestions, gt, this.userId);

    this.gameSet = {
      _id: this.room.gameSetId || 'bf_set',
      title: this.room.roomName || 'Battlefield Game',
      gameType: gt as GameSet['gameType'],
      description: '',
      difficulty: 'Intermediate',
      level: null,
      thumbnailUrl: null,
      icon: '',
      category: '',
      tags: [],
      targetLanguage: '',
      xpReward: 0,
      timerSettings: { sessionLimitSeconds: null, perQuestionSeconds: null },
      visibleToStudents: false,
      courseDay: null,
      sequenceLetter: null,
      isPublished: true,
      isArchived: false,
      questionCount: allQuestions.length,
      estimatedDurationMinutes: 0,
      createdAt: '',
      updatedAt: '',
    };

    this.attempt = {
      _id: this.bfService.attemptId,
      studentId: this.userId,
      gameSetId: this.room.gameSetId || '',
      gameType: gt as any,
      status: 'in-progress',
      startedAt: new Date().toISOString(),
      completedAt: null,
      timeSpentSeconds: 0,
      score: 0,
      xpEarned: 0,
      accuracy: 0,
      totalQuestions: allQuestions.length,
      correctAnswers: 0,
      livesRemaining: 3,
      currentLevel: 0,
      wordsCompleted: 0,
      attemptNumber: 1,
    };

    this.gameQuestions = allQuestions;
    this.gameLevels = [];
    this.gameShuffledWords = allQuestions.flatMap(q =>
      (q as any).words?.length ? (q as any).words : [q.answerWord || q.word || '']
    ).filter(Boolean);

    console.log('[battlefield] initGameData complete — questions:', this.gameQuestions.length, 'gameType:', this.room.gameType);
    this.phase = 'playing';
  }

  onGameComplete(result: any) {
    if (this.gameQuestions.length === 0) {
      console.warn('[battlefield] onGameComplete with empty questions — ignoring');
      return;
    }
    this.playerCompleted = true;
    this.socket.notifyPlayerDone();
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
    this.timers.push(setTimeout(() => this.copiedInvite = false, 2000));
  }

  onSendMessage(msg: string) {
    this.socket.sendChatMessage(msg);
  }

  formatGameType(gt: string): string {
    return gt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
