// src/app/components/student-ai-dashboard/student-ai-dashboard.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { StudentProgressService, DashboardAnalytics } from '../../services/student-progress.service';
import { LearningModulesService } from '../../services/learning-modules.service';
import { AiTutorService } from '../../services/ai-tutor.service';
import { StudentAssignmentsComponent } from '../student-assignments/student-assignments.component';
import { StudentAssignedAssignmentsComponent } from '../student-assigned-assignments/student-assigned-assignments.component';
import { StudentNotificationsComponent } from '../student-notifications/student-notifications.component';
@Component({
  selector: 'app-student-ai-dashboard',
  standalone: true,
  imports: [CommonModule, StudentNotificationsComponent, StudentAssignmentsComponent, StudentAssignedAssignmentsComponent],
  templateUrl: './student-ai-dashboard.component.html',
  styleUrls: ['./student-ai-dashboard.component.css']
})

export class StudentAiDashboardComponent implements OnInit {
  analytics: DashboardAnalytics | null = null;
  recentModules: any[] = [];
  isLoading: boolean = true;
  currentCourseId: string | null = null;
  currentModuleId: string | null = null;
// Make Math available in template
Math = Math;

constructor(
    private studentProgressService: StudentProgressService,
    private learningModulesService: LearningModulesService,
    private aiTutorService: AiTutorService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadDashboardData();
  }

  loadDashboardData(): void {
    this.isLoading = true;

    console.log('🔄 Loading dashboard data for student...');

    // Load analytics
    this.studentProgressService.getDashboardAnalytics().subscribe({
      next: (analytics) => {
        console.log('✅ Dashboard analytics loaded:', analytics);
        this.analytics = analytics;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('❌ Error loading dashboard analytics:', error);
        console.error('❌ Error details:', {
          status: error.status,
          message: error.message,
          error: error.error
        });
        this.isLoading = false;

        // Show error message to user
        alert(`Failed to load dashboard analytics: ${error.message || 'Unknown error'}`);
      }
    });

    // Load recent modules
    this.learningModulesService.getModules({ limit: 6 }).subscribe({
      next: (response) => {
        console.log('✅ Recent modules loaded:', response);
        this.recentModules = response.modules.filter((m: any) => m.studentProgress);
      },
      error: (error) => {
        console.error('❌ Error loading recent modules:', error);
      }
    });
  }

  navigateToModules(): void {
    this.router.navigate(['/learning-modules']);
  }

  viewProgress(): void {
    this.router.navigate(['/student-progress']);
  }

  viewPerformanceHistory(): void {
    this.router.navigate(['/performance-history']);
  }

  testAudio(): void {
    this.router.navigate(['/audio-test']);
  }

  getProgressPercentage(completed: number, total: number): number {
    return this.studentProgressService.calculateCompletionPercentage(completed, total);
  }

  formatTimeSpent(minutes: number): string {
    return this.studentProgressService.formatTimeSpent(minutes);
  }

  getWeeklyActivityData(): any[] {
    if (!this.analytics?.weeklyActivity) return [];

    // Define days in proper order (starting from Monday for better UX)
    const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // Create array with proper day order and ensure all days are present
    return daysOrder.map(day => {
      const dayData = this.analytics?.weeklyActivity?.[day] || { sessions: 0, timeSpent: 0 };
      return {
        day: day,
        dayShort: day.substring(0, 3), // Mon, Tue, Wed, etc.
        sessions: dayData.sessions || 0,
        timeSpent: dayData.timeSpent || 0
      };
    });
  }

  getLevelProgressData(): any[] {
    if (!this.analytics?.progressByLevel) return [];

    return Object.entries(this.analytics.progressByLevel).map(([level, data]: [string, any]) => ({
      level,
      completed: data.completed,
      total: data.total,
      percentage: this.getProgressPercentage(data.completed, data.total)
    }));
  }

  getCategoryProgressData(): any[] {
    if (!this.analytics?.progressByCategory) return [];

    return Object.entries(this.analytics.progressByCategory).map(([category, data]: [string, any]) => ({
      category,
      completed: data.completed,
      total: data.total,
      percentage: this.getProgressPercentage(data.completed, data.total)
    }));
  }

}
