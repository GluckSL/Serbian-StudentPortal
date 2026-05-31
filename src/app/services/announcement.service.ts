import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type AnnouncementChannel = 'website' | 'whatsapp';
export type AnnouncementDeliveryType = 'website' | 'website_email';

export interface AnnouncementAttachment {
  fileName: string;
  fileUrl: string;
  mimeType?: string;
  fileSize?: number;
}

export interface AnnouncementItem {
  _id: string;
  channel: AnnouncementChannel;
  deliveryType: AnnouncementDeliveryType;
  targetBatches: string[];
  title: string;
  body: string;
  attachments: AnnouncementAttachment[];
  emailSubject?: string;
  emailBody?: string;
  createdBy?: { _id: string; name: string; role: string };
  createdAt: string;
  updatedAt: string;
  isActive?: boolean;
  scheduledPublishAt?: string | null;
}

export interface AnnouncementTargetStudent {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  batch: string;
  isTestAccount?: boolean;
}

export interface AnnouncementsAdminPage {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable({ providedIn: 'root' })
export class AnnouncementService {
  private readonly apiUrl = `${environment.apiUrl}/announcements`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<{ success: boolean; data: AnnouncementItem[] }> {
    return this.http.get<{ success: boolean; data: AnnouncementItem[] }>(this.apiUrl, {
      withCredentials: true,
      params: { _ts: String(Date.now()) }
    });
  }

  /** Paginated admin list; only the requested page is loaded from the server. */
  getAdminPage(
    page: number,
    limit: number
  ): Observable<{ success: boolean; data: AnnouncementItem[]; pagination: AnnouncementsAdminPage }> {
    return this.http.get<{
      success: boolean;
      data: AnnouncementItem[];
      pagination: AnnouncementsAdminPage;
    }>(this.apiUrl, {
      withCredentials: true,
      params: {
        page: String(Math.max(1, page)),
        limit: String(limit),
        _ts: String(Date.now())
      }
    });
  }

  getForStudent(): Observable<{ success: boolean; data: AnnouncementItem[] }> {
    return this.http.get<{ success: boolean; data: AnnouncementItem[] }>(`${this.apiUrl}/student`, {
      withCredentials: true,
      params: { _ts: String(Date.now()) }
    });
  }

  getTargetStudents(
    batches: string[]
  ): Observable<{ success: boolean; data: AnnouncementTargetStudent[]; total: number }> {
    return this.http.get<{ success: boolean; data: AnnouncementTargetStudent[]; total: number }>(
      `${this.apiUrl}/target-students`,
      {
        withCredentials: true,
        params: {
          batches: JSON.stringify(batches || []),
          _ts: String(Date.now())
        }
      }
    );
  }

  create(payload: {
    channel: AnnouncementChannel;
    deliveryType: AnnouncementDeliveryType;
    title: string;
    body: string;
    targetBatches: string[];
    emailSubject?: string;
    emailBody?: string;
    scheduleAt?: string;
    attachments?: File[];
  }): Observable<{ success: boolean; data: AnnouncementItem; message?: string }> {
    const formData = new FormData();
    formData.append('channel', payload.channel);
    formData.append('deliveryType', payload.deliveryType);
    formData.append('title', payload.title);
    formData.append('body', payload.body);
    formData.append('targetBatches', JSON.stringify(payload.targetBatches || []));
    if (payload.emailSubject) formData.append('emailSubject', payload.emailSubject);
    if (payload.emailBody) formData.append('emailBody', payload.emailBody);
    if (payload.scheduleAt) formData.append('scheduleAt', payload.scheduleAt);
    (payload.attachments || []).forEach((file) => formData.append('attachments', file, file.name));

    return this.http.post<{ success: boolean; data: AnnouncementItem; message?: string }>(
      this.apiUrl,
      formData,
      { withCredentials: true }
    );
  }

  update(
    announcementId: string,
    payload: {
      deliveryType: AnnouncementDeliveryType;
      title: string;
      body: string;
      targetBatches: string[];
      emailSubject?: string;
      emailBody?: string;
    }
  ): Observable<{ success: boolean; data: AnnouncementItem; message?: string }> {
    return this.http.put<{ success: boolean; data: AnnouncementItem; message?: string }>(
      `${this.apiUrl}/${announcementId}`,
      payload,
      { withCredentials: true }
    );
  }

  delete(announcementId: string): Observable<{ success: boolean; message?: string }> {
    return this.http.delete<{ success: boolean; message?: string }>(`${this.apiUrl}/${announcementId}`, {
      withCredentials: true
    });
  }
}
