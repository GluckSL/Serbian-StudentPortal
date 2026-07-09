import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';

@Injectable({ providedIn: 'root' })
export class GluckRoomSocketService implements OnDestroy {
  private socket: Socket | null = null;

  private _userName = '';

  setUserName(name: string): void {
    this._userName = name;
  }

  connect(roomName: string, token: string, role: string, userId?: string): Socket {
    this.disconnect();
    const loc = typeof window !== 'undefined' ? `${window.location.host}${window.location.pathname}` : 'server';
    console.log('[GluckRoomSocket] connecting from:', loc, 'with path:', '/ws/gluckroom');
    this.socket = io('/gluckroom', {
      path: '/ws/gluckroom',
      auth: { token, roomName, role, userId, userName: this._userName },
      transports: ['polling'],
      autoConnect: false,
    });
    this.socket.on('connect', () => {
      console.log('[GluckRoomSocket] connected with id:', this.socket?.id);
    });
    this.socket.on('connect_error', (err: any) => {
      console.error('[GluckRoomSocket] connect_error:', err.message, '| type:', err.type, '| data:', err.data, '| description:', err.description, '| ctx:', JSON.stringify(err));
    });
    this.socket.on('disconnect', (reason: string) => {
      console.warn('[GluckRoomSocket] disconnected, reason:', reason);
    });
    this.socket.connect();
    return this.socket;
  }

  emit(event: string, payload: any): void {
    if (!this.socket) {
      console.error('[GluckRoomSocket] emit failed: socket is null. Event:', event);
      return;
    }
    if (!this.socket.connected) {
      console.warn('[GluckRoomSocket] emit on disconnected socket. Event:', event);
    }
    this.socket.emit(event, payload);
  }

  on(event: string, callback: (...args: any[]) => void): void {
    this.socket?.on(event, callback);
  }

  off(event: string, callback?: (...args: any[]) => void): void {
    if (callback) this.socket?.off(event, callback);
    else this.socket?.off(event);
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
