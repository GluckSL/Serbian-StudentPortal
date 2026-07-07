// src/app/services/zoom.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface Student {
  _id: string;
  name: string;
  email: string;
  batch: string;
  level: string;
  subscription: string;
  studentStatus: string;
  isTestAccount?: boolean;
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
  startTimes?: string[];
  scheduleMode?: 'single' | 'selected_dates' | 'weekly' | 'monthly';
  duration: number;
  timezone?: string;
  agenda?: string;
  studentIds: string[];
  teacherId: string;
  zoomHostEmail: string;
  courseDay?: number | null;
  courseDaysByStart?: Record<string, number | null>;
}

export interface ZoomHostConflict {
  meetingId: string;
  topic: string;
  startTime: string;
  duration: number;
  batch?: string;
}

export interface ZoomAccount {
  id: string;
  email: string;
  name: string;
  isBusy?: boolean;
  conflicts?: ZoomHostConflict[];
}

export interface StudentConflictEntry {
  studentId: string;
  name: string;
  email: string;
}

export interface StudentConflict {
  conflictingBatch: string;
  conflictingTopic: string;
  clashingStudents: StudentConflictEntry[];
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
  private readonly studentMeetingsCacheTtlMs = 45_000;
  private readonly studentMeetingsCache = new Map<string, { timestamp: number; request$: Observable<any> }>();

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  /**
   * Create a Zoom meeting with selected students
   */
  createMeeting(meetingData: CreateMeetingRequest): Observable<any> {
    return this.http.post(`${this.apiUrl}/create-meeting`, meetingData, {
      withCredentials: true
    });
  }

  /** Server-side journey preview + conflict strings (no Zoom). */
  previewBulkJourneyMeetings(body: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.apiUrl}/preview-bulk-journey-meetings`, body, {
      withCredentials: true
    });
  }

  /** Remove specific students from all future scheduled meetings of the given batch. */
  removeStudentsFromBatch(batchName: string, studentIds: string[]): Observable<any> {
    return this.http.post(`${this.apiUrl}/meetings/remove-students-from-batch`, { batchName, studentIds }, {
      withCredentials: true
    });
  }

  /** One chunk of bulk journey creates (max 25 slots per request). */
  createBulkJourneyMeetingsChunk(body: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.apiUrl}/create-bulk-journey-meetings`, body, {
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
  getAvailableZoomHosts(
    startTime: string,
    duration: number,
    startTimes?: string[]
  ): Observable<any> {
    const params: Record<string, string> = {
      startTime,
      duration: duration.toString()
    };
    if (startTimes && startTimes.length > 1) {
      params['startTimes'] = JSON.stringify(startTimes);
    }
    return this.http.get(`${this.apiUrl}/available-hosts`, {
      params,
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
   * Bulk update scheduled meetings (metadata + attendees).
   */
  bulkUpdateMeetings(payload: {
    meetingIds: string[];
    updates?: {
      duration?: number;
      topic?: string;
      agenda?: string;
      courseDay?: number | null;
      assignedTeacher?: string;
      startTime?: string;
      /** HH:mm (IST) — applies new wall-clock time on each meeting's existing date */
      startClockTime?: string;
    };
    attendeeUpdates?: {
      addStudentIds?: string[];
      removeStudentIds?: string[];
    };
  }): Observable<any> {
    return this.http.post(`${this.apiUrl}/meetings/bulk-update`, payload, {
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
   * Recreate a broken Zoom meeting (error 3,001 / invalid link).
   * Creates a fresh Zoom meeting on Zoom's servers and updates the portal record.
   */
  recreateMeeting(meetingId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/meeting/${meetingId}/recreate-zoom`, {}, {
      withCredentials: true
    });
  }

  /**
   * Sync all upcoming scheduled portal meetings to Zoom (topic, IST time, host, recording).
   */
  syncScheduledMeetingsToZoom(payload: {
    batch?: string;
    limit?: number;
    forceRecreate?: boolean;
  } = {}): Observable<any> {
    return this.http.post(`${this.apiUrl}/meetings/sync-scheduled-to-zoom`, payload, {
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
  getAttendance(meetingId: string, forceRefresh: boolean = false): Observable<any> {
    const refreshParam = forceRefresh ? `?refreshTs=${Date.now()}` : '';
    return this.http.get(`${this.apiUrl}/meeting/${meetingId}/attendance${refreshParam}`, {
      withCredentials: true
    });
  }

  refetchAttendance(meetingId: string): Observable<any> {
    return this.getAttendance(meetingId, true);
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
  getAllMeetings(filters?: {
    status?: string;
    batch?: string;
    plan?: string;
    date?: string;
    page?: number;
    limit?: number;
    completed?: boolean;
    search?: string;
    teacherName?: string;
    datePreset?: string;
    dateFrom?: string;
    dateTo?: string;
    /** scheduled | ongoing | ended — server filters entire collection before pagination */
    lifecycle?: string;
    includeTabCounts?: boolean;
    /** asc = soonest start first (teacher My Classes); desc = latest first */
    sort?: 'asc' | 'desc' | 'start_asc' | 'start_desc';
  }): Observable<any> {
    let url = `${this.apiUrl}/meetings`;
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.batch) params.append('batch', filters.batch);
    if (filters?.plan) params.append('plan', filters.plan);
    if (filters?.date) params.append('date', filters.date);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.completed !== undefined) params.append('completed', String(filters.completed));
    if (filters?.search) params.append('search', filters.search);
    if (filters?.teacherName) params.append('teacherName', filters.teacherName);
    if (filters?.datePreset) params.append('datePreset', filters.datePreset);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.lifecycle) params.append('lifecycle', filters.lifecycle);
    if (filters?.includeTabCounts) params.append('includeTabCounts', 'true');
    if (filters?.sort) params.append('sort', filters.sort);
    const qs = params.toString();
    if (qs) url += `?${qs}`;

    // Do not add Cache-Control / Pragma on the request — that triggers a CORS preflight
    // and allowedHeaders on the API only permits Content-Type and Authorization.
    return this.http.get(url, { withCredentials: true });
  }

  /**
   * Get meetings for logged-in student.
   * Pass tab + page + limit for paginated My Course tabs (7 per page).
   */
  getStudentMeetings(filters?: {
    tab?: 'upcoming' | 'live' | 'attempted';
    page?: number;
    limit?: number;
    includeTabCounts?: boolean;
  }): Observable<any> {
    const params = new URLSearchParams();
    if (filters?.tab) params.append('tab', filters.tab);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.includeTabCounts) params.append('includeTabCounts', 'true');
    const qs = params.toString();
    const url = qs ? `${this.apiUrl}/student-meetings?${qs}` : `${this.apiUrl}/student-meetings`;
    const user = this.authService.getSnapshotUser();
    const userCacheKey = String(user?._id || user?.id || user?.email || 'anonymous');
    const cacheKey = `${userCacheKey}|${qs || '__all__'}`;
    const now = Date.now();
    const cached = this.studentMeetingsCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.studentMeetingsCacheTtlMs) {
      return cached.request$;
    }
    const request$ = this.http.get(url, { withCredentials: true }).pipe(
      tap({ error: () => this.studentMeetingsCache.delete(cacheKey) }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.studentMeetingsCache.set(cacheKey, { timestamp: now, request$ });
    return request$;
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

  manualMarkAttendance(meetingId: string, data: { studentId?: string; studentEmail?: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/meeting/${meetingId}/attendance/manual-mark`, data, {
      withCredentials: true
    });
  }

  manualMarkAllAttendance(meetingId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/meeting/${meetingId}/attendance/manual-mark-all`, {}, {
      withCredentials: true
    });
  }

  addParticipantToEndedMeeting(meetingId: string, studentId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/meeting/${meetingId}/attendance/add-participant`, { studentId }, {
      withCredentials: true
    });
  }

  removeParticipantFromEndedMeeting(meetingId: string, studentId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/meeting/${meetingId}/attendance/remove-participant`, { studentId }, {
      withCredentials: true
    });
  }

  /** Completed-class attendance dashboard — per-student attended X/Y and average %. */
  getAttendanceDashboard(filters?: {
    search?: string;
    teacherName?: string;
    batch?: string;
    datePreset?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
    studentSearch?: string;
    studentId?: string;
    scoreFilter?: string;
    level?: string;
    studentStatus?: string;
  }): Observable<any> {
    const params = new URLSearchParams();
    if (filters?.search) params.append('search', filters.search);
    if (filters?.teacherName) params.append('teacherName', filters.teacherName);
    if (filters?.batch) params.append('batch', filters.batch);
    if (filters?.datePreset) params.append('datePreset', filters.datePreset);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.studentSearch) params.append('studentSearch', filters.studentSearch);
    if (filters?.studentId) params.append('studentId', filters.studentId);
    if (filters?.scoreFilter && filters.scoreFilter !== 'all') {
      params.append('scoreFilter', filters.scoreFilter);
    }
    if (filters?.level) params.append('level', filters.level);
    if (filters?.studentStatus) params.append('studentStatus', filters.studentStatus);
    const qs = params.toString();
    const url = qs ? `${this.apiUrl}/attendance-dashboard?${qs}` : `${this.apiUrl}/attendance-dashboard`;
    return this.http.get(url, { withCredentials: true });
  }

  /** Join status for live class reminder modal (ongoing meetings). */
  getJoinReminderPreview(meetingId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/meeting/${meetingId}/join-reminder-preview`, {
      withCredentials: true,
    });
  }

  /** Send live join reminder emails to selected students. */
  sendJoinReminder(meetingId: string, studentIds: string[]): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/meeting/${meetingId}/send-join-reminder`,
      { studentIds },
      { withCredentials: true },
    );
  }

  /** Students who clicked Join from portal but are still marked Absent. */
  getPortalJoinAbsentStudents(days = 30): Observable<any> {
    return this.http.get(`${this.apiUrl}/portal-join-absent`, {
      params: { days: String(days) },
      withCredentials: true,
    });
  }
}
