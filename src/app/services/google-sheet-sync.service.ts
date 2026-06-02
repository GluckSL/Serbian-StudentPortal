import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SyncStatus {
  totalStudents: number;
  ocrCompleted: number;
  ocrPending: number;
  syncedToSheet: number;
  lastSyncTime: string | null;
  sheetConfigured: boolean;
}

export interface SyncResult {
  totalStudents: number;
  synced: number;
  errors: { studentId: string; regNo: string; error: string }[];
}

export interface OcrResult {
  studentId: string;
  regNo: string;
  ocrStatus: string;
  documentsUsed: number;
}

export interface OcrBatchSummary {
  total: number;
  ok: number;
  errors: number;
  details: { studentId: string; regNo: string; status: string; error?: string }[];
}

export interface ExtractionData {
  _id: string;
  studentId: { _id: string; name: string; email: string; regNo: string } | null;
  regNo: string;
  ocrStatus: string;
  lastSyncedToSheet: string | null;
  documentsUsed: any[];
  candidate: any;
  father: any;
  mother: any;
  spouse: any;
  contactPerson: any;
  documentStatus: any;
  education: any;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractionListResponse {
  data: ExtractionData[];
  total: number;
  page: number;
  totalPages: number;
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
}

@Injectable({ providedIn: 'root' })
export class GoogleSheetSyncService {
  constructor(private http: HttpClient) {}

  getStatus(): Observable<SyncStatus> {
    return this.http.get<SyncStatus>('/api/google-sheet/status');
  }

  triggerSync(): Observable<SyncResult> {
    return this.http.post<SyncResult>('/api/google-sheet/sync', {});
  }

  syncSingleStudent(studentId: string): Observable<{ studentId: string; regNo: string; synced: boolean }> {
    return this.http.post<{ studentId: string; regNo: string; synced: boolean }>(
      `/api/google-sheet/sync/${studentId}`, {}
    );
  }

  runOcr(studentId: string): Observable<OcrResult> {
    return this.http.post<OcrResult>(`/api/google-sheet/ocr/${studentId}`, {});
  }

  runOcrAll(): Observable<OcrBatchSummary> {
    return this.http.post<OcrBatchSummary>('/api/google-sheet/ocr/all', {});
  }

  testOcr(file: File, documentType: string): Observable<OcrTestResult> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('documentType', documentType);
    return this.http.post<OcrTestResult>('/api/google-sheet/ocr/test', fd);
  }

  getExtractions(page = 1, limit = 50, search = ''): Observable<ExtractionListResponse> {
    let url = `/api/google-sheet/extractions?page=${page}&limit=${limit}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    return this.http.get<ExtractionListResponse>(url);
  }

  searchStudents(q: string, limit = 50): Observable<{ data: StudentBrief[] }> {
    return this.http.get<{ data: StudentBrief[] }>(`/api/google-sheet/students/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  }

  runOcrSelected(studentIds: string[]): Observable<OcrBatchSummary> {
    return this.http.post<OcrBatchSummary>('/api/google-sheet/ocr/selected', { studentIds });
  }
}
