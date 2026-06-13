import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  KrishAnalytics,
  KrishDashboardFilters,
  ProfessionStat,
  SalesStudent,
  PaginationMeta,
} from './krish-dashboard-filters.model';

const BASE = `${environment.apiUrl}/krish-dashboard`;

interface ApiResp<T> { success: boolean; data: T; }
interface ListResp    { success: boolean; data: SalesStudent[]; pagination: PaginationMeta; }

@Injectable({ providedIn: 'root' })
export class KrishDashboardApiService {
  constructor(private readonly http: HttpClient) {}

  getAnalytics(): Observable<ApiResp<KrishAnalytics>> {
    return this.http.get<ApiResp<KrishAnalytics>>(`${BASE}/analytics`, { withCredentials: true });
  }

  getProfessionBreakdown(serviceName: string): Observable<ApiResp<ProfessionStat[]>> {
    const params = new HttpParams().set('serviceName', serviceName);
    return this.http.get<ApiResp<ProfessionStat[]>>(
      `${BASE}/analytics/profession-breakdown`,
      { params, withCredentials: true },
    );
  }

  getStudents(filters: Partial<KrishDashboardFilters>): Observable<ListResp> {
    let params = new HttpParams();
    const add = (k: string, v: unknown) => { if (v != null && v !== '') params = params.set(k, String(v)); };
    add('page', filters.page);
    add('limit', filters.limit);
    add('sortBy', filters.sortBy);
    add('sortDir', filters.sortDir);
    add('search', filters.search);
    add('package', filters.package);
    add('status', filters.status);
    add('serviceName', filters.serviceName);
    add('profession', filters.profession);
    add('counselor', filters.counselor);
    return this.http.get<ListResp>(`${BASE}/students`, { params, withCredentials: true });
  }

  getStudent(id: string): Observable<ApiResp<SalesStudent>> {
    return this.http.get<ApiResp<SalesStudent>>(`${BASE}/students/${id}`, { withCredentials: true });
  }

  createStudent(data: Partial<SalesStudent>): Observable<ApiResp<SalesStudent>> {
    return this.http.post<ApiResp<SalesStudent>>(`${BASE}/students`, data, { withCredentials: true });
  }

  updateStudent(id: string, data: Partial<SalesStudent>): Observable<ApiResp<SalesStudent>> {
    return this.http.patch<ApiResp<SalesStudent>>(`${BASE}/students/${id}`, data, { withCredentials: true });
  }

  deleteStudent(id: string): Observable<ApiResp<null>> {
    return this.http.delete<ApiResp<null>>(`${BASE}/students/${id}`, { withCredentials: true });
  }

  resetAllSalesData(): Observable<any> {
    return this.http.post(`${BASE}/students/reset-all`, {}, { withCredentials: true });
  }

  addNote(studentId: string, payload: { type: string; content: string; followUpDate?: string }): Observable<any> {
    return this.http.post(`${BASE}/students/${studentId}/notes`, payload, { withCredentials: true });
  }

  updateNote(studentId: string, noteId: string, payload: object): Observable<any> {
    return this.http.patch(`${BASE}/students/${studentId}/notes/${noteId}`, payload, { withCredentials: true });
  }

  previewImport(file: File): Observable<any> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post(`${BASE}/import/preview`, fd, { withCredentials: true });
  }

  commitImport(file: File): Observable<any> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post(`${BASE}/import/commit`, fd, { withCredentials: true });
  }

  getExportUrl(filters: Partial<KrishDashboardFilters>, format: 'csv' | 'xlsx'): string {
    let params = new HttpParams().set('format', format);
    const add = (k: string, v: unknown) => { if (v != null && v !== '') params = params.set(k, String(v)); };
    add('search', filters.search);
    add('package', filters.package);
    add('status', filters.status);
    add('serviceName', filters.serviceName);
    add('profession', filters.profession);
    add('counselor', filters.counselor);
    return `${BASE}/export?${params.toString()}`;
  }
}
