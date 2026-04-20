import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  ReminderService,
  Reminder,
  ReminderRecipient,
  BatchPreviewStudent,
  BatchPreviewMeeting
} from '../../../services/reminder.service';
import { NotificationService } from '../../../services/notification.service';
import { environment } from '../../../../environments/environment';
import { TestAccountBadgeComponent } from '../../../shared/test-account-badge/test-account-badge.component';

interface BatchSummary { batchName: string; studentCount?: number; }

@Component({
  selector: 'app-reminders',
  standalone: true,
  imports: [CommonModule, FormsModule, TestAccountBadgeComponent],
  templateUrl: './reminders.component.html',
  styleUrls: ['./reminders.component.css']
})
export class RemindersComponent implements OnInit {

  // ── Loading / error flags ────────────────────────────────────────────────
  loadingReminders = false;
  loadingBatches   = false;
  loadingPreview   = false;
  sendingReminder  = false;
  deletingId       = '';

  // ── Create Reminder form ─────────────────────────────────────────────────
  adHocTitle = '';
  adHocBody  = '';
  sendWarnings: string[] = [];

  /** ISO string from datetime-local input (for scheduled delivery) */
  scheduledFor = '';
  showSchedulePicker = false;

  readonly adHocBodyPlaceholder = 'Hi {{studentName}}…';
  readonly TOKENS = ['{{studentName}}', '{{batch}}', '{{classTime}}', '{{classDate}}', '{{topic}}'];

  // ── All Reminders list ───────────────────────────────────────────────────
  reminders: Reminder[] = [];
  historySearch = '';

  // ── Right panel: batch dropdown ───────────────────────────────────────────
  batches: BatchSummary[] = [];
  selectedBatch = '';

  previewStudents: BatchPreviewStudent[] = [];
  previewMeetings: BatchPreviewMeeting[] = [];

  // ── Edit reminder modal ──────────────────────────────────────────────────
  editingReminder: Reminder | null = null;
  editTitle = '';
  editBody  = '';
  editScheduledFor = '';
  savingEdit = false;

  // ── Recipient drawer modal ───────────────────────────────────────────────
  drawerOpen       = false;
  drawerReminder: Reminder | null = null;
  drawerLoading    = false;
  drawerSearch     = '';
  drawerFilter: 'all' | 'queued' | 'in_progress' | 'sent' | 'failed' = 'all';
  resendingId = '';

  constructor(
    private reminderSvc: ReminderService,
    private notify: NotificationService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.loadReminders();
    this.loadBatches();
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  loadReminders(): void {
    this.loadingReminders = true;
    this.reminderSvc.getReminders().subscribe({
      next: (res) => { this.reminders = res.data || []; this.loadingReminders = false; },
      error: () => { this.loadingReminders = false; this.notify.error('Failed to load reminders.'); }
    });
  }

  loadBatches(): void {
    this.loadingBatches = true;
    this.http.get<{ batches: BatchSummary[] }>(`${environment.apiUrl}/batch-journey`, { withCredentials: true }).subscribe({
      next: (res) => {
        this.batches = (res?.batches || []).sort((a, b) => a.batchName.localeCompare(b.batchName));
        this.loadingBatches = false;
      },
      error: () => { this.loadingBatches = false; }
    });
  }

  // ── Batch dropdown ───────────────────────────────────────────────────────

  onBatchSelectChange(value: string): void {
    const v = String(value || '').trim();
    this.selectedBatch = v;
    if (!v) {
      this.previewStudents = [];
      this.previewMeetings = [];
      return;
    }
    this.loadPreview(v);
  }

  loadPreview(batchName: string): void {
    this.loadingPreview = true;
    this.previewStudents = [];
    this.previewMeetings = [];
    this.reminderSvc.getBatchPreview(batchName).subscribe({
      next: (res) => {
        this.previewStudents = res.data?.students || [];
        this.previewMeetings = res.data?.meetings || [];
        this.loadingPreview = false;
      },
      error: () => { this.loadingPreview = false; this.notify.error('Failed to load batch preview.'); }
    });
  }

  // ── Send reminder ─────────────────────────────────────────────────────────

  canSendInstant(): boolean {
    return !!this.selectedBatch && !!this.adHocTitle.trim() && !!this.adHocBody.trim();
  }

  canSchedule(): boolean {
    return !!this.selectedBatch && !!this.adHocTitle.trim() && !!this.adHocBody.trim() && !!this.scheduledFor;
  }

  toggleSchedulePicker(): void {
    this.showSchedulePicker = !this.showSchedulePicker;
    if (!this.showSchedulePicker) this.scheduledFor = '';
  }

  sendInstant(): void {
    this.sendReminder('instant');
  }

  scheduleReminder(): void {
    this.sendReminder('scheduled');
  }

  sendReminder(deliveryMode: 'instant' | 'scheduled'): void {
    if (!this.selectedBatch) { this.notify.warning('Select a batch first.'); return; }
    if (!this.adHocTitle.trim() || !this.adHocBody.trim()) {
      this.notify.warning('Title and message body are required.'); return;
    }
    if (deliveryMode === 'scheduled' && !this.scheduledFor) {
      this.notify.warning('Please select a date and time to schedule the reminder.'); return;
    }

    const payload: { title: string; body: string; targetBatch: string; deliveryMode?: 'instant' | 'scheduled'; scheduledFor?: string } = {
      title: this.adHocTitle.trim(),
      body: this.adHocBody.trim(),
      targetBatch: this.selectedBatch,
      deliveryMode
    };
    if (deliveryMode === 'scheduled') payload.scheduledFor = this.scheduledFor;

    this.sendingReminder = true;
    this.sendWarnings = [];
    this.reminderSvc.createReminder(payload).subscribe({
      next: (res) => {
        this.sendingReminder = false;
        this.sendWarnings = res.warnings || [];
        if (deliveryMode === 'scheduled') {
          this.notify.success(`Reminder scheduled for ${this.formatDateTime(this.scheduledFor)} in batch "${this.selectedBatch}".`);
        } else {
          this.notify.success(`Reminder queued for ${res.data.totalRecipients} students in batch "${this.selectedBatch}".`);
        }
        this.adHocTitle = '';
        this.adHocBody  = '';
        this.scheduledFor = '';
        this.showSchedulePicker = false;
        this.loadReminders();
      },
      error: (err) => {
        this.sendingReminder = false;
        this.notify.error(err?.error?.message || 'Failed to send reminder.');
      }
    });
  }

  // ── All Reminders (history) ───────────────────────────────────────────────

  get filteredReminders(): Reminder[] {
    const q = this.historySearch.trim().toLowerCase();
    if (!q) return this.reminders;
    return this.reminders.filter(
      (r) => r.title.toLowerCase().includes(q) || r.targetBatch.toLowerCase().includes(q)
    );
  }

  deleteReminder(r: Reminder): void {
    if (!confirm(`Delete reminder "${r.title}"?`)) return;
    this.deletingId = r._id;
    this.reminderSvc.deleteReminder(r._id).subscribe({
      next: () => {
        this.deletingId = '';
        this.reminders = this.reminders.filter((x) => x._id !== r._id);
        this.notify.success('Reminder deleted.');
      },
      error: (err) => {
        this.deletingId = '';
        this.notify.error(err?.error?.message || 'Failed to delete reminder.');
      }
    });
  }

  resendFailed(r: Reminder): void {
    this.resendingId = r._id;
    this.reminderSvc.resendFailed(r._id).subscribe({
      next: (res) => {
        this.resendingId = '';
        this.notify.success(res.message);
        this.loadReminders();
        if (this.drawerReminder?._id === r._id) this.openDrawer(r._id);
      },
      error: (err) => {
        this.resendingId = '';
        this.notify.error(err?.error?.message || 'Failed to requeue.');
      }
    });
  }

  // ── Edit reminder ─────────────────────────────────────────────────────────

  openEditReminder(r: Reminder, event: Event): void {
    event.stopPropagation();
    this.editingReminder = r;
    this.editTitle = r.title;
    this.editBody  = r.body;
    this.editScheduledFor = r.scheduledFor
      ? new Date(r.scheduledFor).toISOString().slice(0, 16)
      : '';
  }

  cancelEditReminder(): void {
    this.editingReminder = null;
    this.editTitle = '';
    this.editBody  = '';
    this.editScheduledFor = '';
  }

  saveEditReminder(): void {
    if (!this.editingReminder) return;
    if (!this.editTitle.trim() || !this.editBody.trim()) {
      this.notify.warning('Title and body are required.');
      return;
    }
    this.savingEdit = true;
    this.reminderSvc.updateReminder(this.editingReminder._id, {
      title: this.editTitle.trim(),
      body: this.editBody.trim(),
      scheduledFor: this.editScheduledFor || null
    }).subscribe({
      next: () => {
        this.savingEdit = false;
        this.notify.success('Reminder updated.');
        this.cancelEditReminder();
        this.loadReminders();
      },
      error: (err) => {
        this.savingEdit = false;
        this.notify.error(err?.error?.message || 'Failed to update reminder.');
      }
    });
  }

  // ── Recipient drawer ──────────────────────────────────────────────────────

  openDrawer(reminderId: string): void {
    this.drawerOpen = true;
    this.drawerLoading = true;
    this.drawerReminder = null;
    this.drawerSearch = '';
    this.drawerFilter = 'all';
    this.reminderSvc.getReminderById(reminderId).subscribe({
      next: (res) => { this.drawerReminder = res.data; this.drawerLoading = false; },
      error: () => { this.drawerLoading = false; this.notify.error('Failed to load recipients.'); }
    });
  }

  closeDrawer(): void {
    this.drawerOpen = false;
    this.drawerReminder = null;
  }

  get drawerRecipients(): ReminderRecipient[] {
    if (!this.drawerReminder?.recipients) return [];
    let list = this.drawerReminder.recipients;
    if (this.drawerFilter !== 'all') list = list.filter((r) => r.status === this.drawerFilter);
    const q = this.drawerSearch.trim().toLowerCase();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q) || r.phone.includes(q));
    return list;
  }

  // ── Formatting helpers ────────────────────────────────────────────────────

  formatDate(v: string | null | undefined): string {
    if (!v) return '—';
    try { return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return String(v); }
  }

  formatDateTime(v: string | null | undefined): string {
    if (!v) return '—';
    try { return new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return String(v); }
  }

  /** Map any DB status → Active / Inactive for display */
  statusLabel(status: string): string {
    const active = new Set(['queued', 'scheduled', 'in_progress']);
    return active.has(status) ? 'Active' : 'Inactive';
  }

  statusBadgeClass(status: string): string {
    const active = new Set(['queued', 'scheduled', 'in_progress']);
    return active.has(status) ? 'badge-status--active' : 'badge-status--inactive';
  }

  planBadgeClass(plan: string | undefined): string {
    return String(plan || '').trim().toLowerCase() || 'unknown';
  }

  /** Minimum datetime for schedule picker — now + 1 min */
  get minScheduleDateTime(): string {
    const d = new Date(Date.now() + 60000);
    return d.toISOString().slice(0, 16);
  }

  trackById(_: number, item: { _id: string }): string { return item._id; }
}
