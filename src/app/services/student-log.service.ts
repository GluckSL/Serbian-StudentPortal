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

@Injectable({
    providedIn: 'root'
})

export class StudentLogService {

  private apiUrl = environment.apiUrl;  // Base API URL

    constructor(private http: HttpClient) {}

    // Fetch all student logs
    getAllStudentLogs(): Observable<{ success: boolean; data: StudentLog[] }> {
        return this.http.get<{ success: boolean; data: StudentLog[] }>(`${this.apiUrl}/studentLog/`);
    }

    // Fetch logs for a specific student
    getLogsByStudentId(studentId: string): Observable<{ success: boolean; data: StudentLog[] }> {
        return this.http.get<{ success: boolean; data: StudentLog[] }>(`${this.apiUrl}/studentLog/${studentId}`);
    }

    getStudentAnalytics(studentId: string): Observable<{ success: boolean; data: StudentAnalyticsResponse }> {
        return this.http.get<{ success: boolean; data: StudentAnalyticsResponse }>(`${this.apiUrl}/studentLog/analytics/${studentId}`);
    }

    deleteStudentLog(logId: string): Observable<{ success: boolean; message: string }> {
        return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/studentLog/${logId}`);
    }
}

