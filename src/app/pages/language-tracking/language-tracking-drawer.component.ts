import {
  Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import {
  LanguageTrackingApiService,
  LtStudentRow,
  LtStudentDetailResponse,
  LtIncompleteTask,
} from './language-tracking-api.service';

function formatDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'â€”';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

@Component({
  selector: 'app-language-tracking-drawer',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  template: `
<div class="ltd-overlay" (click)="onOverlayClick($event)">
  <aside class="ltd-panel" (click)="$event.stopPropagation()">

    <!-- Header -->
    <div class="ltd-header">
      <div class="ltd-header__avatar">{{ student.name.charAt(0).toUpperCase() }}</div>
      <div class="ltd-header__info">
        <h2 class="ltd-header__name">{{ student.name }}</h2>
        <p class="ltd-header__meta">
          {{ student.regNo }} &middot; {{ student.level }}
          <span *ngIf="student.batch" class="ltd-badge ltd-badge--batch">{{ student.batch }}</span>
          <span class="ltd-badge ltd-badge--day">Day {{ student.currentCourseDay }}</span>
        </p>
      </div>
      <button class="ltd-close" (click)="close.emit()" aria-label="Close">
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <!-- Loading -->
    <div *ngIf="loading" class="ltd-loading">
      <mat-spinner diameter="40"></mat-spinner>
      <p>Loading student detailsâ€¦</p>
    </div>

    <!-- Error -->
    <div *ngIf="error && !loading" class="ltd-error">
      <mat-icon>error_outline</mat-icon>
      <p>{{ error }}</p>
      <button mat-stroked-button (click)="load()">Retry</button>
    </div>

    <!-- Content -->
    <ng-container *ngIf="detail && !loading">

      <!-- Time summary pills -->
      <div class="ltd-time-pills">
        <div class="ltd-pill ltd-pill--ex">
          <mat-icon>fitness_center</mat-icon>
          <div>
            <div class="ltd-pill__val">{{ fmt(detail.timeSummary.exercisesSeconds) }}</div>
            <div class="ltd-pill__lbl">Exercises</div>
          </div>
        </div>
        <div class="ltd-pill ltd-pill--dg">
          <mat-icon>smart_toy</mat-icon>
          <div>
            <div class="ltd-pill__val">{{ fmt(detail.timeSummary.digibotSeconds) }}</div>
            <div class="ltd-pill__lbl">DG Bot</div>
          </div>
        </div>
        <div class="ltd-pill ltd-pill--ar">
          <mat-icon>sports_esports</mat-icon>
          <div>
            <div class="ltd-pill__val">{{ fmt(detail.timeSummary.arenaSeconds) }}</div>
            <div class="ltd-pill__lbl">GlÃ¼ckArena</div>
          </div>
        </div>
        <div class="ltd-pill ltd-pill--total">
          <mat-icon>schedule</mat-icon>
          <div>
            <div class="ltd-pill__val">{{ fmt(detail.timeSummary.totalSeconds) }}</div>
            <div class="ltd-pill__lbl">Total</div>
          </div>
        </div>
      </div>

      <!-- Journey Day Completion -->
      <section class="ltd-section" *ngIf="detail.dayCompletion">
        <h3 class="ltd-section__title">
          <mat-icon>map</mat-icon>
          Day {{ detail.dayCompletion.day }} Progress
          <span class="ltd-section__badge"
            [class.ltd-section__badge--done]="detail.dayCompletion.complete"
            [class.ltd-section__badge--pct]="!detail.dayCompletion.complete">
            {{ detail.dayCompletion.complete ? 'Complete' : detail.dayCompletion.completionPercent + '%' }}
          </span>
        </h3>

        <!-- Progress bar -->
        <div class="ltd-progress-bar">
          <div class="ltd-progress-bar__fill"
            [style.width.%]="detail.dayCompletion.completionPercent">
          </div>
        </div>
        <p class="ltd-progress-label">
          {{ detail.dayCompletion.doneTasks }} of {{ detail.dayCompletion.totalTasks }} tasks completed
        </p>

        <!-- Incomplete tasks -->
        <div *ngIf="detail.dayCompletion.incompleteTasks.length > 0" class="ltd-tasks">
          <h4 class="ltd-tasks__title">Still to complete</h4>
          <ng-container *ngFor="let task of detail.dayCompletion.incompleteTasks">
            <div *ngIf="task.kind !== 'module'" class="ltd-task">
              <div class="ltd-task__icon ltd-task__icon--{{ task.kind }}">
                <mat-icon>{{ taskIcon(task) }}</mat-icon>
              </div>
              <div class="ltd-task__body">
                <span class="ltd-task__title">{{ task.title }}</span>
                <span class="ltd-task__kind">{{ taskKindLabel(task.kind) }}</span>
              </div>
            </div>
          </ng-container>
        </div>

        <div *ngIf="detail.dayCompletion.incompleteTasks.length === 0 && detail.dayCompletion.complete"
          class="ltd-all-done">
          <mat-icon>check_circle</mat-icon> All tasks for day {{ detail.dayCompletion.day }} completed!
        </div>
      </section>

      <div class="ltd-section ltd-no-journey" *ngIf="!detail.dayCompletion">
        <mat-icon>info</mat-icon>
        Journey completion data not available (student may not be in an active batch).
      </div>

      <!-- Exercise sessions -->
      <section class="ltd-section" *ngIf="detail.sessions.exercises.length > 0">
        <h3 class="ltd-section__title ltd-section__title--ex">
          <mat-icon>fitness_center</mat-icon> Recent Exercises
          <span class="ltd-section__count">{{ detail.sessions.exercises.length }}</span>
        </h3>
        <div class="ltd-sessions">
          <div *ngFor="let s of detail.sessions.exercises" class="ltd-session ltd-session--ex">
            <div class="ltd-session__head">
              <span class="ltd-session__title">{{ s.title }}</span>
              <span class="ltd-session__time">{{ fmt(s.timeSpentSeconds) }}</span>
            </div>
            <div class="ltd-session__meta">
              {{ fmtDate(s.startedAt) }}
              &middot;
              <span class="ltd-status ltd-status--{{ s.status }}">{{ s.status }}</span>
              &middot; {{ s.scorePercentage }}%
            </div>
          </div>
        </div>
      </section>

      <!-- DG Bot sessions -->
      <section class="ltd-section" *ngIf="detail.sessions.digibot.length > 0">
        <h3 class="ltd-section__title ltd-section__title--dg">
          <mat-icon>smart_toy</mat-icon> Recent DG Bot Sessions
          <span class="ltd-section__count">{{ detail.sessions.digibot.length }}</span>
        </h3>
        <div class="ltd-sessions">
          <div *ngFor="let s of detail.sessions.digibot" class="ltd-session ltd-session--dg">
            <div class="ltd-session__head">
              <span class="ltd-session__title">{{ s.title }}</span>
              <span class="ltd-session__time">{{ fmt(s.timeSpentSeconds) }}</span>
            </div>
            <div class="ltd-session__meta">
              {{ fmtDate(s.startedAt) }}
              &middot;
              <span class="ltd-status" [class.ltd-status--completed]="s.completed"
                [class.ltd-status--in-progress]="!s.completed">
                {{ s.completed ? 'completed' : 'incomplete' }}
              </span>
              &middot; score {{ s.score }}
            </div>
          </div>
        </div>
      </section>

      <!-- Arena sessions -->
      <section class="ltd-section" *ngIf="detail.sessions.arena.length > 0">
        <h3 class="ltd-section__title ltd-section__title--ar">
          <mat-icon>sports_esports</mat-icon> Recent Arena Games
          <span class="ltd-section__count">{{ detail.sessions.arena.length }}</span>
        </h3>
        <div class="ltd-sessions">
          <div *ngFor="let s of detail.sessions.arena" class="ltd-session ltd-session--ar">
            <div class="ltd-session__head">
              <span class="ltd-session__title">{{ gameTypeLabel(s.gameType) }}</span>
              <span class="ltd-session__time">{{ fmt(s.timeSpentSeconds) }}</span>
            </div>
            <div class="ltd-session__meta">
              {{ fmtDate(s.startedAt) }}
              &middot;
              <span class="ltd-status ltd-status--{{ s.status }}">{{ s.status }}</span>
              &middot; {{ s.accuracy }}% acc &middot; {{ s.xpEarned }} XP
            </div>
          </div>
        </div>
      </section>

      <div *ngIf="detail.sessions.exercises.length === 0 && detail.sessions.digibot.length === 0 && detail.sessions.arena.length === 0"
        class="ltd-no-sessions">
        <mat-icon>hourglass_empty</mat-icon>
        No learning sessions in the selected date range.
      </div>

    </ng-container>
  </aside>
</div>
  `,
  styleUrls: ['./language-tracking-drawer.component.scss'],
})
export class LanguageTrackingDrawerComponent implements OnInit, OnChanges {
  @Input() student!: LtStudentRow;
  @Input() from!: string;
  @Input() to!: string;
  @Output() close = new EventEmitter<void>();

  loading = false;
  error = '';
  detail: LtStudentDetailResponse | null = null;

  fmt = formatDuration;
  fmtDate = fmtDate;

  constructor(private readonly api: LanguageTrackingApiService) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['student'] && !changes['student'].firstChange) {
      this.load();
    }
  }

  load(): void {
    if (!this.student) return;
    this.loading = true;
    this.error = '';
    this.detail = null;
    this.api.getStudentDetail(this.student.studentId, this.from, this.to).subscribe({
      next: (d) => {
        this.loading = false;
        this.detail = d;
      },
      error: () => {
        this.loading = false;
        this.error = 'Failed to load student details. Please try again.';
      },
    });
  }

  onOverlayClick(e: MouseEvent): void {
    if ((e.target as Element).classList.contains('ltd-overlay')) {
      this.close.emit();
    }
  }

  taskIcon(task: LtIncompleteTask): string {
    const map: Record<string, string> = {
      exercise: 'fitness_center',
      'dg-bot': 'smart_toy',
      class: 'videocam',
      recording: 'play_circle',
    };
    return map[task.kind] || 'task_alt';
  }

  taskKindLabel(kind: string): string {
    const map: Record<string, string> = {
      exercise: 'Digital Exercise',
      'dg-bot': 'DG Bot',
      class: 'Live Class',
      recording: 'Recording',
    };
    return map[kind] || kind;
  }

  gameTypeLabel(gt: string): string {
    const map: Record<string, string> = {
      scramble_rush: 'Scramble Rush',
      sentence_builder: 'Sentence Builder',
      matching: 'Matching',
      flashcards: 'Flashcards',
      image_matching: 'Image Matching',
      gender_stack: 'Gender Stack',
    };
    return map[gt] || gt;
  }
}
