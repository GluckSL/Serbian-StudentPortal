import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CrossBatchRule {
  _id: string;
  journeyTitle?: string;
  courseDay: number;
  targetBatches: string[];
  mappedManualRecordingIds: string[];
  mappedZoomMeetingLinkIds: string[];
  active: boolean;
  notes: string;
  createdBy?: { _id: string; name: string; email: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RulePreviewStudent {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  attended: boolean;
}

export interface RulePreviewSourceRecording {
  meetingLinkId?: string;
  topic?: string;
  startTime?: string;
  isPublished?: boolean;
  status?: string;
  title?: string;
  batches?: string[];
  level?: string;
  plan?: string;
  courseDay?: number;
}

export interface RulePreview {
  eligibleStudents: RulePreviewStudent[];
  attendedCount: number;
  totalStudents: number;
  sourceZoomRecordings: RulePreviewSourceRecording[];
  sourceManualRecordings: RulePreviewSourceRecording[];
}

export interface CatalogRecording {
  id: string;
  type: 'manual' | 'zoom';
  title: string;
  courseDay: number | null;
  isPublished: boolean;
  status: string;
}

@Injectable({ providedIn: 'root' })
export class JourneyCrossBatchRecordingAccessService {
  private readonly url = `${environment.apiUrl}/journey-cross-batch-recording-access`;

  constructor(private http: HttpClient) {}

  getActiveBatches(): Observable<{ success: boolean; activeBatches: string[] }> {
    return this.http.get<{ success: boolean; activeBatches: string[] }>(
      `${this.url}/active-batches`,
      { withCredentials: true }
    );
  }

  updateActiveBatches(activeBatches: string[]): Observable<{ success: boolean; activeBatches: string[] }> {
    return this.http.put<{ success: boolean; activeBatches: string[] }>(
      `${this.url}/active-batches`,
      { activeBatches },
      { withCredentials: true }
    );
  }

  getRules(params: { active?: boolean; courseDay?: number } = {}): Observable<{ success: boolean; journeys: CrossBatchRule[] }> {
    const query: Record<string, string> = {};
    if (params.active !== undefined) query['active'] = String(params.active);
    if (params.courseDay !== undefined) query['courseDay'] = String(params.courseDay);
    return this.http.get<{ success: boolean; journeys: CrossBatchRule[] }>(
      `${this.url}/journeys`,
      { params: query, withCredentials: true }
    );
  }

  createRule(data: {
    courseDay: number;
    targetBatches: string[];
    notes?: string;
    journeyTitle?: string;
  }): Observable<{ success: boolean; journey: CrossBatchRule }> {
    return this.http.post<{ success: boolean; journey: CrossBatchRule }>(
      `${this.url}/journeys`,
      data,
      { withCredentials: true }
    );
  }

  updateRule(id: string, data: Partial<CrossBatchRule>): Observable<{ success: boolean; journey: CrossBatchRule }> {
    return this.http.put<{ success: boolean; journey: CrossBatchRule }>(
      `${this.url}/journeys/${id}`,
      data,
      { withCredentials: true }
    );
  }

  deleteRule(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(
      `${this.url}/journeys/${id}`,
      { withCredentials: true }
    );
  }

  getRecordingsCatalog(q = ''): Observable<{ success: boolean; recordings: CatalogRecording[] }> {
    const params: Record<string, string> = {};
    if (q.trim()) params['q'] = q.trim();
    return this.http.get<{ success: boolean; recordings: CatalogRecording[] }>(
      `${this.url}/recordings-catalog`,
      { params, withCredentials: true }
    );
  }

  mapRecording(journeyId: string, payload: { recordingType: 'manual' | 'zoom'; recordingId: string }): Observable<{ success: boolean; journey: CrossBatchRule }> {
    return this.http.post<{ success: boolean; journey: CrossBatchRule }>(
      `${this.url}/journeys/${journeyId}/map-recording`,
      payload,
      { withCredentials: true }
    );
  }

  unmapRecording(journeyId: string, payload: { recordingType: 'manual' | 'zoom'; recordingId: string }): Observable<{ success: boolean; journey: CrossBatchRule }> {
    return this.http.request<{ success: boolean; journey: CrossBatchRule }>(
      'DELETE',
      `${this.url}/journeys/${journeyId}/map-recording`,
      { body: payload, withCredentials: true }
    );
  }

  previewRule(id: string): Observable<{ success: boolean } & RulePreview> {
    return this.http.get<{ success: boolean } & RulePreview>(
      `${this.url}/journeys/${id}/preview`,
      { withCredentials: true }
    );
  }
}
