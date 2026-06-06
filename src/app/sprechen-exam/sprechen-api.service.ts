import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  SprechenExamModuleSummary,
  SprechenModuleListResponse,
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
  private readonly httpOpts = { withCredentials: true as const };

  constructor(private http: HttpClient) {}

  // ── Module ─────────────────────────────────────────────────────────────────

  listStudentModules(opts: { gluckExamOnly?: boolean } = {}): Observable<SprechenModuleListResponse> {
    let params = new HttpParams();
    if (opts.gluckExamOnly) params = params.set('gluckExamOnly', 'true');
    return this.http.get<SprechenModuleListResponse>(
      `${this.base}/modules/student`,
      { ...this.httpOpts, params },
    );
  }

  listAdminModules(): Observable<{ modules: SprechenExamModuleSummary[] }> {
    return this.http.get<{ modules: SprechenExamModuleSummary[] }>(`${this.base}/modules`, this.httpOpts);
  }

  getAdminModule(id: string): Observable<SprechenExamModuleSummary> {
    return this.http.get<SprechenExamModuleSummary>(`${this.base}/modules/${id}`, this.httpOpts);
  }

  createModule(payload: Partial<SprechenExamModuleSummary>): Observable<SprechenExamModuleSummary> {
    return this.http.post<SprechenExamModuleSummary>(`${this.base}/modules`, payload, this.httpOpts);
  }

  updateModule(id: string, payload: Partial<SprechenExamModuleSummary>): Observable<SprechenExamModuleSummary> {
    return this.http.put<SprechenExamModuleSummary>(`${this.base}/modules/${id}`, payload, this.httpOpts);
  }

  /** Updates basic fields only (no Teil 1–3) — use for journey day / description saves. */
  patchModuleMetadata(
    id: string,
    payload: Partial<SprechenExamModuleSummary>,
  ): Observable<Partial<SprechenExamModuleSummary>> {
    return this.http.patch<Partial<SprechenExamModuleSummary>>(
      `${this.base}/modules/${id}/metadata`,
      payload,
      this.httpOpts,
    );
  }

  patchVisibility(id: string, visible: boolean): Observable<{ visibleToStudents: boolean }> {
    return this.http.patch<{ visibleToStudents: boolean }>(
      `${this.base}/modules/${id}/visibility`,
      { visibleToStudents: visible },
      this.httpOpts,
    );
  }

  deleteModule(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/modules/${id}`, this.httpOpts);
  }

  seedPlaceholder(): Observable<SprechenExamModuleSummary> {
    return this.http.post<SprechenExamModuleSummary>(
      `${this.base}/modules/seed-placeholder`,
      {},
      this.httpOpts,
    );
  }

  uploadCardImage(file: File): Observable<{ url: string; canonicalUrl?: string }> {
    const fd = new FormData();
    fd.append('image', file);
    return this.http.post<{ url: string }>(`${this.base}/upload-card-image`, fd, this.httpOpts);
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
