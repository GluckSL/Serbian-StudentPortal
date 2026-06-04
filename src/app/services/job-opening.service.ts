import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type JobType = 'Full Time' | 'Part Time' | 'Internship' | 'Contract';
export type LocationType = 'Onsite' | 'Remote' | 'Hybrid';

export interface JobOpening {
  _id: string;
  companyName: string;
  companyLogoUrl?: string;
  jobTitle: string;
  jobType: JobType;
  experience: string;
  jobCategory: string;
  locationType: LocationType;
  location: string;
  salary: string;
  skills: string[];
  description: string;
  applyBefore: string;
  isPublished?: boolean;
  isActive?: boolean;
  applicationCount?: number;
  createdBy?: { _id: string; name: string; role: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface JobApplyPrefill {
  name: string;
  email: string;
  regNo: string;
  batch: string;
  phone: string;
}

export interface JobApplicationRecord {
  _id: string;
  studentId: { _id: string; name?: string; email?: string; regNo?: string; batch?: string; isTestAccount?: boolean } | string;
  jobOpeningId: { _id: string; companyName?: string; jobTitle?: string } | string;
  studentName: string;
  studentEmail: string;
  studentRegNo: string;
  studentBatch: string;
  phone: string;
  linkedIn: string;
  coverLetter: string;
  resumeFileName: string;
  resumeUrl: string;
  createdAt: string;
}

export interface JobPortalStats {
  organizations: number;
  openings: number;
  averagePackageLabel: string;
  heroTitle: string;
  heroSubtitle: string;
}

export interface JobPortalSettings {
  heroTitle: string;
  heroSubtitle: string;
  averagePackageLabel: string;
}

export interface StudentJobListResponse {
  success: boolean;
  data: JobOpening[];
  stats: JobPortalStats;
  appliedIds: string[];
}

@Injectable({ providedIn: 'root' })
export class JobOpeningService {
  private readonly apiUrl = `${environment.apiUrl}/job-openings`;

  constructor(private http: HttpClient) {}

  getAdminAll(): Observable<{ success: boolean; data: JobOpening[] }> {
    return this.http.get<{ success: boolean; data: JobOpening[] }>(this.apiUrl, {
      withCredentials: true,
      params: { _ts: String(Date.now()) }
    });
  }

  getAdminApplications(jobOpeningId?: string): Observable<{ success: boolean; data: JobApplicationRecord[]; total: number }> {
    const params: Record<string, string> = { _ts: String(Date.now()) };
    if (jobOpeningId) params['jobOpeningId'] = jobOpeningId;
    return this.http.get<{ success: boolean; data: JobApplicationRecord[]; total: number }>(
      `${this.apiUrl}/admin/applications`,
      { withCredentials: true, params }
    );
  }

  getAdminOne(id: string): Observable<{ success: boolean; data: JobOpening }> {
    return this.http.get<{ success: boolean; data: JobOpening }>(`${this.apiUrl}/${id}`, {
      withCredentials: true
    });
  }

  getPortalSettingsAdmin(): Observable<{
    success: boolean;
    data: { settings: JobPortalSettings; stats: JobPortalStats };
  }> {
    return this.http.get<{
      success: boolean;
      data: { settings: JobPortalSettings; stats: JobPortalStats };
    }>(`${this.apiUrl}/portal-settings`, { withCredentials: true });
  }

  savePortalSettings(payload: Partial<JobPortalSettings>): Observable<{
    success: boolean;
    data: { settings: JobPortalSettings; stats: JobPortalStats };
  }> {
    return this.http.put<{
      success: boolean;
      data: { settings: JobPortalSettings; stats: JobPortalStats };
    }>(`${this.apiUrl}/portal-settings`, payload, { withCredentials: true });
  }

  create(formData: FormData): Observable<{ success: boolean; data: JobOpening }> {
    return this.http.post<{ success: boolean; data: JobOpening }>(this.apiUrl, formData, {
      withCredentials: true
    });
  }

  update(id: string, formData: FormData): Observable<{ success: boolean; data: JobOpening }> {
    return this.http.put<{ success: boolean; data: JobOpening }>(`${this.apiUrl}/${id}`, formData, {
      withCredentials: true
    });
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/${id}`, { withCredentials: true });
  }

  getForStudent(appliedOnly = false): Observable<StudentJobListResponse> {
    return this.http.get<StudentJobListResponse>(`${this.apiUrl}/student`, {
      withCredentials: true,
      params: appliedOnly ? { appliedOnly: '1', _ts: String(Date.now()) } : { _ts: String(Date.now()) }
    });
  }

  getStudentDetail(id: string): Observable<{ success: boolean; data: JobOpening; applied: boolean }> {
    return this.http.get<{ success: boolean; data: JobOpening; applied: boolean }>(
      `${this.apiUrl}/student/${id}`,
      { withCredentials: true }
    );
  }

  getApplyPrefill(): Observable<{ success: boolean; data: JobApplyPrefill }> {
    return this.http.get<{ success: boolean; data: JobApplyPrefill }>(
      `${this.apiUrl}/student/apply-prefill`,
      { withCredentials: true }
    );
  }

  submitApplication(jobId: string, formData: FormData): Observable<{ success: boolean; data: JobApplicationRecord }> {
    return this.http.post<{ success: boolean; data: JobApplicationRecord }>(
      `${this.apiUrl}/student/${jobId}/apply`,
      formData,
      { withCredentials: true }
    );
  }

  resumeFullUrl(path: string): string {
    const url = String(path || '').trim();
    if (!url) return '';
    if (url.startsWith('http')) return url;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return `${base}${url.startsWith('/') ? url : `/${url}`}`;
  }
}
