// src/app/components/student-dashboard/meeting-notifications.component.ts

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../shared/material.module';
import { Router } from '@angular/router';
import { ZoomService } from '../../services/zoom.service';

interface UpcomingMeeting {
  _id: string;
  topic: string;
  batch: string;
  startTime: Date;
  duration: number;
  teacher: {
    name: string;
    email: string;
  };
  joinUrl: string;
  canJoin: boolean;
  isOngoing: boolean;
  hasEnded: boolean;
  timeUntilStart: number;
}

@Component({
  selector: 'app-meeting-notifications',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule
  ],
  templateUrl: './meeting-notifications.component.html',
  styleUrls: ['./meeting-notifications.component.css']
})
export class MeetingNotificationsComponent implements OnInit, OnDestroy {
  upcomingMeetings: UpcomingMeeting[] = [];
  ongoingMeetings: UpcomingMeeting[] = [];
  loading = false;
  error = '';
  private refreshInterval: any;

  constructor(
    private zoomService: ZoomService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadMeetings();
    
    // Refresh every 30 seconds
    this.refreshInterval = setInterval(() => {
      this.loadMeetings();
    }, 30000);
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  loadMeetings(): void {
    this.loading = true;
    this.error = '';

    this.zoomService.getStudentMeetings().subscribe({
      next: (response) => {
        if (response.success) {
          const allMeetings = response.data;
          
          // Filter ongoing meetings
          this.ongoingMeetings = allMeetings.filter((m: UpcomingMeeting) => m.isOngoing);
          
          // Filter upcoming meetings (next 24 hours)
          const now = new Date().getTime();
          const next24Hours = now + (24 * 60 * 60 * 1000);
          
          this.upcomingMeetings = allMeetings.filter((m: UpcomingMeeting) => {
            const meetingTime = new Date(m.startTime).getTime();
            return !m.isOngoing && !m.hasEnded && meetingTime <= next24Hours;
          });
          
          // Sort by start time
          this.upcomingMeetings.sort((a, b) => 
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
          );
        } else {
          this.error = response.message || 'Failed to load meetings';
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading meetings:', err);
        this.error = 'Failed to load meetings';
        this.loading = false;
      }
    });
  }

  joinMeeting(meeting: UpcomingMeeting): void {
    if (meeting.canJoin && meeting.joinUrl) {
      window.open(meeting.joinUrl, '_blank');
    }
  }

  viewAllMeetings(): void {
    this.router.navigate(['/student/meetings']);
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatDate(date: Date): string {
    const meetingDate = new Date(date);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Check if today
    if (meetingDate.toDateString() === today.toDateString()) {
      return 'Today';
    }
    
    // Check if tomorrow
    if (meetingDate.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    }

    // Otherwise show date
    return meetingDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }

  getTimeUntilStart(meeting: UpcomingMeeting): string {
    if (meeting.timeUntilStart <= 0) {
      return 'Now';
    }

    const minutes = Math.floor(meeting.timeUntilStart / (1000 * 60));
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `in ${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `in ${minutes}m`;
    } else {
      return 'Starting soon';
    }
  }

  getTotalNotifications(): number {
    return this.ongoingMeetings.length + this.upcomingMeetings.length;
  }

  isUrgent(meeting: UpcomingMeeting): boolean {
    const minutes = Math.floor(meeting.timeUntilStart / (1000 * 60));
    return minutes <= 15; // Urgent if starting in 15 minutes or less
  }
}
