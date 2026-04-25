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

interface LearningRow {
  studentId: string;
  studentName: string;
  email: string;
  totalSeconds: number;
  interactions?: number;
}

interface LearningResponse {
  kind: LearningKind;
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

  readonly kinds: LearningKind[] = ['video', 'exercises', 'modules'];
  activeKind: LearningKind = 'video';
  viewMode: 'day' | 'range' = 'day';
  loading = false;
  error = '';
  data: LearningResponse | null = null;
  effectiveDay = '';

  formatDuration = formatPortalDuration;

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
        ? { from: this.effectiveDay, to: this.effectiveDay }
        : { from: this.range.from, to: this.range.to };
    this.api.getLearning(reqRange, kind, 300).subscribe({
      next: (res: unknown) => {
        const body = res as LearningResponse;
        this.data = {
          ...body,
          items: (body.items || []).filter((r) => Number(r.totalSeconds || 0) > 0)
        };
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load learning analytics.';
        this.loading = false;
      }
    });
  }
}

