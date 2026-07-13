import { Component, Input, OnChanges, OnInit, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { SprechenApiService } from '../sprechen-api.service';
import type { SprechenExamModuleSummary } from '../sprechen-exam.types';

@Component({
  selector: 'app-sprechen-exam-hub',
  standalone: true,
  imports: [CommonModule, RouterModule, MatButtonModule, MatIconModule],
  templateUrl: './sprechen-exam-hub.component.html',
  styleUrl: './sprechen-exam-hub.component.scss',
})
export class SprechenExamHubComponent implements OnInit, OnChanges {
  @Input() embedded = false;
  @Input() hideEmbeddedHeader = false;
  @Input() journeyFixedDay: number | null = null;
  @Input() tutorName = 'Olly Tutor';

  private allModules: SprechenExamModuleSummary[] = [];
  rawModuleCount = 0;
  modules: SprechenExamModuleSummary[] = [];
  loading = true;
  error: string | null = null;
  studentCourseDay = 1;

  private readonly api = inject(SprechenApiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['journeyFixedDay'] && !changes['journeyFixedDay'].firstChange && this.allModules.length) {
      this.applyDayScope();
    }
  }

  ngOnInit(): void {
    if (!this.embedded) {
      const u = this.auth.getSnapshotUser();
      if (u?.role === 'STUDENT') {
        this.router.navigate(['/student/my-course'], {
          queryParams: { tab: 'talk-buddy', buddy: 'exam' },
          replaceUrl: true,
        });
        return;
      }
    }
    this.loadModules();
  }

  loadModules(): void {
    this.loading = true;
    this.error = null;
    this.api.listStudentModules().subscribe({
      next: (d) => {
        this.allModules = d.modules || [];
        this.rawModuleCount = this.allModules.length;
        const day = Number(d?.studentCourseDay);
        if (Number.isFinite(day) && day >= 1) {
          this.studentCourseDay = Math.min(200, Math.floor(day));
        }
        this.applyDayScope();
        this.loading = false;
      },
      error: (e) => {
        this.error = e?.error?.message || 'Nije moguće učitati ispite.';
        this.loading = false;
      },
    });
  }

  applyDayScope(): void {
    if (this.journeyFixedDay != null && Number.isFinite(Number(this.journeyFixedDay))) {
      const d = Math.min(200, Math.max(1, Math.floor(Number(this.journeyFixedDay))));
      this.modules = this.allModules.filter((m) => this.moduleCourseDayNum(m) === d);
    } else if (this.embedded) {
      // Glück Buddy Exam tab: show modules for current journey day (same as Practice)
      this.modules = this.allModules.filter(
        (m) => this.moduleCourseDayNum(m) === this.studentCourseDay || this.moduleCourseDayNum(m) == null,
      );
    } else {
      this.modules = [...this.allModules];
    }
  }

  moduleCourseDayNum(m: SprechenExamModuleSummary): number | null {
    const cd = m.courseDay;
    if (cd == null) return null;
    const n = Number(cd);
    return Number.isFinite(n) ? Math.min(200, Math.max(1, Math.floor(n))) : null;
  }

  journeyDayLabel(m: SprechenExamModuleSummary): string {
    const d = this.moduleCourseDayNum(m);
    return d == null ? 'Bilo koji dan' : `Dan ${d}`;
  }

  trackModule = (_: number, m: SprechenExamModuleSummary): string => m._id;
}
