import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { QuillModule } from 'ngx-quill';
import {
  AnnouncementTargetStudent,
  AnnouncementDeliveryType,
  AnnouncementItem,
  AnnouncementService
} from '../../services/announcement.service';
import { NotificationService } from '../../services/notification.service';
import { environment } from '../../../environments/environment';
import { TestAccountBadgeComponent } from '../../shared/test-account-badge/test-account-badge.component';

interface BatchSummary {
  batchName: string;
}

@Component({
  selector: 'app-admin-announcements',
  standalone: true,
  imports: [CommonModule, FormsModule, QuillModule, TestAccountBadgeComponent],
  templateUrl: './admin-announcements.component.html',
  styleUrls: ['./admin-announcements.component.css']
})
export class AdminAnnouncementsComponent implements OnInit {
  readonly goStudentsTargetValue = '__GO_STUDENTS__';
  readonly goStudentsTargetLabel = 'GO Students';
  activeChannel: 'website' | 'whatsapp' = 'website';
  deliveryType: AnnouncementDeliveryType = 'website_email';
  sendMode: 'instant' | 'schedule' = 'instant';
  title = '';
  body = '';
  readonly quillModules = {
    toolbar: [
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ header: [1, 2, 3, false] }],
      [{ color: [] }, { background: [] }],
      ['blockquote', 'link'],
      ['clean']
    ]
  };
  scheduleAt = '';
  batches: BatchSummary[] = [];
  selectedBatches: string[] = [];
  batchToAdd = '';
  selectedFiles: File[] = [];
  targetStudents: AnnouncementTargetStudent[] = [];
  loadingTargetStudents = false;
  loading = false;
  saving = false;
  announcements: AnnouncementItem[] = [];
  refreshing = false;
  /** Server-backed pagination: only one page of rows is loaded at a time. */
  readonly pageSize = 5;
  currentPage = 1;
  totalPages = 0;
  totalCount = 0;
  actionAnnouncementId = '';
  editModalOpen = false;
  editForm = {
    id: '',
      deliveryType: 'website_email' as AnnouncementDeliveryType,
    title: '',
    body: '',
    targetBatchesText: ''
  };

  constructor(
    private http: HttpClient,
    private announcementService: AnnouncementService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadBatches();
    this.loadAnnouncements(1);
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

  loadAnnouncements(page?: number): void {
    const target = page ?? this.currentPage;
    this.loadAnnouncementsPage(target, 'list');
  }

  refreshAnnouncements(): void {
    this.loadAnnouncementsPage(this.currentPage, 'refresh');
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.loadAnnouncementsPage(page, 'list');
  }

  private loadAnnouncementsPage(page: number, mode: 'list' | 'refresh'): void {
    const isListLoad = mode === 'list';
    if (isListLoad) this.loading = true;
    else this.refreshing = true;

    this.announcementService.getAdminPage(page, this.pageSize).subscribe({
      next: (res) => {
        const items = res?.data || [];
        const pag = res?.pagination;
        if (pag) {
          this.currentPage = pag.page;
          this.totalCount = pag.total;
          this.totalPages = pag.totalPages;
        }

        if (!items.length && page > 1) {
          this.loadAnnouncementsPage(page - 1, mode);
          return;
        }

        this.announcements = items;

        if (isListLoad) this.loading = false;
        else {
          this.refreshing = false;
          this.notify.success('Announcements refreshed.');
        }
      },
      error: () => {
        if (isListLoad) this.loading = false;
        else this.refreshing = false;
        this.notify.error(isListLoad ? 'Failed to load announcements.' : 'Failed to refresh announcements.');
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

  displayTargetLabel(target: string): string {
    return target === this.goStudentsTargetValue ? this.goStudentsTargetLabel : target;
  }

  formatTargetLabels(targets: string[] | undefined): string {
    return (targets || []).map((target) => this.displayTargetLabel(target)).join(', ');
  }

  removeBatch(batchName: string): void {
    this.selectedBatches = this.selectedBatches.filter((b) => b !== batchName);
    this.loadTargetStudentsPreview();
  }

  get previewTitle(): string {
    return this.title.trim() || 'Portal Notification';
  }

  get previewBody(): string {
    const text = this.getPlainText(this.body).trim();
    if (!text) return 'Your message preview appears here.';
    return text.length > 70 ? `${text.slice(0, 70)}...` : text;
  }

  getPlainText(value: string): string {
    const html = String(value || '').trim();
    if (!html) return '';
    // If user pasted plain text, return it as-is.
    if (!/[<>]/.test(html)) return html;
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return String(doc?.body?.textContent || '').replace(/\s+\n/g, '\n');
    } catch {
      return html.replace(/<[^>]*>/g, ' ');
    }
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

  /** Minimum value for datetime-local (browser local) — one minute from now. */
  get minScheduleLocal(): string {
    const d = new Date(Date.now() + 60_000);
    d.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    if (!this.title.trim() || !this.getPlainText(this.body).trim()) {
      this.notify.warning('Title and body are required.');
      return;
    }
    if (!this.selectedBatches.length) {
      this.notify.warning('Select at least one audience.');
      return;
    }
    if (this.isScheduled && !this.scheduleAt) {
      this.notify.warning('Please select date and time for scheduled announcement.');
      return;
    }

    this.saving = true;
    const scheduleAtPayload =
      this.isScheduled && this.scheduleAt
        ? new Date(this.scheduleAt).toISOString()
        : '';

    this.announcementService
      .create({
        channel: 'website',
        deliveryType: 'website_email',
        title: this.title.trim(),
        body: this.body.trim(),
        targetBatches: this.selectedBatches,
        // Website + Email is now the only supported send type.
        emailSubject: this.title.trim(),
        emailBody: this.body.trim(),
        scheduleAt: scheduleAtPayload,
        attachments: this.selectedFiles
      })
      .subscribe({
        next: (res) => {
          this.saving = false;
          this.notify.success(res?.message || 'Announcement created successfully.');
          this.resetForm();
          this.loadAnnouncements(1);
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

  editAnnouncement(item: AnnouncementItem): void {
    this.editForm = {
      id: item._id,
      deliveryType: item.deliveryType,
      title: item.title || '',
      body: item.body || '',
      targetBatchesText: this.formatTargetLabels(item.targetBatches)
    };
    this.editModalOpen = true;
  }

  closeEditModal(): void {
    if (this.actionAnnouncementId) return;
    this.editModalOpen = false;
  }

  saveEditedAnnouncement(): void {
    const targetBatches = String(this.editForm.targetBatchesText || '')
      .split(',')
      .map((batch) => batch.trim())
      .map((batch) => (batch.toLowerCase() === this.goStudentsTargetLabel.toLowerCase() ? this.goStudentsTargetValue : batch))
      .filter(Boolean);
    if (!targetBatches.length) {
      this.notify.warning('At least one target batch is required.');
      return;
    }

    const payload = {
      deliveryType: this.editForm.deliveryType,
      title: String(this.editForm.title || '').trim(),
      body: String(this.editForm.body || '').trim(),
      targetBatches,
      emailSubject: this.editForm.deliveryType === 'website_email' ? String(this.editForm.title || '').trim() : '',
      emailBody: this.editForm.deliveryType === 'website_email' ? String(this.editForm.body || '').trim() : ''
    };

    if (!payload.title || !payload.body) {
      this.notify.warning('Title and body are required.');
      return;
    }
    if (!this.getPlainText(payload.body).trim()) {
      this.notify.warning('Body cannot be empty.');
      return;
    }

    this.actionAnnouncementId = this.editForm.id;
    this.announcementService.update(this.editForm.id, payload).subscribe({
      next: () => {
        this.actionAnnouncementId = '';
        this.editModalOpen = false;
        this.notify.success('Announcement updated.');
        this.loadAnnouncements(this.currentPage);
      },
      error: (err) => {
        this.actionAnnouncementId = '';
        this.notify.error(err?.error?.message || 'Failed to update announcement.');
      }
    });
  }

  deleteAnnouncement(item: AnnouncementItem): void {
    const shouldDelete = window.confirm(
      `Delete announcement "${item.title}"?\n\nThis will also remove it from student announcements.`
    );
    if (!shouldDelete) return;

    this.actionAnnouncementId = item._id;
    this.announcementService.delete(item._id).subscribe({
      next: () => {
        this.actionAnnouncementId = '';
        this.notify.success('Announcement deleted.');
        this.loadAnnouncements(this.currentPage);
      },
      error: (err) => {
        this.actionAnnouncementId = '';
        this.notify.error(err?.error?.message || 'Failed to delete announcement.');
      }
    });
  }

  private resetForm(): void {
    this.deliveryType = 'website_email';
    this.sendMode = 'instant';
    this.title = '';
    this.body = '';
    this.scheduleAt = '';
    this.selectedBatches = [];
    this.targetStudents = [];
    this.batchToAdd = '';
    this.selectedFiles = [];
  }
}
