import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { PortalAnalyticsApiService, PortalAnalyticsRange } from '../../../services/portal-analytics-api.service';
import { formatPortalDuration } from '../portal-analytics-format';

type LearningKind = 'video' | 'exercises' | 'modules';

interface LearningSummary {
  totalSeconds: number;
  topStudent: { studentId: string; name: string; seconds: number } | null;
  avgSeconds: number;
}

/** Unified line for Video → Types column (portal + DB). */
interface VideoTypeRow {
  kind: 'recording' | 'live';
  title: string;
  seconds: number;
}

interface LearningRow {
  studentId: string;
  studentName: string;
  email: string;
  batch?: string;
  journeyDay?: number | null;
  totalSeconds: number;
  interactions?: number;
  recordedSeconds?: number;
  liveSeconds?: number;
  typeRows?: VideoTypeRow[];
}

interface LearningResponse {
  kind: LearningKind;
  session?: 'combined';
  summary: LearningSummary;
  items: LearningRow[];
}

@Component({
  selector: 'app-portal-analytics-learning',
  standalone: true,
  imports: [CommonModule, MatTabsModule, MatCardModule, MatProgressSpinnerModule, MatButtonModule],
  templateUrl: './portal-analytics-learning.component.html',
  styleUrls: ['./portal-analytics-learning.component.scss']
})
export class PortalAnalyticsLearningComponent implements OnChanges {
  @Input({ required: true }) range!: PortalAnalyticsRange;

  readonly pageSize = 12;
  readonly kinds: LearningKind[] = ['video', 'exercises', 'modules'];
  activeKind: LearningKind = 'video';
  viewMode: 'day' | 'range' = 'day';
  loading = false;
  error = '';
  data: LearningResponse | null = null;
  currentPage = 1;
  effectiveDay = '';

  formatDuration = formatPortalDuration;

  get isVideoTab(): boolean {
    return this.activeKind === 'video';
  }

  get totalRows(): number {
    return this.data?.items?.length || 0;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalRows / this.pageSize));
  }

  get pagedItems(): LearningRow[] {
    const items = this.data?.items || [];
    const start = (this.currentPage - 1) * this.pageSize;
    return items.slice(start, start + this.pageSize);
  }

  hasTypesContent(r: LearningRow): boolean {
    return Boolean(r.typeRows && r.typeRows.length > 0);
  }

  constructor(private api: PortalAnalyticsApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['range'] && this.range?.from && this.range?.to) {
      this.effectiveDay = this.range.to || this.range.from;
      this.load(this.activeKind);
    }
  }

  onTabChanged(index: number): void {
    const kind = this.kinds[index] || 'video';
    this.activeKind = kind;
    this.load(kind);
  }

  setViewMode(mode: 'day' | 'range'): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.load(this.activeKind);
  }

  prevPage(): void {
    if (this.currentPage <= 1) return;
    this.currentPage--;
  }

  nextPage(): void {
    if (this.currentPage >= this.totalPages) return;
    this.currentPage++;
  }

  labelFor(kind: LearningKind): string {
    if (kind === 'video') return 'Video';
    if (kind === 'exercises') return 'Exercises';
    return 'Modules';
  }

  private load(kind: LearningKind): void {
    this.loading = true;
    this.error = '';
    const reqRange: PortalAnalyticsRange =
      this.viewMode === 'day'
        ? { from: this.effectiveDay, to: this.effectiveDay, cohort: this.range.cohort }
        : { from: this.range.from, to: this.range.to, cohort: this.range.cohort };
    this.api.getLearning(reqRange, kind, 300).subscribe({
      next: (res: unknown) => {
        const body = res as LearningResponse;
        const keepRow = (r: LearningRow) => {
          if (body.kind === 'video') {
            return (
              Number(r.totalSeconds || 0) > 0 ||
              Number(r.interactions || 0) > 0 ||
              this.hasTypesContent(r)
            );
          }
          return Number(r.totalSeconds || 0) > 0;
        };
        this.data = {
          ...body,
          items: (body.items || []).filter(keepRow)
        };
        this.currentPage = 1;
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load learning analytics.';
        this.loading = false;
      }
    });
  }
}
