import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CrmStudentPortalService,
  CrmStudentPortalSettingsDto,
  ManualAnnouncementOptionsDto
} from '../../../services/crm-student-portal.service';

@Component({
  selector: 'app-whatsapp-announcement',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './whatsapp-announcement.component.html',
  styleUrls: ['./whatsapp-announcement.component.css']
})
export class WhatsappAnnouncementComponent implements OnInit {
  loading = false;
  saving = false;
  fullSyncing = false;
  manualTriggering = false;
  syncBusy: Record<string, boolean> = {};
  toast = '';
  error = '';

  settings: CrmStudentPortalSettingsDto | null = null;
  manualOptions: ManualAnnouncementOptionsDto = {
    batches: [],
    statuses: [],
    levels: [],
    services: [],
    qualifications: [],
    streams: []
  };

  webhookUrlOverride = '';
  metaDefaults = { remainderFrom: '', participate: '', feedbackForm: '' };
  enabledEvents: Record<string, boolean> = {};
  cronEnabled = false;
  cronExpression = '0 2 * * *';

  campaignName = '';
  deliveryMode: 'instant' | 'schedule' = 'instant';
  scheduleDelivery = '';
  messageBody = '';
  filterBatch = 'all';
  filterStatus = 'all';
  filterLevel = 'all';
  filterService = 'all';
  filterQualification = 'all';
  filterStream = 'all';
  waTemplate = '';
  lastManualResult: any = null;

  constructor(private crm: CrmStudentPortalService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.loadManualOptions();
    this.crm.getSettings().subscribe({
      next: (res) => {
        this.loading = false;
        if (!res.success || !res.data) {
          this.error = 'Could not load settings';
          return;
        }
        this.applyDto(res.data);
      },
      error: (e) => {
        this.loading = false;
        this.error = e.error?.message || e.message || 'Failed to load';
      }
    });
  }

  loadManualOptions(): void {
    this.crm.getManualAnnouncementOptions().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.manualOptions = res.data;
        }
      },
      error: () => {}
    });
  }

  private applyDto(data: CrmStudentPortalSettingsDto): void {
    this.settings = data;
    this.webhookUrlOverride = data.webhookUrlOverride || '';
    this.metaDefaults = {
      remainderFrom: data.metaDefaults?.remainderFrom ?? '',
      participate: data.metaDefaults?.participate ?? '',
      feedbackForm: data.metaDefaults?.feedbackForm ?? ''
    };
    this.enabledEvents = { ...(data.enabledEvents || {}) };
    this.cronEnabled = !!data.cronEnabled;
    this.cronExpression = data.cronExpression || '0 2 * * *';
  }

  get automationReady(): boolean {
    return !!(this.settings?.effectiveWebhook?.configured);
  }

  save(): void {
    this.saving = true;
    this.toast = '';
    this.error = '';
    this.crm
      .putSettings({
        webhookUrlOverride: this.webhookUrlOverride,
        metaDefaults: { ...this.metaDefaults },
        enabledEvents: { ...this.enabledEvents },
        cronEnabled: this.cronEnabled,
        cronExpression: this.cronExpression
      })
      .subscribe({
        next: (res) => {
          this.saving = false;
          if (res.success && res.data) {
            this.toast = 'Settings saved';
            this.load();
          } else {
            this.error = 'Save failed';
          }
        },
        error: (e) => {
          this.saving = false;
          this.error = e.error?.message || e.message || 'Save failed';
        }
      });
  }

  syncKind(kind: 'students' | 'teachers' | 'reminders' | 'feedback'): void {
    this.syncBusy[kind] = true;
    this.toast = '';
    this.error = '';
    this.crm.postSyncKind(kind).subscribe({
      next: (res) => {
        this.syncBusy[kind] = false;
        if (res.success) {
          this.toast = `Sync (${kind}) finished`;
        } else {
          this.error = 'Sync failed';
        }
      },
      error: (e) => {
        this.syncBusy[kind] = false;
        this.error = e.error?.message || e.message || 'Sync failed';
      }
    });
  }

  runFullSync(): void {
    this.fullSyncing = true;
    this.toast = '';
    this.error = '';
    this.crm.postFullSync().subscribe({
      next: (res) => {
        this.fullSyncing = false;
        if (res.success) {
          this.toast = 'Full sync completed';
          this.load();
        } else {
          this.error = 'Full sync failed';
        }
      },
      error: (e) => {
        this.fullSyncing = false;
        this.error = e.error?.message || e.message || 'Full sync failed';
      }
    });
  }

  triggerManualAnnouncement(): void {
    const name = this.campaignName.trim();
    if (!name) {
      this.error = 'Campaign name is required';
      return;
    }
    if (!this.messageBody.trim() && !this.waTemplate.trim()) {
      this.error = 'Message body or template is required';
      return;
    }
    if (this.deliveryMode === 'schedule' && !this.scheduleDelivery) {
      this.error = 'Please choose schedule date/time';
      return;
    }

    this.manualTriggering = true;
    this.toast = '';
    this.error = '';

    this.crm
      .triggerManualAnnouncement({
        campaignName: name,
        deliveryMode: this.deliveryMode,
        scheduleAt: this.deliveryMode === 'schedule' ? this.scheduleDelivery : undefined,
        messageTemplate: this.waTemplate || undefined,
        messageBody: this.messageBody || undefined,
        filters: {
          batch: this.filterBatch,
          status: this.filterStatus,
          level: this.filterLevel,
          service: this.filterService,
          qualification: this.filterQualification,
          stream: this.filterStream
        }
      })
      .subscribe({
        next: (res) => {
          this.manualTriggering = false;
          if (res.success) {
            this.lastManualResult = res.result;
            this.toast = `Manual trigger completed (${this.deliveryMode})`;
          } else {
            this.error = 'Manual trigger failed';
          }
        },
        error: (e) => {
          this.manualTriggering = false;
          this.error = e.error?.message || e.message || 'Manual trigger failed';
        }
      });
  }

  eventKeys(): string[] {
    return this.settings?.allEventKeys?.length
      ? this.settings.allEventKeys
      : [
          'STUDENT_CREATED',
          'STUDENT_UPDATED',
          'STUDENT_DELETED',
          'TEACHER_CREATED',
          'TEACHER_UPDATED',
          'TEACHER_DELETED',
          'REMINDER_CREATED',
          'REMINDER_UPDATED',
          'REMINDER_DELETED',
          'FEEDBACK_CREATED',
          'FEEDBACK_UPDATED'
        ];
  }

  isEventOn(key: string): boolean {
    return this.enabledEvents[key] !== false;
  }

  setEvent(key: string, on: boolean): void {
    this.enabledEvents[key] = on;
  }

  formatDt(v: string | null | undefined): string {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleString();
    } catch {
      return String(v);
    }
  }
}
