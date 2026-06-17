import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { getAuthToken } from './auth.service';

@Injectable({ providedIn: 'root' })
export class GluckRoomService {
  private apiUrl = `${environment.apiUrl}/gluckroom`;

  constructor(private http: HttpClient) {}

  getSessions(params?: Record<string, any>): Observable<any> {
    return this.http.get(`${this.apiUrl}/sessions`, { params, withCredentials: true });
  }

  getSession(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/sessions/${id}`, { withCredentials: true });
  }

  createSession(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions`, data, { withCredentials: true });
  }

  updateSession(id: string, data: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/sessions/${id}`, data, { withCredentials: true });
  }

  deleteSession(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/sessions/${id}`, { withCredentials: true });
  }

  startSession(id: string, videoSource: 'camera' | 'screen_share' | 'none' = 'camera'): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/${id}/start`, { videoSource }, { withCredentials: true });
  }

  endSession(id: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/${id}/end`, {}, { withCredentials: true });
  }

  joinSession(id: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/${id}/join`, {}, { withCredentials: true });
  }

  leaveSession(id: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/${id}/leave`, {}, { withCredentials: true });
  }

  getAttendance(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/sessions/${id}/attendance`, { withCredentials: true });
  }

  getMetrics(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/sessions/${id}/metrics`, { withCredentials: true });
  }

  getBatchAttendance(batch: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/attendance/batch/${batch}`, { withCredentials: true });
  }

  getStudentAttendance(userId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/attendance/student/${userId}`, { withCredentials: true });
  }

  getRecording(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/recordings/${id}`, { withCredentials: true });
  }

  getSessionRecording(sessionId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/sessions/${sessionId}/recording`, { withCredentials: true });
  }

  publishRecording(id: string, data: { isPublished: boolean }): Observable<any> {
    return this.http.put(`${this.apiUrl}/recordings/${id}/publish`, data, { withCredentials: true });
  }

  deleteRecording(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/recordings/${id}`, { withCredentials: true });
  }

  getHlsPlaylistUrl(recordingId: string): string {
    const token = getAuthToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${this.apiUrl}/recordings/${recordingId}/hls/playlist${qs}`;
  }

  // ── Batch / Journey endpoints ──

  getBatchJourneyData(): Observable<any> {
    return this.http.get(`${this.apiUrl}/sessions/batches`, { withCredentials: true });
  }

  bulkPreviewSessions(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/bulk/preview`, data, { withCredentials: true });
  }

  bulkCreateSessions(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/bulk`, data, { withCredentials: true });
  }

  // ── Breakout Rooms ──

  createBreakouts(sessionId: string, data: { count: number; namePrefix?: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/${sessionId}/breakouts`, data, { withCredentials: true });
  }

  getBreakouts(sessionId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/sessions/${sessionId}/breakouts`, { withCredentials: true });
  }

  assignToBreakout(sessionId: string, breakoutId: string, participantIds: string[]): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/${sessionId}/breakouts/${breakoutId}/assign`,
      { participantIds }, { withCredentials: true });
  }

  joinBreakout(sessionId: string, breakoutId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/${sessionId}/breakouts/${breakoutId}/join`,
      {}, { withCredentials: true });
  }

  leaveBreakout(sessionId: string, breakoutId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/${sessionId}/breakouts/${breakoutId}/leave`,
      {}, { withCredentials: true });
  }

  endBreakout(sessionId: string, breakoutId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/${sessionId}/breakouts/${breakoutId}/end`,
      {}, { withCredentials: true });
  }

  endAllBreakouts(sessionId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sessions/${sessionId}/breakouts/end-all`,
      {}, { withCredentials: true });
  }
}
