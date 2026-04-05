import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { environment } from '../../../environments/environment';

const apiUrl = environment.apiUrl;

interface ReportMetric {
  label: string;
  count: number;
  percentage: number;
}

interface MeetingRow {
  _id: string;
  topic: string;
  batch: string;
  startTime: string;
  status: string;
  attendanceRecorded: boolean;
  present: number;
  late: number;
  absent: number;
  total: number;
  attendanceRate: number;
}

interface TeacherReportData {
  teacher: {
    _id: string;
    name: string;
    regNo: string;
    email: string;
    role: string;
    medium: string[];
    assignedCourses: { _id: string; title: string }[];
    assignedBatches: string[];
  };
  summary: {
    totalStudents: number;
    totalAssignedBatches: number;
    totalMeetings: number;
    totalAttendanceRecords: number;
    overallAttendanceRate: number;
    averageCourseDay: number;
  };
  performance: {
    statusBreakdown: Record<string, number>;
    levelBreakdown: Record<string, number>;
  };
  attendance: {
    attendedCount: number;
    lateCount: number;
    absentCount: number;
    recentMeetings: MeetingRow[];
  };
  meetings: {
    pastMeetings: MeetingRow[];
    upcomingMeetings: MeetingRow[];
  };
  batchBreakdown: Array<{
    batch: string;
    totalStudents: number;
    ongoing: number;
    completed: number;
    withdrew: number;
    uncertain: number;
  }>;
  students: Array<{
    _id: string;
    name: string;
    regNo: string;
    email: string;
    level: string;
    batch: string;
    studentStatus: string;
    currentCourseDay: number | null;
    averageExamScore: number | null;
  }>;
}

@Component({
  selector: 'app-teacher-analytics',
  standalone: true,
  imports: [CommonModule, HttpClientModule, RouterModule],
  templateUrl: './teacher-analytics.component.html',
  styleUrls: ['./teacher-analytics.component.css']
})
export class TeacherAnalyticsComponent implements OnInit {
  loading = true;
  error = '';
  report: TeacherReportData | null = null;
  statusMetrics: ReportMetric[] = [];
  levelMetrics: ReportMetric[] = [];

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const teacherId = params.get('id');
      if (!teacherId) {
        this.error = 'Teacher ID is missing.';
        this.loading = false;
        return;
      }
      this.fetchTeacherReport(teacherId);
    });
  }

  fetchTeacherReport(teacherId: string): void {
    this.loading = true;
    this.error = '';

    this.http
      .get<{ success: boolean; data: TeacherReportData }>(`${apiUrl}/admin/teachers/${teacherId}/report`, {
        withCredentials: true
      })
      .subscribe({
        next: (res) => {
          if (res?.success && res.data) {
            this.report = res.data;
            this.statusMetrics = this.toMetrics(
              res.data.performance.statusBreakdown,
              ['ONGOING', 'COMPLETED', 'WITHDREW', 'UNCERTAIN']
            );
            this.levelMetrics = this.toMetrics(
              res.data.performance.levelBreakdown,
              ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
            );
          } else {
            this.report = null;
            this.error = 'Unable to load teacher analytics.';
          }
          this.loading = false;
        },
        error: (err) => {
          this.report = null;
          this.error = err?.error?.message || 'Unable to load teacher analytics.';
          this.loading = false;
        }
      });
  }

  exportAsJson(): void {
    if (!this.report) return;
    const fileName = `teacher-analytics-${this.report.teacher.regNo || this.report.teacher._id}.json`;
    const blob = new Blob([JSON.stringify(this.report, null, 2)], { type: 'application/json;charset=utf-8;' });
    this.downloadBlob(blob, fileName);
  }

  exportStudentsCsv(): void {
    if (!this.report) return;
    const header = [
      'Name',
      'Reg No',
      'Email',
      'Level',
      'Batch',
      'Status',
      'Current Course Day',
      'Average Exam Score'
    ];
    const rows = this.report.students.map((student) => [
      student.name,
      student.regNo,
      student.email,
      student.level,
      student.batch,
      student.studentStatus,
      student.currentCourseDay ?? '',
      student.averageExamScore ?? ''
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const fileName = `teacher-students-${this.report.teacher.regNo || this.report.teacher._id}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    this.downloadBlob(blob, fileName);
  }

  printReport(): void {
    window.print();
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  private toMetrics(source: Record<string, number>, keys: string[]): ReportMetric[] {
    const total = keys.reduce((sum, key) => sum + (source[key] || 0), 0);
    return keys.map((key) => {
      const count = source[key] || 0;
      return {
        label: key,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0
      };
    });
  }
}
