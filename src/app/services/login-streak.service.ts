import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LoginStreakData {
  isFirstLoginToday: boolean;
  currentStreak: number;
  bestStreak: number;
  weeklyDays: number;
  weekKey: string | null;
  totalTrophies: number;
  weeklyRewardTier: string | null;
  loggedDates: string[];
  weekDates: string[];
}

export interface LoginStreakResponse {
  success: boolean;
  data: LoginStreakData;
}

@Injectable({ providedIn: 'root' })
export class LoginStreakService {
  private readonly base = `${environment.apiUrl}/student/login-streak`;

  constructor(private http: HttpClient) {}

  checkLoginStreak(): Observable<LoginStreakResponse> {
    return this.http.post<LoginStreakResponse>(`${this.base}/check`, {});
  }

  getLoginStreak(): Observable<LoginStreakResponse> {
    return this.http.get<LoginStreakResponse>(this.base);
  }
}
