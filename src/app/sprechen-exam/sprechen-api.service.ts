import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  SprechenExamModuleSummary,
  SprechenPlayPayload,
  SprechenSessionStart,
  SprechenTurnResult,
  SprechenSessionListResponse,
  SprechenReplayResponse,
  SprechenScores,
} from './sprechen-exam.types';

@Injectable({ providedIn: 'root' })
export class SprechenApiService {
  private readonly base = `${environment.apiUrl}/sprechen`;

  constructor(private http: HttpClient) {}

  // ── Module ─────────────────────────────────────────────────────────────────

  listStudentModules(): Observable<{ modules: SprechenExamModuleSummary[]; studentCourseDay?: number }> {
    return this.http.get<{ modules: SprechenExamModuleSummary[]; studentCourseDay?: number }>(
      `${this.base}/modules/student`,
    );
  }

  listAdminModules(): Observable<{ modules: SprechenExamModuleSummary[] }> {
    return this.http.get<{ modules: SprechenExamModuleSummary[] }>(`${this.base}/modules`);
  }

  getAdminModule(id: string): Observable<SprechenExamModuleSummary> {
    return this.http.get<SprechenExamModuleSummary>(`${this.base}/modules/${id}`);
  }

  createModule(payload: Partial<SprechenExamModuleSummary>): Observable<SprechenExamModuleSummary> {
    return this.http.post<SprechenExamModuleSummary>(`${this.base}/modules`, payload);
  }

  updateModule(id: string, payload: Partial<SprechenExamModuleSummary>): Observable<SprechenExamModuleSummary> {
    return this.http.put<SprechenExamModuleSummary>(`${this.base}/modules/${id}`, payload);
  }

  patchVisibility(id: string, visible: boolean): Observable<{ visibleToStudents: boolean }> {
    return this.http.patch<{ visibleToStudents: boolean }>(
      `${this.base}/modules/${id}/visibility`,
      { visibleToStudents: visible },
    );
  }

  deleteModule(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/modules/${id}`);
  }

  seedPlaceholder(): Observable<SprechenExamModuleSummary> {
    return this.http.post<SprechenExamModuleSummary>(`${this.base}/modules/seed-placeholder`, {});
  }

  uploadCardImage(file: File): Observable<{ url: string; canonicalUrl?: string }> {
    const fd = new FormData();
    fd.append('image', file);
    return this.http.post<{ url: string }>(`${this.base}/upload-card-image`, fd, {
      withCredentials: true,
    });
  }

  getPlay(moduleId: string): Observable<SprechenPlayPayload> {
    return this.http.get<SprechenPlayPayload>(`${this.base}/modules/${moduleId}/play`);
  }

  getModuleSessions(moduleId: string): Observable<SprechenSessionListResponse> {
    return this.http.get<SprechenSessionListResponse>(`${this.base}/modules/${moduleId}/sessions`);
  }

  exportCsvUrl(moduleId: string): string {
    return `${this.base}/modules/${moduleId}/export.csv`;
  }

  // ── Session ────────────────────────────────────────────────────────────────

  startSession(moduleId: string): Observable<SprechenSessionStart> {
    return this.http.post<SprechenSessionStart>(`${this.base}/session/start`, { moduleId });
  }

  getSessionState(sessionId: string): Observable<{
    phase: string;
    awaitingStudent: boolean;
    teilNumber: number;
    card: any;
    completed: boolean;
    scores: SprechenScores | null;
  }> {
    return this.http.get<any>(`${this.base}/session/${sessionId}/state`);
  }

  advance(sessionId: string, action: 'ready'): Observable<SprechenTurnResult> {
    return this.http.post<SprechenTurnResult>(`${this.base}/session/${sessionId}/advance`, { action });
  }

  submitTurn(sessionId: string, transcript: string, durationMs: number): Observable<SprechenTurnResult> {
    return this.http.post<SprechenTurnResult>(`${this.base}/session/${sessionId}/turn`, {
      transcript,
      durationMs,
    });
  }

  completeSession(sessionId: string): Observable<{ scores: SprechenScores; completed: boolean }> {
    return this.http.post<{ scores: SprechenScores; completed: boolean }>(
      `${this.base}/session/${sessionId}/complete`,
      {},
    );
  }

  synthesize(text: string, voice?: string): Observable<Blob> {
    return this.http.post(`${this.base}/session/tts`, { text, voice }, { responseType: 'blob' });
  }

  // ── Staff: replay + override ───────────────────────────────────────────────

  getReplay(sessionId: string): Observable<SprechenReplayResponse> {
    return this.http.get<SprechenReplayResponse>(`${this.base}/session/${sessionId}/replay`);
  }

  overrideTurnScore(
    sessionId: string,
    turnId: string,
    points: number,
    note: string,
  ): Observable<{ turn: any; scores: SprechenScores }> {
    return this.http.patch<{ turn: any; scores: SprechenScores }>(
      `${this.base}/session/${sessionId}/turns/${turnId}/score`,
      { points, note },
    );
  }
}
