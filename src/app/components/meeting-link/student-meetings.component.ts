// src/app/components/meeting-link/student-meetings.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';

interface StudentMeeting {
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
  password: string;
  status: string;
  currentStatus: string;
  canJoin: boolean;
  isOngoing: boolean;
  hasEnded: boolean;
  timeUntilStart: number;
  agenda?: string;
}

@Component({
  selector: 'app-student-meetings',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule
  ],
  templateUrl: './student-meetings.component.html',
  styleUrls: ['./student-meetings.component.css']
})
export class StudentMeetingsComponent implements OnInit {
  allMeetings: StudentMeeting[] = [];
  upcomingMeetings: StudentMeeting[] = [];
  ongoingMeetings: StudentMeeting[] = [];
  pastMeetings: StudentMeeting[] = [];
  
  loading = false;
  error = '';

  constructor(private zoomService: ZoomService) {}

  ngOnInit(): void {
    this.loadMeetings();
    
    // Refresh every minute to update meeting status
    setInterval(() => {
      this.loadMeetings();
    }, 60000);
  }

  loadMeetings(): void {
    this.loading = true;
    this.error = '';

    this.zoomService.getStudentMeetings().subscribe({
      next: (response) => {
        if (response.success) {
          this.allMeetings = response.data;
          this.categorizeMeetings();
        } else {
          this.error = response.message || 'Failed to load meetings';
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading meetings:', err);
        this.error = 'Failed to load your meetings';
        this.loading = false;
      }
    });
  }

  categorizeMeetings(): void {
    this.ongoingMeetings = this.allMeetings.filter(m => m.isOngoing);
    this.upcomingMeetings = this.allMeetings.filter(m => !m.isOngoing && !m.hasEnded);
    this.pastMeetings = this.allMeetings.filter(m => m.hasEnded);
  }

  joinMeeting(meeting: StudentMeeting): void {
    if (meeting.canJoin && meeting.joinUrl) {
      window.open(meeting.joinUrl, '_blank');
    }
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-US', {
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

  getTimeUntilStart(meeting: StudentMeeting): string {
    if (meeting.timeUntilStart <= 0) {
      return 'Now';
    }

    const minutes = Math.floor(meeting.timeUntilStart / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `in ${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      return `in ${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (minutes > 0) {
      return `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      return 'Starting soon';
    }
  }

  getStatusColor(meeting: StudentMeeting): string {
    if (meeting.isOngoing) return 'ongoing';
    if (meeting.hasEnded) return 'ended';
    if (meeting.canJoin) return 'ready';
    return 'upcoming';
  }

  getStatusText(meeting: StudentMeeting): string {
    if (meeting.isOngoing) return 'Ongoing';
    if (meeting.hasEnded) return 'Ended';
    if (meeting.canJoin) return 'Ready to Join';
    return 'Upcoming';
  }

  copyMeetingInfo(meeting: StudentMeeting): void {
    const info = `
Meeting: ${meeting.topic}
Date: ${this.formatDate(meeting.startTime)}
Time: ${this.formatTime(meeting.startTime)}
Duration: ${this.formatDuration(meeting.duration)}
Join URL: ${meeting.joinUrl}
Password: ${meeting.password}
    `.trim();

    navigator.clipboard.writeText(info).then(() => {
      alert('Meeting information copied to clipboard!');
    });
  }
}
