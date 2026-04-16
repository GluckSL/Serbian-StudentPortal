import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  AnnouncementTargetStudent,
  AnnouncementDeliveryType,
  AnnouncementItem,
  AnnouncementService
} from '../../services/announcement.service';
import { NotificationService } from '../../services/notification.service';
import { environment } from '../../../environments/environment';

interface BatchSummary {
  batchName: string;
}

@Component({
  selector: 'app-admin-announcements',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-announcements.component.html',
  styleUrls: ['./admin-announcements.component.css']
})
export class AdminAnnouncementsComponent implements OnInit {
  activeChannel: 'website' | 'whatsapp' = 'website';
  deliveryType: AnnouncementDeliveryType = 'website';
  sendMode: 'instant' | 'schedule' = 'instant';
  title = '';
  body = '';
  scheduleAt = '';
  emailSubject = '';
  emailBody = '';
  batches: BatchSummary[] = [];
  selectedBatches: string[] = [];
  batchToAdd = '';
  selectedFiles: File[] = [];
  targetStudents: AnnouncementTargetStudent[] = [];
  loadingTargetStudents = false;
  loading = false;
  saving = false;
  announcements: AnnouncementItem[] = [];

  constructor(
    private http: HttpClient,
    private announcementService: AnnouncementService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadBatches();
    this.loadAnnouncements();
  }

  get isWebsiteEmail(): boolean {
    return this.deliveryType === 'website_email';
  }

  get isScheduled(): boolean {
    return this.sendMode === 'schedule';
  }

  loadBatches(): void {
    this.http
      .get<{ batches: BatchSummary[] }>(`${environment.apiUrl}/batch-journey`, { withCredentials: true })
      .subscribe({
        next: (res) => {
          this.batches = (res?.batches || []).sort((a, b) => a.batchName.localeCompare(b.batchName));
        },
        error: () => {
          this.notify.error('Failed to load batches.');
        }
      });
  }

  loadAnnouncements(): void {
    this.loading = true;
    this.announcementService.getAll().subscribe({
      next: (res) => {
        this.announcements = res?.data || [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.error('Failed to load announcements.');
      }
    });
  }

  toggleBatch(batchName: string): void {
    const idx = this.selectedBatches.indexOf(batchName);
    if (idx >= 0) this.selectedBatches.splice(idx, 1);
    else this.selectedBatches.push(batchName);
    this.loadTargetStudentsPreview();
  }

  isBatchSelected(batchName: string): boolean {
    return this.selectedBatches.includes(batchName);
  }

  selectAllBatches(): void {
    this.selectedBatches = this.batches.map((b) => b.batchName);
    this.loadTargetStudentsPreview();
  }

  clearBatchSelection(): void {
    this.selectedBatches = [];
    this.loadTargetStudentsPreview();
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFiles = input.files ? Array.from(input.files) : [];
  }

  onBatchDropdownChange(): void {
    const batchName = String(this.batchToAdd || '').trim();
    if (batchName && !this.selectedBatches.includes(batchName)) {
      this.selectedBatches = [...this.selectedBatches, batchName];
      this.loadTargetStudentsPreview();
    }
    this.batchToAdd = '';
  }

  removeBatch(batchName: string): void {
    this.selectedBatches = this.selectedBatches.filter((b) => b !== batchName);
    this.loadTargetStudentsPreview();
  }

  get previewTitle(): string {
    return this.title.trim() || 'Portal Notification';
  }

  get previewBody(): string {
    const text = this.body.trim();
    if (!text) return 'Your message preview appears here.';
    return text.length > 70 ? `${text.slice(0, 70)}...` : text;
  }

  formatBytes(size: number | undefined): string {
    const value = Number(size || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let idx = 0;
    let n = value;
    while (n >= 1024 && idx < units.length - 1) {
      n /= 1024;
      idx += 1;
    }
    return `${n.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  setSendMode(mode: 'instant' | 'schedule'): void {
    this.sendMode = mode;
    if (mode === 'instant') {
      this.scheduleAt = '';
    }
  }

  loadTargetStudentsPreview(): void {
    if (!this.selectedBatches.length) {
      this.targetStudents = [];
      this.loadingTargetStudents = false;
      return;
    }

    this.loadingTargetStudents = true;
    this.announcementService.getTargetStudents(this.selectedBatches).subscribe({
      next: (res) => {
        this.targetStudents = res?.data || [];
        this.loadingTargetStudents = false;
        console.info('[admin-announcements] target students preview loaded', {
          selectedBatches: this.selectedBatches,
          totalStudents: this.targetStudents.length
        });
      },
      error: () => {
        this.loadingTargetStudents = false;
        this.targetStudents = [];
        this.notify.error('Failed to load students for selected batch.');
      }
    });
  }

  createAnnouncement(): void {
    if (this.activeChannel !== 'website') {
      this.notify.info('WhatsApp announcements will be added next.');
      return;
    }
    if (!this.title.trim() || !this.body.trim()) {
      this.notify.warning('Title and body are required.');
      return;
    }
    if (!this.selectedBatches.length) {
      this.notify.warning('Select at least one batch.');
      return;
    }
    if (this.isScheduled && !this.scheduleAt) {
      this.notify.warning('Please select date and time for scheduled announcement.');
      return;
    }

    this.saving = true;
    this.announcementService
      .create({
        channel: 'website',
        deliveryType: this.deliveryType,
        title: this.title.trim(),
        body: this.body.trim(),
        targetBatches: this.selectedBatches,
        // For Website + Email: reuse Title & Body as email subject/body.
        emailSubject: this.isWebsiteEmail ? this.title.trim() : '',
        emailBody: this.isWebsiteEmail ? this.body.trim() : '',
        scheduleAt: this.isScheduled ? this.scheduleAt : '',
        attachments: this.selectedFiles
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.success('Announcement created successfully.');
          this.resetForm();
          this.loadAnnouncements();
        },
        error: (err) => {
          this.saving = false;
          this.notify.error(err?.error?.message || 'Failed to create announcement.');
        }
      });
  }

  saveDraftPlaceholder(): void {
    this.notify.info('Draft flow can be added next.');
  }

  private resetForm(): void {
    this.deliveryType = 'website';
    this.sendMode = 'instant';
    this.title = '';
    this.body = '';
    this.scheduleAt = '';
    this.emailSubject = '';
    this.emailBody = '';
    this.selectedBatches = [];
    this.targetStudents = [];
    this.batchToAdd = '';
    this.selectedFiles = [];
  }
}
