// src/app/components/meeting-link/meeting-details.component.ts

import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';
import { NotificationService } from '../../services/notification.service';
import { JoinClassFlowService } from '../../services/join-class-flow.service';
import { MeetingRemindDialogComponent } from './meeting-remind-dialog.component';

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
    private zoomService: ZoomService,
    private notify: NotificationService,
    private joinClassFlow: JoinClassFlowService,
    private dialog: MatDialog,
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
    if (!this.meeting) return;
    this.joinClassFlow.openJoin(this.meeting, (msg) => this.notify.error(msg));
  }

  openRemindDialog(): void {
    if (!this.meeting?.isOngoing) return;
    const ref = this.dialog.open(MeetingRemindDialogComponent, {
      data: { meetingId: this.meetingId, topic: this.meeting.topic },
      width: '480px',
      maxWidth: '98vw',
    });
    ref.afterClosed().subscribe((result) => {
      if (result?.sent) {
        const n = result.sent;
        this.notify.success(`Reminder email sent to ${n} student${n !== 1 ? 's' : ''}.`);
      }
    });
  }

  copyJoinUrl(): void {
    if (this.meeting?.joinUrl) {
      navigator.clipboard.writeText(this.meeting.joinUrl).then(() => {
        this.notify.success('Join URL copied to clipboard!');
      });
    }
  }

  copyMeetingId(): void {
    if (this.meeting?.zoomMeetingId) {
      navigator.clipboard.writeText(this.meeting.zoomMeetingId).then(() => {
        this.notify.success('Meeting ID copied to clipboard!');
      });
    }
  }

  copyPassword(): void {
    if (this.meeting?.zoomPassword) {
      navigator.clipboard.writeText(this.meeting.zoomPassword).then(() => {
        this.notify.success('Password copied to clipboard!');
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
    this.notify.confirm('Delete Meeting', 'Are you sure you want to delete this meeting?', 'Yes, Delete', 'Cancel').subscribe(ok => {
      if (!ok) return;
      this.zoomService.deleteMeeting(this.meetingId).subscribe({
        next: (response) => {
          if (response.success) {
            this.notify.success('Meeting deleted successfully');
            this.router.navigate(['/teacher/meetings']);
          }
        },
        error: (err) => {
          console.error('Error deleting meeting:', err);
          this.notify.error('Failed to delete meeting');
        }
      });
    });
  }

  goBack(): void {
    this.router.navigate(['/teacher/meetings']);
  }

  formatDate(date: string | Date): string {
    return new Date(date).toLocaleString('sr-Latn-RS', {
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
