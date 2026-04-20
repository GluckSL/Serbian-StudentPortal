import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';
import { AnnouncementItem, AnnouncementService } from '../../services/announcement.service';

@Component({
  selector: 'app-support-fab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule],
  templateUrl: './support-fab.component.html',
  styleUrls: ['./support-fab.component.css']
})
export class SupportFabComponent implements OnInit, OnDestroy {
  open = false; // small launcher panel
  modalOpen = false; // full modal
  activeTab: 'submit' | 'tickets' | 'announcements' = 'submit';

  ticketForm!: FormGroup;
  submitting = false;
  submitSuccess = false;
  submitError = '';
  screenshotFile: File | null = null;

  isLoggedIn = false;
  currentUser: any = null;
  tickets: any[] = [];
  loadingTickets = false;
  announcements: AnnouncementItem[] = [];
  loadingAnnouncements = false;
  announcementBadgeCount = 0;
  private announcementBadgeTimer: any = null;
  selectedAnnouncement: AnnouncementItem | null = null;
  private announcementReqSeq = 0;
  private autoOpenedAnnouncementId: string | null = null;

  get showAnnouncementsTab(): boolean {
    if (!this.currentUser) return true;
    const role = String(this.currentUser?.role || '').toUpperCase();
    if (role !== 'STUDENT') return true;
    const subscription = String(this.currentUser?.subscription || '').toUpperCase();
    const goStatus = String(this.currentUser?.goStatus || '').toUpperCase();
    // For Silver / GO students, hide announcement tab in support modal.
    return !(subscription === 'SILVER' || goStatus === 'GO');
  }

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

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private authService: AuthService,
    private announcementService: AnnouncementService
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

    this.autoOpenedAnnouncementId = this.readAutoOpenedAnnouncementId();
    this.refreshAnnouncementBadge();
    this.announcementBadgeTimer = setInterval(() => this.refreshAnnouncementBadge(), 60000);
  }

  ngOnDestroy(): void {
    if (this.announcementBadgeTimer) {
      clearInterval(this.announcementBadgeTimer);
      this.announcementBadgeTimer = null;
    }
  }

  toggle(): void {
    this.refreshAnnouncementBadge();
    this.open = !this.open;
  }

  close(): void {
    this.open = false;
  }

  openModal(tab: 'submit' | 'tickets' | 'announcements' = 'submit'): void {
    if (!this.showAnnouncementsTab && tab === 'announcements') tab = 'submit';
    this.refreshAnnouncementBadge();
    this.activeTab = tab;
    this.modalOpen = true;
    this.open = false;
    this.submitError = '';
    this.submitSuccess = false;
    if (tab === 'announcements') this.selectedAnnouncement = null;
    if (tab === 'tickets') this.loadMyTickets();
    if (tab === 'announcements') this.loadAnnouncements();
  }

  closeModal(): void {
    this.modalOpen = false;
  }

  setTab(tab: 'submit' | 'tickets' | 'announcements'): void {
    if (!this.showAnnouncementsTab && tab === 'announcements') return;
    this.refreshAnnouncementBadge();
    this.activeTab = tab;
    if (tab !== 'announcements') this.selectedAnnouncement = null;
    if (tab === 'tickets') this.loadMyTickets();
    if (tab === 'announcements') this.loadAnnouncements();
  }

  onScreenshotSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.screenshotFile = file;
    this.ticketForm.patchValue({ screenshot: file ? file.name : null });
    this.ticketForm.get('screenshot')?.updateValueAndValidity();
  }

  submitTicket(): void {
    if (this.ticketForm.invalid) {
      this.ticketForm.markAllAsTouched();
      return;
    }
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

    this.http
      .post<{ success: boolean; data: any; message?: string }>(
        `${environment.apiUrl}/support/tickets`,
        fd,
        { withCredentials: true }
      )
      .subscribe({
        next: (res) => {
          if (res?.success) {
            this.submitSuccess = true;
            this.screenshotFile = null;
            this.ticketForm.reset({ priority: 'medium', screenshot: null });
            if (this.currentUser) {
              this.ticketForm.patchValue({ name: this.currentUser.name, email: this.currentUser.email });
            }
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
    if (!this.isLoggedIn) {
      this.tickets = [];
      return;
    }
    this.loadingTickets = true;
    this.http
      .get<{ success: boolean; data: any[] }>(`${environment.apiUrl}/support/tickets/my`, { withCredentials: true })
      .subscribe({
        next: (res) => {
          this.tickets = res?.data || [];
          this.loadingTickets = false;
        },
        error: () => {
          this.loadingTickets = false;
        }
      });
  }

  loadAnnouncements(): void {
    if (!this.showAnnouncementsTab) {
      this.loadingAnnouncements = false;
      this.announcements = [];
      this.selectedAnnouncement = null;
      this.announcementBadgeCount = 0;
      return;
    }
    this.loadingAnnouncements = true;
    this.selectedAnnouncement = null;
    this.announcementService.getForStudent().subscribe({
      next: (res) => {
        this.announcements = res?.data || [];
        // When showing announcements, default to the latest item (so we don't need tabs/list).
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

  selectAnnouncement(a: AnnouncementItem): void {
    this.selectedAnnouncement = a;
  }

  backToAnnouncementList(): void {
    this.selectedAnnouncement = null;
  }

  private refreshAnnouncementBadge(): void {
    if (!this.showAnnouncementsTab) {
      this.announcementBadgeCount = 0;
      return;
    }
    const reqId = ++this.announcementReqSeq;
    console.info('[support-fab] refresh announcements badge:start', {
      reqId,
      isLoggedIn: this.isLoggedIn,
      userId: this.currentUser?._id || null
    });
    this.announcementService.getForStudent().subscribe({
      next: (res) => {
        const list = Array.isArray(res?.data) ? res.data : [];
        this.isLoggedIn = true;
        this.announcementBadgeCount = list.length;
        this.maybeAutoOpenLatestAnnouncement(list);
        console.info('[support-fab] refresh announcements badge:success', {
          reqId,
          total: list.length
        });
      },
      error: (err) => {
        this.announcementBadgeCount = 0;
        if (err?.status === 401) this.isLoggedIn = false;
        console.error('[support-fab] refresh announcements badge:error', {
          reqId,
          status: err?.status,
          message: err?.error?.message || err?.message || 'Unknown error'
        });
      }
    });
  }

  private maybeAutoOpenLatestAnnouncement(list: AnnouncementItem[]): void {
    if (!this.showAnnouncementsTab) return;
    const latest = list[0];
    const latestId = latest?._id || null;
    if (!latestId) return;
    if (this.autoOpenedAnnouncementId === latestId) return;

    this.autoOpenedAnnouncementId = latestId;
    this.persistAutoOpenedAnnouncementId(latestId);
    this.activeTab = 'announcements';
    this.announcements = list;
    this.selectedAnnouncement = latest;
    this.open = false;
    this.modalOpen = true;
    console.info('[support-fab] auto-opened latest announcement once', { latestId });
  }

  private getAutoOpenStorageKey(): string {
    const userId = this.currentUser?._id || 'unknown';
    return `sf_auto_opened_announcement_${userId}`;
  }

  private readAutoOpenedAnnouncementId(): string | null {
    try {
      return localStorage.getItem(this.getAutoOpenStorageKey());
    } catch (_err) {
      return null;
    }
  }

  private persistAutoOpenedAnnouncementId(announcementId: string): void {
    try {
      localStorage.setItem(this.getAutoOpenStorageKey(), announcementId);
    } catch (_err) {
      // Ignore storage failures (private mode / blocked storage).
    }
  }

  get descriptionLen(): number {
    return this.ticketForm.get('description')?.value?.length || 0;
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.close();
    this.closeModal();
  }
}

