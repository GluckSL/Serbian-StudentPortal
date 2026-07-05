import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, HostListener, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService, getAuthToken } from '../../services/auth.service';

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
  meetingDurationMinutes?: number;
  avgAttendedMinutes?: number;
  totalAttendedMinutes?: number;
  scheduledMinutes?: number;
}

interface TeachingTimeData {
  totalMinutes: number;
  totalAttendedStudentMinutes: number;
  pastMeetingCount: number;
  meetingsWithRecordedDuration: number;
  meetingsUsingDefaultDuration: number;
  meetings: MeetingRow[];
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
    totalTeachingMinutes?: number;
  };
  teachingTime?: TeachingTimeData;
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
  imports: [CommonModule, RouterModule],
  templateUrl: './teacher-analytics.component.html',
  styleUrls: ['./teacher-analytics.component.css']
})
export class TeacherAnalyticsComponent implements OnInit {
  loading = true;
  error = '';
  report: TeacherReportData | null = null;
  statusMetrics: ReportMetric[] = [];
  levelMetrics: ReportMetric[] = [];
  showTeachingTimeModal = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private authService: AuthService
  ) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeTeachingTimeModal();
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const teacherId = params.get('id');
      if (teacherId && teacherId !== 'me') {
        this.fetchTeacherReport(teacherId);
        return;
      }
      const currentUser = this.authService.getSnapshotUser();
      if (currentUser?._id) {
        this.router.navigate(['/teachers', currentUser._id, 'analytics'], { replaceUrl: true });
      } else {
        this.authService.getUserProfile().subscribe({
          next: (user: any) => {
            if (user?._id) {
              this.router.navigate(['/teachers', user._id, 'analytics'], { replaceUrl: true });
            } else {
              this.error = 'Unable to determine teacher ID.';
              this.loading = false;
            }
          },
          error: () => {
            this.error = 'Teacher ID is missing.';
            this.loading = false;
          }
        });
      }
    });
  }

  fetchTeacherReport(teacherId: string): void {
    this.loading = true;
    this.error = '';

    const token = getAuthToken();
    const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;

    const currentUser = this.authService.getSnapshotUser();
    const isTeacherSelf = currentUser?._id === teacherId && (currentUser?.role === 'TEACHER' || currentUser?.role === 'TEACHER_ADMIN');
    const url = isTeacherSelf
      ? `${apiUrl}/teacher/report`
      : `${apiUrl}/admin/teachers/${teacherId}/report`;

    this.http
      .get<{ success: boolean; data: TeacherReportData }>(url, {
        withCredentials: true,
        headers
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

  openTeachingTimeModal(): void {
    if (!this.report) return;
    this.showTeachingTimeModal = true;
    document.body.style.overflow = 'hidden';
  }

  closeTeachingTimeModal(): void {
    this.showTeachingTimeModal = false;
    document.body.style.overflow = '';
  }

  getTeachingTimeMeetings(): MeetingRow[] {
    return this.report?.teachingTime?.meetings ?? this.report?.meetings.pastMeetings ?? [];
  }

  getTotalTeachingMinutes(): number {
    if (this.report?.teachingTime?.totalMinutes != null) {
      return this.report.teachingTime.totalMinutes;
    }
    if (this.report?.summary?.totalTeachingMinutes != null) {
      return this.report.summary.totalTeachingMinutes;
    }
    return this.getTeachingTimeMeetings().reduce(
      (sum, m) => sum + (m.scheduledMinutes ?? m.meetingDurationMinutes ?? 0),
      0
    );
  }

  getTeachingHours(): string {
    return this.formatMinutes(this.getTotalTeachingMinutes());
  }

  getAttendancePercent(): number {
    return this.report?.summary?.overallAttendanceRate ?? 0;
  }

  formatMinutes(totalMinutes: number): string {
    if (!totalMinutes) return '0 hrs';
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hrs === 0) return `${mins} min`;
    return mins > 0 ? `${hrs} hrs ${mins} min` : `${hrs} hr${hrs !== 1 ? 's' : ''}`;
  }

  formatMeetingDuration(meeting: MeetingRow): string {
    const mins = meeting.scheduledMinutes ?? meeting.meetingDurationMinutes ?? 0;
    if (!mins) return '—';
    return this.formatMinutes(mins);
  }

  getDurationSourceLabel(meeting: MeetingRow): string {
    if ((meeting.meetingDurationMinutes ?? 0) > 0) return 'Recorded';
    if ((meeting.scheduledMinutes ?? 0) > 0) return 'Estimated (60 min)';
    return 'No duration';
  }

  exportAsJson(): void {
    if (!this.report) return;
    const fileName = `teacher-analytics-${this.report.teacher.regNo || this.report.teacher._id}.json`;
    const blob = new Blob([JSON.stringify(this.report, null, 2)], { type: 'application/json;charset=utf-8;' });
    this.downloadBlob(blob, fileName);
  }

  exportTeachingTimeCsv(): void {
    const payload = this.buildTeachingTimeExport();
    if (!payload) return;

    const header = [
      'Topic',
      'Batch',
      'Date',
      'Present',
      'Late',
      'Absent',
      'Duration (min)',
      'Duration',
      'Source',
      'Attendance Rate %'
    ];
    const rows = payload.meetings.map((m) => [
      m.topic,
      m.batch,
      m.startTime,
      m.present,
      m.late,
      m.absent,
      m.durationMinutes,
      m.durationFormatted,
      m.source,
      m.attendanceRate
    ]);
    rows.push([
      'TOTAL',
      '',
      '',
      '',
      '',
      '',
      payload.summary.totalTeachingMinutes,
      payload.summary.totalTeachingHours,
      '',
      ''
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const slug = payload.teacher.regNo || payload.teacher._id;
    this.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `teaching-time-${slug}.csv`);
  }

  exportTeachingTimeJson(): void {
    const payload = this.buildTeachingTimeExport();
    if (!payload) return;
    const slug = payload.teacher.regNo || payload.teacher._id;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
    this.downloadBlob(blob, `teaching-time-${slug}.json`);
  }

  private buildTeachingTimeExport(): {
    teacher: { name: string; regNo: string; _id: string };
    generatedAt: string;
    summary: {
      totalTeachingMinutes: number;
      totalTeachingHours: string;
      pastMeetingCount: number;
      meetingsWithRecordedDuration?: number;
      meetingsUsingDefaultDuration?: number;
      totalAttendedStudentMinutes?: number;
      totalAttendedStudentHours?: string;
    };
    meetings: Array<{
      topic: string;
      batch: string;
      startTime: string;
      present: number;
      late: number;
      absent: number;
      durationMinutes: number;
      durationFormatted: string;
      source: string;
      attendanceRate: number;
    }>;
  } | null {
    if (!this.report) return null;

    const meetings = this.getTeachingTimeMeetings();
    const tt = this.report.teachingTime;
    const totalAttendedStudentMinutes = tt?.totalAttendedStudentMinutes;

    return {
      teacher: {
        name: this.report.teacher.name,
        regNo: this.report.teacher.regNo,
        _id: this.report.teacher._id
      },
      generatedAt: new Date().toISOString(),
      summary: {
        totalTeachingMinutes: this.getTotalTeachingMinutes(),
        totalTeachingHours: this.getTeachingHours(),
        pastMeetingCount: tt?.pastMeetingCount ?? meetings.length,
        meetingsWithRecordedDuration: tt?.meetingsWithRecordedDuration,
        meetingsUsingDefaultDuration: tt?.meetingsUsingDefaultDuration,
        totalAttendedStudentMinutes,
        totalAttendedStudentHours: totalAttendedStudentMinutes != null
          ? this.formatMinutes(totalAttendedStudentMinutes)
          : undefined
      },
      meetings: meetings.map((m) => ({
        topic: m.topic,
        batch: m.batch,
        startTime: m.startTime,
        present: m.present,
        late: m.late,
        absent: m.absent,
        durationMinutes: m.scheduledMinutes ?? m.meetingDurationMinutes ?? 0,
        durationFormatted: this.formatMeetingDuration(m),
        source: this.getDurationSourceLabel(m),
        attendanceRate: m.attendanceRate
      }))
    };
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
