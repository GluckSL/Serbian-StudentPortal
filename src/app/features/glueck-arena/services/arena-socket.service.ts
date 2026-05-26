import { Injectable, OnDestroy } from '@angular/core';

import { io, Socket } from 'socket.io-client';

import { BehaviorSubject, Observable, Subject } from 'rxjs';

import { getAuthToken } from '../../../services/auth.service';

import {
  ArenaRoomState,
  ArenaLeaderboardEntry,
  ArenaBattleRound,
  ArenaBattleAnswerResult,
  ArenaBattleSnapshot,
  ChatMessage,
} from '../glueck-arena.types';



/** Reusable GlückArena Socket.io client — heartbeat, reconnect, realtime battles */

@Injectable({ providedIn: 'root' })

export class ArenaSocketService implements OnDestroy {

  private socket: Socket | null = null;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private roomCode: string | null = null;



  readonly connected$ = new BehaviorSubject<boolean>(false);

  readonly reconnecting$ = new BehaviorSubject<boolean>(false);

  readonly room$ = new BehaviorSubject<ArenaRoomState | null>(null);

  readonly leaderboard$ = new BehaviorSubject<ArenaLeaderboardEntry[]>([]);

  readonly countdown$ = new BehaviorSubject<number | null>(null);

  readonly phase$ = new BehaviorSubject<'idle' | 'lobby' | 'countdown' | 'playing' | 'finished'>('idle');

  readonly error$ = new Subject<string>();

  readonly finished$ = new Subject<{ results: ArenaLeaderboardEntry[] }>();



  /** Live battle round (synchronized scramble / sentence) */

  readonly battleRound$ = new BehaviorSubject<ArenaBattleRound | null>(null);

  readonly battleAnswerAck$ = new Subject<{

    roundIndex: number;

    result: ArenaBattleAnswerResult;

  }>();

  readonly battleRoundEnd$ = new Subject<{ roundIndex: number }>();

  readonly lastAnswerResult$ = new Subject<ArenaBattleAnswerResult>();

  readonly networkQuality$ = new BehaviorSubject<'good' | 'fair' | 'poor'>('good');
  readonly spectatorState$ = new Subject<{ delayed: boolean; spectatorCount?: number }>();

  readonly chatMessage$ = new Subject<ChatMessage>();
  readonly chatHistory$ = new Subject<ChatMessage[]>();



  private lastPongAt = Date.now();



  connect(): void {

    if (this.socket?.connected) return;

    const token = getAuthToken();

    if (!token) {

      this.error$.next('Not authenticated');

      return;

    }



    this.socket = io(window.location.origin, {

      path: '/socket.io',

      auth: { token },

      transports: ['polling', 'websocket'],

      reconnection: true,

      reconnectionAttempts: 15,

      reconnectionDelay: 1000,

    });



    this.socket.on('connect', () => {

      this.connected$.next(true);

      this.startHeartbeat();

    });



    this.socket.on('disconnect', () => {

      this.connected$.next(false);

      this.stopHeartbeat();

    });



    this.socket.io.on('reconnect_attempt', () => this.reconnecting$.next(true));

    this.socket.io.on('reconnect', () => {
      this.reconnecting$.next(false);
      if (this.roomCode) this.joinRoom(this.roomCode);
    });



    this.socket.on('arena:error', (p: { message?: string }) => {

      this.error$.next(p?.message || 'Arena error');

    });



    this.socket.on('arena:room', (p: { room: ArenaRoomState }) => {

      this.room$.next(p.room);

      if (p.room.status === 'finished') this.phase$.next('finished');

      else if (p.room.status === 'lobby') this.phase$.next('lobby');

    });



    this.socket.on('arena:countdown', (p: { seconds: number }) => {

      this.phase$.next('countdown');

      this.countdown$.next(p.seconds);

    });



    this.socket.on('arena:countdown_tick', (p: { seconds: number }) => {

      this.countdown$.next(p.seconds);

    });



    this.socket.on('arena:playing', (p: { room: ArenaRoomState }) => {

      this.room$.next(p.room);

      this.phase$.next('playing');

      this.countdown$.next(null);

    });



    this.socket.on('arena:battle_round', (p: { round: ArenaBattleRound; room?: ArenaRoomState }) => {

      if (p.room) this.room$.next(p.room);

      this.phase$.next('playing');

      this.battleRound$.next(p.round);

    });



    this.socket.on('arena:battle_round_end', (p: { roundIndex: number; room?: ArenaRoomState }) => {

      if (p.room) this.room$.next(p.room);

      this.battleRoundEnd$.next({ roundIndex: p.roundIndex });

    });



    this.socket.on('arena:battle_answer_ack', (p: {

      roundIndex: number;

      result: ArenaBattleAnswerResult;

    }) => {

      this.battleAnswerAck$.next(p);

      this.lastAnswerResult$.next(p.result);

    });



    this.socket.on('arena:battle_answer_result', (p: {

      studentId: string;

      roundIndex: number;

      result: ArenaBattleAnswerResult;

    }) => {

      /* Opponent answered — leaderboard follows */

    });



    this.socket.on('arena:battle_snapshot', (snap: ArenaBattleSnapshot) => {

      if (snap.round) this.battleRound$.next(snap.round);

    });

    this.socket.on('arena:spectator_state', (p: {
      delayed?: boolean;
      spectatorCount?: number;
      room?: ArenaRoomState;
      snapshot?: ArenaBattleSnapshot;
    }) => {
      if (p.room) this.room$.next(p.room);
      if (p.snapshot?.round) this.battleRound$.next(p.snapshot.round);
      this.spectatorState$.next({ delayed: !!p.delayed, spectatorCount: p.spectatorCount });
      if (p.room?.status === 'playing') this.phase$.next('playing');
    });

    this.socket.on('arena:battle_complete', (p: { results: ArenaLeaderboardEntry[] }) => {

      this.phase$.next('finished');

      this.finished$.next({ results: p.results || [] });

    });



    this.socket.on('arena:leaderboard', (p: { players: ArenaLeaderboardEntry[] }) => {

      this.leaderboard$.next(p.players || []);

    });



    this.socket.on('arena:finished', (p: { results: ArenaLeaderboardEntry[] }) => {

      this.phase$.next('finished');

      this.finished$.next({ results: p.results || [] });

    });



    this.socket.on('arena:rematch_update', () => {

      this.battleRound$.next(null);

    });



    this.socket.on('arena:chat_message', (msg: ChatMessage) => {
      this.chatMessage$.next(msg);
    });

    this.socket.on('arena:chat_history', (history: ChatMessage[]) => {
      this.chatHistory$.next(history);
    });

    this.socket.on('arena:room_cancelled', () => {
      this.phase$.next('idle');
      this.room$.next(null);
      this.battleRound$.next(null);
    });

    this.socket.on('arena:pong', () => {

      const latency = Date.now() - this.lastPongAt;

      if (latency < 120) this.networkQuality$.next('good');

      else if (latency < 350) this.networkQuality$.next('fair');

      else this.networkQuality$.next('poor');

    });

  }



  disconnect(): void {

    this.stopHeartbeat();

    this.socket?.disconnect();

    this.socket = null;

    this.connected$.next(false);

    this.roomCode = null;

    this.battleRound$.next(null);

  }



  joinRoom(code: string): void {

    this.roomCode = code.toUpperCase();

    this.socket?.emit('arena:join', { code: this.roomCode });

    this.phase$.next('lobby');

  }



  setReady(ready: boolean): void {

    if (!this.roomCode) return;

    this.socket?.emit('arena:ready', { code: this.roomCode, ready });

  }



  startGame(): void {

    if (!this.roomCode) return;

    this.socket?.emit('arena:start', { code: this.roomCode });

  }



  /** Server-authoritative battle answer */

  submitBattleAnswer(payload: {

    roundIndex: number;

    typedWord?: string;

    orderedTokens?: string[];

  }): void {

    if (!this.roomCode) return;

    this.socket?.emit('arena:battle_answer', { code: this.roomCode, ...payload });

  }



  /** Legacy — non-battle rooms only */

  submitAnswer(payload: { questionIndex: number; isCorrect: boolean; points: number; responseTimeMs: number }): void {

    if (!this.roomCode) return;

    this.socket?.emit('arena:answer', { code: this.roomCode, ...payload });

  }



  finishGame(): void {

    if (!this.roomCode) return;

    this.socket?.emit('arena:finish', { code: this.roomCode });

  }



  cancelRoom(): void {
    if (!this.roomCode) return;
    this.socket?.emit('arena:cancel', { code: this.roomCode });
  }

  requestRematch(): void {

    if (!this.roomCode) return;

    this.socket?.emit('arena:rematch', { code: this.roomCode });

  }



  spectate(code: string): void {

    this.roomCode = code.toUpperCase();

    this.socket?.emit('arena:spectate', { code: this.roomCode });

  }



  sendChatMessage(message: string): void {
    if (!this.roomCode || !message?.trim()) return;
    this.socket?.emit('arena:chat_message', { code: this.roomCode, message: message.trim() });
  }

  getInviteLink(): Observable<{ url: string; code: string }> {

    return new Observable(sub => {

      if (!this.socket || !this.roomCode) {

        sub.next({ url: '', code: this.roomCode || '' });

        sub.complete();

        return;

      }

      this.socket.once('arena:invite_link', (p: { url: string; code: string }) => {

        sub.next(p);

        sub.complete();

      });

      this.socket.emit('arena:share_invite', { code: this.roomCode });

    });

  }



  private startHeartbeat(): void {

    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {

      if (this.socket?.connected) {

        this.lastPongAt = Date.now();

        this.socket.emit('arena:ping', { code: this.roomCode });

      }

    }, 15_000);

  }



  private stopHeartbeat(): void {

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = null;

  }



  ngOnDestroy(): void {

    this.disconnect();

  }

}

