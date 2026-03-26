// src/app/components/meeting-link/meetings-list.component.ts

import { Component, OnInit } from '@angular/core';
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
export class MeetingsListComponent implements OnInit {
  meetings: any[] = [];
  filteredMeetings: any[] = [];
  loading: boolean = true;
  error: string = '';
  userRole: string = ''; // Track user role

  // Filters
  statusFilter: string = 'all';
  batchFilter: string = 'all';
  searchQuery: string = '';

  constructor(
    private router: Router,
    private zoomService: ZoomService
  ) {}

  ngOnInit(): void {
    this.loadMeetings();
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
      // Status filter
      if (this.statusFilter !== 'all' && meeting.status !== this.statusFilter) {
        return false;
      }

      // Batch filter
      if (this.batchFilter !== 'all' && meeting.batch !== this.batchFilter) {
        return false;
      }

      // Search query
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

  formatDate(date: string | Date): string {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
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
    return this.userRole === 'ADMIN';
  }

  getTeacherName(meeting: any): string {
    return meeting.createdBy?.name || 'Unknown Teacher';
  }
}
