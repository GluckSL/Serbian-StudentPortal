import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ActivityDeleteRef,
  StudentLogService,
  StudentActivityEvent,
  StudentActivityType
} from '../../services/student-log.service';
import { Router } from '@angular/router';
import { NotificationService } from '../../services/notification.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-student-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './student-logs.component.html',
  styleUrls: ['./student-logs.component.css']
})
export class StudentLogsComponent implements OnInit {
  analyticsTab: 'overview' | 'student' | 'page' | 'day' | 'timeline' = 'overview';
  readonly analyticsTabs: { id: 'overview' | 'student' | 'page' | 'day' | 'timeline'; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: 'fa-chart-pie' },
    { id: 'student', label: 'Student wise', icon: 'fa-users' },
    { id: 'page', label: 'Page wise', icon: 'fa-window-maximize' },
    { id: 'day', label: 'Day wise', icon: 'fa-calendar-day' },
    { id: 'timeline', label: 'Timeline', icon: 'fa-stream' }
  ];
  activityEvents: StudentActivityEvent[] = [];
  filteredEvents: StudentActivityEvent[] = [];
  paginatedData: StudentActivityEvent[] = [];
  readonly skeletonRows = Array.from({ length: 8 });
  isLoading = false;
  loadError = '';

  batchOptions: string[] = [];
  selectedBatch = '';

  studentSearchQuery = '';
  searchResults: { _id: string; name: string; regNo: string; batch?: string }[] = [];
  searchSearching = false;
  /** empty = all students */
  selectedStudentId = '';
  selectedStudentLabel = '';

  /** When empty, backend treats as “all types” */
  selectedTypes: StudentActivityType[] = [
    'LOGIN',
    'LOGOUT',
    'MEETING_ATTENDANCE',
    'EXERCISE_ATTEMPT',
    'MODULE_PROGRESS',
    'SESSION_RECORD',
    'ASSIGNMENT_SUBMISSION',
    'PROFILE_UPDATE'
  ];

  fromDate = '';
  toDate = '';

  readonly typeOptions: { id: StudentActivityType; label: string }[] = [
    { id: 'LOGIN', label: 'Login' },
    { id: 'LOGOUT', label: 'Logout' },
    { id: 'MEETING_ATTENDANCE', label: 'Meeting / join' },
    { id: 'EXERCISE_ATTEMPT', label: 'Digital exercise' },
    { id: 'MODULE_PROGRESS', label: 'Learning modules' },
    { id: 'SESSION_RECORD', label: 'AI sessions' },
    { id: 'ASSIGNMENT_SUBMISSION', label: 'Assignments' },
    { id: 'PROFILE_UPDATE', label: 'Profile updates' }
  ];

  currentPage = 1;
  pageSize = 15;
  totalPages = 0;

  groupBy: 'none' | 'student' | 'page' | 'day' = 'none';

  /**
   * Portal-time estimate: cluster events by same student; gaps longer than this start a new session.
   */
  private readonly portalIdleGapMs = 30 * 60 * 1000;
  /** Hard cap so a missing logout does not explode totals. */
  private readonly portalMaxSessionMs = 8 * 60 * 60 * 1000;

  timeSummary = {
    totalMinutes: 0,
    activeStudents: 0,
    avgMinutesPerStudent: 0,
    topPage: '—',
    topStudent: '—'
  };
  studentTimeRows: { studentId: string; student: string; minutes: number; visits: number; pages: number }[] = [];
  pageTimeRows: { page: string; minutes: number; visits: number; students: number }[] = [];
  dayTimeRows: { day: string; dayLabel: string; minutes: number; visits: number; students: number }[] = [];
  groupedRows: { key: string; title: string; subtitle: string; events: StudentActivityEvent[] }[] = [];
  studentDrilldown: {
    studentId: string;
    student: string;
    totalMinutes: number;
    visits: number;
    pageRows: { page: string; minutes: number; visits: number }[];
    dayRows: { day: string; dayLabel: string; minutes: number; visits: number }[];
    recentEvents: StudentActivityEvent[];
  } | null = null;

  /** Row keys for bulk delete */
  selectedRowKeys = new Set<string>();

  /** Only ADMIN / TEACHER_ADMIN may delete timeline rows; SUB_ADMIN may view only. */
  canDeleteActivityRecords = false;

  constructor(
    private studentLogService: StudentLogService,
    private router: Router,
    private notify: NotificationService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    const snap = this.authService.getSnapshotUser();
    this.canDeleteActivityRecords = snap?.role === 'ADMIN' || snap?.role === 'TEACHER_ADMIN';
    this.authService.currentUser$.subscribe((user) => {
      this.canDeleteActivityRecords = user?.role === 'ADMIN' || user?.role === 'TEACHER_ADMIN';
    });
    if (!snap) {
      this.authService.refreshUserProfile().subscribe({ error: () => {} });
    }
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    this.fromDate = this.toInputDateTime(startOfDay);
    this.toDate = this.toInputDateTime(now);
    this.loadBatchOptions();
  }

  loadBatchOptions(): void {
    this.studentLogService.getBatchOptions().subscribe({
      next: (res) => {
        this.batchOptions = res.data || [];
        this.loadActivity();
      },
      error: () => {
        this.loadActivity();
      }
    });
  }

  private typesParam(): StudentActivityType[] | undefined {
    if (this.selectedTypes.length === 0 || this.selectedTypes.length === this.typeOptions.length) {
      return undefined;
    }
    return this.selectedTypes;
  }

  loadActivity(): void {
    this.isLoading = true;
    this.loadError = '';
    this.selectedRowKeys.clear();
    const types = this.typesParam();
    const from = this.fromDate ? new Date(this.fromDate).toISOString() : undefined;
    const to = this.toDate ? new Date(this.toDate).toISOString() : undefined;
    const batch = this.selectedBatch || undefined;
    const common = { types, from, to, limit: 300, batch };

    const req = this.selectedStudentId
      ? this.studentLogService.getStudentActivityTimeline(this.selectedStudentId, common)
      : this.studentLogService.getActivityFeed(common);

    req.subscribe({
      next: (res) => {
        this.activityEvents = res.data || [];
        this.applyClientFilters();
        this.isLoading = false;
      },
      error: (err) => {
        console.error(err);
        this.activityEvents = [];
        this.filteredEvents = [];
        this.paginatedData = [];
        this.loadError =
          err?.error?.msg || err?.error?.message || 'Failed to load activity. Are you logged in as admin?';
        this.isLoading = false;
      }
    });
  }

  applyClientFilters(): void {
    this.filteredEvents = [...this.activityEvents];
    this.computeTimeAnalytics();
    this.buildGroupedRows();
    this.currentPage = 1;
    this.calculatePagination();
  }

  applyFilters(): void {
    this.loadActivity();
  }

  clearFilters(): void {
    this.selectedStudentId = '';
    this.selectedStudentLabel = '';
    this.studentSearchQuery = '';
    this.searchResults = [];
    this.selectedBatch = '';
    this.selectedTypes = this.typeOptions.map((t) => t.id);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    this.fromDate = this.toInputDateTime(startOfDay);
    this.toDate = this.toInputDateTime(now);
    this.loadActivity();
  }

  setTodayRange(): void {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    this.fromDate = this.toInputDateTime(startOfDay);
    this.toDate = this.toInputDateTime(now);
  }

  setLastDaysRange(days: number): void {
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    this.fromDate = this.toInputDateTime(from);
    this.toDate = this.toInputDateTime(now);
  }

  searchStudents(): void {
    const q = this.studentSearchQuery.trim();
    if (q.length < 1) {
      this.searchResults = [];
      return;
    }
    this.searchSearching = true;
    this.studentLogService.searchStudents(q, 25).subscribe({
      next: (res) => {
        this.searchResults = res.data || [];
        this.searchSearching = false;
      },
      error: () => {
        this.searchResults = [];
        this.searchSearching = false;
      }
    });
  }

  pickStudent(s: { _id: string; name: string; regNo: string }): void {
    this.selectedStudentId = s._id;
    this.selectedStudentLabel = `${s.regNo} — ${s.name}`;
    this.searchResults = [];
    this.studentSearchQuery = '';
  }

  clearStudent(): void {
    this.selectedStudentId = '';
    this.selectedStudentLabel = '';
  }

  toggleType(id: StudentActivityType, checked: boolean): void {
    const set = new Set(this.selectedTypes);
    if (checked) set.add(id);
    else set.delete(id);
    this.selectedTypes = Array.from(set) as StudentActivityType[];
  }

  isTypeChecked(id: StudentActivityType): boolean {
    return this.selectedTypes.includes(id);
  }

  calculatePagination(): void {
    const n = this.filteredEvents.length;
    this.totalPages = n === 0 ? 0 : Math.ceil(n / this.pageSize);
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = this.totalPages;
    }
    this.paginatedData = this.filteredEvents.slice(
      (this.currentPage - 1) * this.pageSize,
      this.currentPage * this.pageSize
    );
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.calculatePagination();
  }

  formatDateTime(dateStr: string | Date | undefined): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString();
  }

  formatMinutes(mins: number): string {
    if (!mins || mins <= 0) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  eventPage(ev: StudentActivityEvent): string {
    return this.resolveEventPage(ev);
  }

  eventMinutes(ev: StudentActivityEvent): number {
    return this.resolveEventMinutes(ev);
  }

  setAnalyticsTab(id: 'overview' | 'student' | 'page' | 'day' | 'timeline'): void {
    this.analyticsTab = id;
  }

  tabCount(id: 'overview' | 'student' | 'page' | 'day' | 'timeline'): number {
    if (id === 'overview') return this.filteredEvents.length;
    if (id === 'student') return this.studentTimeRows.length;
    if (id === 'page') return this.pageTimeRows.length;
    if (id === 'day') return this.dayTimeRows.length;
    return this.groupBy === 'none' ? this.paginatedData.length : this.groupedRows.length;
  }

  openStudentDrilldown(row: { studentId: string; student: string }): void {
    const eventsChrono = this.filteredEvents.filter((ev) => {
      const sid = ev.student?._id || this.selectedStudentId || '';
      if (row.studentId) {
        return sid === row.studentId;
      }
      return this.resolveStudentLabel(ev) === row.student;
    });
    const eventsNewestFirst = [...eventsChrono].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );

    const { pageMinutes, dayMinutes, totalMinutes } = this.allocatePortalMinutesByPageAndDay(eventsChrono);

    const visitsByPage = new Map<string, number>();
    for (const ev of eventsChrono) {
      const page = this.resolveEventPage(ev);
      visitsByPage.set(page, (visitsByPage.get(page) || 0) + 1);
    }
    const pageRows = Array.from(visitsByPage.entries())
      .map(([page, visits]) => ({
        page,
        visits,
        minutes: Math.round(pageMinutes.get(page) || 0)
      }))
      .sort((a, b) => b.minutes - a.minutes || b.visits - a.visits);

    const visitsByDay = new Map<string, { dayLabel: string; visits: number }>();
    for (const ev of eventsChrono) {
      const day = this.resolveDayKey(ev);
      const dayLabel = day === 'unknown' ? 'Unknown day' : new Date(`${day}T00:00:00`).toLocaleDateString();
      const cur = visitsByDay.get(day) || { dayLabel, visits: 0 };
      cur.visits += 1;
      visitsByDay.set(day, cur);
    }
    const dayRows = Array.from(visitsByDay.entries())
      .map(([day, { dayLabel, visits }]) => ({
        day,
        dayLabel,
        visits,
        minutes: Math.round(dayMinutes.get(day)?.minutes || 0)
      }))
      .sort((a, b) => b.day.localeCompare(a.day));

    this.studentDrilldown = {
      studentId: row.studentId,
      student: row.student,
      totalMinutes,
      visits: eventsChrono.length,
      pageRows,
      dayRows,
      recentEvents: eventsNewestFirst.slice(0, 80)
    };
  }

  closeStudentDrilldown(): void {
    this.studentDrilldown = null;
  }

  formatDetails(ev: StudentActivityEvent): string {
    const d = ev.details;
    if (!d || typeof d !== 'object') return '—';
    const parts: string[] = [];
    if (ev.student?.batch) parts.push(`batch ${ev.student.batch}`);
    if (d.exerciseTitle) parts.push(String(d.exerciseTitle));
    if (d.topic) parts.push(String(d.topic));
    if (d.moduleTitle) parts.push(String(d.moduleTitle));
    if (d.title && ev.type === 'ASSIGNMENT_SUBMISSION') parts.push(String(d.title));
    if (d.attendanceStatus) parts.push(`status: ${d.attendanceStatus}`);
    if (d.status != null && ev.type === 'EXERCISE_ATTEMPT') parts.push(String(d.status));
    if (d.level) parts.push(`level ${d.level}`);
    if (d.batch && !ev.student?.batch) parts.push(`batch ${d.batch}`);
    if (d.ip) parts.push(`IP ${d.ip}`);
    if (parts.length) return parts.join(' · ');
    try {
      return JSON.stringify(d);
    } catch {
      return '—';
    }
  }

  displayStudent(ev: StudentActivityEvent): string {
    if (ev.student) {
      const b = ev.student.batch ? ` · ${ev.student.batch}` : '';
      return `${ev.student.name} (${ev.student.regNo})${b}`;
    }
    const sid = this.selectedStudentId;
    if (!sid) return '—';
    return this.selectedStudentLabel || '—';
  }

  openAnalyticsForStudent(studentId: string | undefined): void {
    if (!studentId) return;
    const url = this.router.serializeUrl(this.router.createUrlTree(['/student-logs', studentId, 'analytics']));
    window.open(url, '_blank');
  }

  resolveStudentId(ev: StudentActivityEvent): string | undefined {
    return ev.student?._id || (this.selectedStudentId || undefined);
  }

  rowKey(ev: StudentActivityEvent): string {
    const dr = ev.deleteRef;
    if (dr) {
      return `${dr.kind}:${dr.id}:${dr.meetingId || ''}`;
    }
    return `${ev.type}:${String(ev.occurredAt)}:${ev.student?.regNo || ''}`;
  }

  trackByRow = (_index: number, ev: StudentActivityEvent) => this.rowKey(ev);

  canDelete(ev: StudentActivityEvent): boolean {
    return (
      this.canDeleteActivityRecords && !!ev.deleteRef?.kind && !!ev.deleteRef?.id
    );
  }

  toDeletePayload(ref: ActivityDeleteRef): { kind: ActivityDeleteRef['kind']; id: string; meetingId?: string } {
    const out: { kind: ActivityDeleteRef['kind']; id: string; meetingId?: string } = {
      kind: ref.kind,
      id: ref.id
    };
    if (ref.kind === 'MEETING_ATTENDANCE' && ref.meetingId) {
      out.meetingId = ref.meetingId;
    }
    return out;
  }

  isRowSelected(ev: StudentActivityEvent): boolean {
    return this.selectedRowKeys.has(this.rowKey(ev));
  }

  toggleRow(ev: StudentActivityEvent, checked: boolean): void {
    const k = this.rowKey(ev);
    if (!this.canDelete(ev)) return;
    if (checked) this.selectedRowKeys.add(k);
    else this.selectedRowKeys.delete(k);
  }

  allDeletableOnPageSelected(): boolean {
    const deletable = this.paginatedData.filter((ev) => this.canDelete(ev));
    if (deletable.length === 0) return false;
    return deletable.every((ev) => this.selectedRowKeys.has(this.rowKey(ev)));
  }

  toggleSelectAllOnPage(checked: boolean): void {
    this.paginatedData.forEach((ev) => {
      if (!this.canDelete(ev)) return;
      const k = this.rowKey(ev);
      if (checked) this.selectedRowKeys.add(k);
      else this.selectedRowKeys.delete(k);
    });
  }

  private collectSelectedPayloads(): { kind: ActivityDeleteRef['kind']; id: string; meetingId?: string }[] {
    const items: { kind: ActivityDeleteRef['kind']; id: string; meetingId?: string }[] = [];
    for (const ev of this.filteredEvents) {
      if (!ev.deleteRef) continue;
      if (!this.selectedRowKeys.has(this.rowKey(ev))) continue;
      items.push(this.toDeletePayload(ev.deleteRef));
    }
    return items;
  }

  deleteOne(ev: StudentActivityEvent): void {
    if (!ev.deleteRef) return;
    this.notify
      .confirm('Delete log', 'Remove this activity record permanently?', 'Delete', 'Cancel')
      .subscribe((ok) => {
        if (!ok) return;
        this.studentLogService.bulkDeleteActivity([this.toDeletePayload(ev.deleteRef!)]).subscribe({
          next: (res) => {
            const r = res.results?.[0];
            if (r?.ok) {
              this.notify.success('Deleted');
              this.loadActivity();
            } else {
              this.notify.error(r?.error || res.message || 'Delete failed');
            }
          },
          error: (err) => this.notify.error(err?.error?.message || 'Delete failed')
        });
      });
  }

  deleteBulk(): void {
    const items = this.collectSelectedPayloads();
    if (items.length === 0) {
      this.notify.warning('Select at least one deletable row');
      return;
    }
    this.notify
      .confirm(
        'Delete selected',
        `Permanently delete ${items.length} record(s)? This cannot be undone.`,
        'Delete all',
        'Cancel'
      )
      .subscribe((ok) => {
        if (!ok) return;
        this.studentLogService.bulkDeleteActivity(items).subscribe({
          next: (res) => {
            const failed = (res.results || []).filter((x) => !x.ok);
            if (failed.length === 0) {
              this.notify.success(`Deleted ${items.length} record(s)`);
            } else {
              this.notify.warning(`Completed with ${failed.length} error(s)`);
            }
            this.selectedRowKeys.clear();
            this.loadActivity();
          },
          error: (err) => this.notify.error(err?.error?.message || 'Bulk delete failed')
        });
      });
  }

  private toInputDateTime(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private resolveEventMinutes(ev: StudentActivityEvent): number {
    const d = ev.details || {};
    switch (ev.type) {
      case 'SESSION_RECORD':
        return Math.max(0, Math.round(Number(d.durationMinutes) || 0));
      case 'MEETING_ATTENDANCE':
        return Math.max(0, Math.round(Number(d.attendedMinutes) || 0));
      case 'EXERCISE_ATTEMPT':
        return Math.max(0, Math.round((Number(d.timeSpentSeconds) || 0) / 60));
      default:
        return 0;
    }
  }

  /** Chronological order (oldest first) for session / portal-time math. */
  private sortEventsChrono(events: StudentActivityEvent[]): StudentActivityEvent[] {
    return [...events].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }

  /**
   * Estimated time in the portal for one student: span from first to last event in each idle-bounded session,
   * capped per session. Counts navigation (logins, module hits, etc.), not only rows that store duration fields.
   */
  private portalSessionMinutesForStudent(events: StudentActivityEvent[]): number {
    const sorted = this.sortEventsChrono(events);
    if (sorted.length === 0) return 0;
    let totalMs = 0;
    let sessionStart = new Date(sorted[0].occurredAt).getTime();
    let lastT = sessionStart;
    for (let i = 1; i < sorted.length; i++) {
      const t = new Date(sorted[i].occurredAt).getTime();
      if (t - lastT > this.portalIdleGapMs) {
        totalMs += Math.min(Math.max(0, lastT - sessionStart), this.portalMaxSessionMs);
        sessionStart = t;
      }
      lastT = t;
    }
    totalMs += Math.min(Math.max(0, lastT - sessionStart), this.portalMaxSessionMs);
    return Math.max(0, Math.round(totalMs / 60000));
  }

  /**
   * Split each session's estimated minutes across the distinct pages/features touched in that session
   * so page- and day-wise totals align with portal time.
   */
  private allocatePortalMinutesByPageAndDay(
    events: StudentActivityEvent[]
  ): {
    pageMinutes: Map<string, number>;
    dayMinutes: Map<string, { dayLabel: string; minutes: number }>;
    totalMinutes: number;
  } {
    const pageMinutes = new Map<string, number>();
    const dayMinutes = new Map<string, { dayLabel: string; minutes: number }>();
    const sorted = this.sortEventsChrono(events);
    if (sorted.length === 0) {
      return { pageMinutes, dayMinutes, totalMinutes: 0 };
    }

    let totalMinutes = 0;
    let sessionStart = new Date(sorted[0].occurredAt).getTime();
    let lastT = sessionStart;
    let sessionStartIdx = 0;

    const flushSession = (endIdx: number) => {
      const slice = sorted.slice(sessionStartIdx, endIdx + 1);
      const rawMs = Math.max(0, new Date(slice[slice.length - 1].occurredAt).getTime() - new Date(slice[0].occurredAt).getTime());
      const durMs = Math.min(rawMs, this.portalMaxSessionMs);
      const durMin = Math.max(0, Math.round(durMs / 60000));
      totalMinutes += durMin;
      if (durMin <= 0) return;

      const pages = new Set(slice.map((e) => this.resolveEventPage(e)));
      const n = Math.max(1, pages.size);
      const perPage = durMin / n;
      for (const p of pages) {
        pageMinutes.set(p, (pageMinutes.get(p) || 0) + perPage);
      }

      const dayKey = this.resolveDayKey(slice[0]);
      const dayLabel =
        dayKey === 'unknown' ? 'Unknown day' : new Date(`${dayKey}T00:00:00`).toLocaleDateString();
      const prev = dayMinutes.get(dayKey);
      dayMinutes.set(dayKey, {
        dayLabel,
        minutes: (prev?.minutes || 0) + durMin
      });
    };

    for (let i = 1; i < sorted.length; i++) {
      const t = new Date(sorted[i].occurredAt).getTime();
      if (t - lastT > this.portalIdleGapMs) {
        flushSession(i - 1);
        sessionStartIdx = i;
      }
      lastT = t;
    }
    flushSession(sorted.length - 1);

    return { pageMinutes, dayMinutes, totalMinutes };
  }

  private resolveEventPage(ev: StudentActivityEvent): string {
    const d = ev.details || {};
    switch (ev.type) {
      case 'LOGIN':
      case 'LOGOUT':
        return 'Auth';
      case 'MEETING_ATTENDANCE':
        return d.topic ? `Meeting · ${d.topic}` : 'Meeting';
      case 'EXERCISE_ATTEMPT':
        return d.exerciseTitle ? `Digital Exercise · ${d.exerciseTitle}` : 'Digital Exercise';
      case 'MODULE_PROGRESS':
        return d.moduleTitle ? `Learning Module · ${d.moduleTitle}` : 'Learning Modules';
      case 'SESSION_RECORD':
        return d.moduleTitle ? `AI Session · ${d.moduleTitle}` : 'AI Session';
      case 'ASSIGNMENT_SUBMISSION':
        return d.title ? `Assignments · ${d.title}` : 'Assignments';
      case 'PROFILE_UPDATE':
        return 'Student Profile';
      default:
        return ev.type;
    }
  }

  private resolveStudentLabel(ev: StudentActivityEvent): string {
    if (ev.student) {
      return `${ev.student.name} (${ev.student.regNo})`;
    }
    return this.selectedStudentLabel || 'Selected student';
  }

  private resolveDayKey(ev: StudentActivityEvent): string {
    const d = new Date(ev.occurredAt);
    if (Number.isNaN(d.getTime())) return 'unknown';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private computeTimeAnalytics(): void {
    const studentMap = new Map<string, { studentId: string; student: string; minutes: number; visits: number; pages: Set<string> }>();
    const pageMap = new Map<string, { page: string; minutes: number; visits: number; students: Set<string> }>();
    const dayMap = new Map<string, { day: string; dayLabel: string; minutes: number; visits: number; students: Set<string> }>();

    const byStudentEvents = new Map<string, StudentActivityEvent[]>();
    for (const ev of this.filteredEvents) {
      const student = this.resolveStudentLabel(ev);
      const studentId = ev.student?._id || this.selectedStudentId || student;
      const page = this.resolveEventPage(ev);
      const day = this.resolveDayKey(ev);

      const stuRow = studentMap.get(studentId) || { studentId, student, minutes: 0, visits: 0, pages: new Set<string>() };
      stuRow.visits += 1;
      stuRow.pages.add(page);
      studentMap.set(studentId, stuRow);

      const pageRow = pageMap.get(page) || { page, minutes: 0, visits: 0, students: new Set<string>() };
      pageRow.visits += 1;
      pageRow.students.add(studentId);
      pageMap.set(page, pageRow);

      const dayLabel = day === 'unknown' ? 'Unknown day' : new Date(`${day}T00:00:00`).toLocaleDateString();
      const dayRow = dayMap.get(day) || { day, dayLabel, minutes: 0, visits: 0, students: new Set<string>() };
      dayRow.visits += 1;
      dayRow.students.add(studentId);
      dayMap.set(day, dayRow);

      const arr = byStudentEvents.get(studentId) || [];
      arr.push(ev);
      byStudentEvents.set(studentId, arr);
    }

    let totalMinutes = 0;
    for (const [studentId, evs] of byStudentEvents) {
      const portalMin = this.portalSessionMinutesForStudent(evs);
      totalMinutes += portalMin;
      const row = studentMap.get(studentId);
      if (row) row.minutes = portalMin;

      const { pageMinutes, dayMinutes } = this.allocatePortalMinutesByPageAndDay(evs);
      for (const [p, mins] of pageMinutes) {
        const pr = pageMap.get(p);
        if (pr) pr.minutes += mins;
      }
      for (const [dk, { minutes: dm }] of dayMinutes) {
        const dr = dayMap.get(dk);
        if (dr) dr.minutes += dm;
      }
    }

    const students = Array.from(studentMap.values())
      .map((row) => ({
        studentId: row.studentId,
        student: row.student,
        minutes: row.minutes,
        visits: row.visits,
        pages: row.pages.size
      }))
      .sort((a, b) => b.minutes - a.minutes || b.visits - a.visits);
    const pages = Array.from(pageMap.values())
      .map((row) => ({
        page: row.page,
        minutes: Math.round(row.minutes),
        visits: row.visits,
        students: row.students.size
      }))
      .sort((a, b) => b.minutes - a.minutes || b.visits - a.visits);
    const days = Array.from(dayMap.values())
      .map((row) => ({
        day: row.day,
        dayLabel: row.dayLabel,
        minutes: Math.round(row.minutes),
        visits: row.visits,
        students: row.students.size
      }))
      .sort((a, b) => b.day.localeCompare(a.day));

    this.studentTimeRows = students.slice(0, 10);
    this.pageTimeRows = pages.slice(0, 10);
    this.dayTimeRows = days;

    this.timeSummary = {
      totalMinutes,
      activeStudents: students.length,
      avgMinutesPerStudent: students.length ? Math.round(totalMinutes / students.length) : 0,
      topPage: pages[0]?.page || '—',
      topStudent: students[0]?.student || '—'
    };

    if (this.studentDrilldown) {
      const selected = students.find((s) => s.studentId === this.studentDrilldown!.studentId);
      if (selected) {
        this.openStudentDrilldown(selected);
      } else {
        this.studentDrilldown = null;
      }
    }
  }

  private buildGroupedRows(): void {
    if (this.groupBy === 'none') {
      this.groupedRows = [];
      return;
    }

    const map = new Map<string, StudentActivityEvent[]>();
    for (const ev of this.filteredEvents) {
      let key = '';
      if (this.groupBy === 'student') key = this.resolveStudentLabel(ev);
      if (this.groupBy === 'page') key = this.resolveEventPage(ev);
      if (this.groupBy === 'day') key = this.resolveDayKey(ev);
      const arr = map.get(key) || [];
      arr.push(ev);
      map.set(key, arr);
    }

    this.groupedRows = Array.from(map.entries())
      .map(([key, events]) => {
        const minutes = this.portalMinutesForEventGroup(events);
        const title = this.groupBy === 'day' && key !== 'unknown' ? new Date(`${key}T00:00:00`).toLocaleDateString() : key;
        return {
          key,
          title,
          subtitle: `${events.length} events · ${this.formatMinutes(minutes)}`,
          events
        };
      })
      .sort((a, b) => b.events.length - a.events.length);
  }

  /** Portal-time estimate for a bucket that may mix students (page/day groups). */
  private portalMinutesForEventGroup(events: StudentActivityEvent[]): number {
    if (events.length === 0) return 0;
    const byStudent = new Map<string, StudentActivityEvent[]>();
    for (const ev of events) {
      const student = this.resolveStudentLabel(ev);
      const studentId = ev.student?._id || this.selectedStudentId || student;
      const arr = byStudent.get(studentId) || [];
      arr.push(ev);
      byStudent.set(studentId, arr);
    }
    let sum = 0;
    for (const evs of byStudent.values()) {
      sum += this.portalSessionMinutesForStudent(evs);
    }
    return sum;
  }
}
