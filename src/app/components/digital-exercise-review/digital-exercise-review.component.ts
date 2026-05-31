import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DigitalExerciseService,
  AttemptReviewRow,
  MyExerciseReviewResponse
} from '../../services/digital-exercise.service';
@Component({
  selector: 'app-digital-exercise-review',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './digital-exercise-review.component.html',
  styleUrls: ['./digital-exercise-review.component.css']
})
export class DigitalExerciseReviewComponent implements OnInit {
  exerciseId = '';
  loading = true;
  error = '';
  data: MyExerciseReviewResponse | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private exerciseService: DigitalExerciseService
  ) {}

  ngOnInit(): void {
    this.exerciseId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.exerciseId) {
      this.error = 'Exercise not found';
      this.loading = false;
      return;
    }
    this.exerciseService.getMyExerciseReview(this.exerciseId).subscribe({
      next: (res) => {
        this.data = res;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'Could not load your results';
      }
    });
  }

  back(): void {
    const ref = this.route.snapshot.queryParamMap.get('from');
    const fc = this.route.snapshot.queryParamMap.get('fc');
    if (ref === 'analytics') {
      const qp = fc ? { from: fc } : {};
      this.router.navigate(['/digital-exercises', 'analytics'], { queryParams: qp });
      return;
    }
    this.router.navigate(['/digital-exercises']);
  }

  wrongRows(rows: AttemptReviewRow[]): AttemptReviewRow[] {
    return rows.filter((r) => !r.isCorrect);
  }

  formatDate(d: string | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  get donutStrokeDash(): string {
    const s = this.data?.summary;
    if (!s || s.totalQuestions <= 0) return '0, 100';
    const pct = Math.round((s.correctCount / s.totalQuestions) * 100);
    return `${pct}, 100`;
  }
}
