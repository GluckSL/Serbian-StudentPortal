import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';

import { SprechenApiService } from '../sprechen-api.service';
import type {
  SprechenReplayResponse,
  SprechenSessionListResponse,
  SprechenSessionRow,
  SprechenTurn,
  SprechenScores,
} from '../sprechen-exam.types';

@Component({
  selector: 'app-sprechen-session-review',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
  ],
  templateUrl: './sprechen-session-review.component.html',
  styleUrl: './sprechen-session-review.component.scss',
})
export class SprechenSessionReviewComponent implements OnInit {
  moduleId = '';
  loading = true;
  error: string | null = null;

  data: SprechenSessionListResponse | null = null;

  // Pagination
  pageIndex = 0;
  pageSize = 10;
  readonly pageSizeOptions = [5, 10, 25, 50];

  // Expanded replay
  expandedSessionId: string | null = null;
  replay: SprechenReplayResponse | null = null;
  replayLoading = false;
  replayError: string | null = null;

  // Override form
  overrideTurnId: string | null = null;
  overridePoints = 0;
  overrideNote = '';
  overrideLoading = false;
  overrideMsg: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: SprechenApiService,
  ) {}

  ngOnInit(): void {
    this.moduleId = this.route.snapshot.paramMap.get('moduleId') || '';
    if (!this.moduleId) { this.error = 'Module ID fehlt'; this.loading = false; return; }
    this._loadSessions();
  }

  private _loadSessions(): void {
    this.loading = true;
    this.api.getModuleSessions(this.moduleId).subscribe({
      next: (d) => { this.data = d; this.loading = false; },
      error: (e) => { this.error = e?.error?.message || 'Ladefehler'; this.loading = false; },
    });
  }

  get pagedSessions(): SprechenSessionRow[] {
    if (!this.data?.sessions?.length) return [];
    const start = this.pageIndex * this.pageSize;
    return this.data.sessions.slice(start, start + this.pageSize);
  }

  onPageChange(ev: PageEvent): void {
    this.pageIndex = ev.pageIndex;
    this.pageSize = ev.pageSize;
  }

  toggleReplay(sessionId: string): void {
    if (this.expandedSessionId === sessionId) {
      this.expandedSessionId = null;
      this.replay = null;
      return;
    }
    this.expandedSessionId = sessionId;
    this.replay = null;
    this.replayLoading = true;
    this.replayError = null;
    this.api.getReplay(sessionId).subscribe({
      next: (r) => { this.replay = r; this.replayLoading = false; },
      error: (e) => { this.replayError = e?.error?.message || 'Replay-Fehler'; this.replayLoading = false; },
    });
  }

  openOverride(turn: SprechenTurn): void {
    this.overrideTurnId = turn._id;
    const current = turn.tutorOverride ?? turn.evaluation;
    this.overridePoints = current?.points ?? 0;
    this.overrideNote = turn.tutorOverride?.note || '';
    this.overrideMsg = null;
  }

  cancelOverride(): void {
    this.overrideTurnId = null;
    this.overrideMsg = null;
  }

  saveOverride(): void {
    if (!this.expandedSessionId || !this.overrideTurnId) return;
    this.overrideLoading = true;
    this.overrideMsg = null;
    this.api.overrideTurnScore(
      this.expandedSessionId,
      this.overrideTurnId,
      this.overridePoints,
      this.overrideNote,
    ).subscribe({
      next: (r) => {
        this.overrideLoading = false;
        this.overrideMsg = 'Gespeichert';
        this.overrideTurnId = null;
        // Patch scores in replay
        if (this.replay) {
          this.replay.session.scores = r.scores;
          const t = this.replay.turns.find((x) => x._id === r.turn._id);
          if (t) t.tutorOverride = r.turn.tutorOverride;
        }
        // Patch in list
        if (this.data) {
          const row = this.data.sessions.find((s) => s._id === this.expandedSessionId);
          if (row) row.scores = r.scores;
        }
      },
      error: (e) => {
        this.overrideLoading = false;
        this.overrideMsg = 'Fehler: ' + (e?.error?.message || 'Unbekannt');
      },
    });
  }

  exportCsv(): void {
    window.open(this.api.exportCsvUrl(this.moduleId), '_blank');
  }

  studentTurns(turns: SprechenTurn[]): SprechenTurn[] {
    return turns.filter((t) => t.role === 'student');
  }

  effectivePoints(turn: SprechenTurn): number {
    return turn.tutorOverride?.points ?? turn.evaluation?.points ?? 0;
  }

  isOverridden(turn: SprechenTurn): boolean {
    return !!turn.tutorOverride;
  }

  formatDate(iso: string | undefined): string {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
  }

  initials(name?: string | null): string {
    const n = name?.trim();
    if (!n) return '?';
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
}
