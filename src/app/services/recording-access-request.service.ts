import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface RecordingRequestQuota {
  level: string;
  approvedCount: number;
  remaining: number;
  limit: number;
}

export interface EligibleClass {
  meetingLinkId: string;
  topic: string;
  batch: string;
  startTime: string;
  duration: number;
  teacherName: string;
  attendanceStatus: string;
  hasRecording: boolean;
  isAlreadyPublished: boolean;
  requestStatus: 'PENDING' | 'APPROVED' | 'DECLINED' | null;
  canRequest: boolean;
}

export interface EligibleClassesPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface EligibleClassesResponse {
  success: boolean;
  classes: EligibleClass[];
  quota: RecordingRequestQuota;
  pagination?: EligibleClassesPagination;
}

export interface PendingRequest {
  _id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentBatch: string;
  studentLevel: string;
  classTopic: string;
  classDate: string;
  status: string;
  requestedAt: string;
  hasRecording: boolean;
  approvedCount: number;
  remaining: number;
  limit: number;
  meetingLinkId: {
    _id: string;
    topic: string;
    startTime: string;
    zoomMeetingId?: string;
    batch?: string;
  };
}

@Injectable({ providedIn: 'root' })
export class RecordingAccessRequestService {
  private readonly url = `${environment.apiUrl}/recording-access-requests`;

  constructor(private http: HttpClient) {}

  getQuota(): Observable<RecordingRequestQuota & { success: boolean }> {
    return this.http.get<any>(`${this.url}/quota`);
  }

  getEligibleClasses(page = 1, pageSize = 7): Observable<EligibleClassesResponse> {
    return this.http.get<EligibleClassesResponse>(`${this.url}/eligible-classes`, {
      params: { page: String(page), pageSize: String(pageSize) },
    });
  }

  submitRequest(meetingLinkId: string): Observable<any> {
    return this.http.post<any>(this.url, { meetingLinkId });
  }

  // Admin
  getPendingRequests(): Observable<{ success: boolean; requests: PendingRequest[]; total: number }> {
    return this.http.get<any>(`${this.url}/admin/pending`);
  }

  getPendingCount(): Observable<{ success: boolean; count: number }> {
    return this.http.get<any>(`${this.url}/admin/count`);
  }

  approveRequest(id: string): Observable<any> {
    return this.http.post<any>(`${this.url}/admin/${id}/approve`, {});
  }

  declineRequest(id: string, reason?: string): Observable<any> {
    return this.http.post<any>(`${this.url}/admin/${id}/decline`, { reason: reason || '' });
  }
}
