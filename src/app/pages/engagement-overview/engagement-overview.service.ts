import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type EngBand = 'red' | 'yellow' | 'green';

export interface EngStudent {
  studentId: string;
  name: string;
  regNo: string;
  level: string;
  hours: number;
  minutes: number;
  pct: number;
  band: EngBand;
  breakdown: { exerciseMin: number; dgMin: number; arenaMin: number };
}

export interface EngBatch {
  batchName: string;
  /** False when the batch has no journey start date — data falls back to the last 7 days. */
  hasJourney: boolean;
  currentWeek: number | null;
  selectedWeek: number | null;
  totalWeeks: number;
  targetHours: number;
  studentCount: number;
  students: EngStudent[];
  bands: { red: number; yellow: number; green: number };
  /** UI-only: set while a per-batch week change is loading. */
  loading?: boolean;
}

export interface EngOverview {
  targetHours: number;
  totalWeeks: number;
  generatedAt: string;
  batches: EngBatch[];
}

@Injectable({ providedIn: 'root' })
export class EngagementOverviewService {
  private readonly base = `${environment.apiUrl}/language-tracking/engagement-overview`;

  constructor(private readonly http: HttpClient) {}

  getOverview(week?: number | null): Observable<EngOverview> {
    let params = new HttpParams();
    if (week != null) params = params.set('week', String(week));
    return this.http.get<EngOverview>(this.base, { params, withCredentials: true });
  }

  getBatch(batch: string, week: number): Observable<EngBatch> {
    const params = new HttpParams().set('batch', batch).set('week', String(week));
    return this.http.get<EngBatch>(`${this.base}/batch`, { params, withCredentials: true });
  }
}
