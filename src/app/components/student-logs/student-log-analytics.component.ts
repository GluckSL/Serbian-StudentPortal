import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { StudentAnalyticsResponse, StudentLogService } from '../../services/student-log.service';

@Component({
  selector: 'app-student-log-analytics',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './student-log-analytics.component.html',
  styleUrls: ['./student-log-analytics.component.css']
})
export class StudentLogAnalyticsComponent implements OnInit {
  loading = true;
  error = '';
  analytics: StudentAnalyticsResponse | null = null;

  constructor(
    private route: ActivatedRoute,
    private studentLogService: StudentLogService
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const studentId = params.get('studentId');
      if (!studentId) {
        this.error = 'Student ID is missing';
        this.loading = false;
        return;
      }
      this.fetchStudentAnalytics(studentId);
    });
  }

  fetchStudentAnalytics(studentId: string): void {
    this.loading = true;
    this.error = '';
    this.studentLogService.getStudentAnalytics(studentId).subscribe({
      next: (res) => {
        if (res?.success) {
          this.analytics = res.data;
        } else {
          this.error = 'Failed to load student analytics';
        }
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load student analytics';
        this.loading = false;
      }
    });
  }

  fmt(date: string | Date | null | undefined): string {
    if (!date) return '-';
    return new Date(date).toLocaleString();
  }

  mins(seconds?: number | null): number {
    if (!seconds || !Number.isFinite(seconds)) return 0;
    return Math.round(seconds / 60);
  }
}
