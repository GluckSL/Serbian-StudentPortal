// teacher.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class TeacherService {
  private baseUrl = `${environment.apiUrl}/teacher`; // Adjust if your route prefix is different

  constructor(private http: HttpClient) {}

  getAllTeachers(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/`, { withCredentials: true });
  }

  // Get logged-in teacher profile
  getTeacherProfile(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/profile`);
  }


  // ✅ Get students assigned to the logged-in teacher
  getAssignedStudents(): Observable<any> {
    // const token = localStorage.getItem('authToken');
    // console.log('Retrieved token:', token); // Debugging line
    // const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    return this.http.get<any>(`${this.baseUrl}/students`, { withCredentials: true});
  }

  /** Batch labels from meetings this teacher teaches (for My Classes filters). */
  getClassBatches(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/class-batches`, { withCredentials: true });
  }

  getMonthlyHours(month: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/monthly-hours?month=${encodeURIComponent(month)}`, { withCredentials: true });
  }
  
  getTeacherById(teacherId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/${teacherId}`, { withCredentials: true });
  }



}
