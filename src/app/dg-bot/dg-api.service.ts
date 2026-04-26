import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  DgCharacterDoc,
  DgConversationRequest,
  DgConversationResponse,
  DgModuleSummary,
  DgPlayPayload,
  DgSessionStartResponse,
} from './dg-bot.types';

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

  createModule(body: Partial<DgModuleSummary> & { scenes?: unknown[] }): Observable<DgModuleSummary> {
    return this.http.post<DgModuleSummary>(`${this.base}/modules`, body);
  }

  updateModule(
    id: string,
    body: Partial<DgModuleSummary> & { scenes?: unknown[] },
  ): Observable<DgModuleSummary> {
    return this.http.put<DgModuleSummary>(`${this.base}/modules/${id}`, body);
  }

  patchModuleVisibility(id: string, visibleToStudents: boolean): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/modules/${id}/visibility`, {
      visibleToStudents,
    });
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

  /** Send the student's transcript to the AI and receive a vocabulary-enforced response. */
  conversationRespond(body: DgConversationRequest): Observable<DgConversationResponse> {
    return this.http.post<DgConversationResponse>(`${this.base}/conversation/respond`, body);
  }
}
