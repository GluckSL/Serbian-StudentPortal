import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type LeaderboardPeriod = 'today' | 'weekly' | 'overall';

export interface LeaderboardEntry {
  studentId: string;
  name: string;
  profilePic: string;
  currentCourseDay: number;
  batch?: string;
  exercisesCompleted: number;
  exercisesTotal: number;
  dgSessionsCompleted: number;
  arenaXp: number;
  averageScore: number | null;
  loginPoints: number;
  totalPoints: number;
  exerciseCompletionPercent: number;
  currentStreak: number;
  loggedToday: boolean;
  rank: number;
  engagementMinutes: number;
  liveClassMinutes: number;
  gluckExamScore: number | null;
  gluckExamCompleted: number;
  gluckExamTotal: number;
}

export interface TaskProgress {
  done: number;
  total: number;
}

export interface TodayTasks {
  courseDay: number;
  period?: LeaderboardPeriod;
  liveClasses: TaskProgress;
  exercises: TaskProgress;
  gluckBuddy: TaskProgress;
  arena: TaskProgress;
}

export interface BatchLeaderboardResponse {
  period: LeaderboardPeriod;
  batch: string | null;
  leaderboard: LeaderboardEntry[];
  myRank: number | null;
  myStats: LeaderboardEntry | null;
  batchmates: number;
  todayTasks: TodayTasks | null;
}

export interface AdminLeaderboardResponse {
  period: LeaderboardPeriod;
  batch: string;
  batches: string[] | 'all';
  leaderboard: LeaderboardEntry[];
  batchmates: number;
  activeCount: number;
  loggedTodayCount: number;
  loggedOnlyCount: number;
  inactiveCount: number;
  page: number;
  limit: number;
  totalPages: number;
  totalStudents: number;
}

export interface BatchListResponse {
  batches: string[];
}

@Injectable({ providedIn: 'root' })
export class BatchLeaderboardService {
  private readonly base = `${environment.apiUrl}/batch-leaderboard`;

  constructor(private http: HttpClient) {}

  getLeaderboard(period: LeaderboardPeriod): Observable<BatchLeaderboardResponse> {
    const params = new HttpParams().set('period', period);
    return this.http.get<BatchLeaderboardResponse>(this.base, { params });
  }

  getAdminBatches(): Observable<BatchListResponse> {
    return this.http.get<BatchListResponse>(`${this.base}/admin`);
  }

  getAdminLeaderboard(
    batches: string[] | 'all',
    period: LeaderboardPeriod,
    page = 1,
    limit = 20,
    search = '',
  ): Observable<AdminLeaderboardResponse> {
    const batchParam = batches === 'all' ? 'all' : batches.join(',');
    let params = new HttpParams()
      .set('period', period)
      .set('batch', batchParam)
      .set('page', String(page))
      .set('limit', String(limit));
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<AdminLeaderboardResponse>(`${this.base}/admin`, { params });
  }
}
