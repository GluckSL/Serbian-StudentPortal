import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type EngBand = 'red' | 'yellow' | 'green';

// ── Learning tab types ────────────────────────────────────────────────────────

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
  /** 'new' = New Batch, 'new2' = New Batch 2.0 */
  batchType: 'new' | 'new2';
  /** False when the batch has no journey start date — data falls back to the last 7 days. */
  hasJourney: boolean;
  currentWeek: number | null;
  /** 0 = Overall (full journey), null = no journey, 1+ = specific week */
  selectedWeek: number | null;
  totalWeeks: number;
  targetHours: number;
  studentCount: number;
  students: EngStudent[];
  bands: { red: number; yellow: number; green: number; fiveToSix: number };
  /** UI-only: set while a per-batch week change is loading. */
  loading?: boolean;
}

export interface EngOverview {
  targetHours: number;
  totalWeeks: number;
  generatedAt: string;
  batches: EngBatch[];
}

// ── Classes tab types ─────────────────────────────────────────────────────────

export interface ClassStudent {
  studentId: string;
  name: string;
  regNo: string;
  level: string;
  attendedCount: number;
  totalCount: number;
  attendancePct: number;
  band: EngBand;
}

export interface ClassBatch {
  batchName: string;
  batchType: 'new' | 'new2' | 'old';
  /** Current CEFR level of the batch (A1/A2/B1/B2) */
  currentLevel: string;
  /** Level currently displayed in the UI */
  selectedLevel: string;
  /** Levels available in the dropdown (A1 up to currentLevel) */
  availableLevels: string[];
  studentCount: number;
  students: ClassStudent[];
  bands: { red: number; yellow: number; green: number };
  /** UI-only: set while a per-batch level change is loading. */
  loading?: boolean;
}

export interface ClassOverview {
  generatedAt: string;
  batches: ClassBatch[];
}

// ── Payment tab types ─────────────────────────────────────────────────────────

export interface PaymentStudent {
  studentId: string;
  name: string;
  regNo: string;
  /** Student's current CEFR level (A1/A2/B1/B2) */
  level: string;
  currentJourneyDay: number | null;
  daysIntoLevel: number | null;
  /** Total pending+overdue for levels A1..selectedLevel */
  totalPending: number;
  /** Total paid for levels A1..selectedLevel */
  totalPaid: number;
  band: EngBand;
}

export interface PaymentBatch {
  batchName: string;
  batchType: 'new' | 'new2' | 'old';
  currentLevel: string;
  selectedLevel: string;
  availableLevels: string[];
  studentCount: number;
  students: PaymentStudent[];
  bands: { red: number; yellow: number; green: number };
  loading?: boolean;
}

export interface PaymentOverview {
  generatedAt: string;
  batches: PaymentBatch[];
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class EngagementOverviewService {
  private readonly base = `${environment.apiUrl}/language-tracking/engagement-overview`;
  private readonly classBase = `${environment.apiUrl}/language-tracking/class-attendance-overview`;

  constructor(private readonly http: HttpClient) {}

  // Learning tab
  getOverview(): Observable<EngOverview> {
    return this.http.get<EngOverview>(this.base, { withCredentials: true });
  }

  getBatch(batch: string, week: number): Observable<EngBatch> {
    const params = new HttpParams().set('batch', batch).set('week', String(week));
    return this.http.get<EngBatch>(`${this.base}/batch`, { params, withCredentials: true });
  }

  // Classes tab
  getClassOverview(): Observable<ClassOverview> {
    return this.http.get<ClassOverview>(this.classBase, { withCredentials: true });
  }

  getClassBatch(batch: string, level: string): Observable<ClassBatch> {
    const params = new HttpParams().set('batch', batch).set('level', level);
    return this.http.get<ClassBatch>(`${this.classBase}/batch`, { params, withCredentials: true });
  }

  // Payment tab
  getPaymentOverview(): Observable<PaymentOverview> {
    return this.http.get<PaymentOverview>(
      `${environment.apiUrl}/language-tracking/payment-overview`,
      { withCredentials: true }
    );
  }

  getPaymentBatch(batch: string, level: string): Observable<PaymentBatch> {
    const params = new HttpParams().set('batch', batch).set('level', level);
    return this.http.get<PaymentBatch>(
      `${environment.apiUrl}/language-tracking/payment-overview/batch`,
      { params, withCredentials: true }
    );
  }
}
