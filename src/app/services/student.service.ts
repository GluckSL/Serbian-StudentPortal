// src/app/services/student.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class StudentService {
  private apiUrl = `${environment.apiUrl}/profile`; // Adjust the base path if needed

  constructor(private http: HttpClient) {}

  // Get logged-in student profile
  getStudentProfile(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/profile`, { withCredentials: true });
  }

  // Get VAPI access
  getVapiAccess(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/vapi-access`, { withCredentials: true });
  }
}
