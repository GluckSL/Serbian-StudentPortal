// src/app/components/admin-dashboard/zoom-reports.component.ts

import { Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
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

interface PortalJoinAbsentRecord {
  studentId: string;
  studentName: string;
  studentEmail: string;
  batch: string;
  classTopic: string;
  classDate: string;
  classDuration: number;
  meetingId: string;
  portalClickCount: number;
  lastZoomDisplayName: string;
}

interface StudentAttRecord {
  studentId: string;
  name: string;
  email: string;
  attended: boolean;
  durationMinutes: number;
  attendancePercent: number;
}

interface EnrolledStudent {
  studentId: string;
  name: string;
  email: string;
}

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
  attendanceList: StudentAttRecord[];
  enrolledStudents: EnrolledStudent[];
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

  selectedMeetingIds = new Set<string>();
  private selectedMeetingsCache = new Map<string, MeetingReport>();

  teacherFilter = 'all';
  allBatchesSelected = true;
  selectedBatches: string[] = [];
  batchDropdownOpen = false;
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

  // Portal-join-but-absent alert panel
  showPortalJoinPanel = false;
  portalJoinAbsentList: PortalJoinAbsentRecord[] = [];
  portalJoinAbsentLoading = false;
  portalJoinAbsentError = '';
  portalJoinDaysFilter = 30;

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

    if (!this.allBatchesSelected && this.selectedBatches.length) {
      filters.batch = this.selectedBatches.join(',');
    }

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
      this.selectedMeetingIds = new Set();
      this.selectedMeetingsCache.clear();
    }
    this.error = '';
    this.zoomService.getAllMeetings(this.buildMeetingFilters()).subscribe({
      next: (response) => {
        if (response.success) {
          this.totalItems = response?.pagination?.totalItems ?? response.totalCount ?? 0;
          this.totalPages = Math.max(response?.pagination?.totalPages || 1, 1);
          this.meetingsPage = this.mapMeetingsToReports(response.data || []);
          this.cacheSelectedMeetingsFromPage();
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
      const duration = m.duration || 0;

      const attendanceList: StudentAttRecord[] = (m.attendance || []).map((a: any) => {
        const rawDurMin = a.durationMinutes != null
          ? a.durationMinutes
          : (a.duration ? Math.round(a.duration / 60) : 0);
        // If absent, force minutes to 0 regardless of stored values
        const attendedMin = !!a.attended ? (rawDurMin || duration) : 0;
        // Always derive % from actual minutes so Minute and %Attendance are always consistent
        const pct = duration > 0 ? Math.min(Math.round((attendedMin / duration) * 100), 100) : (!!a.attended ? 100 : 0);
        return {
          studentId: (typeof a.studentId === 'object' ? a.studentId?._id : a.studentId) || '',
          name: a.name || 'Unknown',
          email: a.email || '',
          attended: !!a.attended,
          durationMinutes: attendedMin,
          attendancePercent: pct
        };
      });

      const enrolledStudents: EnrolledStudent[] = (m.attendees || []).map((s: any) => ({
        studentId: (typeof s.studentId === 'object' ? s.studentId?._id : s.studentId) || '',
        name: s.name || (s.studentId as any)?.name || 'Unknown',
        email: s.email || (s.studentId as any)?.email || ''
      }));

      return {
        _id: m._id,
        topic: m.topic,
        batch: m.batch,
        startTime: new Date(m.startTime),
        duration,
        teacher: {
          name: m.assignedTeacher?.name || m.createdBy?.name || 'Unknown',
          email: m.assignedTeacher?.email || m.createdBy?.email || ''
        },
        attendees: total,
        attended,
        absent: Math.max(total - attended, 0),
        attendanceRate: total > 0 ? Math.round((attended / total) * 100) : 0,
        status: 'completed',
        attendanceList,
        enrolledStudents
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

  @HostListener('document:click')
  onDocumentClick(): void {
    this.batchDropdownOpen = false;
  }

  get batchFilterLabel(): string {
    if (this.allBatchesSelected) return 'All Batches';
    if (this.selectedBatches.length === 1) return this.selectedBatches[0];
    if (!this.selectedBatches.length) return 'Select batches…';
    return `${this.selectedBatches.length} batches`;
  }

  toggleBatchDropdown(event: Event): void {
    event.stopPropagation();
    this.batchDropdownOpen = !this.batchDropdownOpen;
  }

  selectAllBatches(event: Event): void {
    event.stopPropagation();
    this.allBatchesSelected = true;
    this.selectedBatches = [];
    this.onFilterChange();
  }

  toggleBatchSelection(batch: string, event: Event): void {
    event.stopPropagation();
    if (this.allBatchesSelected) {
      this.allBatchesSelected = false;
      this.selectedBatches = [batch];
    } else {
      const idx = this.selectedBatches.indexOf(batch);
      if (idx >= 0) {
        this.selectedBatches = this.selectedBatches.filter(b => b !== batch);
        if (!this.selectedBatches.length) this.allBatchesSelected = true;
      } else {
        this.selectedBatches = [...this.selectedBatches, batch].sort((a, b) => {
          const na = parseInt(a, 10);
          const nb = parseInt(b, 10);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return a.localeCompare(b);
        });
      }
    }
    this.onFilterChange();
  }

  isBatchChecked(batch: string): boolean {
    return this.allBatchesSelected || this.selectedBatches.includes(batch);
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.teacherFilter = 'all';
    this.allBatchesSelected = true;
    this.selectedBatches = [];
    this.batchDropdownOpen = false;
    this.selectedMeetingIds = new Set();
    this.selectedMeetingsCache.clear();
    this.dateFilter = 'all';
    this.customDateFrom = '';
    this.customDateTo = '';
    this.currentPage = 1;
    this.loadCompletedMeetings();
  }

  viewMeetingDetails(id: string): void { this.router.navigate(['/teacher/meetings', id]); }

  openAttendanceDashboard(): void {
    this.router.navigate(['/admin/attendance-dashboard']);
  }

  openPortalJoinAlert(): void {
    this.showPortalJoinPanel = true;
    this.loadPortalJoinAbsent();
  }

  closePortalJoinPanel(): void {
    this.showPortalJoinPanel = false;
  }

  loadPortalJoinAbsent(): void {
    this.portalJoinAbsentLoading = true;
    this.portalJoinAbsentError = '';
    this.zoomService.getPortalJoinAbsentStudents(this.portalJoinDaysFilter).subscribe({
      next: (res) => {
        this.portalJoinAbsentList = res?.data || [];
        this.portalJoinAbsentLoading = false;
      },
      error: () => {
        this.portalJoinAbsentError = 'Failed to load data. Please try again.';
        this.portalJoinAbsentLoading = false;
      }
    });
  }

  openAttendanceForMeeting(meetingId: string): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/teacher/meetings', meetingId, 'attendance'])
    );
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  get portalJoinAbsentCount(): number {
    return this.portalJoinAbsentList.length;
  }

  viewAttendance(id: string): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/teacher/meetings', id, 'attendance'])
    );
    window.open(url, '_blank', 'noopener,noreferrer');
  }

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

  get allPageSelected(): boolean {
    return this.meetingsPage.length > 0 && this.meetingsPage.every(m => this.selectedMeetingIds.has(m._id));
  }

  get somePageSelected(): boolean {
    return this.meetingsPage.some(m => this.selectedMeetingIds.has(m._id));
  }

  get selectedCount(): number {
    return this.selectedMeetingIds.size;
  }

  get canSelectAllFiltered(): boolean {
    return this.totalItems > 0 && this.selectedMeetingIds.size < this.totalItems;
  }

  selectAllFiltered(): void {
    if (!this.totalItems) return;
    const limit = Math.min(this.totalItems, 150);
    const filters = { ...this.buildMeetingFilters(), page: 1, limit };
    this.zoomService.getAllMeetings(filters).subscribe({
      next: (response) => {
        if (!response.success) return;
        const reports = this.mapMeetingsToReports(response.data || []);
        for (const m of reports) {
          this.selectedMeetingIds.add(m._id);
          this.selectedMeetingsCache.set(m._id, m);
        }
        this.selectedMeetingIds = new Set(this.selectedMeetingIds);
        this.notify.success(`Selected ${this.selectedMeetingIds.size} class${this.selectedMeetingIds.size !== 1 ? 'es' : ''} for analytics.`);
      },
      error: () => this.notify.error('Failed to select all filtered classes.')
    });
  }

  private cacheSelectedMeetingsFromPage(): void {
    for (const m of this.meetingsPage) {
      if (this.selectedMeetingIds.has(m._id)) {
        this.selectedMeetingsCache.set(m._id, m);
      }
    }
  }

  toggleSelect(id: string): void {
    if (this.selectedMeetingIds.has(id)) {
      this.selectedMeetingIds.delete(id);
      this.selectedMeetingsCache.delete(id);
    } else {
      this.selectedMeetingIds.add(id);
      const meeting = this.meetingsPage.find(m => m._id === id);
      if (meeting) this.selectedMeetingsCache.set(id, meeting);
    }
    this.selectedMeetingIds = new Set(this.selectedMeetingIds);
  }

  toggleSelectAll(): void {
    if (this.allPageSelected) {
      this.meetingsPage.forEach(m => {
        this.selectedMeetingIds.delete(m._id);
        this.selectedMeetingsCache.delete(m._id);
      });
    } else {
      this.meetingsPage.forEach(m => {
        this.selectedMeetingIds.add(m._id);
        this.selectedMeetingsCache.set(m._id, m);
      });
    }
    this.selectedMeetingIds = new Set(this.selectedMeetingIds);
  }

  generateAnalytics(): void {
    const selected = [...this.selectedMeetingIds]
      .map(id => this.selectedMeetingsCache.get(id))
      .filter((m): m is MeetingReport => !!m)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
    if (!selected.length) {
      this.notify.warning('Please select at least one class to generate analytics.');
      return;
    }

    // ── Build per-student map ──────────────────────────────────────────────
    interface StudentMeetingRow {
      date: string;
      topic: string;
      attendedMin: number;
      totalMin: number;
      pct: number;
      status: string;
    }
    interface StudentEntry {
      name: string;
      batch: string;
      rows: StudentMeetingRow[];
    }

    const studentMap = new Map<string, StudentEntry>();
    const getKey = (studentId: string, email: string, name: string) =>
      studentId || email || name || 'unknown';

    for (const meeting of selected) {
      const date = this.formatDateShort(meeting.startTime);
      const totalMin = meeting.duration;
      const batch = meeting.batch;

      // Register all enrolled students first (so absent ones still appear)
      for (const s of meeting.enrolledStudents) {
        const key = getKey(s.studentId, s.email, s.name);
        if (!studentMap.has(key)) {
          studentMap.set(key, { name: s.name, batch, rows: [] });
        }
      }

      // Index attendance records by key
      const attMap = new Map<string, StudentAttRecord>();
      for (const a of meeting.attendanceList) {
        const k = getKey(a.studentId, a.email, a.name);
        attMap.set(k, a);
        if (!studentMap.has(k)) {
          studentMap.set(k, { name: a.name, batch, rows: [] });
        }
      }

      // Add one row per student per meeting
      for (const [key, entry] of studentMap) {
        const alreadyHasRow = entry.rows.some(r => r.date === date && r.topic === meeting.topic);
        if (alreadyHasRow) continue;

        const isInMeeting = attMap.has(key) ||
          meeting.enrolledStudents.some(s => getKey(s.studentId, s.email, s.name) === key);
        if (!isInMeeting) continue;

        const att = attMap.get(key);
        const attendedMin = att ? att.durationMinutes : 0;
        // Always compute % from minutes — never trust stored value
        const pct = totalMin > 0 ? Math.min(Math.round((attendedMin / totalMin) * 100), 100) : 0;
        const status = att?.attended ? 'Attended' : 'Absent';

        entry.rows.push({ date, topic: meeting.topic, attendedMin, totalMin, pct, status });
      }
    }

    // ── Build CSV ──────────────────────────────────────────────────────────
    const headers = ['Name', 'Date', 'Class Topic', 'Batch', 'Minutes (Attended/Total)', '%Attendance', 'Status', 'Summary'];
    const csvRows: string[][] = [];

    let grandAttended = 0;
    let grandTotal = 0;
    let grandStudents = 0;

    const sortedStudents = Array.from(studentMap.entries())
      .filter(([, s]) => s.rows.length > 0)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));

    for (const [, student] of sortedStudents) {
      student.rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const stuAttended = student.rows.reduce((s, r) => s + r.attendedMin, 0);
      const stuTotal = student.rows.reduce((s, r) => s + r.totalMin, 0);
      const studentOverallPct = stuTotal > 0
        ? Math.min(Math.round((stuAttended / stuTotal) * 100), 100)
        : 0;

      for (const [i, r] of student.rows.entries()) {
        const rowPct = r.totalMin > 0 ? Math.min(Math.round((r.attendedMin / r.totalMin) * 100), 100) : 0;
        csvRows.push([
          student.name,
          r.date,
          r.topic,
          student.batch,
          `${r.attendedMin} / ${r.totalMin}`,
          `${rowPct}%`,
          r.status,
          i === 0 ? `${studentOverallPct}%` : ''
        ]);
        grandAttended += r.attendedMin;
        grandTotal += r.totalMin;
      }
      grandStudents++;
    }

    const grandPct = grandTotal > 0 ? Math.min(Math.round((grandAttended / grandTotal) * 100), 100) : 0;
    csvRows.push([]);
    csvRows.push([
      'OVERALL AVERAGE',
      '',
      `${grandStudents} students | ${selected.length} classes`,
      '',
      `${grandAttended} / ${grandTotal}`,
      '',
      '',
      `${grandPct}%`
    ]);

    const csv = [headers, ...csvRows]
      .map(r => r.map(c => `"${String(c)}"`).join(','))
      .join('\n');

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `student_analytics_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    this.notify.success(`Analytics exported: ${grandStudents} students across ${selected.length} class${selected.length !== 1 ? 'es' : ''}.`);
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
