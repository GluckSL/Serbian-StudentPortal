// exercise-completion-details.component.ts — Teacher analytics for exercise completions

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestAccountBadgeComponent } from '../../../shared/test-account-badge/test-account-badge.component';
import { ActivatedRoute, Router } from '@angular/router';
import { DigitalExerciseService, DigitalExercise } from '../../../services/digital-exercise.service';

interface Attempt {
  _id?: string;
  studentId?: { name?: string; email?: string; batch?: string; level?: string };
  studentName?: string;
  studentBatch?: string;
  attemptNumber: number;
  scorePercentage: number;
  earnedPoints: number;
  totalPoints: number;
  timeSpentSeconds: number;
  completedAt: string;
  responses?: Array<{ questionIndex: number; questionType?: string; isCorrect?: boolean; pointsEarned?: number }>;
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
  studentSummaries: StudentSummary[] = [];
  questionStats: QuestionStats[] = [];
  totalCompletions = 0;
  avgScore = 0;
  uniqueStudents = 0;
  allAttempts: Attempt[] = [];
  selectedBatch = 'all';

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
      next: (ex) => { this.exercise = ex; },
      error: () => { this.exercise = null; }
    });
  }

  loadCompletions(): void {
    this.loading = true;
    this.exerciseService.getExerciseCompletions(this.exerciseId, { limit: 500 }).subscribe({
      next: (res) => {
        this.allAttempts = res.attempts || [];
        this.applyFilters();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.error = 'Failed to load completion data';
      }
    });
  }

  private computeAnalytics(sourceAttempts: Attempt[]): void {
    this.attempts = sourceAttempts;
    this.totalCompletions = this.attempts.length;

    // Student summaries
    const byStudent: Record<string, { attempts: Attempt[] }> = {};
    this.attempts.forEach(a => {
      const s = a.studentId as any;
      const sid = s ? (s._id || s.id || (typeof s === 'string' ? s : 'unknown')) : 'unknown';
      if (!byStudent[sid]) byStudent[sid] = { attempts: [] };
      byStudent[sid].attempts.push(a);
    });

    this.studentSummaries = Object.entries(byStudent).map(([sid, data]) => {
      const first = data.attempts[0];
      const student = first.studentId as any;
      const best = data.attempts.reduce((max, a) => a.scorePercentage > max ? a.scorePercentage : max, 0);
      const last = data.attempts.sort((x, y) =>
        new Date(y.completedAt).getTime() - new Date(x.completedAt).getTime()
      )[0];
      return {
        studentId: sid,
        name: student?.name || first.studentName || 'Unknown',
        email: student?.email,
        batch: student?.batch || first.studentBatch,
        level: student?.level,
        isTestAccount: !!(student && student.isTestAccount),
        attempts: data.attempts.length,
        bestScore: best,
        lastAttemptAt: last.completedAt
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
    this.computeAnalytics(filtered);
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
    return new Date(d).toLocaleDateString('en-US', {
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
    return Array.isArray(this.attempts) && this.attempts.length > 0;
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
    const aid = attempt._id;
    if (!aid || !this.exerciseId) return;
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/admin/digital-exercises', this.exerciseId, 'attempt', aid])
    );
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
