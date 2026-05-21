import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';

@Injectable({ providedIn: 'root' })
export class GluckRoomSocketService implements OnDestroy {
  private socket: Socket | null = null;

  connect(roomName: string, token: string, role: string): Socket {
    this.disconnect();
    this.socket = io('/gluckroom', {
      path: '/ws/gluckroom',
      auth: { token, roomName, role },
      transports: ['websocket', 'polling'],
    });
    return this.socket;
  }

  emit(event: string, payload: any): void {
    this.socket?.emit(event, payload);
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
