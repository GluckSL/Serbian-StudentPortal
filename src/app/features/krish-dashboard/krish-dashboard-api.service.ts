import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  joinFilterValues,
  KrishAnalytics,
  KrishDashboardFilters,
  ProfessionStat,
  SalesStudent,
  PaginationMeta,
} from './krish-dashboard-filters.model';

const BASE = `${environment.apiUrl}/enrollment-overview`;

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

  private buildFilterParams(filters: Partial<KrishDashboardFilters>): HttpParams {
    let params = new HttpParams();
    const add = (k: string, v: unknown) => {
      if (v != null && v !== '') params = params.set(k, String(v));
    };
    const addMulti = (k: string, values?: string[]) => {
      const joined = joinFilterValues(values || []);
      if (joined) params = params.set(k, joined);
    };

    add('page', filters.page);
    add('limit', filters.limit);
    add('sortBy', filters.sortBy);
    add('sortDir', filters.sortDir);
    add('search', filters.search);
    addMulti('status', filters.statuses);
    addMulti('package', filters.packages);
    addMulti('serviceName', filters.serviceNames);
    addMulti('profession', filters.professions);
    addMulti('currentLanguageLevel', filters.languageLevels);
    addMulti('documentPaymentStatus', filters.documentPaymentStatuses);
    addMulti('documentationStatus', filters.documentationStatuses);
    addMulti('visaStatus', filters.visaStatuses);
    add('counselor', filters.counselor);
    add('enrolledFrom', filters.enrolledFrom);
    add('enrolledTo', filters.enrolledTo);
    return params;
  }

  getStudents(filters: Partial<KrishDashboardFilters>): Observable<ListResp> {
    return this.http.get<ListResp>(`${BASE}/students`, {
      params: this.buildFilterParams(filters),
      withCredentials: true,
    });
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

  fetchFromCrm(): Observable<any> {
    return this.http.post(`${BASE}/import/fetch-crm`, {}, { withCredentials: true });
  }

  getExportUrl(filters: Partial<KrishDashboardFilters>, format: 'csv' | 'xlsx'): string {
    return `${BASE}/export?${this.buildFilterParams(filters).set('format', format).toString()}`;
  }

  exportStudents(filters: Partial<KrishDashboardFilters>, format: 'csv' | 'xlsx'): Observable<Blob> {
    const params = this.buildFilterParams(filters).set('format', format);
    return this.http.get(`${BASE}/export`, {
      params,
      withCredentials: true,
      responseType: 'blob',
    });
  }
}
