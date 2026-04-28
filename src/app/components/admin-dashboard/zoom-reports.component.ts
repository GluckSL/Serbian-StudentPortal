// src/app/components/admin-dashboard/zoom-reports.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { NotificationService } from '../../services/notification.service';

interface MeetingReport {
  _id: string;
  topic: string;
  batch: string;
  startTime: Date;
  duration: number;
  teacher: { name: string; email: string; };
  attendees: number;
  attended: number;
  absent: number;
  attendanceRate: number;
  status: string;
}

@Component({
  selector: 'app-zoom-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './zoom-reports.component.html',
  styleUrls: ['./zoom-reports.component.css']
})
export class ZoomReportsComponent implements OnInit {
  meetingsPage: MeetingReport[] = [];
  loading = true;
  loadingPage = false;
  error = '';

  teacherFilter = 'all';
  batchFilter = 'all';
  dateFilter = 'all';
  customDateFrom = '';
  customDateTo = '';
  searchQuery = '';
  currentPage = 1;
  pageSize = 10;
  pageSizeOptions = [10, 20, 50];
  refetchingMeetingIds = new Set<string>();
  skeletonRows = Array.from({ length: this.pageSize });
  totalItems = 0;
  totalPages = 1;

  stats = { totalMeetings: 0, totalStudents: 0, avgAttendance: 0, totalDuration: 0 };

  isTeacherRole = false;

  constructor(
    private zoomService: ZoomService,
    private authService: AuthService,
    private router: Router,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.isTeacherRole = user.role === 'TEACHER';
        this.loadCompletedMeetings();
      }
    });
  }

  loadCompletedMeetings(): void {
    this.loadingPage = true;
    this.loading = this.currentPage === 1 && this.meetingsPage.length === 0;
    this.error = '';
    this.zoomService.getAllMeetings({
      page: this.currentPage,
      limit: this.pageSize,
      completed: true
    }).subscribe({
      next: (response) => {
        if (response.success) {
          this.totalItems = response?.pagination?.totalItems || response.totalCount || 0;
          this.totalPages = Math.max(response?.pagination?.totalPages || 1, 1);
          const mapped = this.mapMeetingsToReports(response.data || []);
          this.meetingsPage = this.applyLocalFiltersOnPage(mapped);
          this.recalculateStatsFromPage();
        } else {
          this.error = response.message || 'Failed to load meetings';
        }
        this.loadingPage = false;
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load meeting reports';
        this.loadingPage = false;
        this.loading = false;
      }
    });
  }

  private mapMeetingsToReports(rows: any[]): MeetingReport[] {
    return rows.map(m => {
      const attended = m.attendance?.filter((a: any) => a.attended).length || 0;
      const total = m.attendees?.length || 0;
      return {
        _id: m._id,
        topic: m.topic,
        batch: m.batch,
        startTime: new Date(m.startTime),
        duration: m.duration,
        teacher: { name: m.createdBy?.name || 'Unknown', email: m.createdBy?.email || '' },
        attendees: total,
        attended,
        absent: Math.max(total - attended, 0),
        attendanceRate: total > 0 ? Math.round((attended / total) * 100) : 0,
        status: 'completed'
      };
    });
  }

  private applyLocalFiltersOnPage(rows: MeetingReport[]): MeetingReport[] {
    return rows.filter(m => {
      if (this.teacherFilter !== 'all' && m.teacher.name !== this.teacherFilter) return false;
      if (this.batchFilter !== 'all' && m.batch !== this.batchFilter) return false;

      if (this.dateFilter !== 'all') {
        const now = new Date();
        if (this.dateFilter === 'today' && m.startTime.toDateString() !== now.toDateString()) return false;
        if (this.dateFilter === 'week' && m.startTime < new Date(now.getTime() - 7 * 864e5)) return false;
        if (this.dateFilter === 'month' && m.startTime < new Date(now.getTime() - 30 * 864e5)) return false;
        if (this.dateFilter === 'custom') {
          if (this.customDateFrom) {
            const from = new Date(this.customDateFrom); from.setHours(0, 0, 0, 0);
            if (m.startTime < from) return false;
          }
          if (this.customDateTo) {
            const to = new Date(this.customDateTo); to.setHours(23, 59, 59, 999);
            if (m.startTime > to) return false;
          }
        }
      }

      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        return m.topic.toLowerCase().includes(q) ||
               m.teacher.name.toLowerCase().includes(q) ||
               m.batch.toLowerCase().includes(q);
      }

      return true;
    });
  }

  applyFilters(): void {
    this.currentPage = 1;
    this.loadCompletedMeetings();
  }

  onPageSizeChange(): void {
    this.currentPage = 1;
    this.skeletonRows = Array.from({ length: this.pageSize });
    this.loadCompletedMeetings();
  }

  goToPrevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadCompletedMeetings();
    }
  }

  goToNextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.loadCompletedMeetings();
    }
  }

  get pageStartIndex(): number {
    if (!this.totalItems) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEndIndex(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalItems);
  }

  recalculateStatsFromPage(): void {
    if (!this.meetingsPage.length) {
      this.stats = { totalMeetings: 0, totalStudents: 0, avgAttendance: 0, totalDuration: 0 };
      return;
    }

    const totalStudentsInPage = this.meetingsPage.reduce((sum, m) => sum + m.attendees, 0);
    const avgAttendanceInPage = Math.round(
      this.meetingsPage.reduce((s, m) => s + m.attendanceRate, 0) / this.meetingsPage.length
    );
    const totalDurationInPage = this.meetingsPage.reduce((s, m) => s + m.duration, 0);

    this.stats = {
      totalMeetings: this.totalItems,
      totalStudents: totalStudentsInPage,
      avgAttendance: avgAttendanceInPage,
      totalDuration: totalDurationInPage
    };
  }

  onFilterChange(): void { this.applyFilters(); }

  clearFilters(): void {
    this.searchQuery = '';
    this.teacherFilter = 'all';
    this.batchFilter = 'all';
    this.dateFilter = 'all';
    this.customDateFrom = '';
    this.customDateTo = '';
    this.currentPage = 1;
    this.loadCompletedMeetings();
  }

  getUniqueTeachers(): string[] {
    return [...new Set(this.meetingsPage.map(m => m.teacher.name))].sort();
  }

  getUniqueBatches(): string[] {
    return [...new Set(this.meetingsPage.map(m => m.batch))].sort();
  }

  viewMeetingDetails(id: string): void { this.router.navigate(['/teacher/meetings', id]); }
  viewAttendance(id: string): void { this.router.navigate(['/teacher/meetings', id, 'attendance']); }

  refetchAttendance(meetingId: string): void {
    if (this.refetchingMeetingIds.has(meetingId)) return;

    this.refetchingMeetingIds.add(meetingId);
    this.zoomService.getAttendance(meetingId).subscribe({
      next: (response) => {
        const updatedAttendance = response?.data?.attendance;
        if (!Array.isArray(updatedAttendance)) {
          this.notify.warning('Attendance refresh completed, but no attendance rows were returned.');
          return;
        }

        const target = this.meetingsPage.find(m => m._id === meetingId);
        if (target) {
          const attended = updatedAttendance.filter((a: any) => a.attended).length || 0;
          const total = target.attendees || 0;
          target.attended = attended;
          target.absent = Math.max(total - attended, 0);
          target.attendanceRate = total > 0 ? Math.round((attended / total) * 100) : 0;
        }
        this.recalculateStatsFromPage();
        this.notify.success('Attendance refreshed from Zoom.');
      },
      error: (err) => {
        const msg = err?.error?.message || 'Attendance refresh failed. Try again in a few minutes.';
        this.notify.error(msg);
      },
      complete: () => {
        this.refetchingMeetingIds.delete(meetingId);
      }
    });
  }

  deleteMeeting(id: string, topic: string): void {
    this.notify.confirm('Delete Meeting', `Delete "${topic}"? This cannot be undone.`, 'Yes, Delete', 'Cancel').subscribe(ok => {
      if (!ok) return;
      this.zoomService.deleteMeeting(id).subscribe({
        next: () => {
          this.meetingsPage = this.meetingsPage.filter(m => m._id !== id);
          this.totalItems = Math.max(this.totalItems - 1, 0);
          this.totalPages = Math.max(Math.ceil(this.totalItems / this.pageSize), 1);
          if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
          this.loadCompletedMeetings();
        },
        error: () => this.notify.error('Failed to delete. Please try again.')
      });
    });
  }

  formatDateShort(date: Date): string {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
  }

  exportToCSV(): void {
    if (!this.meetingsPage.length) { this.notify.warning('No data to export'); return; }
    const headers = ['Date', 'Topic', 'Teacher', 'Batch', 'Duration (min)', 'Total', 'Attended', 'Absent', 'Rate (%)'];
    const rows = this.meetingsPage.map(m => [
      this.formatDateShort(m.startTime), m.topic, m.teacher.name, m.batch,
      m.duration, m.attendees, m.attended, m.absent, m.attendanceRate
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `zoom_reports_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  }

  exportTeacherReport(): void {
    if (!this.meetingsPage.length) { this.notify.warning('No data to export'); return; }
    const map: any = {};
    this.meetingsPage.forEach(m => {
      if (!map[m.teacher.name]) map[m.teacher.name] = { name: m.teacher.name, email: m.teacher.email, meetings: 0, duration: 0, students: 0, attended: 0 };
      map[m.teacher.name].meetings++;
      map[m.teacher.name].duration += m.duration;
      map[m.teacher.name].students += m.attendees;
      map[m.teacher.name].attended += m.attended;
    });
    const headers = ['Teacher', 'Email', 'Meetings', 'Duration (min)', 'Students', 'Attended', 'Avg Rate (%)'];
    const rows = Object.values(map).map((s: any) => [
      s.name, s.email, s.meetings, s.duration, s.students, s.attended,
      s.students > 0 ? Math.round((s.attended / s.students) * 100) : 0
    ]);
    const csv = [headers, ...rows].map((r: any) => r.map((c: any) => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `teacher_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  }
}
