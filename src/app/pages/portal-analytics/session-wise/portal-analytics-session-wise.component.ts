import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { PortalAnalyticsApiService, PortalAnalyticsRange } from '../../../services/portal-analytics-api.service';
import { formatPortalDuration } from '../portal-analytics-format';

export interface SessionPageRow {
  page: string;
  activeSeconds: number;
  startTime: string;
  endTime: string | null;
}

export interface SessionWiseRow {
  sessionId: string;
  studentName: string;
  startTime: string;
  endTime: string | null;
  totalActiveSeconds: number;
  isActive: boolean;
  pages: SessionPageRow[];
}

@Component({
  selector: 'app-portal-analytics-session-wise',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, MatButtonModule],
  templateUrl: './portal-analytics-session-wise.component.html',
  styleUrls: ['./portal-analytics-session-wise.component.scss']
})
export class PortalAnalyticsSessionWiseComponent implements OnChanges {
  @Input({ required: true }) range!: PortalAnalyticsRange;

  readonly pageSize = 6;
  loading = false;
  error = '';
  sessions: SessionWiseRow[] = [];
  currentPage = 1;
  private readonly sessionLabelMap = new Map<string, number>();

  constructor(private api: PortalAnalyticsApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['range'] && this.range?.from && this.range?.to) {
      this.load();
    }
  }

  formatDuration = formatPortalDuration;

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.sessions.length / this.pageSize));
  }

  get pagedSessions(): SessionWiseRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.sessions.slice(start, start + this.pageSize);
  }

  prevPage(): void {
    if (this.currentPage <= 1) return;
    this.currentPage--;
  }

  nextPage(): void {
    if (this.currentPage >= this.totalPages) return;
    this.currentPage++;
  }

  sessionLabel(sessionId: string): string {
    const id = String(sessionId || '').trim();
    if (!id) return 'Session -';
    const idx = this.sessionLabelMap.get(id);
    return `Session ${idx || '?'}`;
  }

  private rebuildSessionLabels(rows: SessionWiseRow[]): void {
    this.sessionLabelMap.clear();
    for (const row of rows) {
      const id = String(row?.sessionId || '').trim();
      if (!id || this.sessionLabelMap.has(id)) continue;
      this.sessionLabelMap.set(id, this.sessionLabelMap.size + 1);
    }
  }

  private load(): void {
    this.loading = true;
    this.error = '';
    this.api.getSessionWise(this.range).subscribe({
      next: (res: unknown) => {
        const body = res as { items?: SessionWiseRow[] };
        this.sessions = body.items || [];
        this.rebuildSessionLabels(this.sessions);
        this.currentPage = 1;
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load sessions.';
        this.loading = false;
      }
    });
  }
}
