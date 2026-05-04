// src/app/components/admin-dashboard/zoom-reports.component.ts

import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { NotificationService } from '../../services/notification.service';
import { environment } from '../../../environments/environment';

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

  /** Batch names from Journey (`/batch-journey`), same source as Journey management */
  journeyBatchNames: string[] = [];
  teacherOptions: string[] = [];

  private readonly destroyRef = inject(DestroyRef);
  private readonly searchDebounced = new Subject<string>();

  constructor(
    private zoomService: ZoomService,
    private authService: AuthService,
    private router: Router,
    private notify: NotificationService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.searchDebounced.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      this.currentPage = 1;
      this.loadCompletedMeetings();
    });

    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.isTeacherRole = user.role === 'TEACHER';
        this.loadReferenceData();
        this.loadCompletedMeetings();
      }
    });
  }

  private loadReferenceData(): void {
    this.http.get<{ batches: { batchName: string }[]; upcomingBatches?: { batchName: string }[] }>(
      `${environment.apiUrl}/batch-journey`,
      { withCredentials: true }
    ).subscribe({
      next: (res) => {
        const rows = [...(res?.batches || []), ...(res?.upcomingBatches || [])];
        const names: string[] = [];
        for (const b of rows) {
          const bn = b?.batchName;
          if (typeof bn === 'string' && bn.trim()) names.push(bn.trim());
        }
        this.journeyBatchNames = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
      },
      error: () => {
        this.journeyBatchNames = [];
      }
    });

    if (!this.isTeacherRole) {
      this.zoomService.getTeachers().subscribe({
        next: (res) => {
          const raw = res?.data;
          const rows: unknown[] = Array.isArray(raw) ? raw : [];
          const names: string[] = [];
          for (const item of rows) {
            if (item && typeof item === 'object' && 'name' in item) {
              const n = (item as { name?: unknown }).name;
              if (typeof n === 'string' && n.trim().length > 0) names.push(n.trim());
            }
          }
          this.teacherOptions = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
        },
        error: () => {
          this.teacherOptions = [];
        }
      });
    } else {
      this.teacherOptions = [];
    }
  }

  onSearchChange(): void {
    this.searchDebounced.next(this.searchQuery.trim());
  }

  private buildMeetingFilters(): Parameters<ZoomService['getAllMeetings']>[0] {
    const filters: NonNullable<Parameters<ZoomService['getAllMeetings']>[0]> = {
      page: this.currentPage,
      limit: this.pageSize,
      completed: true
    };

    const q = this.searchQuery.trim();
    if (q) filters.search = q;

    if (this.batchFilter !== 'all') filters.batch = this.batchFilter;

    if (!this.isTeacherRole && this.teacherFilter !== 'all') {
      filters.teacherName = this.teacherFilter;
    }

    if (this.dateFilter !== 'all') {
      filters.datePreset = this.dateFilter;
      if (this.dateFilter === 'custom') {
        if (this.customDateFrom) filters.dateFrom = this.customDateFrom;
        if (this.customDateTo) filters.dateTo = this.customDateTo;
      }
    }

    return filters;
  }

  loadCompletedMeetings(opts?: { quiet?: boolean }): void {
    const quiet = !!opts?.quiet;
    if (!quiet) {
      this.loadingPage = true;
      this.loading = this.currentPage === 1 && this.meetingsPage.length === 0;
    }
    this.error = '';
    this.zoomService.getAllMeetings(this.buildMeetingFilters()).subscribe({
      next: (response) => {
        if (response.success) {
          this.totalItems = response?.pagination?.totalItems ?? response.totalCount ?? 0;
          this.totalPages = Math.max(response?.pagination?.totalPages || 1, 1);
          this.meetingsPage = this.mapMeetingsToReports(response.data || []);
          this.applySummaryFromResponse(response.summary);
        } else {
          this.error = response.message || 'Failed to load meetings';
        }
        if (!quiet) {
          this.loadingPage = false;
          this.loading = false;
        }
      },
      error: () => {
        this.error = 'Failed to load meeting reports';
        if (!quiet) {
          this.loadingPage = false;
          this.loading = false;
        }
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
        teacher: {
          name: m.assignedTeacher?.name || m.createdBy?.name || 'Unknown',
          email: m.assignedTeacher?.email || m.createdBy?.email || ''
        },
        attendees: total,
        attended,
        absent: Math.max(total - attended, 0),
        attendanceRate: total > 0 ? Math.round((attended / total) * 100) : 0,
        status: 'completed'
      };
    });
  }

  /** Prefer assigned teacher name when present (matches table expectations). */
  private applySummaryFromResponse(summary: any): void {
    const rowCount = this.totalItems;
    if (!summary || typeof summary !== 'object') {
      this.stats = {
        totalMeetings: rowCount,
        totalStudents: 0,
        avgAttendance: 0,
        totalDuration: 0
      };
      return;
    }
    this.stats = {
      totalMeetings: summary.totalMeetings ?? rowCount,
      totalStudents: summary.totalStudents ?? 0,
      avgAttendance: summary.avgAttendance ?? 0,
      totalDuration: summary.totalDurationMinutes ?? 0
    };
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
        this.loadCompletedMeetings({ quiet: true });
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
