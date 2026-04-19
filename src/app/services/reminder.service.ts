import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ReminderAttachment {
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
}

export interface ReminderTemplate {
  _id: string;
  title: string;
  body: string;
  attachments: ReminderAttachment[];
  createdBy: { name: string; role: string } | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderRecipient {
  _id: string;
  studentId: string;
  name: string;
  phone: string;
  messageBody: string;
  status: 'queued' | 'in_progress' | 'sent' | 'failed';
  sentAt: string | null;
  error: string;
  isTestAccount?: boolean;
}

export interface Reminder {
  _id: string;
  templateId: { _id: string; title: string } | null;
  title: string;
  body: string;
  attachments: ReminderAttachment[];
  targetBatch: string;
  deliveryMode?: 'instant' | 'scheduled';
  scheduleScope?: 'one' | 'all' | 'multi';
  createdBy: { name: string; role: string } | null;
  status: 'queued' | 'scheduled' | 'in_progress' | 'completed' | 'failed';
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  recipients?: ReminderRecipient[];
  createdAt: string;
  updatedAt: string;
}

export interface BatchPreviewStudent {
  _id: string;
  name: string;
  regNo: string;
  phone: string;
  level: string;
  studentStatus: string;
  isTestAccount?: boolean;
}

export interface BatchPreviewMeeting {
  _id: string;
  topic: string;
  startTime: string;
  duration: number;
  batch: string;
  plan: string;
  platform: string;
  joinUrl: string;
  courseDay: number | null;
}

export interface BatchPreview {
  students: BatchPreviewStudent[];
  meetings: BatchPreviewMeeting[];
}

@Injectable({ providedIn: 'root' })
export class ReminderService {
  private readonly base = `${environment.apiUrl}/reminders`;

  constructor(private http: HttpClient) {}

  // ── Templates ──────────────────────────────────────────────────────────────

  getTemplates(): Observable<{ success: boolean; data: ReminderTemplate[] }> {
    return this.http.get<{ success: boolean; data: ReminderTemplate[] }>(
      `${this.base}/templates`,
      { withCredentials: true }
    );
  }

  createTemplate(form: FormData): Observable<{ success: boolean; data: ReminderTemplate }> {
    return this.http.post<{ success: boolean; data: ReminderTemplate }>(
      `${this.base}/templates`,
      form,
      { withCredentials: true }
    );
  }

  updateTemplate(id: string, body: { title: string; body: string }): Observable<{ success: boolean; data: ReminderTemplate }> {
    return this.http.put<{ success: boolean; data: ReminderTemplate }>(
      `${this.base}/templates/${id}`,
      body,
      { withCredentials: true }
    );
  }

  deleteTemplate(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(
      `${this.base}/templates/${id}`,
      { withCredentials: true }
    );
  }

  // ── Batch preview ──────────────────────────────────────────────────────────

  getBatchPreview(batchName: string): Observable<{ success: boolean; data: BatchPreview }> {
    return this.http.get<{ success: boolean; data: BatchPreview }>(
      `${this.base}/batch/${encodeURIComponent(batchName)}/preview`,
      { withCredentials: true }
    );
  }

  // ── Reminders ──────────────────────────────────────────────────────────────

  getReminders(): Observable<{ success: boolean; data: Reminder[] }> {
    return this.http.get<{ success: boolean; data: Reminder[] }>(
      `${this.base}`,
      { withCredentials: true }
    );
  }

  getReminderById(id: string): Observable<{ success: boolean; data: Reminder }> {
    return this.http.get<{ success: boolean; data: Reminder }>(
      `${this.base}/${id}`,
      { withCredentials: true }
    );
  }

  createReminder(payload: {
    templateId?: string;
    title?: string;
    body?: string;
    targetBatch: string;
    deliveryMode?: 'instant' | 'scheduled';
    scheduleScope?: 'one' | 'all' | 'multi';
    meetingIds?: string[];
  }): Observable<{ success: boolean; data: Reminder; warnings: string[] }> {
    return this.http.post<{ success: boolean; data: Reminder; warnings: string[] }>(
      `${this.base}`,
      payload,
      { withCredentials: true }
    );
  }

  resendFailed(id: string): Observable<{ success: boolean; message: string; requeued: number }> {
    return this.http.post<{ success: boolean; message: string; requeued: number }>(
      `${this.base}/${id}/resend-failed`,
      {},
      { withCredentials: true }
    );
  }

  deleteReminder(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(
      `${this.base}/${id}`,
      { withCredentials: true }
    );
  }
}
