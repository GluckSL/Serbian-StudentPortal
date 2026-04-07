// src/app/components/meeting-link/meetings-list.component.ts

import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';

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
  filteredMeetings: any[] = [];
  loading: boolean = true;
  error: string = '';
  userRole: string = ''; // Track user role

  /** Tab: scheduled | ongoing | ended (default: scheduled) */
  statusTab: 'scheduled' | 'ongoing' | 'ended' = 'scheduled';
  batchFilter: string = 'all';
  searchQuery: string = '';

  /** mat-tab-group index ↔ statusTab */
  tabIndex = 0;

  displayedColumnsAdmin: string[] = [
    'status', 'topic', 'teacher', 'dateTime', 'duration', 'participants', 'batch', 'actions'
  ];
  displayedColumnsTeacher: string[] = [
    'status', 'topic', 'dateTime', 'duration', 'participants', 'batch', 'actions'
  ];

  /** Refresh “Join in …” labels periodically */
  private joinLabelTimer?: ReturnType<typeof setInterval>;

  constructor(
    private router: Router,
    private zoomService: ZoomService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadMeetings();
    this.joinLabelTimer = setInterval(() => this.cdr.markForCheck(), 30000);
  }

  ngOnDestroy(): void {
    if (this.joinLabelTimer) {
      clearInterval(this.joinLabelTimer);
    }
  }

  loadMeetings(): void {
    this.loading = true;
    this.error = '';

    this.zoomService.getAllMeetings().subscribe({
      next: (response) => {
        if (response.success) {
          this.meetings = response.data;
          this.userRole = response.userRole || ''; // Store user role
          this.applyFilters();
        } else {
          this.error = response.message || 'Failed to load meetings';
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading meetings:', err);
        this.error = err.error?.message || 'Failed to load meetings';
        this.loading = false;
      }
    });
  }

  applyFilters(): void {
    this.filteredMeetings = this.meetings.filter(meeting => {
      if (this.effectiveTabStatus(meeting) !== this.statusTab) {
        return false;
      }

      if (this.batchFilter !== 'all' && meeting.batch !== this.batchFilter) {
        return false;
      }

      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        return (
          meeting.topic?.toLowerCase().includes(query) ||
          meeting.batch?.toLowerCase().includes(query) ||
          meeting.agenda?.toLowerCase().includes(query)
        );
      }

      return true;
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
    this.applyFilters();
  }

  tabCount(tab: 'scheduled' | 'ongoing' | 'ended'): number {
    return this.meetings.filter((m) => {
      if (this.batchFilter !== 'all' && m.batch !== this.batchFilter) return false;
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        return (
          m.topic?.toLowerCase().includes(q) ||
          m.batch?.toLowerCase().includes(q) ||
          m.agenda?.toLowerCase().includes(q)
        );
      }
      return true;
    }).filter((m) => this.effectiveTabStatus(m) === tab).length;
  }

  tableColumns(): string[] {
    return this.isAdmin() ? this.displayedColumnsAdmin : this.displayedColumnsTeacher;
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  createMeeting(): void {
    this.router.navigate(['/teacher/meetings/create']);
  }

  viewMeeting(meetingId: string): void {
    this.router.navigate(['/teacher/meetings', meetingId]);
  }

  joinMeeting(meeting: any, event: Event): void {
    event.stopPropagation();
    const url = meeting.joinUrl || meeting.startUrl;
    if (url) {
      window.open(url, '_blank');
    }
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
    const tz = timeZone || 'Asia/Colombo';
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
    const batches = this.meetings.map(m => m.batch).filter(Boolean);
    return [...new Set(batches)].sort();
  }

  isAdmin(): boolean {
    return this.userRole === 'ADMIN' || this.userRole === 'SUB_ADMIN';
  }

  getTeacherName(meeting: any): string {
    return meeting.assignedTeacher?.name || meeting.createdBy?.name || 'Unknown Teacher';
  }
}
