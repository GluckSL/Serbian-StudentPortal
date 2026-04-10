// services/student-log.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface StudentLog {

    _id?: string;
    action: string;
    studentId: {
        _id: string;
        name: string;
        email: string;
        regNo: string;
    };

    levelAtUpdate?: string;
    batchAtUpdate?: string;
    mediumAtUpdate?: string[];
    statusAtUpdate?: string;
    subscriptionAtUpdate?: string;
    updatedAt?: Date;

    assignedTeacherAtUpdate?: {
        _id: string;
        name: string;
        regNo: string;
    };
}

export interface StudentAnalyticsResponse {
    student: any;
    summary: {
        totalProfileUpdates: number;
        totalClasses: number;
        attendedClasses: number;
        attendanceRate: number;
        totalDigitalExerciseAttempts: number;
        completedDigitalExercises: number;
        totalModulesTracked: number;
        completedModules: number;
        totalSessions: number;
        totalAssignments: number;
    };
    lastProfileUpdate: any;
    profileUpdateHistory: any[];
    classAttendanceHistory: any[];
    digitalExerciseHistory: any[];
    moduleHistory: any[];
    sessionHistory: any[];
    marksHistory: any[];
}

export type StudentActivityType =
  | 'LOGIN'
  | 'LOGOUT'
  | 'PROFILE_UPDATE'
  | 'MEETING_ATTENDANCE'
  | 'EXERCISE_ATTEMPT'
  | 'MODULE_PROGRESS'
  | 'SESSION_RECORD'
  | 'ASSIGNMENT_SUBMISSION';

export type ActivityDeleteKind =
  | 'USER_ACTIVITY_LOG'
  | 'STUDENT_LOG'
  | 'EXERCISE_ATTEMPT'
  | 'STUDENT_PROGRESS'
  | 'SESSION_RECORD'
  | 'ASSIGNMENT_SUBMISSION'
  | 'MEETING_ATTENDANCE';

export interface ActivityDeleteRef {
  kind: ActivityDeleteKind;
  id: string;
  meetingId?: string;
}

export interface StudentActivityEvent {
  type: StudentActivityType;
  occurredAt: string | Date;
  title: string;
  details?: any;
  /** Present on aggregated feeds; omitted when scoped to one student in some responses */
  student?: { _id: string; regNo: string; name: string; batch?: string };
  /** When set, admin can delete this underlying record */
  deleteRef?: ActivityDeleteRef;
}

@Injectable({
    providedIn: 'root'
})

export class StudentLogService {

  private apiUrl = environment.apiUrl;  // Base API URL
  private readonly httpOpts = { withCredentials: true as const };

    constructor(private http: HttpClient) {}

    // Fetch all student logs
    getAllStudentLogs(): Observable<{ success: boolean; data: StudentLog[] }> {
        return this.http.get<{ success: boolean; data: StudentLog[] }>(`${this.apiUrl}/studentLog/`, this.httpOpts);
    }

    // Fetch logs for a specific student
    getLogsByStudentId(studentId: string): Observable<{ success: boolean; data: StudentLog[] }> {
        return this.http.get<{ success: boolean; data: StudentLog[] }>(`${this.apiUrl}/studentLog/${studentId}`, this.httpOpts);
    }

    getStudentAnalytics(studentId: string): Observable<{ success: boolean; data: StudentAnalyticsResponse }> {
        return this.http.get<{ success: boolean; data: StudentAnalyticsResponse }>(`${this.apiUrl}/studentLog/analytics/${studentId}`, this.httpOpts);
    }

    getStudentOptions(): Observable<{ success: boolean; data: { _id: string; name: string; regNo: string }[] }> {
        return this.http.get<{ success: boolean; data: { _id: string; name: string; regNo: string }[] }>(
          `${this.apiUrl}/studentLog/student-options`,
          this.httpOpts
        );
    }

    getStudentActivityTimeline(
      studentId: string,
      params?: { types?: StudentActivityType[]; from?: string; to?: string; limit?: number; batch?: string }
    ): Observable<{ success: boolean; data: StudentActivityEvent[] }> {
      const q: Record<string, string | number> = {};
      if (params?.types?.length) q['types'] = params.types.join(',');
      if (params?.from) q['from'] = params.from;
      if (params?.to) q['to'] = params.to;
      if (params?.limit) q['limit'] = params.limit;
      if (params?.batch) q['batch'] = params.batch;
      return this.http.get<{ success: boolean; data: StudentActivityEvent[] }>(`${this.apiUrl}/studentLog/activity/${studentId}`, {
        params: q,
        ...this.httpOpts
      });
    }

    getActivityFeed(params?: { types?: StudentActivityType[]; from?: string; to?: string; limit?: number; batch?: string }): Observable<{ success: boolean; data: StudentActivityEvent[] }> {
      const q: Record<string, string | number> = {};
      if (params?.types?.length) q['types'] = params.types.join(',');
      if (params?.from) q['from'] = params.from;
      if (params?.to) q['to'] = params.to;
      if (params?.limit) q['limit'] = params.limit;
      if (params?.batch) q['batch'] = params.batch;
      return this.http.get<{ success: boolean; data: StudentActivityEvent[] }>(`${this.apiUrl}/studentLog/activity-feed`, {
        params: q,
        ...this.httpOpts
      });
    }

    getBatchOptions(): Observable<{ success: boolean; data: string[] }> {
      return this.http.get<{ success: boolean; data: string[] }>(`${this.apiUrl}/studentLog/batch-options`, this.httpOpts);
    }

    searchStudents(q: string, limit = 20): Observable<{ success: boolean; data: { _id: string; name: string; regNo: string; batch?: string; email?: string }[] }> {
      return this.http.get<{ success: boolean; data: { _id: string; name: string; regNo: string; batch?: string; email?: string }[] }>(
        `${this.apiUrl}/studentLog/student-search`,
        { params: { q, limit }, ...this.httpOpts }
      );
    }

    bulkDeleteActivity(items: { kind: ActivityDeleteKind; id: string; meetingId?: string }[]): Observable<{
      success: boolean;
      message: string;
      results: { kind: string; id: string; ok: boolean; error?: string }[];
    }> {
      return this.http.post<{
        success: boolean;
        message: string;
        results: { kind: string; id: string; ok: boolean; error?: string }[];
      }>(`${this.apiUrl}/studentLog/bulk-delete-activity`, { items }, this.httpOpts);
    }

    deleteStudentLog(logId: string): Observable<{ success: boolean; message: string }> {
        return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/studentLog/${logId}`, this.httpOpts);
    }
}

