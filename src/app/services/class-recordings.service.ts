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

@Injectable({ providedIn: 'root' })
export class ClassRecordingsService {
  private url = `${environment.apiUrl}/class-recordings`;

  constructor(private http: HttpClient) {}

  getRecordings(): Observable<{ success: boolean; recordings: ClassRecording[] }> {
    return this.http.get<any>(this.url, { withCredentials: true });
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

  getAnalyticsSummary(): Observable<{ success: boolean; summary: Record<string, any> }> {
    return this.http.get<any>(`${this.url}/analytics/summary`, { withCredentials: true });
  }
}
