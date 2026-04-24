import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
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
  imports: [CommonModule, MatProgressSpinnerModule],
  templateUrl: './portal-analytics-session-wise.component.html',
  styleUrls: ['./portal-analytics-session-wise.component.scss']
})
export class PortalAnalyticsSessionWiseComponent implements OnChanges {
  @Input({ required: true }) range!: PortalAnalyticsRange;

  loading = false;
  error = '';
  sessions: SessionWiseRow[] = [];

  constructor(private api: PortalAnalyticsApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['range'] && this.range?.from && this.range?.to) {
      this.load();
    }
  }

  formatDuration = formatPortalDuration;

  private load(): void {
    this.loading = true;
    this.error = '';
    this.api.getSessionWise(this.range).subscribe({
      next: (res: unknown) => {
        const body = res as { items?: SessionWiseRow[] };
        this.sessions = body.items || [];
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load sessions.';
        this.loading = false;
      }
    });
  }
}
