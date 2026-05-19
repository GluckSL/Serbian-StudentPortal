import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpEventType } from '@angular/common/http';
import { Observable } from 'rxjs';
import { filter, map, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { getAuthToken } from './auth.service';
import { StudentProgressService } from './student-progress.service';

export interface ClassRecording {
  _id: string;
  title: string;
  description: string;
  videoUrl: string;
  sourceType?: 'URL' | 'HLS_UPLOAD';
  status?: 'processing' | 'ready' | 'failed' | 'missing';
  hlsKey?: string | null;
  errorMessage?: string | null;
  batches: string[];
  level: string;
  plan: string;
  uploadedBy: { _id: string; name: string };
  active: boolean;
  /** When false, hidden from student class recordings (manual uploads / URL). */
  isPublished?: boolean;
  publishedAt?: string | null;
  createdAt: string;
  duration?: number | null;
  watchedSeconds?: number | null;
  /** Journey day tag (GO / batch journey); used to group recordings per day. */
  courseDay?: number | null;
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

export interface ManualUploadStatusResponse {
  success: boolean;
  recordingId: string;
  sourceType: 'URL' | 'HLS_UPLOAD';
  status: 'processing' | 'ready' | 'failed';
  errorMessage: string | null;
  hlsReady: boolean;
  createdAt: string;
}

export interface ManualUploadCreateResponse {
  success: boolean;
  message: string;
  recordingId: string;
}

export type ManualUploadProgressEvent =
  | { kind: 'progress'; percent: number; loaded: number; total: number | null }
  | { kind: 'complete'; body: ManualUploadCreateResponse };

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
  /** True when the recording was converted to HLS. Use hlsPlaylistUrl for playback. */
  hlsMode: boolean;
  /** Presigned MP4 URL — only present for legacy recordings where hlsMode is false. */
  signedUrl: string | null;
  duration: number | null;
  createdAt: string;
  isPublished?: boolean;
  r2Key: string | null;
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
  status?: 'processing' | 'ready' | 'failed';
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
  batches?: string[];
  level?: string | null;
  plan?: string;
  /** From MeetingLink — aligns with manual recordings for journey-by-day UI. */
  courseDay?: number | null;
}

@Injectable({ providedIn: 'root' })
export class ClassRecordingsService {
  private url = `${environment.apiUrl}/class-recordings`;

  constructor(private http: HttpClient, private progressService: StudentProgressService) {}

  getRecordings(): Observable<{ success: boolean; recordings: ClassRecording[] }> {
    const sep = this.url.includes('?') ? '&' : '?';
    return this.http.get<any>(`${this.url}${sep}_=${Date.now()}`);
  }

  getAdminAllRecordings(): Observable<{ success: boolean; recordings: AdminClassRecording[] }> {
    return this.http.get<any>(`${this.url}/admin/all`);
  }

  getAdminRecordingsPage(params: {
    page: number;
    limit: number;
    level?: string;
    batch?: string;
    search?: string;
  }): Observable<{
    success: boolean;
    recordings: AdminClassRecording[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    summary?: { readyTotal: number; readyManual: number; readyZoom: number };
  }> {
    const qp = new URLSearchParams();
    qp.set('page', String(params.page));
    qp.set('limit', String(params.limit));
    if (params.level && params.level !== 'ALL') qp.set('level', params.level);
    if (params.batch && params.batch !== 'ALL') qp.set('batch', params.batch);
    if (params.search?.trim()) qp.set('search', params.search.trim());
    return this.http.get<any>(`${this.url}/admin/all?${qp.toString()}`);
  }

  runZoomBackfill(payload: {
    batch?: string | null;
    limit?: number;
    includeFailed?: boolean;
    force?: boolean;
    meetingIds?: string[];
  }): Observable<any> {
    return this.http.post<any>(`${this.url}/zoom/backfill`, payload || {});
  }

  getZoomBackfillStatus(): Observable<any> {
    return this.http.get<any>(`${this.url}/zoom/backfill/status`);
  }

  publishZoomRecordings(
    meetingLinkIds: string[],
    isPublished = true
  ): Observable<{
    success: boolean;
    message: string;
    matched: number;
    modified: number;
  }> {
    return this.http.post<any>(
      `${this.url}/zoom/publish`,
      { meetingLinkIds, isPublished }
    );
  }

  publishManualRecordings(
    recordingIds: string[],
    isPublished = true
  ): Observable<{
    success: boolean;
    message: string;
    matched: number;
    modified: number;
  }> {
    return this.http.post<any>(
      `${this.url}/manual/publish`,
      { recordingIds, isPublished }
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
    return this.http.get<any>(`${this.url}/zoom/webhook-audit${qs}`);
  }

  getBatches(): Observable<{ success: boolean; batches: string[] }> {
    return this.http.get<any>(`${this.url}/batches`);
  }

  create(data: any): Observable<{ success: boolean; recording: ClassRecording }> {
    return this.http.post<any>(this.url, data);
  }

  createFromUpload(formData: FormData): Observable<ManualUploadCreateResponse> {
    return this.http.post<ManualUploadCreateResponse>(`${this.url}/upload`, formData);
  }

  /** File upload with XMLHttpRequest progress events (percent + bytes). */
  createFromUploadWithProgress(formData: FormData): Observable<ManualUploadProgressEvent> {
    return this.http
      .post<ManualUploadCreateResponse>(`${this.url}/upload`, formData, {
        reportProgress: true,
        observe: 'events',
      })
      .pipe(
        map((event: HttpEvent<ManualUploadCreateResponse>): ManualUploadProgressEvent | null => {
          if (event.type === HttpEventType.UploadProgress) {
            const loaded = event.loaded ?? 0;
            const total = event.total ?? null;
            const percent =
              total && total > 0 ? Math.min(100, Math.round((100 * loaded) / total)) : 0;
            return { kind: 'progress', percent, loaded, total };
          }
          if (event.type === HttpEventType.Response && event.body) {
            return { kind: 'complete', body: event.body };
          }
          return null;
        }),
        filter((e): e is ManualUploadProgressEvent => e != null)
      );
  }

  /**
   * Step 1 of fast direct-upload flow: create the DB record server-side and
   * receive a presigned R2 PUT URL so the browser can upload directly to R2.
   */
  prepareDirectUpload(data: {
    title: string;
    description: string;
    level: string;
    plan: string;
    batches: string[];
    courseDay: number | null;
    filename: string;
    contentType: string;
  }): Observable<{ success: boolean; recordingId: string; uploadUrl: string; r2RawKey: string }> {
    return this.http.post<any>(`${this.url}/upload/prepare`, data);
  }

  /**
   * Step 3 of fast direct-upload flow: tell the server the file is now in R2
   * at `r2RawKey` so it can start the FFmpeg → HLS pipeline in the background.
   */
  startProcessing(recordingId: string, r2RawKey: string): Observable<{ success: boolean }> {
    return this.http.post<any>(`${this.url}/${recordingId}/start-processing`, { r2RawKey });
  }

  update(id: string, data: any): Observable<{ success: boolean; recording: ClassRecording }> {
    return this.http.put<any>(`${this.url}/${id}`, data);
  }

  delete(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<any>(`${this.url}/${id}`);
  }

  deleteZoomRecording(meetingLinkId: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<any>(`${this.url}/zoom/${meetingLinkId}`);
  }

  // View tracking
  startView(recordingId: string): Observable<{ success: boolean; viewId: string }> {
    return this.http.post<any>(`${this.url}/${recordingId}/view`, {});
  }

  updateViewDuration(viewId: string, watchDuration: number): Observable<any> {
    return this.http.put<any>(`${this.url}/view/${viewId}`, { watchDuration }).pipe(
      tap((res: any) => {
        if (res?.journeyAdvanced && res.previousCourseDay != null && res.newCourseDay != null) {
          this.progressService.notifyJourneyAdvance({
            previousDay: res.previousCourseDay,
            newDay: res.newCourseDay
          });
        }
      })
    );
  }

  updateManualDuration(recordingId: string, durationSeconds: number): Observable<{ success: boolean; duration: number }> {
    return this.http.put<any>(`${this.url}/${recordingId}/duration`, { duration: durationSeconds });
  }

  getViews(recordingId: string): Observable<{ success: boolean; views: any[] }> {
    return this.http.get<any>(`${this.url}/${recordingId}/views`);
  }

  getManualUploadStatus(recordingId: string): Observable<ManualUploadStatusResponse> {
    return this.http.get<ManualUploadStatusResponse>(
      `${this.url}/${recordingId}/upload-status`
    );
  }

  getManualHlsPlaylistUrl(recordingId: string): string {
    const token = getAuthToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${this.url}/${recordingId}/hls/playlist${qs}`;
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
    return this.http.get<any>(`${this.url}/zoom/${meetingLinkId}/views`);
  }

  getAnalyticsSummary(): Observable<{ success: boolean; summary: Record<string, any> }> {
    return this.http.get<any>(`${this.url}/analytics/summary`);
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
      `${this.url}/zoom/${meetingLinkId}`
    );
  }

  /**
   * Returns the URL of the authenticated HLS playlist endpoint for a recording.
   * The backend serves a rewritten .m3u8 where every segment line is a
   * presigned R2 URL, so hls.js fetches segments directly from R2.
   */
  getHlsPlaylistUrl(meetingLinkId: string): string {
    const token = getAuthToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${this.url}/zoom/${meetingLinkId}/hls/playlist${qs}`;
  }

  startZoomView(meetingLinkId: string): Observable<{ success: boolean; viewId: string }> {
    return this.http.post<any>(`${this.url}/zoom/${meetingLinkId}/view`, {});
  }

  updateZoomViewDuration(viewId: string, watchDuration: number): Observable<any> {
    return this.http.put<any>(`${this.url}/zoom/view/${viewId}`, { watchDuration }).pipe(
      tap((res: any) => {
        if (res?.journeyAdvanced && res.previousCourseDay != null && res.newCourseDay != null) {
          this.progressService.notifyJourneyAdvance({
            previousDay: res.previousCourseDay,
            newDay: res.newCourseDay
          });
        }
      })
    );
  }

  /**
   * Poll processing status without generating a signed URL.
   * Useful while the recording is still being ingested.
   */
  getZoomRecordingStatus(meetingLinkId: string): Observable<ZoomRecordingStatusResponse> {
    return this.http.get<ZoomRecordingStatusResponse>(
      `${this.url}/zoom/${meetingLinkId}/status`
    );
  }

  /**
   * List all Zoom recordings for the authenticated student's own batch.
   * Admins/Teachers may pass an optional batch query param.
   */
  getMyBatchZoomRecordings(batch?: string): Observable<{ success: boolean; recordings: BatchZoomRecording[] }> {
    const parts: string[] = [];
    if (batch) parts.push(`batch=${encodeURIComponent(batch)}`);
    parts.push(`_=${Date.now()}`);
    const params = parts.length ? `?${parts.join('&')}` : '';
    return this.http.get<any>(
      `${this.url}/zoom/my-batch${params}`
    );
  }

  updateZoomRecordingMeta(meetingLinkId: string, payload: {
    title?: string;
    batch?: string;
    batches?: string[];
    level?: string | null;
    plan?: string;
    teacherId?: string;
    courseDay?: number | null;
  }): Observable<{ success: boolean; message: string }> {
    return this.http.put<any>(`${this.url}/zoom/${meetingLinkId}/meta`, payload);
  }

  getZoomTeachers(): Observable<{ success: boolean; data: Array<{ _id: string; name: string; email: string }> }> {
    return this.http.get<any>(`${environment.apiUrl}/zoom/teachers`);
  }
}
