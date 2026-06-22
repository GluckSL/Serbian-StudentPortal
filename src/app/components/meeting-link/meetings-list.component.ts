// src/app/components/meeting-link/meetings-list.component.ts

import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { MatDialog } from '@angular/material/dialog';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';
import { JoinClassFlowService } from '../../services/join-class-flow.service';
import { NotificationService } from '../../services/notification.service';
import { AuthService } from '../../services/auth.service';
import { NavService } from '../../shared/services/nav.service';
import { BulkEditMeetingsDialogComponent } from './bulk-edit-meetings-dialog.component';
import { MeetingRemindDialogComponent } from './meeting-remind-dialog.component';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-meetings-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MaterialModule
  ],
  templateUrl: './meetings-list.component.html',
  styleUrls: ['./meetings-list.component.css']
})
export class MeetingsListComponent implements OnInit, OnDestroy {
  meetings: any[] = [];
  loading = true;
  isDeletingSelected = false;
  error: string = '';
  userRole: string = ''; // Track user role
  selectedMeetingIds = new Set<string>();

  /** Tab: scheduled | ongoing | ended (default: scheduled) */
  statusTab: 'scheduled' | 'ongoing' | 'ended' = 'scheduled';
  batchFilter: string = 'all';
  searchQuery: string = '';

  /** Server pagination (filters apply to full collection, then slice) */
  pageIndex = 0;
  pageSize = 15;
  private readonly batchEndedPageSize = 150;
  totalCount = 0;
  tabCounts: { scheduled: number; ongoing: number; ended: number } = {
    scheduled: 0,
    ongoing: 0,
    ended: 0
  };
  availableBatches: string[] = [];

  /** mat-tab-group index ↔ statusTab */
  tabIndex = 0;

  private loadSeq = 0;
  private filterDebounceTimer?: ReturnType<typeof setTimeout>;

  displayedColumnsAdmin: string[] = [
    'status', 'topic', 'teacher', 'dateTime', 'duration', 'participants', 'batch', 'meetingId', 'actions'
  ];
  displayedColumnsTeacher: string[] = [
    'status', 'topic', 'dateTime', 'duration', 'participants', 'batch', 'meetingId', 'actions'
  ];

  /** Refresh “Join in …” labels periodically */
  private joinLabelTimer?: ReturnType<typeof setInterval>;

  isBulkEditing = false;
  isSelectingAllBatch = false;

  constructor(
    private router: Router,
    private zoomService: ZoomService,
    private cdr: ChangeDetectorRef,
    private joinClassFlow: JoinClassFlowService,
    private notify: NotificationService,
    private auth: AuthService,
    private nav: NavService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.loadMeetings();
    this.joinLabelTimer = setInterval(() => this.cdr.markForCheck(), 30000);
  }

  ngOnDestroy(): void {
    if (this.joinLabelTimer) {
      clearInterval(this.joinLabelTimer);
    }
    if (this.filterDebounceTimer) {
      clearTimeout(this.filterDebounceTimer);
    }
  }

  loadMeetings(): void {
    const seq = ++this.loadSeq;
    this.loading = true;
    this.error = '';

    const batchParam = this.batchFilter !== 'all' ? this.batchFilter : undefined;
    const searchTrim = this.searchQuery.trim();
    const showBatchEndedInOnePage = this.shouldShowBatchEndedInOnePage();
    if (showBatchEndedInOnePage && this.pageIndex !== 0) {
      this.pageIndex = 0;
    }
    const requestPageSize = showBatchEndedInOnePage ? this.batchEndedPageSize : this.pageSize;

    this.zoomService
      .getAllMeetings({
        lifecycle: this.statusTab,
        page: showBatchEndedInOnePage ? 1 : this.pageIndex + 1,
        limit: requestPageSize,
        search: searchTrim || undefined,
        batch: batchParam,
        includeTabCounts: true
      })
      .subscribe({
        next: (response) => {
          if (seq !== this.loadSeq) return;
          if (response.success) {
            this.meetings = response.data || [];
            this.userRole = response.userRole || '';
            this.totalCount = Number(response.totalCount) || 0;
            const lastPageIndex = Math.max(Math.ceil(this.totalCount / requestPageSize) - 1, 0);
            if (this.pageIndex > lastPageIndex) {
              this.pageIndex = lastPageIndex;
              this.loading = false;
              this.isDeletingSelected = false;
              this.loadMeetings();
              return;
            }
            if (response.tabCounts) {
              this.tabCounts = {
                scheduled: response.tabCounts.scheduled ?? 0,
                ongoing: response.tabCounts.ongoing ?? 0,
                ended: response.tabCounts.ended ?? 0
              };
            }
            if (Array.isArray(response.availableBatches)) {
              this.availableBatches = response.availableBatches;
            }
            this.pruneSelection();
          } else {
            this.error = response.message || 'Failed to load meetings';
          }
          this.loading = false;
          this.isDeletingSelected = false;
        },
        error: (err) => {
          if (seq !== this.loadSeq) return;
          console.error('Error loading meetings:', err);
          this.error = err.error?.message || 'Failed to load meetings';
          this.loading = false;
          this.isDeletingSelected = false;
        }
      });
  }

  /** Map DB row + time window → which of the three tabs this meeting belongs to */
  effectiveTabStatus(meeting: any): 'scheduled' | 'ongoing' | 'ended' {
    if (meeting.status === 'cancelled') {
      return 'ended';
    }
    const s = this.getMeetingStatus(meeting);
    if (s === 'ongoing' || s === 'ended' || s === 'scheduled') {
      return s;
    }
    return 'ended';
  }

  onTabIndexChange(index: number): void {
    this.tabIndex = index;
    const map: Array<'scheduled' | 'ongoing' | 'ended'> = ['scheduled', 'ongoing', 'ended'];
    this.statusTab = map[index] ?? 'scheduled';
    this.pageIndex = 0;
    if (!this.canBulkDelete()) {
      this.selectedMeetingIds.clear();
    }
    this.loadMeetings();
  }

  tabCount(tab: 'scheduled' | 'ongoing' | 'ended'): number {
    return this.tabCounts[tab] ?? 0;
  }

  onSearchChange(): void {
    if (this.filterDebounceTimer) clearTimeout(this.filterDebounceTimer);
    this.filterDebounceTimer = setTimeout(() => {
      this.filterDebounceTimer = undefined;
      this.pageIndex = 0;
      this.loadMeetings();
    }, 350);
  }

  onBatchFilterChange(): void {
    this.pageIndex = 0;
    this.loadMeetings();
  }

  onPageChange(ev: PageEvent): void {
    this.pageIndex = ev.pageIndex;
    this.pageSize = ev.pageSize;
    this.loadMeetings();
  }

  shouldShowBatchEndedInOnePage(): boolean {
    return this.statusTab === 'ended' && this.batchFilter !== 'all';
  }

  showPaginator(): boolean {
    if (this.totalCount <= 0) return false;
    if (this.shouldShowBatchEndedInOnePage() && this.totalCount <= this.batchEndedPageSize) return false;
    return true;
  }

  paginatorPageSize(): number {
    return this.shouldShowBatchEndedInOnePage() ? this.batchEndedPageSize : this.pageSize;
  }

  tableColumns(): string[] {
    const base = this.isAdmin() ? this.displayedColumnsAdmin : this.displayedColumnsTeacher;
    return this.canBulkDelete() ? ['select', ...base] : base;
  }


  canBulkDelete(): boolean {
    return this.statusTab === 'scheduled';
  }

  isMeetingSelected(meetingId: string): boolean {
    return this.selectedMeetingIds.has(meetingId);
  }

  toggleMeetingSelection(meetingId: string, checked: boolean): void {
    if (checked) {
      this.selectedMeetingIds.add(meetingId);
    } else {
      this.selectedMeetingIds.delete(meetingId);
    }
  }

  areAllFilteredSelected(): boolean {
    if (!this.meetings.length) return false;
    return this.meetings.every((m) => this.selectedMeetingIds.has(m._id));
  }

  hasSomeFilteredSelected(): boolean {
    if (!this.meetings.length) return false;
    const selectedCount = this.meetings.filter((m) => this.selectedMeetingIds.has(m._id)).length;
    return selectedCount > 0 && selectedCount < this.meetings.length;
  }

  toggleSelectAllFiltered(checked: boolean): void {
    if (checked) {
      this.meetings.forEach((m) => this.selectedMeetingIds.add(m._id));
    } else {
      this.meetings.forEach((m) => this.selectedMeetingIds.delete(m._id));
    }
  }

  selectedCount(): number {
    return this.selectedMeetingIds.size;
  }

  clearSelection(): void {
    this.selectedMeetingIds.clear();
  }

  deleteSelectedMeetings(event?: Event): void {
    event?.stopPropagation();
    if (!this.selectedMeetingIds.size || this.isDeletingSelected) return;

    const count = this.selectedMeetingIds.size;
    const confirmed = window.confirm(`Delete ${count} selected meeting(s)? This cannot be undone.`);
    if (!confirmed) return;

    const requests = Array.from(this.selectedMeetingIds).map((id) =>
      this.zoomService.deleteMeeting(id).pipe(
        catchError((err) => of({ success: false, _error: err }))
      )
    );

    this.isDeletingSelected = true;
    this.error = '';

    forkJoin(requests).subscribe({
      next: (results: any[]) => {
        const successCount = results.filter((r) => r?.success !== false).length;
        const failCount = results.length - successCount;

        if (successCount > 0) {
          this.selectedMeetingIds.clear();
          this.loadMeetings();
        } else {
          this.isDeletingSelected = false;
        }

        if (failCount > 0) {
          this.error = `${failCount} meeting(s) could not be deleted.`;
        }
      },
      error: () => {
        this.error = 'Failed to delete selected meetings.';
        this.isDeletingSelected = false;
      }
    });
  }

  selectAllInBatch(): void {
    if (this.isSelectingAllBatch) return;
    this.isSelectingAllBatch = true;
    const batchParam = this.batchFilter !== 'all' ? this.batchFilter : undefined;
    this.zoomService.getAllMeetings({
      lifecycle: this.statusTab,
      limit: 2000,
      batch: batchParam,
      search: this.searchQuery.trim() || undefined,
    }).subscribe({
      next: (response) => {
        if (response?.success && response?.data?.meetings) {
          response.data.meetings.forEach((m: any) => this.selectedMeetingIds.add(m._id));
        }
        this.isSelectingAllBatch = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isSelectingAllBatch = false;
        this.notify.error('Could not load all meetings. Please try again.');
      }
    });
  }

  openBulkEdit(): void {
    if (!this.selectedMeetingIds.size) return;
    const selectedMeetings = this.meetings.filter((m) => this.selectedMeetingIds.has(m._id));
    const ref = this.dialog.open(BulkEditMeetingsDialogComponent, {
      data: { selectedMeetings },
      width: '600px',
      maxWidth: '98vw',
      disableClose: true,
    });
    ref.afterClosed().subscribe((result) => {
      if (result && result.summary?.updated > 0) {
        this.selectedMeetingIds.clear();
        this.loadMeetings();
        this.notify.success(`${result.summary.updated} meeting${result.summary.updated !== 1 ? 's' : ''} updated successfully.`);
      }
    });
  }

  private pruneSelection(): void {
    const visibleIds = new Set(this.meetings.map((m) => m._id));
    Array.from(this.selectedMeetingIds).forEach((id) => {
      if (!visibleIds.has(id)) this.selectedMeetingIds.delete(id);
    });
  }

  createMeeting(): void {
    this.router.navigate(['/teacher/meetings/create']);
  }

  /** ADMIN / TEACHER_ADMIN always; SUB_ADMIN only if they have Manage Classes (manage-classes) permission */
  canBulkJourneyMeetings(): boolean {
    if (this.userRole === 'ADMIN' || this.userRole === 'TEACHER_ADMIN') return true;
    if (this.userRole !== 'SUB_ADMIN') return false;
    const user = this.auth.getSnapshotUser();
    if (!user) return false;
    return this.nav.canSubAdminAccessRoute(
      '/teacher/meetings/bulk-journey-create',
      user.sidebarPermissions || [],
      user.sidebarAccessLevels || {},
    );
  }

  bulkJourneyMeetings(): void {
    this.router.navigate(['/teacher/meetings/bulk-journey-create']);
  }

  viewMeeting(meetingId: string): void {
    this.router.navigate(['/teacher/meetings', meetingId]);
  }

  joinMeeting(meeting: any, event: Event): void {
    event.stopPropagation();
    this.joinClassFlow.openJoin(meeting, (msg) => this.notify.error(msg));
  }

  canShowRemindButton(meeting: any): boolean {
    return this.statusTab === 'ongoing' && this.getMeetingStatus(meeting) === 'ongoing';
  }

  openRemindDialog(meeting: any, event: Event): void {
    event.stopPropagation();
    const ref = this.dialog.open(MeetingRemindDialogComponent, {
      data: { meetingId: meeting._id, topic: meeting.topic },
      width: '480px',
      maxWidth: '98vw',
      disableClose: false,
    });
    ref.afterClosed().subscribe((result) => {
      if (result?.sent) {
        const n = result.sent;
        this.notify.success(
          `Reminder email sent to ${n} student${n !== 1 ? 's' : ''}.`,
        );
      }
    });
  }

  /** Hide join for ended (and cancelled) meetings; table/cards use this. */
  showJoinButton(meeting: any): boolean {
    return this.effectiveTabStatus(meeting) !== 'ended';
  }

  /**
   * Ongoing → “Join”. Scheduled before join window → “Join in …”.
   * Scheduled inside join window → “Join”.
   */
  joinButtonLabel(meeting: any): string {
    if (this.getMeetingStatus(meeting) === 'ongoing') {
      return 'Join';
    }
    if (this.canJoinMeeting(meeting)) {
      return 'Join';
    }
    return 'Join in ' + this.formatTimeUntilJoinOpens(meeting);
  }

  /** Time until the 10‑minute-before window opens (same rule as canJoinMeeting). */
  formatTimeUntilJoinOpens(meeting: any): string {
    const start = new Date(meeting.startTime);
    const joinOpens = new Date(start.getTime() - 10 * 60000);
    const ms = joinOpens.getTime() - Date.now();
    if (ms <= 0) {
      return '0 min';
    }
    const totalMins = Math.floor(ms / 60000);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    if (totalMins >= 1) {
      return `${totalMins} min`;
    }
    const secs = Math.max(1, Math.ceil(ms / 1000));
    return `${secs} sec`;
  }

  formatDate(date: string | Date, timeZone?: string): string {
    const tz = timeZone || 'Asia/Kolkata';
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz
    });
  }

  formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins} min`;
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'scheduled':
        return 'primary';
      case 'started':
      case 'ongoing':
        return 'accent';
      case 'ended':
        return 'warn';
      case 'cancelled':
        return 'warn';
      default:
        return 'primary';
    }
  }

  getMeetingStatus(meeting: any): string {
    const now = new Date();
    const start = new Date(meeting.startTime);
    const end = new Date(start.getTime() + meeting.duration * 60000);

    if (now >= start && now <= end) {
      return 'ongoing';
    } else if (now > end) {
      return 'ended';
    } else {
      return 'scheduled';
    }
  }

  canJoinMeeting(meeting: any): boolean {
    const now = new Date();
    const start = new Date(meeting.startTime);
    const end = new Date(start.getTime() + meeting.duration * 60000);
    const tenMinBefore = new Date(start.getTime() - 10 * 60000);

    return now >= tenMinBefore && now <= end;
  }

  getUniqueBatches(): string[] {
    return this.availableBatches.length ? this.availableBatches : [];
  }

  displayBatch(meeting: any): string {
    const topicBatch = String(meeting?.topic || '').match(/\bbatch\s*[-#:]*\s*([A-Za-z0-9_-]+)\b/i)?.[1];
    const rawBatch = String(meeting?.batch || '').trim();
    if (topicBatch && (/^GO-/i.test(rawBatch) || rawBatch === '')) {
      return topicBatch;
    }
    return rawBatch || topicBatch || '—';
  }

  isAdmin(): boolean {
    return this.userRole === 'ADMIN' || this.userRole === 'SUB_ADMIN';
  }

  getTeacherName(meeting: any): string {
    return meeting.assignedTeacher?.name || meeting.createdBy?.name || 'Unknown Teacher';
  }

  /** Track which meeting is currently being recreated */
  recreatingMeetingId: string | null = null;

  /** Only show Recreate for admins on non-ended meetings that have a Zoom ID */
  canShowRecreateButton(meeting: any): boolean {
    return (
      this.isAdmin() &&
      !!meeting.zoomMeetingId &&
      this.effectiveTabStatus(meeting) !== 'ended'
    );
  }

  recreateMeeting(meeting: any, event: Event): void {
    event.stopPropagation();
    if (this.recreatingMeetingId) return;

    const confirmed = window.confirm(
      `Recreate the Zoom meeting for "${meeting.topic}"?\n\n` +
      `The current Zoom link is broken (error 3,001). This will create a fresh Zoom meeting ` +
      `and update the link for teachers and students.`
    );
    if (!confirmed) return;

    this.recreatingMeetingId = meeting._id;
    this.zoomService.recreateMeeting(meeting._id).subscribe({
      next: (res: any) => {
        this.recreatingMeetingId = null;
        if (res?.success) {
          this.notify.success(`Zoom meeting recreated! New ID: ${res.newZoomMeetingId}`);
          this.loadMeetings();
        } else {
          this.notify.error(res?.message || 'Failed to recreate the Zoom meeting.');
        }
      },
      error: (err: any) => {
        this.recreatingMeetingId = null;
        this.notify.error(err?.error?.message || 'Failed to recreate the Zoom meeting. Please try again.');
      }
    });
  }
}
