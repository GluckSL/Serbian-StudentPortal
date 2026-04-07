import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-support-fab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule],
  templateUrl: './support-fab.component.html',
  styleUrls: ['./support-fab.component.css']
})
export class SupportFabComponent implements OnInit {
  open = false; // small launcher panel
  modalOpen = false; // full modal
  activeTab: 'submit' | 'faq' | 'tickets' = 'submit';

  ticketForm!: FormGroup;
  submitting = false;
  submitSuccess = false;
  submitError = '';
  screenshotFile: File | null = null;

  isLoggedIn = false;
  currentUser: any = null;
  tickets: any[] = [];
  loadingTickets = false;

  openFaqIndex: number | null = null;

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

  readonly faqs = [
    {
      q: 'I cannot log in to my account.',
      a: 'Make sure you are using the correct email and password. If you have forgotten your password, use the “Forgot Password” link or email support@gluckglobal.com.'
    },
    {
      q: 'My video or audio is not working during class.',
      a: 'Use the Audio Test page to verify microphone and speakers. Ensure browser permissions are allowed. If the issue persists, raise a ticket.'
    },
    {
      q: 'I cannot join my Zoom class.',
      a: 'Ensure Zoom is installed and the class has started. If the issue persists, raise a ticket.'
    }
  ];

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private authService: AuthService
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
  }

  toggle(): void {
    this.open = !this.open;
  }

  close(): void {
    this.open = false;
  }

  openModal(tab: 'submit' | 'faq' | 'tickets' = 'submit'): void {
    this.activeTab = tab;
    this.modalOpen = true;
    this.open = false;
    this.submitError = '';
    this.submitSuccess = false;
    if (tab === 'tickets') this.loadMyTickets();
  }

  closeModal(): void {
    this.modalOpen = false;
  }

  setTab(tab: 'submit' | 'faq' | 'tickets'): void {
    this.activeTab = tab;
    if (tab === 'tickets') this.loadMyTickets();
  }

  toggleFaq(i: number): void {
    this.openFaqIndex = this.openFaqIndex === i ? null : i;
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

  get descriptionLen(): number {
    return this.ticketForm.get('description')?.value?.length || 0;
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.close();
    this.closeModal();
  }
}

