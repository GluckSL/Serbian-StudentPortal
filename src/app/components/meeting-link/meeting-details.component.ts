// src/app/components/meeting-link/meeting-details.component.ts

import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';

@Component({
  selector: 'app-meeting-details',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule
  ],
  templateUrl: './meeting-details.component.html',
  styleUrls: ['./meeting-details.component.css']
})
export class MeetingDetailsComponent implements OnInit {
  meetingId: string = '';
  meeting: any = null;
  loading: boolean = true;
  error: string = '';
  
  // Table columns
  attendeeColumns: string[] = ['name', 'email', 'batch', 'level', 'status'];
  attendanceColumns: string[] = ['name', 'email', 'status', 'joinTime', 'duration'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private zoomService: ZoomService
  ) {}

  ngOnInit(): void {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    if (this.meetingId) {
      this.loadMeetingDetails();
    }
  }

  loadMeetingDetails(): void {
    this.loading = true;
    this.error = '';

    this.zoomService.getMeetingDetails(this.meetingId).subscribe({
      next: (response) => {
        if (response.success) {
          this.meeting = response.data;
          console.log('Meeting details loaded:', this.meeting);
        } else {
          this.error = response.message || 'Failed to load meeting details';
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading meeting details:', err);
        this.error = err.error?.message || 'Failed to load meeting details';
        this.loading = false;
      }
    });
  }

  joinMeeting(): void {
    // Use joinUrl instead of startUrl to avoid "meeting already in progress" conflict
    // when the Zoom desktop app is logged into a different host account
    const url = this.meeting?.joinUrl || this.meeting?.startUrl;
    if (url) {
      window.open(url, '_blank');
    }
  }

  copyJoinUrl(): void {
    if (this.meeting?.joinUrl) {
      navigator.clipboard.writeText(this.meeting.joinUrl).then(() => {
        alert('Join URL copied to clipboard!');
      });
    }
  }

  copyMeetingId(): void {
    if (this.meeting?.zoomMeetingId) {
      navigator.clipboard.writeText(this.meeting.zoomMeetingId).then(() => {
        alert('Meeting ID copied to clipboard!');
      });
    }
  }

  copyPassword(): void {
    if (this.meeting?.zoomPassword) {
      navigator.clipboard.writeText(this.meeting.zoomPassword).then(() => {
        alert('Password copied to clipboard!');
      });
    }
  }

  viewAttendance(): void {
    this.router.navigate(['/teacher/meetings', this.meetingId, 'attendance']);
  }

  viewEngagement(): void {
    this.router.navigate(['/teacher/meetings', this.meetingId, 'engagement']);
  }

  editMeeting(): void {
    this.router.navigate(['/teacher/meetings', this.meetingId, 'edit']);
  }

  deleteMeeting(): void {
    if (confirm('Are you sure you want to delete this meeting?')) {
      this.zoomService.deleteMeeting(this.meetingId).subscribe({
        next: (response) => {
          if (response.success) {
            alert('Meeting deleted successfully');
            this.router.navigate(['/teacher/meetings']);
          }
        },
        error: (err) => {
          console.error('Error deleting meeting:', err);
          alert('Failed to delete meeting');
        }
      });
    }
  }

  goBack(): void {
    this.router.navigate(['/teacher/meetings']);
  }

  formatDate(date: string | Date): string {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
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
    return `${mins} minutes`;
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'scheduled':
        return 'primary';
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

  getAttendanceStatus(attended: boolean): string {
    return attended ? 'Attended' : 'Absent';
  }

  getAttendanceColor(attended: boolean): string {
    return attended ? 'primary' : 'warn';
  }

  formatTime(dateString: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatMinutes(seconds: number): string {
    if (!seconds) return '0 min';
    const minutes = Math.round(seconds / 60);
    return `${minutes} min`;
  }
}
