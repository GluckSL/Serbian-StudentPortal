import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { StudentLogService } from '../../../services/student-log.service';

export interface DaySummaryRow {
  dayKey: string;
  dayLabel: string;
  estPortalMinutes: number;
  mostUsedPage: string;
  mostActiveStudent: string;
  avgPortalPerStudent: number;
  eventCount: number;
}

interface DailySummaryApiRow {
  dayKey: string;
  estPortalMinutes: number;
  mostUsedPage: string;
  mostActiveStudent: string;
  avgPortalPerStudent: number;
  eventCount: number;
  timelineEventCount: number;
}

@Component({
  selector: 'app-student-logs-all-days',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './student-logs-all-days.component.html',
  styleUrls: ['./student-logs-all-days.component.css']
})
export class StudentLogsAllDaysComponent implements OnInit {
  fromDate = '';
  toDate = '';
  /** HTTP in flight */
  isLoading = false;
  /** Appending rows in chunks after response */
  isHydrating = false;
  loadError = '';
  allDayRows: DaySummaryRow[] = [];
  readonly pageSize = 7;
  currentPage = 1;
  readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7];

  private pendingRaw: DailySummaryApiRow[] = [];
  private clientTimeZone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

  constructor(
    private studentLogService: StudentLogService,
    private router: Router
  ) {}

  ngOnInit(): void {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
    this.fromDate = this.toInputDateTime(start);
    this.toDate = this.toInputDateTime(now);
    this.load();
  }

  get pagedDayRows(): DaySummaryRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.allDayRows.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    if (this.allDayRows.length === 0) return 1;
    return Math.ceil(this.allDayRows.length / this.pageSize);
  }

  load(): void {
    this.isLoading = true;
    this.isHydrating = false;
    this.loadError = '';
    this.allDayRows = [];
    this.pendingRaw = [];
    this.currentPage = 1;
    const from = new Date(this.fromDate).toISOString();
    const to = new Date(this.toDate).toISOString();
    this.studentLogService
      .getActivityDailySummaries({ from, to, tz: this.clientTimeZone })
      .subscribe({
        next: (res) => {
          const raw = res.data || [];
          this.isLoading = false;
          if (raw.length === 0) {
            return;
          }
          this.pendingRaw = raw;
          this.isHydrating = raw.length > this.pageSize;
          this.flushHydrateChunk(0);
        },
        error: (err: { error?: { msg?: string; message?: string } }) => {
          this.loadError =
            err?.error?.msg || err?.error?.message || 'Failed to load daily summaries for this range.';
          this.allDayRows = [];
          this.pendingRaw = [];
          this.isLoading = false;
          this.isHydrating = false;
        }
      });
  }

  /** Reveal rows in chunks so the first page can paint before the rest is mapped. */
  private flushHydrateChunk(startIndex: number): void {
    const chunk = 7;
    const slice = this.pendingRaw.slice(startIndex, startIndex + chunk).map((row) => this.mapApiRow(row));
    this.allDayRows = [...this.allDayRows, ...slice];
    const next = startIndex + chunk;
    if (next < this.pendingRaw.length) {
      requestAnimationFrame(() => this.flushHydrateChunk(next));
    } else {
      this.pendingRaw = [];
      this.isHydrating = false;
      if (this.currentPage > this.totalPages) {
        this.currentPage = this.totalPages;
      }
    }
  }

  private mapApiRow(row: DailySummaryApiRow): DaySummaryRow {
    return {
      dayKey: row.dayKey,
      dayLabel: new Date(`${row.dayKey}T12:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }),
      estPortalMinutes: row.estPortalMinutes,
      mostUsedPage: row.mostUsedPage,
      mostActiveStudent: row.mostActiveStudent,
      avgPortalPerStudent: row.avgPortalPerStudent,
      eventCount: row.eventCount
    };
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  formatMinutes(mins: number): string {
    if (!mins || mins <= 0) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  openDay(dayKey: string): void {
    void this.router.navigate(['/student-logs'], { queryParams: { day: dayKey } });
  }

  goToMainLogs(): void {
    void this.router.navigate(['/student-logs']);
  }

  private toInputDateTime(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
