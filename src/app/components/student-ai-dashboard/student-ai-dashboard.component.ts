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
  journeyData: any = null;
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

    // Load analytics
    this.studentProgressService.getDashboardAnalytics().subscribe({
      next: (analytics) => {
        this.analytics = analytics;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('❌ Error loading dashboard analytics:', error);
        this.isLoading = false;
      }
    });

    // Load journey data for overall progress bar
    this.studentProgressService.getStudentJourney().subscribe({
      next: (res) => { this.journeyData = res; },
      error: () => {}
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

  // Journey progress getters
  get jLevelProgression() { return this.journeyData?.levelProgression || []; }
  get jDocuments() { return this.journeyData?.documents || []; }
  get jPayments() {
    const p = this.journeyData?.payments || {};
    return { totalAmount: p.totalAmount || 0, paidAmount: p.paidAmount || 0 };
  }
  get jVisa() { return this.journeyData?.visa || { steps: [], currentStep: 0 }; }

  get jDocsSubmitted(): number { return this.jDocuments.filter((d: any) => d.status === 'verified').length; }

  get jLearningPct(): number {
    const lp = this.jLevelProgression;
    const completed = lp.filter((l: any) => l.status === 'completed').length;
    return lp.length ? Math.round((completed / lp.length) * 100) : 0;
  }
  get jDocsPct(): number {
    return this.jDocuments.length ? Math.round((this.jDocsSubmitted / this.jDocuments.length) * 100) : 0;
  }
  get jPayPct(): number {
    return this.jPayments.totalAmount ? Math.round((this.jPayments.paidAmount / this.jPayments.totalAmount) * 100) : 0;
  }
  get jVisaPct(): number {
    return this.jVisa.steps.length > 1 ? Math.round((this.jVisa.currentStep / (this.jVisa.steps.length - 1)) * 100) : 0;
  }
  get jOverallPct(): number {
    const lp = this.jLevelProgression;
    const completed = lp.filter((l: any) => l.status === 'completed').length;
    const learningPct = lp.length ? completed / lp.length : 0;
    const docsPct = this.jDocuments.length ? this.jDocsSubmitted / this.jDocuments.length : 0;
    const payPct = this.jPayments.totalAmount ? this.jPayments.paidAmount / this.jPayments.totalAmount : 0;
    const visaPct = this.jVisa.steps.length > 1 ? this.jVisa.currentStep / (this.jVisa.steps.length - 1) : 0;
    return Math.round((learningPct * 0.4 + docsPct * 0.2 + payPct * 0.2 + visaPct * 0.2) * 100);
  }

}
