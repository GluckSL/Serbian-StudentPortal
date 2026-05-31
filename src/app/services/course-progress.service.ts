// src/app/services/course-progress.service.ts


import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

interface CourseProgress {
  courseId: { _id: string; name: string };
  progressPercentage: number;
  lastUpdated: string;
}

@Injectable({
  providedIn: 'root'
})
export class CourseProgressService {
  private readonly apiUrl = `${environment.apiUrl}/student`;

  constructor(private http: HttpClient) {}

  getProgress(): Observable<CourseProgress[]> {
    return this.http.get<CourseProgress[]>(`${this.apiUrl}/progress`);
  }
}
