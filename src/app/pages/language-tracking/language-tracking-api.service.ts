import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LtCohort = 'overall' | 'platinum' | 'go';
export type LtSort = 'totalSeconds' | 'name' | 'currentCourseDay';

export interface LtFilterOptions {
  batches: string[];
  levels: string[];
}

export interface LtKpis {
  totalLearningHours: number;
  activeStudents: number;
  totalStudents: number;
  avgMinutesPerStudent: number;
  topSource: 'exercises' | 'digibot' | 'arena';
  exercisesHours: number;
  digibotHours: number;
  arenaHours: number;
}

export interface LtTrendDay {
  date: string;
  exercises: number;
  digibot: number;
  arena: number;
  total: number;
}

export interface LtSourceProgress {
  done: number;
  total: number;
  label: string;
}

export interface LtStudentJourneyProgress {
  day: number;
  completionPercent: number;
  doneTasks: number;
  totalTasks: number;
  error?: boolean;
  sources: {
    exercises: LtSourceProgress;
    dg: LtSourceProgress;
    arena: LtSourceProgress;
  };
}

export interface LtStudentRow {
  studentId: string;
  name: string;
  email: string;
  regNo: string;
  batch: string;
  level: string;
  subscription: string;
  goStatus: string | null;
  currentCourseDay: number;
  totalSeconds: number;
  exercisesSeconds: number;
  digibotSeconds: number;
  arenaSeconds: number;
  lastLearningAt: string | null;
  isTestAccount?: boolean;
  journeyProgress?: LtStudentJourneyProgress;
}

export interface LtOverviewResponse {
  kpis: LtKpis;
  trend: LtTrendDay[];
  students: LtStudentRow[];
  topStudents?: LtStudentRow[];
  total: number;
  page: number;
  limit: number;
}

// ── Detail types ─────────────────────────────────────────────────────────────

export interface LtIncompleteTask {
  kind: string;
  title: string;
  courseDay: number;
}

export interface LtDayCompletion {
  day: number;
  complete: boolean;
  completionPercent: number;
  doneTasks: number;
  totalTasks: number;
  incompleteTasks: LtIncompleteTask[];
  breakdown: Record<string, { done: number; total: number }>;
}

export interface LtExerciseSession {
  id: string;
  title: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  timeSpentSeconds: number;
  scorePercentage: number;
}

export interface LtDigibotSession {
  id: string;
  title: string;
  startedAt: string;
  completedAt: string | null;
  completed: boolean;
  timeSpentSeconds: number;
  score: number;
}

export interface LtArenaSession {
  id: string;
  gameType: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  timeSpentSeconds: number;
  score: number;
  xpEarned: number;
  accuracy: number;
}

export interface LtReminderResult {
  studentId: string;
  ok: boolean;
  reason?: string;
  name?: string;
  email?: string;
  day?: number;
  incompleteCount?: number;
}

export interface LtSendRemindersResponse {
  results: LtReminderResult[];
  sent: number;
  skipped: number;
  failed: number;
}

export interface LtWeekDaySummary {
  day: number;
  isFuture: boolean;
  complete: boolean;
  completionPercent: number;
  doneTasks: number;
  totalTasks: number;
  incompleteCount: number;
  error?: boolean;
}

export interface LtWeekSummaryResponse {
  student: {
    studentId: string;
    name: string;
    regNo: string;
    batch: string;
    level: string;
    currentCourseDay: number;
  };
  week: number;
  weekStartDay: number;
  weekEndDay: number;
  currentWeek: number;
  days: LtWeekDaySummary[];
}

export interface LtDayDetailResponse {
  student: {
    studentId: string;
    name: string;
    email: string;
    regNo: string;
    batch: string;
    level: string;
    currentCourseDay: number;
  };
  dayCompletion: LtDayCompletion | null;
}

export interface LtStudentDetailResponse {
  student: {
    studentId: string;
    name: string;
    email: string;
    regNo: string;
    batch: string;
    level: string;
    subscription: string;
    goStatus: string | null;
    currentCourseDay: number;
  };
  timeSummary: {
    exercisesSeconds: number;
    digibotSeconds: number;
    arenaSeconds: number;
    totalSeconds: number;
  };
  dayCompletion: LtDayCompletion | null;
  sessions: {
    exercises: LtExerciseSession[];
    digibot: LtDigibotSession[];
    arena: LtArenaSession[];
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export interface LtOverviewParams {
  from: string;
  to: string;
  cohort?: LtCohort;
  batches?: string[];
  level?: string;
  search?: string;
  includeTestAccounts?: boolean;
  includeProgress?: boolean;
  page?: number;
  limit?: number;
  sort?: LtSort;
}

@Injectable({ providedIn: 'root' })
export class LanguageTrackingApiService {
  private readonly base = `${environment.apiUrl}/language-tracking`;

  constructor(private readonly http: HttpClient) {}

  getFilterOptions(): Observable<LtFilterOptions> {
    return this.http.get<LtFilterOptions>(`${this.base}/filter-options`, {
      withCredentials: true,
    });
  }

  getOverview(p: LtOverviewParams): Observable<LtOverviewResponse> {
    let params = new HttpParams().set('from', p.from).set('to', p.to);
    if (p.cohort && p.cohort !== 'overall') params = params.set('cohort', p.cohort);
    if (p.batches?.length) params = params.set('batch', p.batches.join(','));
    if (p.level) params = params.set('level', p.level);
    if (p.search) params = params.set('search', p.search);
    if (p.includeTestAccounts === true) params = params.set('includeTestAccounts', 'true');
    if (p.includeProgress === true) params = params.set('includeProgress', 'true');
    if (p.page) params = params.set('page', String(p.page));
    if (p.limit) params = params.set('limit', String(p.limit));
    if (p.sort) params = params.set('sort', p.sort);
    return this.http.get<LtOverviewResponse>(`${this.base}/overview`, {
      params,
      withCredentials: true,
    });
  }

  getStudentDetail(studentId: string, from: string, to: string): Observable<LtStudentDetailResponse> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<LtStudentDetailResponse>(`${this.base}/student/${studentId}`, {
      params,
      withCredentials: true,
    });
  }

  sendReminders(studentIds: string[], day?: number): Observable<LtSendRemindersResponse> {
    const body: { studentIds: string[]; day?: number } = { studentIds };
    if (day != null && day >= 1) body.day = day;
    return this.http.post<LtSendRemindersResponse>(
      `${this.base}/send-reminders`,
      body,
      { withCredentials: true },
    );
  }

  getWeekSummary(studentId: string, week: number): Observable<LtWeekSummaryResponse> {
    return this.http.get<LtWeekSummaryResponse>(
      `${this.base}/student/${studentId}/week/${week}`,
      { withCredentials: true },
    );
  }

  getDayDetail(studentId: string, day: number): Observable<LtDayDetailResponse> {
    return this.http.get<LtDayDetailResponse>(
      `${this.base}/student/${studentId}/day/${day}`,
      { withCredentials: true },
    );
  }
}
