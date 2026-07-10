import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { MaterialModule } from '../../shared/material.module';
import { GluckRoomService } from '../../services/gluck-room.service';
import { AuthService } from '../../services/auth.service';

/** How often (ms) to poll the server for status changes */
const AUTO_REFRESH_MS = 30_000;
/** How often (ms) to tick the countdown labels */
const COUNTDOWN_TICK_MS = 30_000;
/** How many minutes before start to open the join window */
const JOIN_WINDOW_MINUTES = 10;

@Component({
  selector: 'app-gluck-room-list',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './gluck-room-list.component.html',
  styleUrls: ['./gluck-room-list.component.scss']
})
export class GluckRoomListComponent implements OnInit, OnDestroy {
  sessions: any[] = [];
  loading = false;
  error = '';

  userRole = '';
  isStudent = false;

  statusTab: 'scheduled' | 'active' | 'ended' = 'scheduled';
  batchFilter = 'all';
  planFilter = 'all';
  searchQuery = '';
  studentQuickFilter: 'all' | 'today' | 'week' | 'available' = 'all';

  pageIndex = 0;
  pageSize = 15;
  totalCount = 0;
  tabIndex = 0;

  tabCounts: { scheduled: number; active: number; ended: number } = { scheduled: 0, active: 0, ended: 0 };

  actionLoadingId: string | null = null;
  availableBatches: string[] = [];

  private loadSeq = 0;
  private filterDebounceTimer?: ReturnType<typeof setTimeout>;
  /** Periodically re-fetch so status transitions (scheduled→live→ended) are picked up */
  private autoRefreshTimer?: ReturnType<typeof setInterval>;
  /** Keeps countdown labels fresh without a network round-trip */
  private countdownTickTimer?: ReturnType<typeof setInterval>;

  get displayedColumns(): string[] {
    const cols = ['sessionName', 'host', 'batch', 'plan', 'dateTime', 'duration'];
    if (this.statusTab !== 'scheduled') cols.push('participants');
    if (!(this.isStudent && this.statusTab === 'ended')) cols.push('actions');
    return cols;
  }

  get displayedSessions(): any[] {
    if (!this.isStudent || this.studentQuickFilter === 'all') return this.sessions;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday = startOfToday + 24 * 60 * 60 * 1000;
    const endOfWeek = now.getTime() + 7 * 24 * 60 * 60 * 1000;

    return this.sessions.filter((session) => {
      const start = new Date(session.scheduledStartTime).getTime();
      if (this.studentQuickFilter === 'today') return start >= startOfToday && start < endOfToday;
      if (this.studentQuickFilter === 'week') return start >= now.getTime() && start <= endOfWeek;
      if (this.studentQuickFilter === 'available') return session.status === 'active' || this.canJoinSession(session);
      return true;
    });
  }

  get heroSession(): any | null {
    if (!this.isStudent) return null;
    return this.sessions.find((session) => session.status === 'active')
      || this.sessions.find((session) => this.canJoinSession(session))
      || this.sessions[0]
      || null;
  }

  get studentEmptyTitle(): string {
    if (this.studentQuickFilter === 'available') return 'No rooms available now';
    if (this.statusTab === 'active') return 'No live sessions right now';
    if (this.statusTab === 'ended') return 'No completed sessions yet';
    return 'No upcoming sessions found';
  }

  get studentEmptyText(): string {
    if (this.studentQuickFilter !== 'all') return 'Try another filter or check the full schedule.';
    if (this.statusTab === 'active') return 'Check Upcoming for your next scheduled class.';
    if (this.statusTab === 'ended') return 'Recordings will appear here after completed sessions.';
    return 'Your next Gluck Room class will appear here once it is scheduled.';
  }

  constructor(
    private router: Router,
    private gluckRoomService: GluckRoomService,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const user = this.auth.getSnapshotUser();
    this.userRole = user?.role || '';
    this.isStudent = this.userRole === 'STUDENT';
    this.loadSessions();

    // Auto-refresh: re-fetch server data so live/ended transitions appear automatically
    this.autoRefreshTimer = setInterval(() => {
      this.loadSessions({ silent: true });
    }, AUTO_REFRESH_MS);

    // Countdown tick: re-render labels (no network call)
    this.countdownTickTimer = setInterval(() => {
      this.cdr.markForCheck();
    }, COUNTDOWN_TICK_MS);
  }

  ngOnDestroy(): void {
    if (this.filterDebounceTimer) clearTimeout(this.filterDebounceTimer);
    if (this.autoRefreshTimer) clearInterval(this.autoRefreshTimer);
    if (this.countdownTickTimer) clearInterval(this.countdownTickTimer);
  }

  loadSessions(opts: { silent?: boolean } = {}): void {
    const seq = ++this.loadSeq;
    if (!opts.silent) {
      this.loading = true;
      this.error = '';
    }

    const params: Record<string, any> = {
      status: this.statusTab,
      page: this.pageIndex + 1,
      limit: this.pageSize,
      includeTabCounts: 'true'
    };

    if (this.batchFilter !== 'all') params['batch'] = this.batchFilter;
    if (this.planFilter !== 'all') params['plan'] = this.planFilter;
    if (this.searchQuery.trim()) params['search'] = this.searchQuery.trim();

    this.gluckRoomService.getSessions(params).subscribe({
      next: (res) => {
        if (seq !== this.loadSeq) return;
        if (res.success) {
          this.sessions = res.data || [];
          this.totalCount = res.totalCount || 0;
          if (res.tabCounts) {
            this.tabCounts = {
              scheduled: res.tabCounts.scheduled ?? 0,
              active: res.tabCounts.active ?? 0,
              ended: res.tabCounts.ended ?? 0
            };
          }
          if (Array.isArray(res.availableBatches)) {
            this.availableBatches = res.availableBatches;
          }
          const lastPage = Math.max(Math.ceil(this.totalCount / this.pageSize) - 1, 0);
          if (this.pageIndex > lastPage) {
            this.pageIndex = lastPage;
            this.loading = false;
            this.loadSessions();
            return;
          }
        } else {
          if (!opts.silent) this.error = res.message || 'Failed to load sessions';
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (seq !== this.loadSeq) return;
        if (!opts.silent) {
          this.error = err.error?.message || 'Failed to load sessions';
        }
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onTabIndexChange(index: number): void {
    this.tabIndex = index;
    const map = ['scheduled', 'active', 'ended'];
    this.statusTab = map[index] as 'scheduled' | 'active' | 'ended';
    this.pageIndex = 0;
    this.loadSessions();
  }

  onSearchChange(): void {
    if (this.filterDebounceTimer) clearTimeout(this.filterDebounceTimer);
    this.filterDebounceTimer = setTimeout(() => {
      this.filterDebounceTimer = undefined;
      this.pageIndex = 0;
      this.loadSessions();
    }, 350);
  }

  onBatchFilterChange(): void {
    this.pageIndex = 0;
    this.loadSessions();
  }

  setStudentQuickFilter(filter: 'all' | 'today' | 'week' | 'available'): void {
    this.studentQuickFilter = filter;
  }

  onPageChange(ev: PageEvent): void {
    this.pageIndex = ev.pageIndex;
    this.pageSize = ev.pageSize;
    this.loadSessions();
  }

  // ── Actions ────────────────────────────────────────────────────────────

  createSession(): void {
    this.router.navigate(['/gluck-room/create']);
  }

  createBulkSession(): void {
    this.router.navigate(['/gluck-room/create'], { queryParams: { mode: 'bulk' } });
  }

  editSession(id: string, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/gluck-room', id, 'edit']);
  }

  viewSession(id: string): void {
    this.router.navigate(['/gluck-room', id]);
  }

  startSession(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('Start this session? This will open the live room.')) return;
    this.actionLoadingId = id;
    this.gluckRoomService.startSession(id).subscribe({
      next: (res) => {
        this.actionLoadingId = null;
        if (res.success) {
          // Switch to live tab and reload
          this.tabIndex = 1;
          this.statusTab = 'active';
          this.pageIndex = 0;
          this.loadSessions();
        } else {
          this.error = res.message;
        }
      },
      error: (err) => {
        this.actionLoadingId = null;
        this.error = err.error?.message || 'Failed to start session';
      }
    });
  }

  endSession(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('End this session? Recording will be finalised.')) return;
    this.actionLoadingId = id;
    this.gluckRoomService.endSession(id).subscribe({
      next: (res) => {
        this.actionLoadingId = null;
        if (res.success) {
          // Switch to completed tab after ending
          this.tabIndex = 2;
          this.statusTab = 'ended';
          this.pageIndex = 0;
          this.loadSessions();
        } else {
          this.error = res.message;
        }
      },
      error: (err) => {
        this.actionLoadingId = null;
        this.error = err.error?.message || 'Failed to end session';
      }
    });
  }

  deleteSession(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('Cancel this session? This cannot be undone.')) return;
    this.gluckRoomService.deleteSession(id).subscribe({
      next: (res) => {
        if (res.success) this.loadSessions();
        else this.error = res.message;
      },
      error: (err) => { this.error = err.error?.message || 'Failed to cancel session'; }
    });
  }

  deleteEndedSession(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('Delete this completed session permanently?')) return;
    this.gluckRoomService.deleteSession(id).subscribe({
      next: (res) => {
        if (res.success) this.loadSessions();
        else this.error = res.message;
      },
      error: (err) => { this.error = err.error?.message || 'Failed to delete session'; }
    });
  }

  joinSession(id: string, event: Event): void {
    event.stopPropagation();
    window.open(`/gluck-room/${id}`, '_blank');
  }

  openSession(id: string | undefined, event?: Event): void {
    event?.stopPropagation();
    if (!id) return;
    this.viewSession(id);
  }

  openRecording(sessionId: string, event?: Event): void {
    event?.stopPropagation();
    this.gluckRoomService.getSessionRecording(sessionId).subscribe({
      next: (res) => {
        if (res.success && res.data.recordingId) {
          this.router.navigate(['/gluck-room/recording', res.data.recordingId]);
        } else {
          this.error = res.message || 'No recording found';
        }
      },
      error: (err) => { this.error = err.error?.message || 'Failed to load recording'; }
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  tabCount(tab: 'scheduled' | 'active' | 'ended'): number {
    return this.tabCounts[tab] ?? 0;
  }

  /**
   * Returns true when the session is within the join window:
   *  • JOIN_WINDOW_MINUTES before the scheduled start, up to maxDurationMinutes after.
   */
  canJoinSession(session: any): boolean {
    const now = Date.now();
    const start = new Date(session.scheduledStartTime).getTime();
    const end = start + (session.maxDurationMinutes || 180) * 60_000;
    const windowOpen = start - JOIN_WINDOW_MINUTES * 60_000;
    return now >= windowOpen && now <= end;
  }

  /** Label shown on the Join button for upcoming sessions */
  joinButtonLabel(session: any): string {
    if (session.status === 'active') return 'Join Room Now';
    if (this.canJoinSession(session)) return 'Join Now';
    return this.timeUntilJoinOpens(session);
  }

  /** Whether to show a Start button (host only, within window, not yet active) */
  canStartSession(session: any): boolean {
    if (!this.isHost(session) || session.status !== 'scheduled') return false;
    return this.canJoinSession(session);
  }

  timeUntilJoinOpens(session: any): string {
    const start = new Date(session.scheduledStartTime).getTime();
    const windowOpen = start - JOIN_WINDOW_MINUTES * 60_000;
    const ms = windowOpen - Date.now();
    if (ms <= 0) return 'Starting now';
    const totalMins = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours > 0) return `Join in ${hours}h ${mins > 0 ? `${mins}m` : ''}`.trim();
    if (totalMins >= 1) return `Join in ${totalMins}m`;
    return 'Starting now';
  }

  formatDate(d: string | Date): string {
    return new Date(d).toLocaleString('sr-Latn-RS', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
    });
  }

  formatDuration(minutes: number): string {
    if (!minutes) return '—';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
  }

  sessionImage(index: number): string {
    const images = [
      'assets/gluck-room/session-germany-flag.png',
      'assets/gluck-room/session-germany-city.png',
      'assets/gluck-room/session-learning-1.png',
      'assets/gluck-room/session-learning-2.png'
    ];
    return images[index % images.length];
  }

  sessionStatusText(session: any): string {
    if (session.status === 'active') return 'Live now';
    if (this.canJoinSession(session)) return 'Available';
    if (session.status === 'ended') return 'Completed';
    return 'Scheduled';
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      scheduled: 'Upcoming', active: 'Live', ended: 'Completed', cancelled: 'Cancelled'
    };
    return map[status] || status;
  }

  isHost(session: any): boolean {
    const user = this.auth.getSnapshotUser();
    const userId = user?.userId || user?._id;
    return session.hostId?._id === userId || session.hostId === userId;
  }

  canManage(): boolean {
    return !this.isStudent;
  }
}
