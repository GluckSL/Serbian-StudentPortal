import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class VisaTrackingService {
  private api = `${environment.apiUrl}/visa-tracking`;

  constructor(private http: HttpClient) {}

  getStages(): Observable<any> {
    return this.http.get(`${this.api}/stages`, { withCredentials: true });
  }

  getAll(): Observable<any> {
    return this.http.get(`${this.api}/all`, { withCredentials: true });
  }

  getByStudent(studentId: string): Observable<any> {
    return this.http.get(`${this.api}/student/${studentId}`, { withCredentials: true });
  }

  create(data: any): Observable<any> {
    return this.http.post(this.api, data, { withCredentials: true });
  }

  update(id: string, data: any): Observable<any> {
    return this.http.put(`${this.api}/${id}`, data, { withCredentials: true });
  }

  delete(id: string): Observable<any> {
    return this.http.delete(`${this.api}/${id}`, { withCredentials: true });
  }
}
