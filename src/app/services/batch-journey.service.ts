import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface JourneyTimetableLiveClass {
  meetingId: string;
  topic: string;
  startTime: string;
  endTime?: string;
  timeLabel: string;
  duration?: number;
  teacherName: string;
  joinUrl: string;
  password?: string;
  status?: string;
}

export interface JourneyTimetableExercise {
  _id: string;
  title: string;
  category?: string;
  level?: string;
  kind: 'exercise' | 'weekly-test' | 'exam';
}

export interface JourneyTimetableDgModule {
  _id: string;
  title: string;
  level?: string;
  kind: 'dg-bot' | 'weekly-test' | 'exam';
}

export interface JourneyTimetableArenaGame {
  _id: string;
  title: string;
  gameType?: string;
  difficulty?: string;
}

export interface JourneyTimetableDay {
  journeyDay: number;
  calendarDate?: string;
  dateKey?: string;
  liveClasses: JourneyTimetableLiveClass[];
  exercises: JourneyTimetableExercise[];
  dgModules: JourneyTimetableDgModule[];
  arenaGames: JourneyTimetableArenaGame[];
}

export interface JourneyTimetableResponse {
  success: boolean;
  batchName: string;
  batchStartDate?: string | null;
  journeyLength: number;
  studentCurrentDay: number;
  horizonDays: number;
  days: JourneyTimetableDay[];
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class BatchJourneyService {
  private apiUrl = `${environment.apiUrl}/batch-journey`;

  constructor(private http: HttpClient) {}

  getStudentTimetable(horizonDays = 14): Observable<JourneyTimetableResponse> {
    return this.http.get<JourneyTimetableResponse>(
      `${this.apiUrl}/student/timetable`,
      { params: { horizonDays: String(horizonDays) }, withCredentials: true }
    );
  }
}
