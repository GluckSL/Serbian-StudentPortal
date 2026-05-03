import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  DgCharacterDoc,
  DgConversationRequest,
  DgConversationResponse,
  DgConversationStartRequest,
  DgConversationStartResponse,
  DgModuleSummary,
  DgPlayPayload,
  DgSessionStartResponse,
} from './dg-bot.types';

export interface DgImportFromLearningResponse {
  results: Array<{ learningModuleId: string; dgModuleId: string; title: string }>;
  errors: Array<{ learningModuleId: string; message: string }>;
}

export interface DgSessionInsightStudent {
  _id: string;
  name?: string;
  email?: string;
  regNo?: string;
  level?: string;
}

export interface DgChatTurn {
  at?: string;
  speaker: 'student' | 'ai' | 'hint';
  text: string;
  score?: number;
  kind?: string;
  instructionEn?: string;
}

export interface DgSessionInsightRow {
  _id: string;
  student: DgSessionInsightStudent | null;
  createdAt: string;
  updatedAt: string;
  completed: boolean;
  completedAt?: string | null;
  score: number;
  attempts: number;
  successCount: number;
  failureCount: number;
  silenceFailureCount: number;
  timeMinutes: number;
  chatTurns: DgChatTurn[];
}

export interface DgModuleSessionInsightsResponse {
  module: { _id: string; title: string };
  summary: {
    sessionCount: number;
    completedCount: number;
    avgScore: number;
    avgMinutes: number;
  };
  sessions: DgSessionInsightRow[];
}

@Injectable({ providedIn: 'root' })
export class DgApiService {
  private readonly base = `${environment.apiUrl}/dg`;

  constructor(private http: HttpClient) {}

  listStudentModules(): Observable<{ modules: DgModuleSummary[] }> {
    return this.http.get<{ modules: DgModuleSummary[] }>(`${this.base}/modules/student`);
  }

  listAdminModules(): Observable<{ modules: DgModuleSummary[] }> {
    return this.http.get<{ modules: DgModuleSummary[] }>(`${this.base}/modules`);
  }

  getAdminModule(id: string): Observable<DgModuleSummary> {
    return this.http.get<DgModuleSummary>(`${this.base}/modules/${id}`);
  }

  getPlay(moduleId: string): Observable<DgPlayPayload> {
    return this.http.get<DgPlayPayload>(`${this.base}/modules/${moduleId}/play`);
  }

  /** Staff: per-student sessions, times, scores, and chat turns for a module. */
  getModuleSessionInsights(
    moduleId: string,
    limit = 120,
  ): Observable<DgModuleSessionInsightsResponse> {
    return this.http.get<DgModuleSessionInsightsResponse>(
      `${this.base}/modules/${moduleId}/session-insights`,
      { params: { limit: String(limit) } },
    );
  }

  createModule(body: Partial<DgModuleSummary> & { scenes?: unknown[] }): Observable<DgModuleSummary> {
    return this.http.post<DgModuleSummary>(`${this.base}/modules`, body);
  }

  /** Bulk-create DG modules from Learning module IDs (admin). */
  importFromLearning(learningModuleIds: string[]): Observable<DgImportFromLearningResponse> {
    return this.http.post<DgImportFromLearningResponse>(`${this.base}/modules/from-learning`, {
      learningModuleIds,
    });
  }

  updateModule(
    id: string,
    body: Partial<DgModuleSummary> & { scenes?: unknown[] },
  ): Observable<DgModuleSummary> {
    return this.http.put<DgModuleSummary>(`${this.base}/modules/${id}`, body);
  }

  patchModuleVisibility(
    id: string,
    visibleToStudents: boolean,
  ): Observable<{ success: boolean; visibleToStudents?: boolean }> {
    return this.http.patch<{ success: boolean; visibleToStudents?: boolean }>(
      `${this.base}/modules/${id}/visibility`,
      { visibleToStudents },
    );
  }

  deleteModule(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/modules/${id}`);
  }

  listCharacters(): Observable<{ characters: DgCharacterDoc[] }> {
    return this.http.get<{ characters: DgCharacterDoc[] }>(`${this.base}/character`);
  }

  getCharacter(id: string): Observable<DgCharacterDoc> {
    return this.http.get<DgCharacterDoc>(`${this.base}/character/${id}`);
  }

  createCharacter(body: Partial<DgCharacterDoc>): Observable<DgCharacterDoc> {
    return this.http.post<DgCharacterDoc>(`${this.base}/character`, body);
  }

  updateCharacter(id: string, body: Partial<DgCharacterDoc>): Observable<DgCharacterDoc> {
    return this.http.put<DgCharacterDoc>(`${this.base}/character/${id}`, body);
  }

  startSession(moduleId: string): Observable<DgSessionStartResponse> {
    return this.http.post<DgSessionStartResponse>(`${this.base}/session/start`, { moduleId });
  }

  updateSession(body: Record<string, unknown>): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/session/update`, body);
  }

  completeSession(sessionId: string, finalScore?: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/session/complete`, {
      sessionId,
      finalScore,
    });
  }

  /** Initialise conversation state for a session (call once after session/start). */
  conversationStart(body: DgConversationStartRequest): Observable<DgConversationStartResponse> {
    return this.http.post<DgConversationStartResponse>(`${this.base}/conversation/start`, body);
  }

  /** Send the student's transcript to the AI and receive a response. */
  conversationRespond(body: DgConversationRequest): Observable<DgConversationResponse> {
    return this.http.post<DgConversationResponse>(`${this.base}/conversation/respond`, body);
  }
}
