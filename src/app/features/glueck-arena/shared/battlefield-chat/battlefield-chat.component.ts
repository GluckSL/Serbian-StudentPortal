import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewChecked, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../shared/material.module';
import { ChatMessage } from '../../glueck-arena.types';

@Component({
  selector: 'app-battlefield-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  template: `
    <div class="bfchat">
      <div class="bfchat__header">
        <mat-icon>chat</mat-icon>
        <span>Room Chat</span>
      </div>

      <div class="bfchat__messages" #messageContainer>
        <div *ngIf="!messages?.length" class="bfchat__empty">
          <mat-icon>forum</mat-icon>
          <span>No messages yet. Say something nice!</span>
        </div>

        <div *ngFor="let msg of messages" class="bfchat__msg"
          [class.bfchat__msg--system]="msg.isSystem"
          [class.bfchat__msg--mine]="msg.userId === currentUserId">
          <div class="bfchat__msg-header" *ngIf="!msg.isSystem">
            <span class="bfchat__msg-name" [style.color]="nameColor(msg.userId)">{{ msg.userName }}</span>
            <span class="bfchat__msg-time">{{ formatTime(msg.timestamp) }}</span>
          </div>
          <div class="bfchat__msg-text">{{ msg.message }}</div>
        </div>
      </div>

      <div class="bfchat__input-area">
        <input #chatInput class="bfchat__input" type="text"
          [(ngModel)]="newMessage" (keyup.enter)="send()"
          [disabled]="disabled"
          placeholder="Type a message…" maxlength="500">
        <button class="bfchat__send" mat-icon-button color="primary"
          (click)="send()" [disabled]="!newMessage.trim() || disabled">
          <mat-icon>send</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .bfchat { display: flex; flex-direction: column; flex: 1; min-height: 0; background: #fff; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,.06); border: 1px solid #e8ecf0; }
    .bfchat__header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e8ecf0; font-weight: 700; font-size: 14px; color: #405980; }
    .bfchat__header mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .bfchat__messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
    .bfchat__empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 32px 16px; color: #94a3b8; text-align: center; font-size: 13px; }
    .bfchat__empty mat-icon { font-size: 36px; width: 36px; height: 36px; opacity: 0.4; }
    .bfchat__msg { max-width: 85%; padding: 8px 12px; border-radius: 12px; background: #f1f5f9; align-self: flex-start; }
    .bfchat__msg--mine { align-self: flex-end; background: #e0f2fe; }
    .bfchat__msg--system { align-self: center; max-width: 100%; background: transparent; padding: 4px 8px; }
    .bfchat__msg--system .bfchat__msg-text { font-size: 12px; color: #94a3b8; font-style: italic; text-align: center; }
    .bfchat__msg-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .bfchat__msg-name { font-size: 12px; font-weight: 700; }
    .bfchat__msg-time { font-size: 10px; color: #94a3b8; }
    .bfchat__msg-text { font-size: 13px; line-height: 1.4; color: #1e293b; word-break: break-word; }
    .bfchat__msg--system .bfchat__msg-text { color: #94a3b8; }
    .bfchat__input-area { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid #e8ecf0; background: #fff; }
    .bfchat__input { flex: 1; border: 2px solid #e2e8f0; border-radius: 20px; padding: 8px 14px; font-size: 13px; outline: none; }
    .bfchat__input:focus { border-color: #405980; }
    .bfchat__send { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; min-width: 36px; line-height: 1; }
    .bfchat__send mat-icon { font-size: 18px; width: 18px; height: 18px; line-height: 18px; }
  `]
})
export class BattlefieldChatComponent implements AfterViewChecked {
  @Input() messages: ChatMessage[] = [];
  @Input() currentUserId: string = '';
  @Input() disabled = false;
  @Output() sendMessage = new EventEmitter<string>();

  @ViewChild('messageContainer') private msgContainer!: ElementRef;
  @ViewChild('chatInput') private chatInput!: ElementRef;

  newMessage = '';
  private autoScroll = true;

  ngAfterViewChecked() {
    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  private scrollToBottom() {
    try {
      const el = this.msgContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch {}
  }

  send() {
    const msg = this.newMessage.trim();
    if (!msg || this.disabled) return;
    this.sendMessage.emit(msg);
    this.newMessage = '';
    setTimeout(() => this.chatInput?.nativeElement?.focus(), 50);
  }

  formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  nameColor(userId: string): string {
    const colors = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
    let hash = 0;
    for (let i = 0; i < (userId || '').length; i++) {
      hash = ((hash << 5) - hash) + (userId.charCodeAt(i) || 0);
    }
    return colors[Math.abs(hash) % colors.length];
  }
}
