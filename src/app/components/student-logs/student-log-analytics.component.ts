import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  StudentActivityEvent,
  StudentActivityType,
  StudentAnalyticsResponse,
  StudentLogService
} from '../../services/student-log.service';

export type AnalyticsTabId =
  | 'activity'
  | 'profile'
  | 'attendance'
  | 'exercises'
  | 'modules'
  | 'sessions'
  | 'assignments';

@Component({
  selector: 'app-student-log-analytics',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './student-log-analytics.component.html',
  styleUrls: ['./student-log-analytics.component.css']
})
export class StudentLogAnalyticsComponent implements OnInit {
  loading = true;
  error = '';
  analytics: StudentAnalyticsResponse | null = null;

  activeTab: AnalyticsTabId = 'activity';

  readonly tabs: { id: AnalyticsTabId; label: string; icon: string }[] = [
    { id: 'activity', label: 'Activity', icon: 'fa-stream' },
    { id: 'profile', label: 'Profile', icon: 'fa-id-card' },
    { id: 'attendance', label: 'Attendance', icon: 'fa-chalkboard-teacher' },
    { id: 'exercises', label: 'Exercises', icon: 'fa-laptop-code' },
    { id: 'modules', label: 'Modules', icon: 'fa-book-open' },
    { id: 'sessions', label: 'AI sessions', icon: 'fa-microphone-alt' },
    { id: 'assignments', label: 'Assignments', icon: 'fa-award' }
  ];

  activityLoading = false;
  activityError = '';
  activityEvents: StudentActivityEvent[] = [];
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

  /** After user clicks "Apply filter"; button switches to "Remove filter". */
  filterApplied = false;

  /** Types picker modal */
  typesModalOpen = false;
  /** Working copy while modal is open */
  draftTypes: StudentActivityType[] = [];

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

  private studentId: string | null = null;

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
      this.studentId = studentId;
      this.fetchStudentAnalytics(studentId);
      this.fetchActivity(studentId);
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

  setTab(id: AnalyticsTabId): void {
    this.activeTab = id;
  }

  tabCount(id: AnalyticsTabId): number {
    if (!this.analytics) return 0;
    const s = this.analytics.summary;
    switch (id) {
      case 'activity':
        return this.activityEvents.length;
      case 'profile':
        return s.totalProfileUpdates;
      case 'attendance':
        return this.analytics.classAttendanceHistory?.length ?? 0;
      case 'exercises':
        return s.totalDigitalExerciseAttempts;
      case 'modules':
        return s.totalModulesTracked;
      case 'sessions':
        return s.totalSessions;
      case 'assignments':
        return s.totalAssignments;
      default:
        return 0;
    }
  }

  private typesParam(): StudentActivityType[] | undefined {
    if (this.selectedTypes.length === 0 || this.selectedTypes.length === this.typeOptions.length) {
      return undefined;
    }
    return this.selectedTypes;
  }

  fetchActivity(studentId: string): void {
    this.activityLoading = true;
    this.activityError = '';
    const from = this.fromDate ? new Date(this.fromDate).toISOString() : undefined;
    const to = this.toDate ? new Date(this.toDate).toISOString() : undefined;
    this.studentLogService
      .getStudentActivityTimeline(studentId, {
        types: this.typesParam(),
        from,
        to,
        limit: 400
      })
      .subscribe({
        next: (res) => {
          if (res?.success) {
            this.activityEvents = res.data || [];
          } else {
            this.activityError = 'Failed to load activity timeline';
          }
          this.activityLoading = false;
        },
        error: (err) => {
          this.activityError = err?.error?.message || err?.error?.msg || 'Failed to load activity timeline';
          this.activityLoading = false;
        }
      });
  }

  applyActivityFilters(): void {
    this.applyFilters();
  }

  applyFilters(): void {
    if (!this.studentId) return;
    this.fetchActivity(this.studentId);
    this.filterApplied = true;
  }

  removeFilters(): void {
    this.resetActivityFilters();
    this.filterApplied = false;
    if (this.studentId) this.fetchActivity(this.studentId);
  }

  openTypesModal(): void {
    this.draftTypes = [...this.selectedTypes];
    if (this.draftTypes.length === 0) {
      this.draftTypes = this.typeOptions.map((t) => t.id);
    }
    this.typesModalOpen = true;
  }

  closeTypesModal(save: boolean): void {
    if (save) {
      this.selectedTypes = [...this.draftTypes];
    }
    this.typesModalOpen = false;
  }

  isDraftTypeChecked(id: StudentActivityType): boolean {
    return this.draftTypes.includes(id);
  }

  toggleDraftType(id: StudentActivityType, checked: boolean): void {
    const set = new Set(this.draftTypes);
    if (checked) set.add(id);
    else set.delete(id);
    this.draftTypes = Array.from(set) as StudentActivityType[];
  }

  selectAllDraftTypes(): void {
    this.draftTypes = this.typeOptions.map((t) => t.id);
  }

  clearAllDraftTypes(): void {
    this.draftTypes = [];
  }

  typesSelectionSummary(): string {
    const n = this.selectedTypes.length;
    const total = this.typeOptions.length;
    if (n === 0 || n === total) return `All ${total}`;
    return `${n} of ${total}`;
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

  /** Toggle filter pill (no native checkbox). */
  toggleTypePill(id: StudentActivityType): void {
    this.toggleType(id, !this.isTypeChecked(id));
  }

  selectAllActivityTypes(): void {
    this.selectedTypes = this.typeOptions.map((t) => t.id);
  }

  resetActivityFilters(): void {
    this.fromDate = '';
    this.toDate = '';
    this.selectAllActivityTypes();
  }

  fmt(date: string | Date | null | undefined): string {
    if (!date) return '-';
    return new Date(date).toLocaleString();
  }

  mins(seconds?: number | null): number {
    if (!seconds || !Number.isFinite(seconds)) return 0;
    return Math.round(seconds / 60);
  }

  formatActivityDetails(ev: StudentActivityEvent): string {
    const d = ev.details;
    if (!d || typeof d !== 'object') return '—';
    const parts: string[] = [];
    if (d.exerciseTitle) parts.push(String(d.exerciseTitle));
    if (d.topic) parts.push(String(d.topic));
    if (d.moduleTitle) parts.push(String(d.moduleTitle));
    if (d.title && ev.type === 'ASSIGNMENT_SUBMISSION') parts.push(String(d.title));
    if (d.attendanceStatus) parts.push(`status: ${d.attendanceStatus}`);
    if (d.status != null && ev.type === 'EXERCISE_ATTEMPT') parts.push(String(d.status));
    if (d.level) parts.push(`level ${d.level}`);
    if (d.batch) parts.push(`batch ${d.batch}`);
    if (d.ip) parts.push(`IP ${d.ip}`);
    if (d.joinTime) parts.push(`join ${this.fmt(d.joinTime)}`);
    if (d.attendedMinutes != null) parts.push(`${d.attendedMinutes} min`);
    if (parts.length) return parts.join(' · ');
    try {
      return JSON.stringify(d);
    } catch {
      return '—';
    }
  }
}
