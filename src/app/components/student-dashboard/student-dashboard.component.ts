//student-dashboard.component.ts

import { Component, OnInit } from '@angular/core';
import { Renderer2 } from '@angular/core';
import { Inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { FeedbackService } from '../../services/feedback.service';
import { CourseProgressService } from '../../services/course-progress.service';
import { ChartOptions, ChartConfiguration, ChartType } from 'chart.js';
import { Router } from '@angular/router';
import { MeetingNotificationsComponent } from './meeting-notifications.component';

interface Student {
  _id: string;
  name: string;
  email: string;
  subscription: string;
  courseAssigned: string;
  registeredAt: string;
  feedbackStats?: {
    fluency: number;
    grammar: number;
    accent: number;
    overallCFBR: number;
  };
  courseProgress?: {
    courseName: string;
    progressPercentage: number;
    lastUpdated: string;
  }[];
}

interface FeedbackEntry {
  timestamp: string;
  studentName: string;
  studentId: string;
  summary: string;
  conversationTime: number;
  fluency: string;
  accent: string;
  grammar: string;
  overallCfbr: string;
  commonMistakes: string;
  currentLevel: string;
  suggestedImprovement: string;
}

interface CourseProgress {
  courseId: { _id: string; name: string };
  progressPercentage: number;
  lastUpdated: string;
}

@Component({
  standalone: false,
  selector: 'app-student-dashboard',
  templateUrl: './student-dashboard.component.html',
  styleUrls: ['./student-dashboard.component.css'],
})

export class StudentDashboardComponent implements OnInit {
  feedbackList: FeedbackEntry[] = [];
  feedbackLoading: boolean = false;
  feedbackError: string | null = null;
  loading: boolean = false;
  error: string | null = null;
  userProfile: any = null;
  basicUser: { name: string; email: string; level?: string; } | null = null;
  courseProgressList: CourseProgress[] = [];

  constructor(
    private renderer: Renderer2,
    private http: HttpClient,
    private feedbackService: FeedbackService,
    public authService: AuthService,
    private courseProgressService: CourseProgressService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.authService.getUserProfile().subscribe({
      next: (user) => {
        this.basicUser = user;
        this.fetchUserProfile();
      },
      error: (err) => {
        this.router.navigate(['/login']);
      }
    });
  }

  fetchUserProfile(): void {
    this.loading = true;
    this.authService.getUserProfile().subscribe({
      next: (profile) => {
        this.userProfile = profile;
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Failed to load user profile';
        this.loading = false;
      }
    });
  }

  exportToCSV(): void {
    const headers = Object.keys(this.feedbackList[0] || {}).join(',');
    const rows = this.feedbackList.map(fb => Object.values(fb).join(','));
    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'feedback.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  getProgressColor(value: number): 'primary' | 'accent' | 'warn' {
    if (value >= 75) return 'primary';
    if (value >= 40) return 'accent';
    return 'warn';
  }
}