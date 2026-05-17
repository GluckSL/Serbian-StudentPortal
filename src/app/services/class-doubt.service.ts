import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ClassDoubtService {
  private base = `${environment.apiUrl}/class-doubts`
  constructor(private http: HttpClient) {}

  list(meetingId: string): Observable<any> {
    return this.http.get(`${this.base}/${meetingId}`, { withCredentials: true });
  }

  submit(meetingId: string, data: { title: string; explanation: string; visibility: string }): Observable<any> {
    return this.http.post(`${this.base}/${meetingId}`, data, { withCredentials: true });
  }

  reply(doubtId: string, text: string): Observable<any> {
    return this.http.post(`${this.base}/${doubtId}/reply`, { text }, { withCredentials: true });
  }

  delete(doubtId: string): Observable<any> {
    return this.http.delete(`${this.base}/${doubtId}`, { withCredentials: true });
  }
}
