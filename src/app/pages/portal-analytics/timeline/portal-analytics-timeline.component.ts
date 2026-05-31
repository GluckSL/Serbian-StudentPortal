import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { PortalAnalyticsApiService, PortalAnalyticsRange } from '../../../services/portal-analytics-api.service';
import { formatPortalDuration } from '../portal-analytics-format';

export interface TimelineRow {
  time: string;
  endTime: string | null;
  page: string;
  type: string;
  durationSeconds: number;
  studentName: string;
  sessionId: string;
}

@Component({
  selector: 'app-portal-analytics-timeline',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, MatButtonModule],
  templateUrl: './portal-analytics-timeline.component.html',
  styleUrls: ['./portal-analytics-timeline.component.scss']
})
export class PortalAnalyticsTimelineComponent implements OnChanges {
  @Input({ required: true }) range!: PortalAnalyticsRange;

  readonly pageSize = 40;

  loading = false;
  error = '';
  rows: TimelineRow[] = [];
  total = 0;
  skip = 0;
  private readonly sessionLabelMap = new Map<string, number>();

  constructor(private api: PortalAnalyticsApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['range'] && this.range?.from && this.range?.to) {
      this.skip = 0;
      this.load();
    }
  }

  formatDuration = formatPortalDuration;

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  get currentPage(): number {
    return Math.floor(this.skip / this.pageSize) + 1;
  }

  prev(): void {
    this.skip = Math.max(0, this.skip - this.pageSize);
    this.load();
  }

  next(): void {
    if (this.skip + this.pageSize >= this.total) return;
    this.skip += this.pageSize;
    this.load();
  }

  sessionLabel(sessionId: string): string {
    const id = String(sessionId || '').trim();
    if (!id) return 'Session -';
    const idx = this.sessionLabelMap.get(id);
    return `Session ${idx || '?'}`;
  }

  private rebuildSessionLabels(rows: TimelineRow[]): void {
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
    this.api.getTimeline(this.range, this.pageSize, this.skip).subscribe({
      next: (res: unknown) => {
        const body = res as { items?: TimelineRow[]; total?: number; skip?: number };
        this.rows = body.items || [];
        this.rebuildSessionLabels(this.rows);
        this.total = typeof body.total === 'number' ? body.total : this.rows.length;
        if (typeof body.skip === 'number') this.skip = body.skip;
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load timeline.';
        this.loading = false;
      }
    });
  }
}
