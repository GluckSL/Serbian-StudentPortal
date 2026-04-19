import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CrmStudentPortalSettingsDto {
  webhookUrlOverride: string;
  envHasUrl: boolean;
  effectiveWebhook: { configured: boolean; host: string };
  metaDefaults: { remainderFrom: string; participate: string; feedbackForm: string };
  enabledEvents: Record<string, boolean>;
  cronEnabled: boolean;
  cronExpression: string;
  lastFullSyncAt: string | null;
  lastFullSyncResult: unknown;
  lastDispatchError: string;
  lastDispatchAt: string | null;
  lastDispatchSuccessAt: string | null;
  allEventKeys: string[];
}

export interface ManualAnnouncementOptionsDto {
  batches: string[];
  statuses: string[];
  levels: string[];
  services: string[];
  qualifications: string[];
  streams: string[];
}

export interface ManualAnnouncementTriggerPayload {
  campaignName: string;
  deliveryMode: 'instant' | 'schedule';
  scheduleAt?: string;
  messageTemplate?: string;
  messageBody?: string;
  filters?: {
    batch?: string;
    status?: string;
    level?: string;
    service?: string;
    qualification?: string;
    stream?: string;
  };
}

@Injectable({ providedIn: 'root' })
export class CrmStudentPortalService {
  private readonly base = `${environment.apiUrl}/crm-student-portal`;

  constructor(private http: HttpClient) {}

  getSettings(): Observable<{ success: boolean; data: CrmStudentPortalSettingsDto }> {
    return this.http.get<{ success: boolean; data: CrmStudentPortalSettingsDto }>(
      `${this.base}/settings`,
      { withCredentials: true }
    );
  }

  putSettings(body: Partial<{
    webhookUrlOverride: string;
    metaDefaults: { remainderFrom: string; participate: string; feedbackForm: string };
    enabledEvents: Record<string, boolean>;
    cronEnabled: boolean;
    cronExpression: string;
  }>): Observable<{ success: boolean; data: unknown }> {
    return this.http.put<{ success: boolean; data: unknown }>(
      `${this.base}/settings`,
      body,
      { withCredentials: true }
    );
  }

  postSyncKind(kind: 'students' | 'teachers' | 'reminders' | 'feedback'): Observable<{ success: boolean; result: unknown }> {
    return this.http.post<{ success: boolean; result: unknown }>(
      `${this.base}/sync/${kind}`,
      {},
      { withCredentials: true }
    );
  }

  postFullSync(): Observable<{ success: boolean; result: unknown }> {
    return this.http.post<{ success: boolean; result: unknown }>(
      `${this.base}/sync/run-now`,
      {},
      { withCredentials: true }
    );
  }

  getManualAnnouncementOptions(): Observable<{ success: boolean; data: ManualAnnouncementOptionsDto }> {
    return this.http.get<{ success: boolean; data: ManualAnnouncementOptionsDto }>(
      `${this.base}/manual-announcement/options`,
      { withCredentials: true }
    );
  }

  triggerManualAnnouncement(
    payload: ManualAnnouncementTriggerPayload
  ): Observable<{ success: boolean; result: unknown }> {
    return this.http.post<{ success: boolean; result: unknown }>(
      `${this.base}/manual-announcement/trigger`,
      payload,
      { withCredentials: true }
    );
  }
}
