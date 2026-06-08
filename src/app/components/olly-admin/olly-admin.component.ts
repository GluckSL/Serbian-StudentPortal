import {
  Component, OnDestroy, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

interface OllyMsg {
  role: 'user' | 'assistant' | 'agent';
  content: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaOriginalName?: string | null;
  timestamp: string | Date;
}

interface OllySession {
  sessionId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  language: 'en' | 'ta' | 'si';
  status: 'active' | 'waiting_agent' | 'with_agent' | 'closed';
  lastActivity: string;
  createdAt: string;
  messageCount: number;
  lastMessage?: OllyMsg | null;
  messages?: OllyMsg[];
}

@Component({
  selector: 'app-olly-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './olly-admin.component.html',
  styleUrls: ['./olly-admin.component.css']
})
export class OllyAdminComponent implements OnInit, OnDestroy {
  sessions: OllySession[] = [];
  loadingSessions = false;
  filterStatus = '';

  selectedSession: OllySession | null = null;
  loadingSession = false;

  replyText = '';
  sendingReply = false;
  replyError = '';

  pendingCount = 0;
  private refreshTimer: any = null;

  readonly statusOptions = [
    { value: '', label: 'All Sessions' },
    { value: 'waiting_agent', label: '🟡 Waiting for Agent' },
    { value: 'with_agent', label: '🔵 With Agent' },
    { value: 'active', label: '🟢 AI Active' },
    { value: 'closed', label: '⚫ Closed' }
  ];

  readonly langLabels: Record<string, string> = { en: 'EN', ta: 'TA', si: 'SI' };

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadSessions();
    this.loadPendingCount();
    this.refreshTimer = setInterval(() => {
      this.loadSessions(true);
      this.loadPendingCount();
      if (this.selectedSession) this.refreshSelectedSession();
    }, 6000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  loadSessions(silent = false): void {
    if (!silent) this.loadingSessions = true;
    const params = this.filterStatus ? `?status=${this.filterStatus}` : '';
    this.http.get<any>(`${environment.apiUrl}/olly/admin/sessions${params}`, { withCredentials: true }).subscribe({
      next: (res) => {
        if (res?.success) this.sessions = res.data;
        this.loadingSessions = false;
      },
      error: () => { this.loadingSessions = false; }
    });
  }

  loadPendingCount(): void {
    this.http.get<any>(`${environment.apiUrl}/olly/admin/pending-count`, { withCredentials: true }).subscribe({
      next: (res) => { if (res?.success) this.pendingCount = res.data.count; }
    });
  }

  selectSession(s: OllySession): void {
    this.selectedSession = s;
    this.replyText = '';
    this.replyError = '';
    this.loadFullSession(s.sessionId);
  }

  loadFullSession(sessionId: string): void {
    this.loadingSession = true;
    this.http.get<any>(`${environment.apiUrl}/olly/admin/session/${sessionId}`, { withCredentials: true }).subscribe({
      next: (res) => {
        if (res?.success && this.selectedSession?.sessionId === sessionId) {
          this.selectedSession = res.data;
        }
        this.loadingSession = false;
      },
      error: () => { this.loadingSession = false; }
    });
  }

  refreshSelectedSession(): void {
    const current = this.selectedSession;
    if (!current) return;
    this.http.get<any>(`${environment.apiUrl}/olly/admin/session/${current.sessionId}`, { withCredentials: true }).subscribe({
      next: (res) => {
        if (!res?.success || !res.data || this.selectedSession?.sessionId !== res.data.sessionId) return;
        const prevCount = current.messages?.length || 0;
        this.selectedSession = res.data;
        if ((res.data.messages?.length || 0) > prevCount) {
          setTimeout(() => this.scrollToBottom(), 50);
        }
      }
    });
  }

  sendReply(): void {
    const msg = this.replyText.trim();
    if (!msg || !this.selectedSession) return;
    this.sendingReply = true;
    this.replyError = '';

    this.http.post<any>(`${environment.apiUrl}/olly/admin/${this.selectedSession.sessionId}/reply`,
      { message: msg }, { withCredentials: true }
    ).subscribe({
      next: (res) => {
        this.sendingReply = false;
        if (res?.success) {
          this.replyText = '';
          this.loadFullSession(this.selectedSession!.sessionId);
        } else {
          this.replyError = res?.message || 'Failed to send.';
        }
      },
      error: (err) => {
        this.sendingReply = false;
        this.replyError = err?.error?.message || 'Send failed.';
      }
    });
  }

  onReplyKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendReply();
    }
  }

  closeSession(sessionId: string): void {
    this.http.patch<any>(`${environment.apiUrl}/olly/admin/${sessionId}/status`,
      { status: 'closed' }, { withCredentials: true }
    ).subscribe({
      next: () => { this.loadSessions(); if (this.selectedSession?.sessionId === sessionId) this.selectedSession = null; }
    });
  }

  isImage(mediaType?: string | null): boolean {
    return !!mediaType && mediaType.startsWith('image/');
  }

  statusLabel(s: string): string {
    const m: Record<string, string> = {
      active: '🟢 Active',
      waiting_agent: '🟡 Waiting',
      with_agent: '🔵 Live',
      closed: '⚫ Closed'
    };
    return m[s] || s;
  }

  scrollToBottom(): void {
    const el = document.getElementById('olly-admin-msgs');
    if (el) el.scrollTop = el.scrollHeight;
  }

  trackById(index: number, item: OllySession): string { return item.sessionId; }
}
