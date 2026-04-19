import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  ReminderService,
  ReminderTemplate,
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
  loadingTemplates = false;
  loadingReminders = false;
  loadingBatches   = false;
  loadingPreview   = false;
  saving           = false;
  sendingReminder  = false;
  deletingId       = '';

  // ── Left panel: templates ────────────────────────────────────────────────
  templates: ReminderTemplate[] = [];
  selectedTemplateId = '';
  showCreateTemplate = false;
  editingTemplate: ReminderTemplate | null = null;

  newTemplate = { title: '', body: '' };
  selectedFiles: File[] = [];

  // Helper tokens for textarea hint
  readonly TOKENS = ['{{studentName}}', '{{batch}}', '{{classTime}}', '{{classDate}}', '{{topic}}'];

  /** Literal placeholders (avoid `{{ }}` in HTML attributes — Angular parses them as bindings). */
  readonly templateBodyPlaceholder =
    'Hi {{studentName}}, your class is on {{classDate}} at {{classTime}}…';
  readonly adHocBodyPlaceholder = 'Hi {{studentName}}…';

  // ── Left panel: send reminder ────────────────────────────────────────────
  adHocTitle = '';
  adHocBody  = '';
  sendWarnings: string[] = [];

  // ── Left panel: history table ────────────────────────────────────────────
  reminders: Reminder[] = [];
  historySearch = '';

  // ── Right panel: batch dropdown ───────────────────────────────────────────
  batches: BatchSummary[] = [];
  selectedBatch = '';

  previewStudents: BatchPreviewStudent[] = [];
  previewMeetings: BatchPreviewMeeting[] = [];
  selectedMeetingIds: string[] = [];

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
    this.loadTemplates();
    this.loadReminders();
    this.loadBatches();
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  loadTemplates(): void {
    this.loadingTemplates = true;
    this.reminderSvc.getTemplates().subscribe({
      next: (res) => { this.templates = res.data || []; this.loadingTemplates = false; },
      error: () => { this.loadingTemplates = false; this.notify.error('Failed to load templates.'); }
    });
  }

  loadReminders(): void {
    this.loadingReminders = true;
    this.reminderSvc.getReminders().subscribe({
      next: (res) => { this.reminders = res.data || []; this.loadingReminders = false; },
      error: () => { this.loadingReminders = false; this.notify.error('Failed to load reminder history.'); }
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

  // ── Template CRUD ─────────────────────────────────────────────────────────

  openCreateTemplate(): void {
    this.showCreateTemplate = true;
    this.editingTemplate = null;
    this.newTemplate = { title: '', body: '' };
    this.selectedFiles = [];
  }

  openEditTemplate(tpl: ReminderTemplate, event: Event): void {
    event.stopPropagation();
    this.showCreateTemplate = true;
    this.editingTemplate = tpl;
    this.newTemplate = { title: tpl.title, body: tpl.body };
    this.selectedFiles = [];
  }

  cancelTemplate(): void {
    this.showCreateTemplate = false;
    this.editingTemplate = null;
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFiles = input.files ? Array.from(input.files) : [];
  }

  insertToken(token: string): void {
    this.newTemplate.body = (this.newTemplate.body || '') + token;
  }

  saveTemplate(): void {
    if (!this.newTemplate.title.trim() || !this.newTemplate.body.trim()) {
      this.notify.warning('Title and body are required.');
      return;
    }

    if (this.editingTemplate) {
      this.saving = true;
      this.reminderSvc.updateTemplate(this.editingTemplate._id, {
        title: this.newTemplate.title.trim(),
        body: this.newTemplate.body.trim()
      }).subscribe({
        next: () => {
          this.saving = false;
          this.notify.success('Template updated.');
          this.cancelTemplate();
          this.loadTemplates();
        },
        error: (err) => {
          this.saving = false;
          this.notify.error(err?.error?.message || 'Failed to update template.');
        }
      });
    } else {
      const form = new FormData();
      form.append('title', this.newTemplate.title.trim());
      form.append('body', this.newTemplate.body.trim());
      for (const f of this.selectedFiles) form.append('attachments', f);

      this.saving = true;
      this.reminderSvc.createTemplate(form).subscribe({
        next: () => {
          this.saving = false;
          this.notify.success('Template created.');
          this.cancelTemplate();
          this.loadTemplates();
        },
        error: (err) => {
          this.saving = false;
          this.notify.error(err?.error?.message || 'Failed to create template.');
        }
      });
    }
  }

  deleteTemplate(tpl: ReminderTemplate, event: Event): void {
    event.stopPropagation();
    if (!confirm(`Delete template "${tpl.title}"?`)) return;
    this.reminderSvc.deleteTemplate(tpl._id).subscribe({
      next: () => {
        this.notify.success('Template deleted.');
        if (this.selectedTemplateId === tpl._id) this.selectedTemplateId = '';
        this.loadTemplates();
      },
      error: (err) => this.notify.error(err?.error?.message || 'Failed to delete template.')
    });
  }

  selectTemplate(id: string): void {
    this.selectedTemplateId = this.selectedTemplateId === id ? '' : id;
  }

  get activeTemplate(): ReminderTemplate | null {
    return this.templates.find((t) => t._id === this.selectedTemplateId) || null;
  }

  // ── Batch dropdown ───────────────────────────────────────────────────────

  onBatchSelectChange(value: string): void {
    const v = String(value || '').trim();
    this.selectedBatch = v;
    this.selectedMeetingIds = [];
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

  canSendBase(): boolean {
    return !!this.selectedBatch && (!!this.selectedTemplateId || (!!this.adHocTitle.trim() && !!this.adHocBody.trim()));
  }

  canSendInstant(): boolean {
    return this.canSendBase();
  }

  canSchedule(): boolean {
    return this.canSendBase() && this.selectedMeetingIds.length > 0;
  }

  /** True when every listed meeting is selected (for “select all” checkbox). */
  get allMeetingsSelected(): boolean {
    const n = this.previewMeetings.length;
    return n > 0 && this.selectedMeetingIds.length === n;
  }

  /** How selection is summarized on the saved reminder (one / all / multi). */
  meetingScheduleScopeForPayload(): 'one' | 'all' | 'multi' {
    const total = this.previewMeetings.length;
    const sel = this.selectedMeetingIds.length;
    if (sel === 0 || total === 0) return 'one';
    if (sel === total) return 'all';
    if (sel === 1) return 'one';
    return 'multi';
  }

  toggleSelectAllMeetings(checked: boolean): void {
    if (checked) {
      this.selectedMeetingIds = this.previewMeetings.map((m) => String(m._id));
    } else {
      this.selectedMeetingIds = [];
    }
  }

  isMeetingSelected(meetingId: string): boolean {
    return this.selectedMeetingIds.includes(String(meetingId));
  }

  toggleMeetingSelection(meetingId: string, checked: boolean): void {
    const id = String(meetingId);
    if (!checked) {
      this.selectedMeetingIds = this.selectedMeetingIds.filter((x) => x !== id);
      return;
    }
    if (!this.selectedMeetingIds.includes(id)) {
      this.selectedMeetingIds = [...this.selectedMeetingIds, id];
    }
  }

  sendInstant(): void {
    this.sendReminder('instant');
  }

  scheduleReminder(): void {
    this.sendReminder('scheduled');
  }

  sendReminder(deliveryMode: 'instant' | 'scheduled'): void {
    if (!this.selectedBatch) { this.notify.warning('Select a batch first (right panel).'); return; }
    if (!this.selectedTemplateId && (!this.adHocTitle.trim() || !this.adHocBody.trim())) {
      this.notify.warning('Select a template or fill in title + body.'); return;
    }
    if (deliveryMode === 'scheduled' && this.selectedMeetingIds.length === 0) {
      this.notify.warning('Select one or more meetings to schedule.');
      return;
    }

    const payload: any = { targetBatch: this.selectedBatch };
    if (this.selectedTemplateId) {
      payload.templateId = this.selectedTemplateId;
    } else {
      payload.title = this.adHocTitle.trim();
      payload.body  = this.adHocBody.trim();
    }
    payload.deliveryMode = deliveryMode;
    payload.scheduleScope = this.meetingScheduleScopeForPayload();
    if (deliveryMode === 'scheduled') payload.meetingIds = [...this.selectedMeetingIds];

    this.sendingReminder = true;
    this.sendWarnings = [];
    this.reminderSvc.createReminder(payload).subscribe({
      next: (res) => {
        this.sendingReminder = false;
        this.sendWarnings = res.warnings || [];
        if (deliveryMode === 'scheduled') {
          this.notify.success(`Reminder scheduled for ${this.selectedMeetingIds.length} meeting(s) in batch "${this.selectedBatch}".`);
        } else {
          this.notify.success(`Reminder queued for ${res.data.totalRecipients} students in batch "${this.selectedBatch}".`);
        }
        this.adHocTitle = '';
        this.adHocBody  = '';
        this.selectedTemplateId = '';
        this.selectedMeetingIds = [];
        this.loadReminders();
      },
      error: (err) => {
        this.sendingReminder = false;
        this.notify.error(err?.error?.message || 'Failed to send reminder.');
      }
    });
  }

  // ── History ───────────────────────────────────────────────────────────────

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

  formatTime(v: string | null | undefined): string {
    if (!v) return '—';
    try { return new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' }); }
    catch { return String(v); }
  }

  formatDateTime(v: string | null | undefined): string {
    if (!v) return '—';
    try { return new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return String(v); }
  }

  statusBadgeClass(status: string): string {
    const map: Record<string, string> = {
      queued: 'badge-status--queued',
      scheduled: 'badge-status--scheduled',
      in_progress: 'badge-status--in-progress',
      completed: 'badge-status--completed',
      sent: 'badge-status--completed',
      failed: 'badge-status--failed'
    };
    return map[status] || 'badge-status--queued';
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      queued: 'Queued',
      scheduled: 'Scheduled',
      in_progress: 'Sending',
      completed: 'Completed',
      sent: 'Sent',
      failed: 'Failed'
    };
    return map[status] || status;
  }

  planBadgeClass(plan: string | undefined): string {
    return String(plan || '').trim().toLowerCase() || 'unknown';
  }

  formatBytes(size: number | undefined): string {
    const v = Number(size || 0);
    if (!v) return '0 B';
    const u = ['B', 'KB', 'MB'];
    let i = 0; let n = v;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
  }

  trackById(_: number, item: { _id: string }): string { return item._id; }
}
