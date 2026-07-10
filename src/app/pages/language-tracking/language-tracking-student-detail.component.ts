import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject, takeUntil } from 'rxjs';

import {
  LanguageTrackingApiService,
  LtDayCompletion,
  LtDayDetailResponse,
  LtIncompleteTask,
  LtStudentDetailResponse,
  LtWeekDaySummary,
  LtWeekSummaryResponse,
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
  if (!iso) return '—';
  return new Date(iso).toLocaleString('sr-Latn-RS', { dateStyle: 'medium', timeStyle: 'short' });
}

function journeyWeekFromDay(day: number): number {
  return Math.max(1, Math.ceil(Math.max(1, day) / 7));
}

@Component({
  selector: 'app-language-tracking-student-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './language-tracking-student-detail.component.html',
  styleUrls: ['./language-tracking-student-detail.component.scss'],
})
export class LanguageTrackingStudentDetailComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  studentId = '';
  from = '';
  to = '';

  loadingOverview = true;
  loadingWeek = false;
  loadingDay = false;
  overviewError = '';
  weekError = '';
  dayError = '';

  overview: LtStudentDetailResponse | null = null;
  weekSummary: LtWeekSummaryResponse | null = null;
  selectedWeek = 1;
  selectedDay: number | null = null;
  dayCompletion: LtDayCompletion | null = null;

  sendingReminder = false;
  weeks: number[] = [];

  fmt = formatDuration;
  fmtDate = fmtDate;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly api: LanguageTrackingApiService,
    private readonly snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.studentId = params.get('studentId') || '';
      if (!this.studentId) return;
      this.loadOverview();
    });

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((q) => {
      this.from = q.get('from') || new Date().toISOString().slice(0, 10);
      this.to = q.get('to') || this.from;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get studentName(): string {
    return this.overview?.student.name || this.weekSummary?.student.name || 'Student';
  }

  get currentCourseDay(): number {
    return (
      this.overview?.student.currentCourseDay ||
      this.weekSummary?.student.currentCourseDay ||
      1
    );
  }

  get currentWeek(): number {
    return journeyWeekFromDay(this.currentCourseDay);
  }

  loadOverview(): void {
    this.loadingOverview = true;
    this.overviewError = '';
    this.api.getStudentDetail(this.studentId, this.from, this.to).subscribe({
      next: (d) => {
        this.loadingOverview = false;
        this.overview = d;
        const w = Number(this.route.snapshot.queryParamMap.get('week'));
        const day = Number(this.route.snapshot.queryParamMap.get('day'));
        this.bootstrapWeekAndDay(w, day);
      },
      error: () => {
        this.loadingOverview = false;
        this.overviewError = 'Failed to load student. Please try again.';
      },
    });
  }

  private bootstrapWeekAndDay(weekParam: number, dayParam: number): void {
    const cw = this.currentWeek;
    this.weeks = Array.from({ length: cw }, (_, i) => i + 1);
    const week = Number.isFinite(weekParam) && weekParam >= 1 ? Math.min(weekParam, cw) : cw;
    const day =
      Number.isFinite(dayParam) && dayParam >= 1
        ? Math.min(dayParam, this.currentCourseDay)
        : this.currentCourseDay;
    this.selectedWeek = week;
    this.loadWeek(week, day);
  }

  selectWeek(week: number): void {
    if (week === this.selectedWeek) return;
    this.selectedWeek = week;
    const defaultDay =
      week === this.currentWeek
        ? this.currentCourseDay
        : (week - 1) * 7 + 1;
    this.updateRouteQuery(week, defaultDay);
    this.loadWeek(week, defaultDay);
  }

  selectDay(day: LtWeekDaySummary): void {
    if (day.isFuture) return;
    this.selectedDay = day.day;
    this.updateRouteQuery(this.selectedWeek, day.day);
    this.loadDayDetail(day.day);
  }

  private loadWeek(week: number, selectDay: number): void {
    this.loadingWeek = true;
    this.weekError = '';
    this.api.getWeekSummary(this.studentId, week).subscribe({
      next: (res) => {
        this.loadingWeek = false;
        this.weekSummary = res;
        const target = Math.min(selectDay, this.currentCourseDay);
        const dayRow = res.days.find((d) => d.day === target && !d.isFuture);
        if (dayRow) {
          this.selectedDay = dayRow.day;
          this.loadDayDetail(dayRow.day);
        } else {
          const first = res.days.find((d) => !d.isFuture);
          if (first) {
            this.selectedDay = first.day;
            this.loadDayDetail(first.day);
          }
        }
      },
      error: () => {
        this.loadingWeek = false;
        this.weekError = 'Failed to load week summary.';
      },
    });
  }

  private loadDayDetail(day: number): void {
    this.loadingDay = true;
    this.dayError = '';
    this.dayCompletion = null;
    this.api.getDayDetail(this.studentId, day).subscribe({
      next: (res: LtDayDetailResponse) => {
        this.loadingDay = false;
        this.dayCompletion = res.dayCompletion;
      },
      error: () => {
        this.loadingDay = false;
        this.dayError = 'Failed to load day tasks.';
      },
    });
  }

  sendReminderForSelectedDay(): void {
    if (!this.selectedDay || this.sendingReminder) return;
    this.sendingReminder = true;
    this.api.sendReminders([this.studentId], this.selectedDay).subscribe({
      next: (res) => {
        this.sendingReminder = false;
        const one = res.results[0];
        if (res.sent) {
          this.snackBar.open(
            `Reminder sent for Day ${this.selectedDay} (${one?.incompleteCount ?? 0} tasks)`,
            'OK',
            { duration: 5000 },
          );
          return;
        }
        const why =
          one?.reason === 'all_complete'
            ? 'all tasks already complete'
            : one?.reason === 'no_email'
              ? 'no email on file'
              : 'could not send';
        this.snackBar.open(`No reminder sent (${why})`, 'OK', { duration: 5000 });
      },
      error: () => {
        this.sendingReminder = false;
        this.snackBar.open('Failed to send reminder email.', 'Dismiss', { duration: 5000 });
      },
    });
  }

  weekDayLabel(day: number): string {
    return `Day ${day}`;
  }

  weekRangeLabel(week: number): string {
    const start = (week - 1) * 7 + 1;
    const end = week * 7;
    return `Days ${start}–${end}`;
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
      memory: 'Memory Game',
    };
    return map[gt] || gt;
  }

  private updateRouteQuery(week: number, day: number): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { from: this.from, to: this.to, week, day },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
