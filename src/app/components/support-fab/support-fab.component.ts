import {
  Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';
import { AnnouncementItem, AnnouncementService } from '../../services/announcement.service';
import { OllyContextService } from '../../services/olly-context.service';

// ── Types ──────────────────────────────────────────────────────────────────

interface OllyMessage {
  role: 'user' | 'assistant' | 'agent';
  content: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaOriginalName?: string | null;
  timestamp: Date;
}

// ── Component ──────────────────────────────────────────────────────────────

@Component({
  selector: 'app-support-fab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './support-fab.component.html',
  styleUrls: ['./support-fab.component.css']
})
export class SupportFabComponent implements OnInit, OnDestroy {
  // Launcher panel
  open = false;

  // Modal state
  modalOpen = false;
  activeTab: 'olly' | 'ticket' | 'tickets' | 'announcements' = 'olly';

  // ── Ticket form ──────────────────────────────────────────────────────────
  ticketForm!: FormGroup;
  submitting = false;
  submitSuccess = false;
  submitError = '';
  screenshotFile: File | null = null;

  isLoggedIn = false;
  currentUser: any = null;
  tickets: any[] = [];
  loadingTickets = false;

  // ── Announcements ────────────────────────────────────────────────────────
  announcements: AnnouncementItem[] = [];
  loadingAnnouncements = false;
  announcementBadgeCount = 0;
  private announcementBadgeTimer: any = null;
  selectedAnnouncement: AnnouncementItem | null = null;
  private announcementReqSeq = 0;
  private autoOpenedAnnouncementId: string | null = null;

  // ── Olly chat ────────────────────────────────────────────────────────────
  ollyShowIntake = true;
  ollyIntakeForm!: FormGroup;
  ollyIntakeSubmitting = false;
  ollyIntakeMediaFile: File | null = null;
  ollyIntakeMediaPreview: string | null = null;
  ollyMessages: OllyMessage[] = [];
  ollyInput = '';
  ollyLoading = false;
  ollyError = '';
  ollySessionId: string | null = null;
  ollyLanguage: 'en' | 'ta' | 'si' = 'en';
  ollyMediaFile: File | null = null;
  ollyMediaPreview: string | null = null;

  @ViewChild('ollyMessagesEl') ollyMessagesEl?: ElementRef<HTMLDivElement>;
  @ViewChild('ollyFileInput') ollyFileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('ollyIntakeFileInput') ollyIntakeFileInput?: ElementRef<HTMLInputElement>;

  // ── Language labels ──────────────────────────────────────────────────────
  readonly langLabels = { en: 'English', ta: 'தமிழ்', si: 'සිංහල' };

  // ── Ticket categories/priorities ─────────────────────────────────────────
  readonly categories = [
    { value: 'login', label: 'Login / Access Issue' },
    { value: 'payment', label: 'Payment Problem' },
    { value: 'class', label: 'Class / Meeting Issue' },
    { value: 'video', label: 'Video / Audio Issue' },
    { value: 'course', label: 'Course Material' },
    { value: 'technical', label: 'Technical Error' },
    { value: 'account', label: 'Account Settings' },
    { value: 'other', label: 'Other' }
  ];

  readonly priorities = [
    { value: 'low', label: 'Low – General query' },
    { value: 'medium', label: 'Medium – Impacting work' },
    { value: 'high', label: 'High – Urgent issue' }
  ];

  readonly ollyIssueTypes = [
    { value: 'technical', label: 'Technical Issue' },
    { value: 'language', label: 'Language / Course Help' },
    { value: 'payment', label: 'Payment & Subscription' },
    { value: 'login', label: 'Login & Access' },
    { value: 'class', label: 'Class / Zoom / Meeting' },
    { value: 'course', label: 'Course Materials' },
    { value: 'account', label: 'Account & Profile' },
    { value: 'documents', label: 'Documents & Visa' },
    { value: 'other', label: 'Other' }
  ];

  get showAnnouncementsTab(): boolean {
    if (!this.currentUser) return true;
    const role = String(this.currentUser?.role || '').toUpperCase();
    if (role !== 'STUDENT') return true;
    const sub = String(this.currentUser?.subscription || '').toUpperCase();
    const go = String(this.currentUser?.goStatus || '').toUpperCase();
    return !(sub === 'SILVER' || go === 'GO');
  }

  get descriptionLen(): number {
    return this.ticketForm.get('description')?.value?.length || 0;
  }

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private authService: AuthService,
    private announcementService: AnnouncementService,
    private ollyContext: OllyContextService
  ) {}

  ngOnInit(): void {
    this.isLoggedIn = this.authService.isLoggedIn();
    this.currentUser = this.authService.getSnapshotUser();

    this.ticketForm = this.fb.group({
      name: [this.currentUser?.name || '', [Validators.required, Validators.minLength(2)]],
      email: [this.currentUser?.email || '', [Validators.required, Validators.email]],
      subject: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(100)]],
      category: ['', Validators.required],
      priority: ['medium', Validators.required],
      description: ['', [Validators.required, Validators.minLength(20), Validators.maxLength(1000)]],
      screenshot: [null, Validators.required]
    });

    this.ollyIntakeForm = this.fb.group({
      issueType: ['', Validators.required],
      question: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(1000)]]
    });

    this.autoOpenedAnnouncementId = this.readAutoOpenedAnnouncementId();
    this.refreshAnnouncementBadge();
    this.announcementBadgeTimer = setInterval(() => this.refreshAnnouncementBadge(), 60000);
  }

  ngOnDestroy(): void {
    if (this.announcementBadgeTimer) clearInterval(this.announcementBadgeTimer);
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  toggle(): void {
    this.refreshAnnouncementBadge();
    this.open = !this.open;
  }

  close(): void { this.open = false; }

  openModal(tab: 'olly' | 'ticket' | 'tickets' | 'announcements' = 'olly'): void {
    if (!this.showAnnouncementsTab && tab === 'announcements') tab = 'olly';
    this.refreshAnnouncementBadge();
    this.activeTab = tab;
    this.modalOpen = true;
    this.open = false;
    this.submitError = '';
    this.submitSuccess = false;
    if (tab === 'announcements') { this.selectedAnnouncement = null; this.loadAnnouncements(); }
    if (tab === 'tickets') this.loadMyTickets();
    if (tab === 'olly') this.initOllySession();
  }

  closeModal(): void {
    this.modalOpen = false;
  }

  setTab(tab: 'olly' | 'ticket' | 'tickets' | 'announcements'): void {
    if (!this.showAnnouncementsTab && tab === 'announcements') return;
    this.refreshAnnouncementBadge();
    this.activeTab = tab;
    if (tab !== 'announcements') this.selectedAnnouncement = null;
    if (tab === 'tickets') this.loadMyTickets();
    if (tab === 'announcements') this.loadAnnouncements();
    if (tab === 'olly') this.initOllySession();
  }

  // ── Olly Session ──────────────────────────────────────────────────────────

  private ollySessionKey = 'olly_session_id';

  initOllySession(): void {
    this.ollyError = '';
    const saved = localStorage.getItem(this.ollySessionKey);
    if (saved) {
      this.ollySessionId = saved;
      this.loadOllySession();
    } else {
      this.resetOllyIntake();
    }
  }

  private resetOllyIntake(): void {
    this.ollyShowIntake = true;
    this.ollySessionId = null;
    this.ollyMessages = [];
    this.ollyIntakeForm.reset({ issueType: '', question: '' });
    this.clearIntakeMedia();
  }

  loadOllySession(): void {
    if (!this.ollySessionId) {
      this.resetOllyIntake();
      return;
    }
    this.http.get<any>(`${environment.apiUrl}/olly/session/${this.ollySessionId}`, { withCredentials: true }).subscribe({
      next: (res) => {
        if (res?.success && res.data) {
          this.ollyLanguage = res.data.language || 'en';
          const msgs = (res.data.messages || [])
            .filter((m: any) => this.isVisibleOllyMessage(m))
            .map((m: any) => ({
              ...m,
              timestamp: new Date(m.timestamp)
            }));

          if (res.data.intakeComplete && msgs.length > 0) {
            this.ollyShowIntake = false;
            this.ollyMessages = msgs;
            this.scrollOllyToBottom();
          } else {
            this.ollyShowIntake = true;
            this.ollyMessages = [];
          }
        } else {
          localStorage.removeItem(this.ollySessionKey);
          this.resetOllyIntake();
        }
      },
      error: () => {
        localStorage.removeItem(this.ollySessionKey);
        this.resetOllyIntake();
      }
    });
  }

  get ollyIntakeQuestionLen(): number {
    return this.ollyIntakeForm.get('question')?.value?.length || 0;
  }

  triggerIntakeFileInput(): void {
    this.ollyIntakeFileInput?.nativeElement?.click();
  }

  onIntakeFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    if (!file) return;
    this.ollyIntakeMediaFile = file;
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => { this.ollyIntakeMediaPreview = e.target?.result as string; };
      reader.readAsDataURL(file);
    } else {
      this.ollyIntakeMediaPreview = null;
    }
  }

  clearIntakeMedia(): void {
    this.ollyIntakeMediaFile = null;
    this.ollyIntakeMediaPreview = null;
    if (this.ollyIntakeFileInput) this.ollyIntakeFileInput.nativeElement.value = '';
  }

  submitOllyIntake(): void {
    if (this.ollyIntakeForm.invalid) {
      this.ollyIntakeForm.markAllAsTouched();
      return;
    }
    if (this.ollyIntakeSubmitting) return;

    this.ollyIntakeSubmitting = true;
    this.ollyError = '';

    const fd = new FormData();
    fd.append('issueType', this.ollyIntakeForm.value.issueType);
    fd.append('question', this.ollyIntakeForm.value.question.trim());
    fd.append('language', this.ollyLanguage);
    if (this.ollySessionId) fd.append('sessionId', this.ollySessionId);
    if (this.ollyIntakeMediaFile) fd.append('file', this.ollyIntakeMediaFile);
    fd.append('activityContext', JSON.stringify(this.ollyContext.getSnapshot()));

    this.http.post<any>(`${environment.apiUrl}/olly/intake`, fd, { withCredentials: true }).subscribe({
      next: (res) => {
        this.ollyIntakeSubmitting = false;
        if (res?.success && res.data) {
          this.ollySessionId = res.data.sessionId;
          localStorage.setItem(this.ollySessionKey, this.ollySessionId!);
          this.ollyMessages = (res.data.messages || []).map((m: any) => ({
            ...m,
            timestamp: new Date(m.timestamp)
          }));
          this.ollyShowIntake = false;
          this.clearIntakeMedia();
          this.scrollOllyToBottom();
        } else {
          this.ollyError = res?.message || 'Unable to start chat.';
        }
      },
      error: (err) => {
        this.ollyIntakeSubmitting = false;
        this.ollyError = err?.error?.message || 'Unable to start chat. Please try again.';
      }
    });
  }

  // ── Olly Chat ─────────────────────────────────────────────────────────────

  sendOllyMessage(): void {
    const text = this.ollyInput.trim();
    if (!text && !this.ollyMediaFile) return;
    if (this.ollyLoading) return;
    if (!this.ollySessionId) { this.ollyError = 'Session not ready. Please wait.'; return; }

    // Upload media first if present
    if (this.ollyMediaFile) {
      this.uploadOllyMedia();
      return;
    }

    this.ollyMessages.push({ role: 'user', content: text, timestamp: new Date() });
    this.ollyInput = '';
    this.ollyError = '';
    this.ollyLoading = true;
    this.scrollOllyToBottom();

    this.http.post<any>(`${environment.apiUrl}/olly/chat`, {
      sessionId: this.ollySessionId,
      message: text,
      language: this.ollyLanguage,
      activityContext: this.ollyContext.getSnapshot()
    }, { withCredentials: true }).subscribe({
      next: (res) => {
        this.ollyLoading = false;
        if (res?.success && res.data?.reply) {
          this.ollyMessages.push({ role: 'assistant', content: res.data.reply, timestamp: new Date() });
        } else if (!res?.success) {
          this.ollyError = res?.message || 'Unable to get response.';
        }
        this.scrollOllyToBottom();
      },
      error: (err) => {
        this.ollyLoading = false;
        this.ollyError = err?.error?.message || 'Connection error. Please try again.';
      }
    });
  }

  onOllyKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendOllyMessage();
    }
  }

  // ── Media Upload ──────────────────────────────────────────────────────────

  triggerOllyFileInput(): void {
    this.ollyFileInput?.nativeElement?.click();
  }

  onOllyFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    if (!file) return;
    this.ollyMediaFile = file;

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => { this.ollyMediaPreview = e.target?.result as string; };
      reader.readAsDataURL(file);
    } else {
      this.ollyMediaPreview = null;
    }
  }

  clearOllyMedia(): void {
    this.ollyMediaFile = null;
    this.ollyMediaPreview = null;
    if (this.ollyFileInput) this.ollyFileInput.nativeElement.value = '';
  }

  uploadOllyMedia(): void {
    if (!this.ollyMediaFile || !this.ollySessionId) return;
    this.ollyLoading = true;
    this.ollyError = '';

    const fd = new FormData();
    fd.append('file', this.ollyMediaFile);
    fd.append('sessionId', this.ollySessionId);

    const textToSend = this.ollyInput.trim();

    this.http.post<any>(`${environment.apiUrl}/olly/upload`, fd, { withCredentials: true }).subscribe({
      next: (res) => {
        if (res?.success) {
          const f = this.ollyMediaFile!;
          this.ollyMessages.push({
            role: 'user',
            content: textToSend ? `${textToSend}\n[Shared: ${f.name}]` : `[Shared: ${f.name}]`,
            mediaUrl: res.data.mediaUrl,
            mediaType: res.data.mediaType,
            mediaOriginalName: f.name,
            timestamp: new Date()
          });
          this.clearOllyMedia();
          this.ollyInput = '';
          this.scrollOllyToBottom();

          // Now send text message to Olly if any
          if (textToSend) {
            this.http.post<any>(`${environment.apiUrl}/olly/chat`, {
              sessionId: this.ollySessionId,
              message: textToSend,
              language: this.ollyLanguage,
              activityContext: this.ollyContext.getSnapshot()
            }, { withCredentials: true }).subscribe({
              next: (r2) => {
                this.ollyLoading = false;
                if (r2?.success && r2.data?.reply) {
                  this.ollyMessages.push({ role: 'assistant', content: r2.data.reply, timestamp: new Date() });
                }
                this.scrollOllyToBottom();
              },
              error: () => { this.ollyLoading = false; }
            });
          } else {
            this.ollyLoading = false;
          }
        } else {
          this.ollyLoading = false;
          this.ollyError = res?.message || 'Upload failed.';
        }
      },
      error: (err) => {
        this.ollyLoading = false;
        this.ollyError = err?.error?.message || 'Upload failed.';
      }
    });
  }

  // ── Language switch ───────────────────────────────────────────────────────

  switchLanguage(lang: 'en' | 'ta' | 'si'): void {
    this.ollyLanguage = lang;
    if (this.ollySessionId) {
      // Persist language in session on next chat call; also update locally
    }
  }

  // ── Scroll helper ─────────────────────────────────────────────────────────

  private scrollOllyToBottom(): void {
    setTimeout(() => {
      const el = this.ollyMessagesEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  isImage(mediaType?: string | null): boolean {
    return !!mediaType && mediaType.startsWith('image/');
  }

  private isVisibleOllyMessage(m: { role?: string; content?: string }): boolean {
    if (m.role !== 'user' && m.role !== 'assistant') return false;
    const text = String(m.content || '');
    if (m.role === 'assistant' && /requested to speak with a real agent|support agent has joined|team has been notified/i.test(text)) {
      return false;
    }
    return true;
  }

  // ── Ticket form ───────────────────────────────────────────────────────────

  onScreenshotSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.screenshotFile = file;
    this.ticketForm.patchValue({ screenshot: file ? file.name : null });
    this.ticketForm.get('screenshot')?.updateValueAndValidity();
  }

  submitTicket(): void {
    if (this.ticketForm.invalid) { this.ticketForm.markAllAsTouched(); return; }
    if (!this.screenshotFile) {
      this.ticketForm.get('screenshot')?.setErrors({ required: true });
      this.ticketForm.markAllAsTouched();
      return;
    }
    this.submitting = true;
    this.submitError = '';

    const fd = new FormData();
    fd.append('name', this.ticketForm.value.name);
    fd.append('email', this.ticketForm.value.email);
    fd.append('subject', this.ticketForm.value.subject);
    fd.append('category', this.ticketForm.value.category);
    fd.append('priority', this.ticketForm.value.priority);
    fd.append('description', this.ticketForm.value.description);
    if (this.currentUser?._id) fd.append('userId', this.currentUser._id);
    fd.append('screenshot', this.screenshotFile);

    this.http.post<any>(`${environment.apiUrl}/support/tickets`, fd, { withCredentials: true }).subscribe({
      next: (res) => {
        if (res?.success) {
          this.submitSuccess = true;
          this.screenshotFile = null;
          this.ticketForm.reset({ priority: 'medium', screenshot: null });
          if (this.currentUser) this.ticketForm.patchValue({ name: this.currentUser.name, email: this.currentUser.email });
          if (this.isLoggedIn) this.loadMyTickets();
        } else {
          this.submitError = res?.message || 'Failed to submit ticket.';
        }
        this.submitting = false;
      },
      error: (err) => {
        this.submitError = err?.error?.message || 'Unable to submit ticket. Please try again.';
        this.submitting = false;
      }
    });
  }

  loadMyTickets(): void {
    if (!this.isLoggedIn) { this.tickets = []; return; }
    this.loadingTickets = true;
    this.http.get<any>(`${environment.apiUrl}/support/tickets/my`, { withCredentials: true }).subscribe({
      next: (res) => { this.tickets = res?.data || []; this.loadingTickets = false; },
      error: () => { this.loadingTickets = false; }
    });
  }

  // ── Announcements ─────────────────────────────────────────────────────────

  loadAnnouncements(): void {
    if (!this.showAnnouncementsTab) { this.announcements = []; return; }
    this.loadingAnnouncements = true;
    this.selectedAnnouncement = null;
    this.announcementService.getForStudent().subscribe({
      next: (res) => {
        this.announcements = res?.data || [];
        this.selectedAnnouncement = this.announcements[0] || null;
        this.isLoggedIn = true;
        this.loadingAnnouncements = false;
        this.announcementBadgeCount = this.announcements.length;
      },
      error: (err) => {
        this.announcements = [];
        if (err?.status === 401) this.isLoggedIn = false;
        this.loadingAnnouncements = false;
      }
    });
  }

  private refreshAnnouncementBadge(): void {
    if (!this.showAnnouncementsTab) { this.announcementBadgeCount = 0; return; }
    const reqId = ++this.announcementReqSeq;
    this.announcementService.getForStudent().subscribe({
      next: (res) => {
        const list = Array.isArray(res?.data) ? res.data : [];
        this.isLoggedIn = true;
        this.announcementBadgeCount = list.length;
        this.maybeAutoOpenLatestAnnouncement(list);
      },
      error: (err) => {
        this.announcementBadgeCount = 0;
        if (err?.status === 401) this.isLoggedIn = false;
      }
    });
  }

  private maybeAutoOpenLatestAnnouncement(list: AnnouncementItem[]): void {
    if (!this.showAnnouncementsTab) return;
    const latest = list[0];
    const latestId = latest?._id || null;
    if (!latestId || this.autoOpenedAnnouncementId === latestId) return;
    this.autoOpenedAnnouncementId = latestId;
    this.persistAutoOpenedAnnouncementId(latestId);
    this.activeTab = 'announcements';
    this.announcements = list;
    this.selectedAnnouncement = latest;
    this.open = false;
    this.modalOpen = true;
  }

  private getAutoOpenStorageKey(): string {
    return `sf_auto_opened_announcement_${this.currentUser?._id || 'unknown'}`;
  }

  private readAutoOpenedAnnouncementId(): string | null {
    try { return localStorage.getItem(this.getAutoOpenStorageKey()); } catch { return null; }
  }

  private persistAutoOpenedAnnouncementId(id: string): void {
    try { localStorage.setItem(this.getAutoOpenStorageKey(), id); } catch { }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { this.close(); this.closeModal(); }
}
