import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SheetConnectionInfo {
  connected?: boolean;
  configured?: boolean;
  spreadsheetTitle?: string;
  expectedTitle?: string;
  titleMatch?: boolean;
  worksheetTitle?: string;
  spreadsheetUrl?: string;
  headerCount?: number;
  openInBrowserHint?: string;
}

export interface OcrBatchSummary {
  total: number;
  ok: number;
  errors: number;
  details: { studentId: string; regNo: string; status: string; error?: string }[];
}

export interface OcrTestResult {
  text: string;
  parsed: Record<string, string>;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface StudentBrief {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  batch?: string;
  level?: string;
  documentCount?: number;
}

export interface FilterOptions {
  batches: string[];
  levels: string[];
}

export type ActivityLogLevel = 'info' | 'success' | 'error' | 'warn';

export interface ActivityLogEntry {
  id: number;
  at: string;
  level: ActivityLogLevel;
  message: string;
}

export interface ActivityJob {
  type: 'sync' | 'ocr' | 'extract';
  running: boolean;
  current: number;
  total: number;
  startedAt: string;
  finishedAt?: string;
  message?: string;
}

export interface ActivityResponse {
  job: ActivityJob | null;
  logs: ActivityLogEntry[];
  lastId: number;
}

export interface StudentListResponse {
  data: StudentBrief[];
  total: number;
  page: number;
  totalPages: number;
}

@Injectable({ providedIn: 'root' })
export class GoogleSheetSyncService {
  constructor(private http: HttpClient) {}

  testOcr(file: File, documentType: string): Observable<OcrTestResult> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('documentType', documentType);
    return this.http.post<OcrTestResult>('/api/google-sheet/ocr/test', fd);
  }

  searchStudents(q: string, limit = 50): Observable<{ data: StudentBrief[] }> {
    return this.http.get<{ data: StudentBrief[] }>(`/api/google-sheet/students/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  }

  getAllStudents(page = 1, limit = 50, q = '', batch = '', level = ''): Observable<StudentListResponse> {
    let url = `/api/google-sheet/students?page=${page}&limit=${limit}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;
    if (batch) url += `&batch=${encodeURIComponent(batch)}`;
    if (level) url += `&level=${encodeURIComponent(level)}`;
    return this.http.get<StudentListResponse>(url);
  }

  getFilterOptions(): Observable<FilterOptions> {
    return this.http.get<FilterOptions>('/api/google-sheet/students/filter-options');
  }

  extractAndSyncSelected(studentIds: string[]): Observable<OcrBatchSummary> {
    return this.http.post<OcrBatchSummary>('/api/google-sheet/extract-and-sync', { studentIds });
  }

  getActivity(since = 0): Observable<ActivityResponse> {
    return this.http.get<ActivityResponse>(`/api/google-sheet/activity?since=${since}`);
  }

  clearActivityLog(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/google-sheet/activity/clear', {});
  }
}
