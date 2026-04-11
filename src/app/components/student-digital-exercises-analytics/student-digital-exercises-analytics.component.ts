import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DigitalExerciseService, DigitalExercise } from '../../services/digital-exercise.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-student-digital-exercises-analytics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './student-digital-exercises-analytics.component.html',
  styleUrls: ['./student-digital-exercises-analytics.component.css']
})
export class StudentDigitalExercisesAnalyticsComponent implements OnInit {
  loading = true;
  error = '';
  exercises: DigitalExercise[] = [];
  private returnTo: string | null = null;

  constructor(
    private exerciseService: DigitalExerciseService,
    private authService: AuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.returnTo = this.route.snapshot.queryParamMap.get('from');
    const role = this.authService.getSnapshotUser()?.role;
    if (role !== 'STUDENT') {
      this.router.navigate(['/digital-exercises']);
      return;
    }
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.exerciseService.getExercises({ page: 1, limit: 100 }).subscribe({
      next: (res) => {
        this.exercises = res.exercises || [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.error = 'Could not load your exercises.';
      }
    });
  }

  back(): void {
    if (this.returnTo === 'my-course') {
      this.router.navigate(['/my-course']);
    } else {
      this.router.navigate(['/digital-exercises']);
    }
  }

  get completedExercises(): DigitalExercise[] {
    return this.exercises.filter((ex) => ex.studentAttempt);
  }

  get sortedCompleted(): DigitalExercise[] {
    const list = [...this.completedExercises];
    list.sort((a, b) => {
      const ta = new Date((a.studentAttempt?.completedAt as any) || 0).getTime();
      const tb = new Date((b.studentAttempt?.completedAt as any) || 0).getTime();
      return tb - ta;
    });
    return list;
  }

  get overall(): {
    completedExercises: number;
    totalQuestions: number;
    wrongTotal: number;
    correctTotal: number;
    itemAccuracyPct: number;
    avgScorePct: number;
  } {
    const withAttempt = this.completedExercises;
    let totalQuestions = 0;
    let wrongTotal = 0;
    let correctTotal = 0;
    let scoreSum = 0;
    for (const ex of withAttempt) {
      const a = ex.studentAttempt!;
      const tq =
        typeof a.totalQuestions === 'number' && a.totalQuestions > 0
          ? a.totalQuestions
          : ex.questions?.length || 0;
      totalQuestions += tq;
      const w = typeof a.wrongCount === 'number' ? a.wrongCount : 0;
      const c =
        typeof a.correctCount === 'number'
          ? a.correctCount
          : Math.max(0, tq - w);
      wrongTotal += w;
      correctTotal += c;
      scoreSum += Number(a.scorePercentage) || 0;
    }
    const denom = correctTotal + wrongTotal;
    const itemAccuracyPct =
      denom > 0 ? Math.round((correctTotal / denom) * 100) : 0;
    const avgScorePct =
      withAttempt.length > 0
        ? Math.round(scoreSum / withAttempt.length)
        : 0;
    return {
      completedExercises: withAttempt.length,
      totalQuestions,
      wrongTotal,
      correctTotal,
      itemAccuracyPct,
      avgScorePct
    };
  }

  get donutDash(): string {
    return `${this.overall.itemAccuracyPct}, 100`;
  }

  openExerciseReview(ex: DigitalExercise): void {
    if (!ex._id || !ex.studentAttempt) return;
    const qp: Record<string, string> = { from: 'analytics' };
    if (this.returnTo) qp['fc'] = this.returnTo;
    this.router.navigate(['/digital-exercises', ex._id, 'review'], { queryParams: qp });
  }

  formatDate(d: unknown): string {
    if (!d) return '—';
    return new Date(d as string).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  getLevelColor(level: string): string {
    return this.exerciseService.getLevelColor(level);
  }
}
