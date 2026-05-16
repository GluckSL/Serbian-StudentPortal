import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { PortalAnalyticsApiService, PortalAnalyticsRange } from '../../../services/portal-analytics-api.service';
import { formatPortalDuration } from '../portal-analytics-format';

type LearningKind = 'video' | 'exercises' | 'digibot';

interface LearningSummary {
  totalSeconds: number;
  topStudent: { studentId: string; name: string; seconds: number } | null;
  avgSeconds: number;
}

/** Video → Types column */
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

export interface DigiBotChatTurn {
  at: string;
  speaker: 'student' | 'ai' | 'hint';
  text: string;
  score?: number;
  kind?: string;
  instructionEn?: string;
}

export interface DigiBotSessionRow {
  sessionId: string;
  studentId: string;
  studentName: string;
  email: string;
  batch: string;
  journeyDay: number | null;
  regNo: string;
  studentLevel: string;
  moduleId: string;
  moduleTitle: string;
  moduleLevel: string;
  startedAt: string;
  completedAt: string | null;
  completed: boolean;
  score: number;
  moduleCompletionPercent: number | null;
  moduleFullyComplete: boolean;
  attempts: number;
  successCount: number;
  failureCount: number;
  timeSpentSeconds: number;
  chatTurns: DigiBotChatTurn[];
}

export interface DigiBotSummary {
  sessionCount: number;
  completedCount: number;
  avgScore: number;
  totalSeconds: number;
  avgSecondsPerSession: number;
  topStudent: { studentId: string; name: string; seconds: number } | null;
}

export interface DigiBotLearningResponse {
  kind: 'digibot';
  range: { from: string; to: string };
  summary: DigiBotSummary;
  items: DigiBotSessionRow[];
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
  readonly kinds: LearningKind[] = ['video', 'exercises', 'digibot'];
  activeKind: LearningKind = 'video';
  viewMode: 'day' | 'range' = 'day';
  loading = false;
  error = '';
  data: LearningResponse | null = null;
  digiBotData: DigiBotLearningResponse | null = null;
  currentPage = 1;
  effectiveDay = '';
  expandedSessionId: string | null = null;

  formatDuration = formatPortalDuration;

  get isVideoTab(): boolean {
    return this.activeKind === 'video';
  }

  get isDigiBotTab(): boolean {
    return this.activeKind === 'digibot';
  }

  get totalRows(): number {
    if (this.isDigiBotTab) return this.digiBotData?.items?.length || 0;
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

  get pagedDigiBotItems(): DigiBotSessionRow[] {
    const items = this.digiBotData?.items || [];
    const start = (this.currentPage - 1) * this.pageSize;
    return items.slice(start, start + this.pageSize);
  }

  hasTypesContent(r: LearningRow): boolean {
    return Boolean(r.typeRows && r.typeRows.length > 0);
  }

  toggleExpand(sessionId: string): void {
    this.expandedSessionId = this.expandedSessionId === sessionId ? null : sessionId;
  }

  initials(name: string): string {
    return (name || '?')
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0] || '')
      .join('')
      .toUpperCase();
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
    this.expandedSessionId = null;
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
    return 'DigiBot';
  }

  private load(kind: LearningKind): void {
    this.loading = true;
    this.error = '';
    this.data = null;
    this.digiBotData = null;
    const reqRange: PortalAnalyticsRange =
      this.viewMode === 'day'
        ? { from: this.effectiveDay, to: this.effectiveDay, cohort: this.range.cohort }
        : { from: this.range.from, to: this.range.to, cohort: this.range.cohort };

    this.api.getLearning(reqRange, kind, 300).subscribe({
      next: (res: unknown) => {
        if (kind === 'digibot') {
          const body = res as DigiBotLearningResponse;
          this.digiBotData = {
            ...body,
            items: (body.items || []).filter(
              (r) => r.timeSpentSeconds > 0 || r.attempts > 0 || r.chatTurns?.length > 0
            )
          };
        } else {
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
        }
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
