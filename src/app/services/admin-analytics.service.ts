// src/app/services/admin-analytics.service.ts
// Admin Analytics Service for Student Usage and Teacher Performance

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { NotificationService } from './notification.service';

export interface ModuleUsageData {
  _id: any;
  totalSessions: number;
  totalTimeSpent: number;
  completedSessions: number;
  averageScore: number;
  uniqueStudentCount: number;
  totalVocabularyLearned: number;
  completionRate: number;
  averageTimePerSession: number;
  averageTimePerStudent: number;
  sessions: SessionDetail[];
}

export interface SessionDetail {
  sessionId: string;
  studentName: string;
  studentBatch: string;
  studentLevel: string;
  moduleName: string;
  moduleLevel: string;
  timeSpent: number;
  score: number;
  completionStatus: string;
  date: Date;
}

export interface TeacherPerformance {
  _id: {
    teacherId: string;
    teacherName: string;
    teacherEmail: string;
  };
  totalTimeSpent: number;
  totalSessions: number;
  totalCompletedSessions: number;
  averageScore: number;
  totalStudents: number;
  overallCompletionRate: number;
  averageTimePerStudent: number;
  modulePerformance: ModulePerformanceDetail[];
}

export interface ModulePerformanceDetail {
  moduleId: string;
  moduleName: string;
  moduleLevel: string;
  batch: string;
  timeSpent: number;
  sessions: number;
  completedSessions: number;
  completionRate: number;
  averageScore: number;
  studentCount: number;
  averageTimePerStudent: number;
  studentDetails: StudentDetail[];
}

export interface StudentDetail {
  studentId: string;
  studentName: string;
  studentLevel: string;
  studentBatch: string;
}

export interface BatchStats {
  _id: string; // batch name
  totalTimeSpent: number;
  totalSessions: number;
  totalStudents: number;
  teachers: TeacherBatchDetail[];
}

export interface TeacherBatchDetail {
  teacherId: string;
  teacherName: string;
  timeSpent: number;
  sessions: number;
  studentCount: number;
}

export interface DetailedUsage {
  sessionId: string;
  studentName: string;
  studentEmail: string;
  studentBatch: string;
  studentLevel: string;
  teacherName: string;
  teacherEmail: string;
  moduleName: string;
  moduleLevel: string;
  moduleCategory: string;
  sessionType: string;
  sessionState: string;
  durationMinutes: number;
  summary: any;
  messages: any[]; // NEW: Include conversation messages
  createdAt: Date;
  startTime: Date;
  endTime: Date;
}

@Injectable({
  providedIn: 'root'
})
export class AdminAnalyticsService {
  private apiUrl = `${environment.apiUrl}/admin-analytics`;

  constructor(private http: HttpClient, private notify: NotificationService) {}

  // Get module usage analytics
  getModuleUsage(filters: {
    moduleId?: string;
    teacherId?: string;
    batch?: string;
    level?: string;
    dateFrom?: string;
    dateTo?: string;
    studentName?: string; // NEW: Student name search
    groupBy?: 'module' | 'teacher' | 'batch' | 'student';
  } = {}): Observable<{
    success: boolean;
    data: ModuleUsageData[];
    summary: any;
    filters: any;
  }> {
    let params = new HttpParams();
    
    Object.keys(filters).forEach(key => {
      const value = (filters as any)[key];
      if (value) {
        params = params.set(key, value);
      }
    });

    return this.http.get<{
      success: boolean;
      data: ModuleUsageData[];
      summary: any;
      filters: any;
    }>(`${this.apiUrl}/module-usage`, { params, withCredentials: true });
  }

  // Get teacher performance analytics
  getTeacherPerformance(filters: {
    teacherId?: string;
    batch?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}): Observable<{
    success: boolean;
    teacherPerformance: TeacherPerformance[];
    batchStats: BatchStats[];
    summary: any;
  }> {
    let params = new HttpParams();
    
    Object.keys(filters).forEach(key => {
      const value = (filters as any)[key];
      if (value) {
        params = params.set(key, value);
      }
    });

    return this.http.get<{
      success: boolean;
      teacherPerformance: TeacherPerformance[];
      batchStats: BatchStats[];
      summary: any;
    }>(`${this.apiUrl}/teacher-performance`, { params, withCredentials: true });
  }

  // Get detailed student module usage
  getStudentModuleDetails(filters: {
    moduleId?: string;
    studentId?: string;
    teacherId?: string;
    batch?: string;
  } = {}): Observable<{
    success: boolean;
    detailedUsage: DetailedUsage[];
    summary: any;
    totalRecords: number;
  }> {
    let params = new HttpParams();
    
    Object.keys(filters).forEach(key => {
      const value = (filters as any)[key];
      if (value) {
        params = params.set(key, value);
      }
    });

    return this.http.get<{
      success: boolean;
      detailedUsage: DetailedUsage[];
      summary: any;
      totalRecords: number;
    }>(`${this.apiUrl}/student-module-details`, { params, withCredentials: true });
  }

  // Get detailed teacher module usage
  getTeacherModuleDetails(filters: {
    moduleId?: string;
    teacherId?: string;
    batch?: string;
  } = {}): Observable<{
    success: boolean;
    detailedUsage: DetailedUsage[];
    summary: any;
    totalRecords: number;
  }> {
    let params = new HttpParams();
    
    Object.keys(filters).forEach(key => {
      const value = (filters as any)[key];
      if (value) {
        params = params.set(key, value);
      }
    });

    return this.http.get<{
      success: boolean;
      detailedUsage: DetailedUsage[];
      summary: any;
      totalRecords: number;
    }>(`${this.apiUrl}/teacher-module-details`, { params, withCredentials: true });
  }

  // Get teacher's own usage (when teacher uses AI bot as student)
  getTeacherOwnUsage(filters: {
    teacherEmail?: string;
    moduleId?: string;
  } = {}): Observable<{
    success: boolean;
    detailedUsage: DetailedUsage[];
    summary: any;
    totalRecords: number;
  }> {
    let params = new HttpParams();
    
    Object.keys(filters).forEach(key => {
      const value = (filters as any)[key];
      if (value) {
        params = params.set(key, value);
      }
    });

    return this.http.get<{
      success: boolean;
      detailedUsage: DetailedUsage[];
      summary: any;
      totalRecords: number;
    }>(`${this.apiUrl}/teacher-own-usage`, { params, withCredentials: true });
  }

  // Utility methods for formatting
  formatTimeSpent(minutes: number): string {
    // Handle invalid values
    if (minutes === null || minutes === undefined || isNaN(minutes)) {
      return '0m';
    }
    
    // Round to nearest integer
    minutes = Math.round(minutes);
    
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('sr-Latn-RS', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  formatDateTime(date: Date | string): string {
    return new Date(date).toLocaleString('sr-Latn-RS', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getCompletionRateColor(rate: number): string {
    if (rate >= 80) return 'text-success';
    if (rate >= 60) return 'text-warning';
    return 'text-danger';
  }

  getScoreColor(score: number): string {
    if (score >= 80) return 'text-success';
    if (score >= 60) return 'text-warning';
    return 'text-danger';
  }

  exportToCSV(data: any[], filename: string): void {
    if (!data || data.length === 0) {
      this.notify.warning('No data to export');
      return;
    }

    // Get headers from first object
    const headers = Object.keys(data[0]);
    
    // Create CSV content
    const csvContent = [
      headers.join(','),
      ...data.map(row => 
        headers.map(header => {
          const value = row[header];
          // Handle nested objects and arrays
          if (typeof value === 'object' && value !== null) {
            return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
          }
          return `"${String(value).replace(/"/g, '""')}"`;
        }).join(',')
      )
    ].join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Get filter options (batches, levels)
  getFilterOptions(): Observable<{
    success: boolean;
    batches: string[];
    levels: string[];
  }> {
    return this.http.get<{
      success: boolean;
      batches: string[];
      levels: string[];
    }>(`${this.apiUrl}/filter-options`, { withCredentials: true });
  }
}