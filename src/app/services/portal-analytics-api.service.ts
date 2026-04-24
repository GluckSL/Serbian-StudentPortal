import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PortalAnalyticsRange {
  from: string;
  to: string;
}

@Injectable({ providedIn: 'root' })
export class PortalAnalyticsApiService {
  private readonly base = `${environment.apiUrl}/portal-analytics`;

  constructor(private http: HttpClient) {}

  private params(range: PortalAnalyticsRange, extra?: Record<string, string | number | boolean>): HttpParams {
    let p = new HttpParams().set('from', range.from).set('to', range.to);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v === undefined || v === null) continue;
        p = p.set(k, String(v));
      }
    }
    return p;
  }

  getDashboard(range: PortalAnalyticsRange, includeHistorical = false): Observable<unknown> {
    return this.http.get(`${this.base}/dashboard`, {
      params: this.params(range, { includeHistorical: includeHistorical ? 'true' : 'false' }),
      withCredentials: true
    });
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
}
