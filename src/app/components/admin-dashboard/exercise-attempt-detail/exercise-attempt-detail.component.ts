import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DigitalExerciseService,
  AttemptReviewRow,
  StaffAttemptReviewResponse
} from '../../../services/digital-exercise.service';
import { finalize, switchMap } from 'rxjs';
@Component({
  selector: 'app-exercise-attempt-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './exercise-attempt-detail.component.html',
  styleUrls: ['./exercise-attempt-detail.component.css']
})
export class ExerciseAttemptDetailComponent implements OnInit {
  exerciseId = '';
  attemptId = '';
  loading = true;
  error = '';
  actionError = '';
  updatingQuestionIndex: number | null = null;
  updatingSubQuestionIndex: number | null = null;
  regrading = false;
  data: StaffAttemptReviewResponse | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private exerciseService: DigitalExerciseService
  ) {}

  ngOnInit(): void {
    this.exerciseId = this.route.snapshot.paramMap.get('id') || '';
    this.attemptId = this.route.snapshot.paramMap.get('attemptId') || '';
    if (!this.exerciseId || !this.attemptId) {
      this.error = 'Missing exercise or attempt';
      this.loading = false;
      return;
    }
    this.loadAttempt();
  }

  backToCompletions(): void {
    this.router.navigate(['/admin/digital-exercises', this.exerciseId, 'completions']);
  }

  studentDisplayName(): string {
    const sid = this.data?.attempt?.studentId as { name?: string } | string | undefined;
    if (sid && typeof sid === 'object' && sid.name) return sid.name;
    return 'Student';
  }

  studentEmail(): string | null {
    const sid = this.data?.attempt?.studentId as { email?: string } | undefined;
    if (sid && typeof sid === 'object' && sid.email) return sid.email;
    return null;
  }

  formatDate(d: string | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  formatTime(seconds: number | undefined): string {
    if (seconds == null || !Number.isFinite(Number(seconds))) return '';
    const s = Math.floor(Number(seconds));
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  get donutStrokeDash(): string {
    const s = this.data?.summary;
    if (!s || s.totalQuestions <= 0) return '0, 100';
    const pct = Math.round((s.correctCount / s.totalQuestions) * 100);
    return `${pct}, 100`;
  }

  wrongRows(rows: AttemptReviewRow[]): AttemptReviewRow[] {
    return rows.filter((r) => !r.isCorrect);
  }

  isUpdatingRow(row: AttemptReviewRow): boolean {
    return (
      this.updatingQuestionIndex === row.questionIndex &&
      (row.subQuestionIndex ?? null) === (this.updatingSubQuestionIndex ?? null)
    );
  }

  markAsCorrect(row: AttemptReviewRow): void {
    if (!this.exerciseId || !this.attemptId || this.updatingQuestionIndex !== null) return;
    this.actionError = '';
    this.updatingQuestionIndex = row.questionIndex;
    this.updatingSubQuestionIndex = row.subQuestionIndex ?? null;

    const subIdx =
      row.isSubQuestion && row.subQuestionIndex !== undefined && row.subQuestionIndex !== null
        ? row.subQuestionIndex
        : undefined;

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
          this.error = '';
        },
        error: (err) => {
          this.actionError = err?.error?.error || 'Could not update this answer';
        }
      });
  }

  regradeAttempt(): void {
    if (!this.exerciseId || !this.attemptId || this.regrading || this.updatingQuestionIndex !== null) return;
    this.actionError = '';
    this.regrading = true;

    this.exerciseService
      .regradeAttemptForStaff(this.exerciseId, this.attemptId)
      .pipe(finalize(() => { this.regrading = false; }))
      .subscribe({
        next: (res) => {
          if (this.data) {
            this.data = {
              ...this.data,
              attempt: {
                ...this.data.attempt,
                earnedPoints: res.earnedPoints,
                totalPoints: res.totalPoints,
                scorePercentage: res.scorePercentage
              },
              summary: res.summary,
              perQuestion: res.perQuestion
            };
          }
          this.error = '';
        },
        error: (err) => {
          this.actionError = err?.error?.error || 'Could not regrade this attempt';
        }
      });
  }

  private loadAttempt(): void {
    this.loading = true;
    this.error = '';
    this.exerciseService.getAttemptReviewForStaff(this.exerciseId, this.attemptId).subscribe({
      next: (res) => {
        this.data = res;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'Could not load attempt';
      }
    });
  }
}
