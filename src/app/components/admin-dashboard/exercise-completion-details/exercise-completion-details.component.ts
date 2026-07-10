// exercise-completion-details.component.ts — Teacher analytics for exercise completions

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestAccountBadgeComponent } from '../../../shared/test-account-badge/test-account-badge.component';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { DigitalExerciseService, DigitalExercise } from '../../../services/digital-exercise.service';

interface Attempt {
  _id?: string;
  studentId?: { name?: string; email?: string; batch?: string; level?: string };
  studentName?: string;
  studentBatch?: string;
  attemptNumber: number;
  status?: 'completed' | 'in-progress' | 'abandoned';
  scorePercentage: number;
  earnedPoints: number;
  totalPoints: number;
  timeSpentSeconds: number;
  startedAt?: string;
  completedAt: string;
  autoSubmittedDueToLockBrowser?: boolean;
  responses?: Array<{
    questionIndex: number;
    questionType?: string;
    isCorrect?: boolean;
    pointsEarned?: number;
    subQuestionGrades?: Array<{ questionIndex: number; isCorrect?: boolean }>;
  }>;
}

interface AttemptResultSummary {
  correctCount: number;
  wrongCount: number;
  totalGraded: number;
  wrongLabels: string[];
}

interface StudentSummary {
  studentId: string;
  name: string;
  email?: string;
  batch?: string;
  level?: string;
  isTestAccount?: boolean;
  attempts: number;
  bestScore: number;
  lastAttemptAt: string;
}

interface QuestionStats {
  index: number;
  type?: string;
  prompt?: string;
  totalAttempts: number;
  correctCount: number;
  wrongCount: number;
  failureRate: number;
}

@Component({
  selector: 'app-exercise-completion-details',
  standalone: true,
  imports: [CommonModule, FormsModule, TestAccountBadgeComponent],
  templateUrl: './exercise-completion-details.component.html',
  styleUrls: ['./exercise-completion-details.component.css']
})
export class ExerciseCompletionDetailsComponent implements OnInit {
  exercise: DigitalExercise | null = null;
  exerciseId = '';
  loading = true;
  error = '';

  attempts: Attempt[] = [];
  /** Every attempt row for the table (#1, #2, …), including in-progress. */
  tableAttempts: Attempt[] = [];
  studentSummaries: StudentSummary[] = [];
  questionStats: QuestionStats[] = [];
  totalCompletions = 0;
  avgScore = 0;
  uniqueStudents = 0;
  allAttempts: Attempt[] = [];
  selectedBatch = 'all';
  regradingAll = false;
  regradeAllMessage = '';
  regradeAllError = '';
  private autoRegradeDone = false;
  private completionsLoaded = false;
  private exerciseLoaded = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private exerciseService: DigitalExerciseService
  ) {}

  ngOnInit(): void {
    this.exerciseId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.exerciseId) {
      this.error = 'Exercise ID missing';
      this.loading = false;
      return;
    }
    this.loadExercise();
    this.loadCompletions();
  }

  loadExercise(): void {
    this.exerciseService.getExercise(this.exerciseId).subscribe({
      next: (ex) => {
        this.exercise = ex;
        this.exerciseLoaded = true;
        this.tryAutoRegradeFillBlankAttempts();
      },
      error: () => { this.exercise = null; }
    });
  }

  exerciseHasMultipartFillBlank(): boolean {
    return (this.exercise?.questions || []).some((q: any) => {
      const subs = Array.isArray(q?.subQuestions) ? q.subQuestions : [];
      return q?.type === 'fill-blank' && subs.some((sq: any) => sq?.type === 'fill-blank');
    });
  }

  private tryAutoRegradeFillBlankAttempts(): void {
    if (!this.completionsLoaded || !this.exerciseLoaded) return;
    if (this.autoRegradeDone || this.regradingAll) return;
    if (!this.exerciseId || !this.exerciseHasMultipartFillBlank() || !this.allAttempts.length) return;
    this.autoRegradeDone = true;
    this.regradeAllAttempts(false);
  }

  regradeAllAttempts(manual = true): void {
    if (!this.exerciseId || this.regradingAll) return;
    this.regradingAll = true;
    this.regradeAllError = '';
    this.regradeAllMessage = manual ? 'Updating scores…' : 'Auto-mapping fill-in-the-blank answers and updating scores…';

    this.exerciseService.regradeAllAttemptsForStaff(this.exerciseId).subscribe({
      next: (res) => {
        this.regradingAll = false;
        this.regradeAllMessage =
          `Updated ${res.updated} of ${res.totalAttempts} attempt(s). Scores and progress records are refreshed.`;
        this.loadCompletions();
      },
      error: (err) => {
        this.regradingAll = false;
        this.regradeAllMessage = '';
        this.regradeAllError = err?.error?.error || 'Could not update all attempts';
      }
    });
  }

  loadCompletions(): void {
    this.loading = true;
    this.fetchAllAttemptsForExercise().subscribe({
      next: (rows) => {
        this.allAttempts = rows;
        this.applyFilters();
        this.loading = false;
        this.completionsLoaded = true;
        this.tryAutoRegradeFillBlankAttempts();
      },
      error: () => {
        this.loading = false;
        this.error = 'Failed to load completion data';
      }
    });
  }

  /** Load every attempt (#1, #2, …), paginating if the API returns multiple pages. */
  private fetchAllAttemptsForExercise() {
    const base = { all: true, limit: 500 };
    return this.exerciseService.getExerciseCompletions(this.exerciseId, base).pipe(
      switchMap((res) => {
        const first = (res.attempts || []) as Attempt[];
        const pages = Number(res.pages) || 1;
        if (pages <= 1) return of(first);
        const rest = Array.from({ length: pages - 1 }, (_, i) =>
          this.exerciseService.getExerciseCompletions(this.exerciseId, { page: i + 2, limit: 500 }).pipe(
            map((r) => (r.attempts || []) as Attempt[]),
            catchError(() => of([] as Attempt[]))
          )
        );
        return forkJoin(rest).pipe(
          map((chunks) => {
            const merged = [...first];
            for (const chunk of chunks) merged.push(...chunk);
            return merged;
          })
        );
      })
    );
  }

  private computeAnalytics(sourceAttempts: Attempt[], tableSource: Attempt[]): void {
    this.tableAttempts = tableSource;
    this.attempts = sourceAttempts.filter((a) => (a.status || 'completed') === 'completed');
    this.totalCompletions = this.attempts.length;

    // Student summaries (attempt count = all rows; best/last from completed only)
    const byStudent: Record<string, { all: Attempt[]; completed: Attempt[] }> = {};
    const sidOf = (a: Attempt) => {
      const s = a.studentId as any;
      return s ? (s._id || s.id || (typeof s === 'string' ? s : 'unknown')) : 'unknown';
    };
    tableSource.forEach((a) => {
      const sid = sidOf(a);
      if (!byStudent[sid]) byStudent[sid] = { all: [], completed: [] };
      byStudent[sid].all.push(a);
      if ((a.status || 'completed') === 'completed') byStudent[sid].completed.push(a);
    });

    this.studentSummaries = Object.entries(byStudent).map(([sid, data]) => {
      const first = data.all[0];
      const student = first.studentId as any;
      const completed = data.completed;
      const best = completed.length
        ? completed.reduce((max, a) => a.scorePercentage > max ? a.scorePercentage : max, 0)
        : 0;
      const lastSource = completed.length ? completed : data.all;
      const last = [...lastSource].sort((x, y) =>
        new Date(y.completedAt || y.startedAt || 0).getTime() - new Date(x.completedAt || x.startedAt || 0).getTime()
      )[0];
      return {
        studentId: sid,
        name: student?.name || first.studentName || 'Unknown',
        email: student?.email,
        batch: student?.batch || first.studentBatch,
        level: student?.level,
        isTestAccount: !!(student && student.isTestAccount),
        attempts: data.all.length,
        bestScore: best,
        lastAttemptAt: last.completedAt || ''
      };
    }).sort((a, b) => b.attempts - a.attempts);

    this.uniqueStudents = this.studentSummaries.length;

    if (this.attempts.length > 0) {
      this.avgScore = Math.round(
        this.attempts.reduce((s, a) => s + a.scorePercentage, 0) / this.attempts.length
      );
    }

    // Question-level stats
    const qMap: Record<number, { correct: number; wrong: number }> = {};
    this.attempts.forEach(a => {
      (a.responses || []).forEach((r: any) => {
        const idx = r.questionIndex ?? r.questionIndex;
        if (idx === undefined) return;
        if (!qMap[idx]) qMap[idx] = { correct: 0, wrong: 0 };
        if (r.isCorrect) qMap[idx].correct++;
        else qMap[idx].wrong++;
      });
    });

    const questions = this.exercise?.questions || [];
    this.questionStats = Object.entries(qMap).map(([idxStr, stats]) => {
      const idx = parseInt(idxStr, 10);
      const q = questions[idx];
      const total = stats.correct + stats.wrong;
      return {
        index: idx + 1,
        type: q?.type,
        prompt: this.getQuestionPrompt(q, idx),
        totalAttempts: total,
        correctCount: stats.correct,
        wrongCount: stats.wrong,
        failureRate: total > 0 ? Math.round((stats.wrong / total) * 100) : 0
      };
    }).sort((a, b) => b.failureRate - a.failureRate);
  }

  private applyFilters(): void {
    const filtered = this.selectedBatch === 'all'
      ? this.allAttempts
      : this.allAttempts.filter((a) => {
        const student = a.studentId as any;
        const batch = String(student?.batch || a.studentBatch || '').trim();
        return batch === this.selectedBatch;
      });
    const completedOnly = filtered.filter((a) => (a.status || 'completed') === 'completed');
    this.computeAnalytics(completedOnly, filtered);
  }

  onBatchChange(): void {
    this.applyFilters();
  }

  get batchOptions(): string[] {
    const set = new Set<string>();
    (this.allAttempts || []).forEach((a) => {
      const student = a.studentId as any;
      const batch = String(student?.batch || a.studentBatch || '').trim();
      if (batch) set.add(batch);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }

  exportStudentSummaryCsv(): void {
    const rows = this.studentSummaries || [];
    const headers = ['Student Name', 'Email', 'Batch', 'Level', 'Attempts', 'Best Score (%)', 'Last Attempt'];
    const lines = [headers.join(',')];
    rows.forEach((s) => {
      lines.push([
        this.csvCell(s.name || ''),
        this.csvCell(s.email || ''),
        this.csvCell(s.batch || ''),
        this.csvCell(s.level || ''),
        this.csvCell(String(s.attempts || 0)),
        this.csvCell(String(s.bestScore || 0)),
        this.csvCell(this.formatDate(s.lastAttemptAt))
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const batchPart = this.selectedBatch === 'all' ? 'all-batches' : this.selectedBatch.replace(/[^a-z0-9_-]+/gi, '-');
    a.href = url;
    a.download = `exercise-completions-${this.exerciseId}-${batchPart}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private csvCell(v: string): string {
    const safe = String(v ?? '');
    return `"${safe.replace(/"/g, '""')}"`;
  }

  private getQuestionPrompt(q: any, idx: number): string {
    if (!q) return `Question ${idx + 1}`;
    const text = q.question || q.prompt || q.instruction || q.sentence || q.word || '';
    return (text as string).slice(0, 80) + (text.length > 80 ? '...' : '');
  }

  formatTime(seconds: number): string {
    if (!seconds) return '—';
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  formatDate(d: string): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('sr-Latn-RS', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  getLevelColor(level: string): string {
    return this.exerciseService.getLevelColor(level);
  }

  getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      mcq: 'Multiple Choice', matching: 'Matching', 'fill-blank': 'Fill Blanks',
      pronunciation: 'Pronunciation', 'question-answer': 'Q&A', listening: 'Listening'
    };
    return labels[type] || type || '—';
  }

  getFailureClass(rate: number): string {
    if (rate >= 70) return 'fail-high';
    if (rate >= 40) return 'fail-medium';
    return 'fail-low';
  }

  backToList(): void {
    this.router.navigate(['/admin/digital-exercises']);
  }

  get hasAttempts(): boolean {
    return Array.isArray(this.tableAttempts) && this.tableAttempts.length > 0;
  }

  get hasStudentSummaries(): boolean {
    return Array.isArray(this.studentSummaries) && this.studentSummaries.length > 0;
  }

  get hasQuestionStats(): boolean {
    return Array.isArray(this.questionStats) && this.questionStats.length > 0;
  }

  /** Cohort-wide item correctness from aggregated question stats */
  get cohortItemAccuracy(): { correct: number; wrong: number; pct: number } {
    let correct = 0;
    let wrong = 0;
    for (const q of this.questionStats) {
      correct += q.correctCount;
      wrong += q.wrongCount;
    }
    const denom = correct + wrong;
    const pct = denom > 0 ? Math.round((correct / denom) * 100) : 0;
    return { correct, wrong, pct };
  }

  get cohortDonutDash(): string {
    return `${this.cohortItemAccuracy.pct}, 100`;
  }

  openAttemptDetailInNewTab(attempt: Attempt, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.isAttemptCompleted(attempt)) return;
    const aid = attempt._id;
    if (!aid || !this.exerciseId) return;
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/admin/digital-exercises', this.exerciseId, 'attempt', aid])
    );
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /** All attempts per student (#1, then #2, …) — no collapsing to latest only. */
  get attemptsForTable(): Attempt[] {
    return [...(this.tableAttempts || [])].sort((a, b) => {
      const nameA = this.attemptStudentName(a);
      const nameB = this.attemptStudentName(b);
      const byName = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      if (byName !== 0) return byName;
      return (a.attemptNumber || 0) - (b.attemptNumber || 0);
    });
  }

  isAttemptCompleted(attempt: Attempt): boolean {
    return (attempt.status || 'completed') === 'completed';
  }

  getAttemptStatusLabel(attempt: Attempt): string {
    const s = attempt.status || 'completed';
    if (s === 'in-progress') return 'In progress';
    if (s === 'abandoned') return 'Abandoned';
    return 'Completed';
  }

  attemptStudentName(attempt: Attempt): string {
    const student = attempt.studentId as { name?: string } | undefined;
    return student?.name || attempt.studentName || '';
  }

  getAttemptResultSummary(attempt: Attempt): AttemptResultSummary {
    const questions = this.exercise?.questions || [];
    const byIdx: Record<number, NonNullable<Attempt['responses']>[number]> = {};
    (attempt.responses || []).forEach((r) => {
      if (r.questionIndex !== undefined && r.questionIndex !== null) {
        byIdx[r.questionIndex] = r;
      }
    });

    let correctCount = 0;
    let wrongCount = 0;
    const wrongLabels: string[] = [];

    const qCount = Math.max(questions.length, ...Object.keys(byIdx).map((k) => Number(k) + 1), 0);
    for (let i = 0; i < qCount; i++) {
      const q = questions[i];
      const r = byIdx[i];
      const subs = Array.isArray((q as any)?.subQuestions) ? (q as any).subQuestions : [];
      const subGrades = Array.isArray(r?.subQuestionGrades) ? r.subQuestionGrades : [];

      if (subs.length) {
        if (subGrades.length) {
          for (let si = 0; si < subs.length; si++) {
            const g = subGrades.find((x) => Number(x.questionIndex) === si);
            if (!g || g.isCorrect === undefined) continue;
            if (g.isCorrect) correctCount++;
            else {
              wrongCount++;
              wrongLabels.push(`${i + 1}.${si + 1}`);
            }
          }
        } else if (r?.isCorrect !== undefined) {
          if (r.isCorrect) correctCount++;
          else {
            wrongCount++;
            wrongLabels.push(String(i + 1));
          }
        }
        continue;
      }

      if (!r || r.isCorrect === undefined) continue;
      if (r.isCorrect) correctCount++;
      else {
        wrongCount++;
        wrongLabels.push(String(i + 1));
      }
    }

    return {
      correctCount,
      wrongCount,
      totalGraded: correctCount + wrongCount,
      wrongLabels
    };
  }

}
