import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ClassSubmissionService {
  private base = `${environment.apiUrl}/class-submissions`;

  constructor(private http: HttpClient) {}

  upload(meetingId: string, formData: FormData): Observable<any> {
    return this.http.post(`${this.base}/${meetingId}/upload`, formData, { withCredentials: true });
  }

  list(meetingId: string): Observable<any> {
    return this.http.get(`${this.base}/${meetingId}`, { withCredentials: true });
  }

  review(submissionId: string, status: 'correct' | 'wrong', comment: string): Observable<any> {
    return this.http.put(`${this.base}/${submissionId}/review`, { status, comment }, { withCredentials: true });
  }

  remove(submissionId: string): Observable<any> {
    return this.http.delete(`${this.base}/${submissionId}`, { withCredentials: true });
  }
}
