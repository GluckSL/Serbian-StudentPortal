import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface UniversityApplicationStage {
  stage: number;
  status: 'pending' | 'in_progress' | 'completed';
  message: string;
  stageDate?: string | Date | null;
  updatedAt?: string | Date | null;
}

export interface UniversityApplication {
  _id: string;
  studentId: string | { _id: string; name?: string; email?: string; regNo?: string };
  universityName: string;
  course?: string;
  degreeLevel?: string;
  country?: string;
  city?: string;
  campus?: string;
  intakeTerm?: string;
  applicationReference?: string;
  website?: string;
  languageOfInstruction?: string;
  duration?: string;
  tuitionFee?: string;
  notes?: string;
  stages: UniversityApplicationStage[];
  finalOutcome?: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  adminNotes?: string;
  currentStage?: number;
  stageDefinitions?: { stage: number; label: string; desc: string }[];
  updatedAt?: string;
  createdAt?: string;
}

export interface UniversityStageDefinition {
  stage: number;
  label: string;
  desc: string;
}

@Injectable({ providedIn: 'root' })
export class UniversityApplicationService {
  private api = `${environment.apiUrl}/university-applications`;

  constructor(private http: HttpClient) {}

  getStages(): Observable<{ success: boolean; data: UniversityStageDefinition[] }> {
    return this.http.get<{ success: boolean; data: UniversityStageDefinition[] }>(`${this.api}/stages`, { withCredentials: true });
  }

  getAllAdmin(): Observable<{ success: boolean; data: UniversityApplication[] }> {
    return this.http.get<{ success: boolean; data: UniversityApplication[] }>(`${this.api}/admin/all`, { withCredentials: true });
  }

  getByStudent(studentId: string): Observable<{ success: boolean; data: UniversityApplication[] }> {
    return this.http.get<{ success: boolean; data: UniversityApplication[] }>(`${this.api}/admin/student/${studentId}`, { withCredentials: true });
  }

  createForStudent(studentId: string, data: Partial<UniversityApplication>): Observable<{ success: boolean; data: UniversityApplication }> {
    return this.http.post<{ success: boolean; data: UniversityApplication }>(`${this.api}/admin/student/${studentId}`, data, { withCredentials: true });
  }

  update(id: string, data: Partial<UniversityApplication>): Observable<{ success: boolean; data: UniversityApplication }> {
    return this.http.put<{ success: boolean; data: UniversityApplication }>(`${this.api}/${id}`, data, { withCredentials: true });
  }

  delete(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.api}/${id}`, { withCredentials: true });
  }

  getMine(): Observable<{ success: boolean; data: UniversityApplication[] }> {
    return this.http.get<{ success: boolean; data: UniversityApplication[] }>(`${this.api}/student/mine`, { withCredentials: true });
  }
}
