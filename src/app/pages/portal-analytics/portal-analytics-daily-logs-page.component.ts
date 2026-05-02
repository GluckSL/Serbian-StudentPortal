import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map, distinctUntilChanged } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PortalAnalyticsApiService, PortalAnalyticsRange } from '../../services/portal-analytics-api.service';
import { formatPortalDuration } from './portal-analytics-format';
import { normalizeDailyLogsApi, PortalDailyLogRow } from './portal-analytics-daily-logs.types';

@Component({
  selector: 'app-portal-analytics-daily-logs-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule
  ],
  templateUrl: './portal-analytics-daily-logs-page.component.html',
  styleUrls: ['./portal-analytics-daily-logs-page.component.scss']
})
export class PortalAnalyticsDailyLogsPageComponent implements OnInit {
  private readonly analyticsTz = 'Asia/Kolkata';

  draftFrom = '';
  draftTo = '';
  cohort: 'overall' | 'platinum' | 'go' = 'overall';
  viewMode: 'rolling' | 'custom' = 'rolling';

  loading = true;
  loadingMore = false;
  error = '';
  rows: PortalDailyLogRow[] = [];
  selected: PortalDailyLogRow | null = null;
  oldestLoadedYmd: string | null = null;
  noOlderChunks = false;

  displayedColumns: string[] = [
    'date',
    'portalTime',
    'interactions',
    'avgTime',
    'topPage',
    'topStudent',
    'actions'
  ];

  formatDuration = formatPortalDuration;

  constructor(
    private readonly api: PortalAnalyticsApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(
        map((q) => `${q.get('from') ?? ''}|${q.get('to') ?? ''}|${q.get('cohort') ?? ''}`),
        distinctUntilChanged(),
        map(() => this.route.snapshot.queryParamMap)
      )
      .subscribe((q) => {
        const fromQ = (q.get('from') || '').trim();
        const toQ = (q.get('to') || '').trim();
        const cohortQ = q.get('cohort');
        this.cohort =
          cohortQ === 'platinum' || cohortQ === 'go' ? cohortQ : 'overall';

        if (this.isYmd(fromQ) && this.isYmd(toQ)) {
          this.viewMode = 'custom';
          this.draftFrom = fromQ;
          this.draftTo = toQ;
          this.noOlderChunks = false;
          this.fetchRange({ from: fromQ, to: toQ, cohort: this.cohort }, true);
        } else {
          this.viewMode = 'rolling';
          const today = this.toInputDateInTimeZone(new Date(), this.analyticsTz);
          this.draftFrom = this.addDaysYmd(today, -6);
          this.draftTo = today;
          this.noOlderChunks = false;
          this.fetchRange({ from: this.draftFrom, to: this.draftTo, cohort: this.cohort }, true);
        }
      });
  }

  get showLoadMore(): boolean {
    return this.viewMode === 'rolling' && !this.loading && !this.error && !!this.oldestLoadedYmd && !this.noOlderChunks;
  }

  get rangeSummary(): string {
    if (!this.rows.length) return '';
    const sorted = [...this.rows].map((r) => r.date).sort();
    return `${sorted[sorted.length - 1]} → ${sorted[0]}`;
  }

  applyCustomRange(): void {
    if (!this.isYmd(this.draftFrom) || !this.isYmd(this.draftTo)) return;
    this.replaceQueryParams(this.draftFrom, this.draftTo);
  }

  setLastSevenDays(): void {
    this.router.navigate(['/portal-analytics/daily-logs'], {
      queryParams: this.cohort !== 'overall' ? { cohort: this.cohort } : {},
      replaceUrl: true
    });
  }

  setCohort(c: 'overall' | 'platinum' | 'go'): void {
    this.cohort = c;
    if (this.viewMode === 'custom' && this.isYmd(this.draftFrom) && this.isYmd(this.draftTo)) {
      this.replaceQueryParams(this.draftFrom, this.draftTo);
    } else {
      this.router.navigate(['/portal-analytics/daily-logs'], {
        queryParams: this.cohort !== 'overall' ? { cohort: this.cohort } : {},
        replaceUrl: true
      });
    }
  }

  setTodayDraft(): void {
    const t = this.toInputDateInTimeZone(new Date(), this.analyticsTz);
    this.draftFrom = t;
    this.draftTo = t;
  }

  setWeekDraft(): void {
    const today = this.toInputDateInTimeZone(new Date(), this.analyticsTz);
    this.draftFrom = this.addDaysYmd(today, -6);
    this.draftTo = today;
  }

  loadMoreSevenDays(): void {
    if (!this.oldestLoadedYmd || this.viewMode !== 'rolling') return;
    const chunkTo = this.addDaysYmd(this.oldestLoadedYmd, -1);
    const chunkFrom = this.addDaysYmd(this.oldestLoadedYmd, -7);
    if (chunkTo < chunkFrom) return;
    this.loadingMore = true;
    this.error = '';
    this.api.getDailyLogs({ from: chunkFrom, to: chunkTo, cohort: this.cohort }).subscribe({
      next: (raw: unknown) => {
        const chunk = normalizeDailyLogsApi(raw);
        if (!chunk.length) this.noOlderChunks = true;
        this.mergeRows(chunk);
        this.oldestLoadedYmd = this.minYmd(this.rows.map((r) => r.date));
        this.loadingMore = false;
      },
      error: () => {
        this.error = 'Could not load older days.';
        this.loadingMore = false;
      }
    });
  }

  displayDateYmd(ymd: string): string {
    const parts = String(ymd || '').split('-');
    if (parts.length !== 3) return ymd;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  toggleDetail(row: PortalDailyLogRow): void {
    this.selected = this.selected?.date === row.date ? null : row;
  }

  isDetailOpen(row: PortalDailyLogRow): boolean {
    return this.selected?.date === row.date;
  }

  private fetchRange(range: PortalAnalyticsRange, resetRows: boolean): void {
    this.loading = true;
    this.error = '';
    if (resetRows) {
      this.rows = [];
      this.selected = null;
      this.oldestLoadedYmd = null;
    }
    this.api.getDailyLogs(range).subscribe({
      next: (raw: unknown) => {
        const next = normalizeDailyLogsApi(raw);
        this.rows = this.sortByDateDesc(next);
        this.oldestLoadedYmd = this.minYmd(next.map((r) => r.date));
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load daily logs.';
        this.loading = false;
      }
    });
  }

  private mergeRows(chunk: PortalDailyLogRow[]): void {
    const byDate = new Map<string, PortalDailyLogRow>();
    for (const r of this.rows) byDate.set(r.date, r);
    for (const r of chunk) byDate.set(r.date, r);
    this.rows = this.sortByDateDesc([...byDate.values()]);
  }

  private sortByDateDesc(list: PortalDailyLogRow[]): PortalDailyLogRow[] {
    return [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  private minYmd(dates: string[]): string | null {
    if (!dates.length) return null;
    return [...dates].sort()[0];
  }

  private replaceQueryParams(from: string, to: string): void {
    const q: Record<string, string> = { from, to };
    if (this.cohort !== 'overall') q['cohort'] = this.cohort;
    this.router.navigate(['/portal-analytics/daily-logs'], { queryParams: q, replaceUrl: true });
  }

  private isYmd(s: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  private toInputDateInTimeZone(d: Date, timeZone: string): string {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = fmt.formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value || '';
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const day = parts.find((p) => p.type === 'day')?.value || '';
    return `${year}-${month}-${day}`;
  }

  private addDaysYmd(ymd: string, days: number): string {
    const date = new Date(`${ymd}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
