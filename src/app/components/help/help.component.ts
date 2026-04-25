import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

export interface SupportTicket {
  _id?: string;
  ticketNumber?: string;
  name: string;
  email: string;
  subject: string;
  category: string;
  priority: string;
  description: string;
  screenshot?: {
    url?: string;
    originalName?: string;
  };
  replies?: Array<{
    authorRole?: string;
    message?: string;
    createdAt?: string;
  }>;
  status?: 'open' | 'in-progress' | 'resolved' | 'closed';
  createdAt?: string;
  updatedAt?: string;
  userId?: string;
}

@Component({
  selector: 'app-help',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './help.component.html',
  styleUrls: ['./help.component.css']
})
export class HelpComponent implements OnInit {
  activeTab: 'submit' | 'tickets' = 'submit';
  ticketForm!: FormGroup;
  submitting = false;
  submitSuccess = false;
  submitError = '';
  tickets: SupportTicket[] = [];
  loadingTickets = false;
  isLoggedIn = false;
  currentUser: any = null;
  submittedTicket: SupportTicket | null = null;
  screenshotFile: File | null = null;
  expandedTicketId: string | null = null;

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
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'tickets' || tab === 'submit') {
      this.activeTab = tab;
    }

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

    if (this.isLoggedIn) {
      this.loadMyTickets();
    }
  }

  setTab(tab: 'submit' | 'tickets'): void {
    this.activeTab = tab;
    if (tab === 'tickets' && this.isLoggedIn && this.tickets.length === 0) {
      this.loadMyTickets();
    }
  }

  toggleTicket(ticketId?: string): void {
    if (!ticketId) return;
    this.expandedTicketId = this.expandedTicketId === ticketId ? null : ticketId;
  }

  repliesCount(ticket: SupportTicket): number {
    return (ticket.replies || []).length;
  }

  onSubmit(): void {
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
    this.submitSuccess = false;

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
      .post<{ success: boolean; data: SupportTicket; message?: string }>(
        `${environment.apiUrl}/support/tickets`,
        fd,
        { withCredentials: true }
      )
      .subscribe({
        next: (res) => {
          if (res?.success) {
            this.submitSuccess = true;
            this.submittedTicket = res.data;
            this.screenshotFile = null;
            this.ticketForm.reset({ priority: 'medium', screenshot: null });
            if (this.currentUser) {
              this.ticketForm.patchValue({ name: this.currentUser.name, email: this.currentUser.email });
            }
            if (this.isLoggedIn) {
              this.loadMyTickets();
            }
          } else {
            this.submitError = res?.message || 'Failed to submit ticket. Please try again.';
          }
          this.submitting = false;
        },
        error: (err) => {
          this.submitError = err?.error?.message || 'Unable to submit ticket. Please try again or email support@gluckglobal.com.';
          this.submitting = false;
        }
      });
  }

  loadMyTickets(): void {
    if (!this.isLoggedIn) return;
    this.loadingTickets = true;
    this.http
      .get<{ success: boolean; data: SupportTicket[] }>(
        `${environment.apiUrl}/support/tickets/my`,
        { withCredentials: true }
      )
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

  onScreenshotSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.screenshotFile = file;
    this.ticketForm.patchValue({ screenshot: file ? file.name : null });
    this.ticketForm.get('screenshot')?.updateValueAndValidity();
  }

  getStatusClass(status?: string): string {
    const map: Record<string, string> = {
      open: 'status-open',
      'in-progress': 'status-progress',
      resolved: 'status-resolved',
      closed: 'status-closed'
    };
    return map[status || 'open'] || 'status-open';
  }

  getPriorityClass(priority?: string): string {
    const map: Record<string, string> = {
      low: 'priority-low',
      medium: 'priority-medium',
      high: 'priority-high'
    };
    return map[priority || 'medium'] || 'priority-medium';
  }

  getCategoryLabel(value: string): string {
    return this.categories.find(c => c.value === value)?.label || value;
  }

  get descriptionLen(): number {
    return this.ticketForm.get('description')?.value?.length || 0;
  }

  get screenshotLabel(): string {
    return this.screenshotFile?.name || '';
  }
}
