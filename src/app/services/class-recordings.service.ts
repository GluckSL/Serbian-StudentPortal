import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ClassRecording {
  _id: string;
  title: string;
  description: string;
  videoUrl: string;
  batches: string[];
  level: string;
  plan: string;
  uploadedBy: { _id: string; name: string };
  active: boolean;
  createdAt: string;
}

export interface AdminClassRecording extends ClassRecording {
  recordingType?: 'MANUAL' | 'ZOOM';
  source?: 'MANUAL_UPLOAD' | 'ZOOM_AUTO';
  status?: 'ready' | 'processing' | 'failed' | 'missing';
  duration?: number | null;
  classDate?: string;
  classDuration?: number | null;
  meetingLinkId?: string | null;
  zoomMeetingId?: string | null;
  assignedTeacherId?: string | null;
  r2Key?: string | null;
  isPublished?: boolean;
  publishedAt?: string | null;
}

export interface ZoomWebhookAuditRow {
  _id: string;
  eventType: string;
  meetingId: string | null;
  meetingUuid: string | null;
  status: string;
  recordingFilesCount: number;
  selectedRecordingType: string | null;
  hasDownloadUrl: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface ZoomRecordingResponse {
  success: boolean;
  signedUrl: string;
  duration: number | null;
  createdAt: string;
  isPublished?: boolean;
  r2Key: string;
}

export interface ZoomRecordingStatusResponse {
  success: boolean;
  status: 'processing' | 'ready' | 'failed';
  duration: number | null;
  createdAt: string;
}

/** Shape of each item returned by GET /zoom/my-batch */
export interface BatchZoomRecording {
  meetingLinkId: string;
  r2Key: string;
  duration: number | null;
  createdAt: string;
  isPublished?: boolean;
  topic: string;
  batch: string;
  teacherName?: string;
  attempted?: boolean;
  attendanceStatus?: 'Attended' | 'Not Attended' | 'Not Attempted' | 'Pending';
  classDate: string;
  meetingDuration: number | null;
}

@Injectable({ providedIn: 'root' })
export class ClassRecordingsService {
  private url = `${environment.apiUrl}/class-recordings`;

  constructor(private http: HttpClient) {}

  getRecordings(): Observable<{ success: boolean; recordings: ClassRecording[] }> {
    return this.http.get<any>(this.url, { withCredentials: true });
  }

  getAdminAllRecordings(): Observable<{ success: boolean; recordings: AdminClassRecording[] }> {
    return this.http.get<any>(`${this.url}/admin/all`, { withCredentials: true });
  }

  runZoomBackfill(payload: {
    batch?: string | null;
    limit?: number;
    includeFailed?: boolean;
    force?: boolean;
  }): Observable<any> {
    return this.http.post<any>(`${this.url}/zoom/backfill`, payload || {}, { withCredentials: true });
  }

  getZoomBackfillStatus(): Observable<any> {
    return this.http.get<any>(`${this.url}/zoom/backfill/status`, { withCredentials: true });
  }

  publishZoomRecordings(meetingLinkIds: string[], isPublished: boolean): Observable<{
    success: boolean;
    message: string;
    matched: number;
    modified: number;
  }> {
    return this.http.post<any>(
      `${this.url}/zoom/publish`,
      { meetingLinkIds, isPublished },
      { withCredentials: true }
    );
  }

  getZoomWebhookAudit(params?: {
    limit?: number;
    status?: string;
    eventType?: string;
  }): Observable<{ success: boolean; total: number; summary: Record<string, number>; rows: ZoomWebhookAuditRow[] }> {
    const qp = new URLSearchParams();
    if (params?.limit) qp.set('limit', String(params.limit));
    if (params?.status) qp.set('status', params.status);
    if (params?.eventType) qp.set('eventType', params.eventType);
    const qs = qp.toString() ? `?${qp.toString()}` : '';
    return this.http.get<any>(`${this.url}/zoom/webhook-audit${qs}`, { withCredentials: true });
  }

  getBatches(): Observable<{ success: boolean; batches: string[] }> {
    return this.http.get<any>(`${this.url}/batches`, { withCredentials: true });
  }

  create(data: any): Observable<{ success: boolean; recording: ClassRecording }> {
    return this.http.post<any>(this.url, data, { withCredentials: true });
  }

  update(id: string, data: any): Observable<{ success: boolean; recording: ClassRecording }> {
    return this.http.put<any>(`${this.url}/${id}`, data, { withCredentials: true });
  }

  delete(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<any>(`${this.url}/${id}`, { withCredentials: true });
  }

  deleteZoomRecording(meetingLinkId: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<any>(`${this.url}/zoom/${meetingLinkId}`, { withCredentials: true });
  }

  // View tracking
  startView(recordingId: string): Observable<{ success: boolean; viewId: string }> {
    return this.http.post<any>(`${this.url}/${recordingId}/view`, {}, { withCredentials: true });
  }

  updateViewDuration(viewId: string, watchDuration: number): Observable<any> {
    return this.http.put<any>(`${this.url}/view/${viewId}`, { watchDuration }, { withCredentials: true });
  }

  getViews(recordingId: string): Observable<{ success: boolean; views: any[] }> {
    return this.http.get<any>(`${this.url}/${recordingId}/views`, { withCredentials: true });
  }

  getZoomViews(meetingLinkId: string): Observable<{
    success: boolean;
    views: any[];
    summary?: {
      totalStudents: number;
      watchedCount: number;
      notWatchedCount: number;
      totalWatchSeconds: number;
      videoSizeBytes: number;
    };
  }> {
    return this.http.get<any>(`${this.url}/zoom/${meetingLinkId}/views`, { withCredentials: true });
  }

  getAnalyticsSummary(): Observable<{ success: boolean; summary: Record<string, any> }> {
    return this.http.get<any>(`${this.url}/analytics/summary`, { withCredentials: true });
  }

  // ---------------------------------------------------------------------------
  // Zoom Auto-Recorded Sessions
  // ---------------------------------------------------------------------------

  /**
   * Fetch a short-lived R2 presigned URL for a Zoom-recorded class session.
   * @param meetingLinkId  The internal MeetingLink _id
   */
  getZoomRecordingUrl(meetingLinkId: string): Observable<ZoomRecordingResponse> {
    return this.http.get<ZoomRecordingResponse>(
      `${this.url}/zoom/${meetingLinkId}`,
      { withCredentials: true }
    );
  }

  startZoomView(meetingLinkId: string): Observable<{ success: boolean; viewId: string }> {
    return this.http.post<any>(`${this.url}/zoom/${meetingLinkId}/view`, {}, { withCredentials: true });
  }

  updateZoomViewDuration(viewId: string, watchDuration: number): Observable<any> {
    return this.http.put<any>(`${this.url}/zoom/view/${viewId}`, { watchDuration }, { withCredentials: true });
  }

  /**
   * Poll processing status without generating a signed URL.
   * Useful while the recording is still being ingested.
   */
  getZoomRecordingStatus(meetingLinkId: string): Observable<ZoomRecordingStatusResponse> {
    return this.http.get<ZoomRecordingStatusResponse>(
      `${this.url}/zoom/${meetingLinkId}/status`,
      { withCredentials: true }
    );
  }

  /**
   * List all Zoom recordings for the authenticated student's own batch.
   * Admins/Teachers may pass an optional batch query param.
   */
  getMyBatchZoomRecordings(batch?: string): Observable<{ success: boolean; recordings: BatchZoomRecording[] }> {
    const params = batch ? `?batch=${encodeURIComponent(batch)}` : '';
    return this.http.get<any>(
      `${this.url}/zoom/my-batch${params}`,
      { withCredentials: true }
    );
  }

  updateZoomRecordingMeta(meetingLinkId: string, payload: {
    title?: string;
    batch?: string;
    teacherId?: string;
  }): Observable<{ success: boolean; message: string }> {
    return this.http.put<any>(`${this.url}/zoom/${meetingLinkId}/meta`, payload, { withCredentials: true });
  }

  getZoomTeachers(): Observable<{ success: boolean; data: Array<{ _id: string; name: string; email: string }> }> {
    return this.http.get<any>(`${environment.apiUrl}/zoom/teachers`, { withCredentials: true });
  }
}
