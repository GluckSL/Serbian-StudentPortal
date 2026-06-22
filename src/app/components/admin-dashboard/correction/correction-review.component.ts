import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  DigitalExerciseService,
  AttemptReviewRow,
  StaffAttemptReviewResponse
} from '../../../services/digital-exercise.service';
import { NotificationService } from '../../../services/notification.service';
import { finalize, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-correction-review',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './correction-review.component.html',
  styleUrls: ['./correction-review.component.css']
})
export class CorrectionReviewComponent implements OnInit {
  studentId = '';
  exerciseId = '';
  attemptId = '';
  journeyDay: string | null = null;

  loading = true;
  error = '';
  actionError = '';
  updatingQuestionIndex: number | null = null;
  updatingSubQuestionIndex: number | null = null;
  data: StaffAttemptReviewResponse | null = null;

  readonly skeletonRows = Array.from({ length: 6 }, (_, i) => i);

  constructor(
    private route: ActivatedRoute,
    private exerciseService: DigitalExerciseService,
    private notif: NotificationService
  ) {}

  ngOnInit(): void {
    this.studentId = this.route.snapshot.paramMap.get('studentId') || '';
    this.exerciseId = this.route.snapshot.paramMap.get('exerciseId') || '';
    this.attemptId = this.route.snapshot.paramMap.get('attemptId') || '';
    this.journeyDay = this.route.snapshot.queryParamMap.get('day');

    if (!this.exerciseId || !this.attemptId) {
      this.error = 'Missing exercise or attempt';
      this.loading = false;
      return;
    }
    this.loadAttempt();
  }

  get backLink(): string {
    const q = new URLSearchParams();
    if (this.studentId) q.set('studentId', this.studentId);
    if (this.journeyDay) q.set('day', this.journeyDay);
    const qs = q.toString();
    return `/admin/correction${qs ? `?${qs}` : ''}`;
  }

  studentDisplayName(): string {
    const sid = this.data?.attempt?.studentId as { name?: string } | string | undefined;
    if (sid && typeof sid === 'object' && sid.name) return sid.name;
    return 'Student';
  }

  studentMeta(): string {
    const sid = this.data?.attempt?.studentId as { email?: string; batch?: string; level?: string } | undefined;
    if (!sid || typeof sid !== 'object') return '';
    const parts = [sid.email, sid.batch ? `Batch ${sid.batch}` : '', sid.level].filter(Boolean);
    return parts.join(' · ');
  }

  formatDate(d: string | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  scoreRingDash(): string {
    const pct = this.data?.attempt?.scorePercentage ?? 0;
    return `${Math.round(pct)}, 100`;
  }

  wrongRows(rows: AttemptReviewRow[] | undefined): AttemptReviewRow[] {
    return (rows || []).filter(r => !r.isCorrect);
  }

  isUpdatingRow(row: AttemptReviewRow): boolean {
    return (
      this.updatingQuestionIndex === row.questionIndex &&
      (this.updatingSubQuestionIndex ?? null) === (row.subQuestionIndex ?? null)
    );
  }

  markAsCorrect(row: AttemptReviewRow): void {
    if (!this.exerciseId || !this.attemptId || this.updatingQuestionIndex !== null) return;
    this.actionError = '';
    this.updatingQuestionIndex = row.questionIndex;
    this.updatingSubQuestionIndex = row.subQuestionIndex ?? null;

    const subIdx =
      row.isSubQuestion && row.subQuestionIndex != null ? row.subQuestionIndex : undefined;

    this.exerciseService
      .overrideAttemptQuestion(this.exerciseId, this.attemptId, row.questionIndex, true, subIdx)
      .pipe(
        switchMap(() => this.exerciseService.getAttemptReviewForStaff(this.exerciseId, this.attemptId)),
        finalize(() => {
          this.updatingQuestionIndex = null;
          this.updatingSubQuestionIndex = null;
        })
      )
      .subscribe({
        next: (res) => {
          this.data = res;
          this.notif.success('Question marked as correct — score updated');
        },
        error: (err) => {
          this.actionError = err?.error?.error || 'Could not update this answer';
        }
      });
  }

  refresh(): void {
    this.loadAttempt();
  }

  loadAttempt(): void {
    this.loading = true;
    this.error = '';
    this.exerciseService.getAttemptReviewForStaff(this.exerciseId, this.attemptId).subscribe({
      next: (res) => {
        this.data = res;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'Could not load attempt review';
      }
    });
  }
}
