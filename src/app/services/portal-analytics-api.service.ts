import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PortalAnalyticsRange {
  from: string;
  to: string;
  cohort?: 'overall' | 'platinum' | 'go';
  batch?: string;
  level?: string;
  /** When true, students marked as test accounts are included in metrics. */
  includeTestAccounts?: boolean;
}

export interface PortalAnalyticsFilterOptions {
  batches: string[];
  levels: string[];
}

@Injectable({ providedIn: 'root' })
export class PortalAnalyticsApiService {
  private readonly base = `${environment.apiUrl}/portal-analytics`;

  constructor(private http: HttpClient) {}

  private params(range: PortalAnalyticsRange, extra?: Record<string, string | number | boolean>): HttpParams {
    let p = new HttpParams().set('from', range.from).set('to', range.to);
    if (range.cohort && range.cohort !== 'overall') {
      p = p.set('cohort', range.cohort);
    }
    if (range.batch) {
      p = p.set('batch', range.batch);
    }
    if (range.level) {
      p = p.set('level', range.level);
    }
    if (range.includeTestAccounts === true) {
      p = p.set('includeTestAccounts', 'true');
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v === undefined || v === null) continue;
        p = p.set(k, String(v));
      }
    }
    return p;
  }

  getFilterOptions(): Observable<PortalAnalyticsFilterOptions> {
    return this.http.get<PortalAnalyticsFilterOptions>(`${this.base}/filter-options`, {
      withCredentials: true
    });
  }

  getDashboard(range: PortalAnalyticsRange, includeHistorical = false): Observable<unknown> {
    return this.http.get(`${this.base}/dashboard`, {
      params: this.params(range, { includeHistorical: includeHistorical ? 'true' : 'false' }),
      headers: new HttpHeaders({
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }),
      withCredentials: true
    });
  }

  getDailyLogs(range: PortalAnalyticsRange): Observable<unknown> {
    return this.http.get(`${this.base}/daily-logs`, { params: this.params(range), withCredentials: true });
  }

  getOverview(range: PortalAnalyticsRange): Observable<unknown> {
    return this.http.get(`${this.base}/overview`, { params: this.params(range), withCredentials: true });
  }

  getStudentWise(
    range: PortalAnalyticsRange,
    limit = 200,
    sortBy: 'time' | 'sessions' | 'name' = 'time',
    order: 'asc' | 'desc' = 'desc'
  ): Observable<unknown> {
    return this.http.get(`${this.base}/student-wise`, {
      params: this.params(range, { limit, sortBy, order }),
      withCredentials: true
    });
  }

  getPageWise(range: PortalAnalyticsRange, limit = 200): Observable<unknown> {
    return this.http.get(`${this.base}/page-wise`, { params: this.params(range, { limit }), withCredentials: true });
  }

  getTimeline(range: PortalAnalyticsRange, limit = 50, skip = 0): Observable<unknown> {
    return this.http.get(`${this.base}/timeline`, {
      params: this.params(range, { limit, skip }),
      withCredentials: true
    });
  }

  getSessionWise(range: PortalAnalyticsRange, limit = 200): Observable<unknown> {
    return this.http.get(`${this.base}/session-wise`, { params: this.params(range, { limit }), withCredentials: true });
  }

  getDeviceWise(range: PortalAnalyticsRange, limit = 300): Observable<unknown> {
    return this.http.get(`${this.base}/device-wise`, { params: this.params(range, { limit }), withCredentials: true });
  }

  getLearning(range: PortalAnalyticsRange, kind: 'video' | 'exercises' | 'digibot', limit = 300): Observable<unknown> {
    return this.http.get(`${this.base}/learning/${kind}`, {
      params: this.params(range, { limit }),
      withCredentials: true
    });
  }
}
