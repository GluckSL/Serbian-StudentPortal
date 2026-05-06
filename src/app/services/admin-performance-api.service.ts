import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AdminPerformanceRange {
  from: string;
  to: string;
}

export interface AdminPerformanceKpisStudent {
  totalPortalSecondsAllTime: number;
  totalPortalSecondsInRange: number;
  totalPortalSecondsToday: number;
  mostUsedPageInRange: { page: string; label: string; seconds: number } | null;
  overallPct: number;
  learningPct: number;
}

export interface AdminPerformanceKpisBatch {
  avgOverallPct: number;
  totalPortalSecondsAllTime: number;
  totalPortalSecondsInRange: number;
  avgTodaySecondsPerStudent: number;
  mostUsedPageInRange: { page: string; label: string; seconds: number } | null;
}

export interface AdminPerformanceSeries {
  classes: { date: string; attendedCount: number; minutesPresent: number; attendedStudentCount?: number; attendanceRatePct?: number }[];
  exercises: { date: string; completedCount: number; avgScore: number }[];
  dg: { date: string; sessionCount: number; practiceMinutes: number }[];
}

export interface AdminPerformanceStudentPayload {
  scope: 'student';
  range: AdminPerformanceRange;
  student: { _id: string; name: string; email: string; regNo?: string; batch: string };
  kpis: AdminPerformanceKpisStudent;
  series: AdminPerformanceSeries;
  tables: AdminPerformanceTablesStudent;
}

export interface AdminPerformanceBatchPayload {
  scope: 'batch';
  range: AdminPerformanceRange;
  batch: { key: string; studentCount: number; studentIds: string[] };
  kpis: AdminPerformanceKpisBatch;
  series: AdminPerformanceSeries;
  tables: AdminPerformanceTablesBatch;
}

export interface AdminPerformanceTablesStudent {
  classes: {
    topic: string;
    startTime: string;
    batch?: string;
    courseDay?: number | null;
    attended: boolean;
    durationMinutes: number | null;
    attendancePercent: number | null;
    status: string;
  }[];
  exercises: {
    exerciseTitle: string;
    exerciseId: string;
    scorePercentage: number;
    timeSpentSeconds: number;
    status: string;
    attemptedAt?: string;
    completedAt?: string | null;
  }[];
  dg: {
    moduleTitle: string;
    moduleId: string;
    score: number;
    completed: boolean;
    practiceMinutes: number;
    createdAt: string;
    completedAt: string | null;
  }[];
}

export interface AdminPerformanceTablesBatch {
  classes: {
    studentName: string;
    studentId: string;
    topic: string;
    startTime: string;
    courseDay?: number | null;
    attended: boolean;
    durationMinutes: number | null;
    attendancePercent: number | null;
    status: string;
  }[];
  exercises: {
    studentName: string;
    studentId: string;
    exerciseTitle: string;
    scorePercentage: number;
    timeSpentSeconds: number;
    status: string;
    completedAt?: string | null;
  }[];
  dg: {
    studentName: string;
    studentId: string;
    moduleTitle: string;
    score: number;
    completed: boolean;
    practiceMinutes: number;
    createdAt: string;
    completedAt: string | null;
  }[];
}

@Injectable({ providedIn: 'root' })
export class AdminPerformanceApiService {
  private readonly base = `${environment.apiUrl}/admin-performance`;

  constructor(private http: HttpClient) {}

  getStudent(studentId: string, range: AdminPerformanceRange): Observable<AdminPerformanceStudentPayload> {
    const params = new HttpParams().set('from', range.from).set('to', range.to);
    return this.http.get<AdminPerformanceStudentPayload>(`${this.base}/student/${encodeURIComponent(studentId)}`, {
      params,
      withCredentials: true
    });
  }

  getBatch(batchKey: string, range: AdminPerformanceRange): Observable<AdminPerformanceBatchPayload> {
    const params = new HttpParams().set('from', range.from).set('to', range.to);
    return this.http.get<AdminPerformanceBatchPayload>(
      `${this.base}/batch/${encodeURIComponent(batchKey)}`,
      { params, withCredentials: true }
    );
  }
}
