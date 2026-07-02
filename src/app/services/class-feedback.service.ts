import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ClassFeedbackSubmit {
  meetingId: string;
  understanding: 'not_really' | 'mostly' | 'completely';
  pace: 'too_slow' | 'just_right' | 'too_fast';
  confidence: 1 | 2 | 3;
  motivation: 'not_motivated' | 'somewhat_motivated' | 'very_motivated';
}

export interface ClassFeedbackItem {
  _id: string;
  studentName: string;
  studentEmail: string;
  batch: string;
  classTitle: string;
  classDate: string;
  understanding: string;
  pace: string;
  confidence: number;
  motivation: string;
  submittedAt: string;
}

export interface BatchFeedbackSetting {
  batch: string;
  enabled: boolean;
  updatedAt: string | null;
}

export interface FeedbackListResponse {
  success: boolean;
  data: ClassFeedbackItem[];
  total: number;
  page: number;
  totalPages: number;
}

export interface FeedbackStatsResponse {
  success: boolean;
  total: number;
  understanding: Record<string, number>;
  pace: Record<string, number>;
  confidence: Record<string, number>;
  motivation: Record<string, number>;
}

@Injectable({ providedIn: 'root' })
export class ClassFeedbackService {
  private readonly base = `${environment.apiUrl}/class-feedback`;

  constructor(private http: HttpClient) {}

  // ── Student ──────────────────────────────────────────────────────────────

  submitFeedback(data: ClassFeedbackSubmit): Observable<any> {
    return this.http.post(`${this.base}/submit`, data);
  }

  checkSubmitted(meetingId: string): Observable<{ success: boolean; submitted: boolean; feedback: any }> {
    return this.http.get<any>(`${this.base}/check/${meetingId}`);
  }

  getMeetingForFeedback(meetingId: string): Observable<any> {
    return this.http.get<any>(`${this.base}/meeting/${meetingId}`);
  }

  isBatchEnabled(batch: string): Observable<{ success: boolean; enabled: boolean }> {
    return this.http.get<any>(`${this.base}/batch-enabled/${encodeURIComponent(batch)}`);
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  getBatchSettings(): Observable<{ success: boolean; data: BatchFeedbackSetting[] }> {
    return this.http.get<any>(`${this.base}/batch-settings`);
  }

  updateBatchSettings(updates: { batch: string; enabled: boolean }[]): Observable<any> {
    return this.http.put(`${this.base}/batch-settings`, { updates });
  }

  getFeedbackList(filters: {
    batch?: string;
    dateFrom?: string;
    dateTo?: string;
    understanding?: string;
    motivation?: string;
    page?: number;
    limit?: number;
  }): Observable<FeedbackListResponse> {
    let params = new HttpParams();
    if (filters.batch) params = params.set('batch', filters.batch);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params = params.set('dateTo', filters.dateTo);
    if (filters.understanding) params = params.set('understanding', filters.understanding);
    if (filters.motivation) params = params.set('motivation', filters.motivation);
    if (filters.page) params = params.set('page', filters.page.toString());
    if (filters.limit) params = params.set('limit', filters.limit.toString());
    return this.http.get<FeedbackListResponse>(`${this.base}/list`, { params });
  }

  getStats(filters: { batch?: string; dateFrom?: string; dateTo?: string }): Observable<FeedbackStatsResponse> {
    let params = new HttpParams();
    if (filters.batch) params = params.set('batch', filters.batch);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params = params.set('dateTo', filters.dateTo);
    return this.http.get<FeedbackStatsResponse>(`${this.base}/stats`, { params });
  }

  getExportUrl(filters: { batch?: string; dateFrom?: string; dateTo?: string; understanding?: string; motivation?: string }): string {
    let params = new HttpParams();
    if (filters.batch) params = params.set('batch', filters.batch);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params = params.set('dateTo', filters.dateTo);
    if (filters.understanding) params = params.set('understanding', filters.understanding);
    if (filters.motivation) params = params.set('motivation', filters.motivation);
    const token = localStorage.getItem('authToken') || '';
    params = params.set('token', token);
    return `${this.base}/export?${params.toString()}`;
  }

  exportCsv(filters: { batch?: string; dateFrom?: string; dateTo?: string; understanding?: string; motivation?: string }): void {
    let params = new HttpParams();
    if (filters.batch) params = params.set('batch', filters.batch);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params = params.set('dateTo', filters.dateTo);
    if (filters.understanding) params = params.set('understanding', filters.understanding);
    if (filters.motivation) params = params.set('motivation', filters.motivation);
    this.http.get(`${this.base}/export`, { params, responseType: 'blob' }).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `class-feedback-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}
