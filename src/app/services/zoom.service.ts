// src/app/services/zoom.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Student {
  _id: string;
  name: string;
  email: string;
  batch: string;
  level: string;
  subscription: string;
  studentStatus: string;
}

export interface ZoomMeeting {
  meetingId: string;
  zoomMeetingId: string;
  topic: string;
  startTime: Date;
  duration: number;
  joinUrl: string;
  startUrl: string;
  password: string;
  attendeesCount: number;
  attendees: Array<{ name: string; email: string }>;
}

export interface CreateMeetingRequest {
  batch: string;
  plan: string;
  topic: string;
  startTime: string;
  duration: number;
  timezone?: string;
  agenda?: string;
  studentIds: string[];
  teacherId: string;
  zoomHostEmail: string;
  courseDay?: number | null;
}

export interface ZoomAccount {
  id: string;
  email: string;
  name: string;
  isBusy?: boolean;
}

export interface Teacher {
  _id: string;
  name: string;
  email: string;
  assignedBatches: string[];
  medium: string[];
}

@Injectable({
  providedIn: 'root'
})
export class ZoomService {
  private apiUrl = `${environment.apiUrl}/zoom`;

  constructor(private http: HttpClient) {}

  /**
   * Create a Zoom meeting with selected students
   */
  createMeeting(meetingData: CreateMeetingRequest): Observable<any> {
    return this.http.post(`${this.apiUrl}/create-meeting`, meetingData, {
      withCredentials: true
    });
  }

  /**
   * Get all teachers for meeting creation
   */
  getTeachers(): Observable<any> {
    return this.http.get(`${this.apiUrl}/teachers`, { withCredentials: true });
  }

  /**
   * Get all zoom host accounts from Zoom API
   */
  getZoomHosts(): Observable<any> {
    return this.http.get(`${this.apiUrl}/external/hosts`, { withCredentials: true });
  }

  /**
   * Get available zoom hosts for a time slot (checks overlap)
   */
  getAvailableZoomHosts(startTime: string, duration: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/available-hosts`, {
      params: { startTime, duration: duration.toString() },
      withCredentials: true
    });
  }

  /**
   * Get students by batch
   */
  getStudentsByBatch(batch: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/students/${batch}`, {
      withCredentials: true
    });
  }

  /**
   * Get all students with optional filters
   */
  getAllStudents(filters?: { batch?: string; level?: string; subscription?: string }): Observable<any> {
    let url = `${this.apiUrl}/students`;
    
    if (filters) {
      const params = new URLSearchParams();
      if (filters.batch) params.append('batch', filters.batch);
      if (filters.level) params.append('level', filters.level);
      if (filters.subscription) params.append('subscription', filters.subscription);
      
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
    }

    return this.http.get(url, { withCredentials: true });
  }

  /**
   * Update meeting attendees
   */
  updateMeetingAttendees(meetingId: string, data: { addStudentIds?: string[]; removeStudentIds?: string[] }): Observable<any> {
    return this.http.put(`${this.apiUrl}/meeting/${meetingId}/attendees`, data, {
      withCredentials: true
    });
  }

  /**
   * Delete a Zoom meeting
   */
  deleteMeeting(meetingId: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/meeting/${meetingId}`, {
      withCredentials: true
    });
  }

  /**
   * Get meeting participants (for attendance)
   */
  getMeetingParticipants(zoomMeetingId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/meeting/${zoomMeetingId}/participants`, {
      withCredentials: true
    });
  }

  /**
   * Get meeting attendance report
   * @param meetingId - Database meeting ID
   */
  getAttendance(meetingId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/meeting/${meetingId}/attendance`, {
      withCredentials: true
    });
  }

  /**
   * Get detailed meeting report from Zoom
   * @param zoomMeetingId - Zoom meeting ID
   */
  getMeetingReport(zoomMeetingId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/meeting/${zoomMeetingId}/report`, {
      withCredentials: true
    });
  }

  /**
   * Get participant engagement metrics (camera/mic usage)
   * @param zoomMeetingId - Zoom meeting ID
   */
  getEngagementMetrics(zoomMeetingId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/meeting/${zoomMeetingId}/engagement`, {
      withCredentials: true
    });
  }

  /**
   * Get STUDENT engagement metrics only (excludes teachers)
   * @param zoomMeetingId - Zoom meeting ID
   */
  getStudentEngagementMetrics(zoomMeetingId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/meeting/${zoomMeetingId}/engagement/students`, {
      withCredentials: true
    });
  }

  /**
   * Get TEACHER engagement metrics only
   * @param zoomMeetingId - Zoom meeting ID
   */
  getTeacherEngagementMetrics(zoomMeetingId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/meeting/${zoomMeetingId}/engagement/teacher`, {
      withCredentials: true
    });
  }

  /**
   * Get all meetings for teacher
   */
  getAllMeetings(filters?: { status?: string; batch?: string; plan?: string; date?: string }): Observable<any> {
    let url = `${this.apiUrl}/meetings`;
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.batch) params.append('batch', filters.batch);
    if (filters?.plan) params.append('plan', filters.plan);
    if (filters?.date) params.append('date', filters.date);
    const qs = params.toString();
    if (qs) url += `?${qs}`;

    // Do not add Cache-Control / Pragma on the request — that triggers a CORS preflight
    // and allowedHeaders on the API only permits Content-Type and Authorization.
    return this.http.get(url, { withCredentials: true });
  }

  /**
   * Get meetings for logged-in student
   */
  getStudentMeetings(): Observable<any> {
    return this.http.get(`${this.apiUrl}/student-meetings`, {
      withCredentials: true
    });
  }

  /**
   * Get single meeting details
   */
  getMeetingDetails(meetingId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/meeting/${meetingId}`, {
      withCredentials: true
    });
  }

  /**
   * Update meeting details (topic, time, duration, agenda)
   */
  updateMeeting(meetingId: string, updateData: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/meeting/${meetingId}`, updateData, {
      withCredentials: true
    });
  }

  /**
   * Map a Zoom participant to a batch student
   */
  mapParticipantToStudent(meetingId: string, data: { participantName: string; participantEmail: string; studentEmail: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/meeting/${meetingId}/attendance/map-participant`, data, {
      withCredentials: true
    });
  }
}
