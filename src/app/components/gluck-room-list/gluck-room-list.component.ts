import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { MaterialModule } from '../../shared/material.module';
import { GluckRoomService } from '../../services/gluck-room.service';
import { AuthService } from '../../services/auth.service';

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
  searchQuery = '';

  pageIndex = 0;
  pageSize = 15;
  totalCount = 0;
  tabIndex = 0;

  actionLoadingId: string | null = null;

  availableBatches: string[] = [];

  private loadSeq = 0;
  private filterDebounceTimer?: ReturnType<typeof setTimeout>;

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
  }

  ngOnDestroy(): void {
    if (this.filterDebounceTimer) clearTimeout(this.filterDebounceTimer);
  }

  loadSessions(): void {
    const seq = ++this.loadSeq;
    this.loading = true;
    this.error = '';

    const statusMap: Record<string, string> = {
      scheduled: 'scheduled',
      active: 'active',
      ended: 'ended'
    };

    const params: Record<string, any> = {
      status: statusMap[this.statusTab],
      page: this.pageIndex + 1,
      limit: this.pageSize
    };

    if (this.batchFilter !== 'all') params['batch'] = this.batchFilter;
    if (this.searchQuery.trim()) params['search'] = this.searchQuery.trim();

    this.gluckRoomService.getSessions(params).subscribe({
      next: (res) => {
        if (seq !== this.loadSeq) return;
        if (res.success) {
          this.sessions = res.data || [];
          this.totalCount = res.totalCount || 0;
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
          this.error = res.message || 'Failed to load sessions';
        }
        this.loading = false;
      },
      error: (err) => {
        if (seq !== this.loadSeq) return;
        this.error = err.error?.message || 'Failed to load sessions';
        this.loading = false;
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

  onPageChange(ev: PageEvent): void {
    this.pageIndex = ev.pageIndex;
    this.pageSize = ev.pageSize;
    this.loadSessions();
  }

  createSession(): void {
    this.router.navigate(['/gluck-room/create']);
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
    if (!confirm('Start this session? This will create a LiveKit room and begin recording.')) return;
    this.actionLoadingId = id;
    this.gluckRoomService.startSession(id).subscribe({
      next: (res) => {
        this.actionLoadingId = null;
        if (res.success) this.loadSessions();
        else this.error = res.message;
      },
      error: (err) => {
        this.actionLoadingId = null;
        this.error = err.error?.message || 'Failed to start session';
      }
    });
  }

  endSession(id: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('End this session? Recording will be finalized and uploaded.')) return;
    this.actionLoadingId = id;
    this.gluckRoomService.endSession(id).subscribe({
      next: (res) => {
        this.actionLoadingId = null;
        if (res.success) this.loadSessions();
        else this.error = res.message;
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
    if (!confirm('Delete this completed session permanently? This will remove all participant and recording data.')) return;
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

  openRecording(sessionId: string): void {
    this.router.navigate(['/gluck-room', sessionId]);
  }

  formatDate(d: string | Date): string {
    return new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
    });
  }

  formatDuration(minutes: number): string {
    if (!minutes) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = { scheduled: 'Upcoming', active: 'Live', ended: 'Completed', cancelled: 'Cancelled' };
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
