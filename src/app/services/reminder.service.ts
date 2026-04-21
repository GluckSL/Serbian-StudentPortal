import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ReminderRecipient {
  _id: string;
  studentId: string;
  name: string;
  phone: string;
  messageBody: string;
  status: 'queued' | 'in_progress' | 'sent' | 'failed';
  scheduledFor?: string | null;
  sentAt: string | null;
  error: string;
  isTestAccount?: boolean;
}

export interface Reminder {
  _id: string;
  title: string;
  body: string;
  targetBatch: string;
  deliveryMode?: 'instant' | 'scheduled';
  scheduleScope?: 'one' | 'all' | 'multi';
  scheduledFor?: string | null;
  createdBy: { name: string; role: string } | null;
  status: 'queued' | 'scheduled' | 'in_progress' | 'completed' | 'failed';
  isActive?: boolean;
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
    title: string;
    body: string;
    targetBatch: string;
    deliveryMode?: 'instant' | 'scheduled';
    /** Wall-clock India / ISO datetime when not using minutesBeforeClass */
    scheduledFor?: string;
    /** Send at (class start − minutes). Omit when using manual scheduledFor. */
    minutesBeforeClass?: number;
  }): Observable<{ success: boolean; data: Reminder; warnings: string[] }> {
    return this.http.post<{ success: boolean; data: Reminder; warnings: string[] }>(
      `${this.base}`,
      payload,
      { withCredentials: true }
    );
  }

  updateReminder(id: string, payload: {
    title: string;
    body: string;
    scheduledFor?: string | null;
  }): Observable<{ success: boolean; data: Reminder }> {
    return this.http.put<{ success: boolean; data: Reminder }>(
      `${this.base}/${id}`,
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

  setReminderActivity(id: string, isActive: boolean): Observable<{ success: boolean; message: string; data: Reminder }> {
    return this.http.patch<{ success: boolean; message: string; data: Reminder }>(
      `${this.base}/${id}/activity`,
      { isActive },
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
