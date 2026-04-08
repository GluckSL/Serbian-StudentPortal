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
  activityEvents: StudentActivityEvent[] = [];
  filteredEvents: StudentActivityEvent[] = [];
  paginatedData: StudentActivityEvent[] = [];
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
    this.fromDate = '';
    this.toDate = '';
    this.loadActivity();
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
}
