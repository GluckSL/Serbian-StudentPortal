import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-payment-approvals',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './payment-approvals.component.html',
  styleUrls: ['./payment-approvals.component.css']
})
export class PaymentApprovalsComponent implements OnInit {
  isLoading = true;
  submissions: any[] = [];
  counts = { pending: 0, confirmed: 0, rejected: 0 };
  activeFilter = 'all';
  actionLoading: { [id: string]: boolean } = {};

  // Reject modal state
  showRejectModal = false;
  rejectingId = '';
  rejectReason = '';

  // Confirmation modal state
  showConfirmModal = false;
  confirmingId = '';
  confirmingName = '';
  confirmingAmount = 0;

  toast: { msg: string; type: 'success' | 'error' } | null = null;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadSubmissions();
  }

  loadSubmissions(): void {
    this.isLoading = true;
    const url = this.activeFilter === 'all'
      ? '/api/payment-submissions/all'
      : `/api/payment-submissions/all?status=${this.activeFilter}`;

    this.http.get<any>(url).subscribe({
      next: (res) => {
        this.submissions = res.submissions || [];
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; }
    });

    // Also refresh counts
    this.http.get<any>('/api/payment-submissions/pending').subscribe({
      next: (res) => { this.counts = res.counts || this.counts; },
      error: () => {}
    });
  }

  setFilter(f: string): void {
    this.activeFilter = f;
    this.loadSubmissions();
  }

  openConfirmModal(sub: any): void {
    this.confirmingId = sub._id;
    this.confirmingName = sub.studentName;
    this.confirmingAmount = sub.amount;
    this.showConfirmModal = true;
  }

  closeConfirmModal(): void {
    this.showConfirmModal = false;
    this.confirmingId = '';
  }

  confirmPayment(): void {
    if (!this.confirmingId) return;
    this.actionLoading[this.confirmingId] = true;
    this.showConfirmModal = false;

    this.http.post<any>(`/api/payment-submissions/${this.confirmingId}/confirm`, {}).subscribe({
      next: () => {
        this.showToast('Payment confirmed! Congratulations email sent to student.', 'success');
        this.actionLoading[this.confirmingId] = false;
        this.confirmingId = '';
        this.loadSubmissions();
      },
      error: (err) => {
        this.showToast(err?.error?.message || 'Failed to confirm payment', 'error');
        this.actionLoading[this.confirmingId] = false;
      }
    });
  }

  openRejectModal(sub: any): void {
    this.rejectingId = sub._id;
    this.rejectReason = '';
    this.showRejectModal = true;
  }

  closeRejectModal(): void {
    this.showRejectModal = false;
    this.rejectingId = '';
    this.rejectReason = '';
  }

  rejectPayment(): void {
    if (!this.rejectingId) return;
    this.actionLoading[this.rejectingId] = true;
    this.showRejectModal = false;

    this.http.post<any>(`/api/payment-submissions/${this.rejectingId}/reject`, { reason: this.rejectReason }).subscribe({
      next: () => {
        this.showToast('Submission rejected and student notified.', 'success');
        this.actionLoading[this.rejectingId] = false;
        this.rejectingId = '';
        this.rejectReason = '';
        this.loadSubmissions();
      },
      error: (err) => {
        this.showToast(err?.error?.message || 'Failed to reject submission', 'error');
        this.actionLoading[this.rejectingId] = false;
      }
    });
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'confirmed': return 'pa-badge pa-badge--confirmed';
      case 'processing': return 'pa-badge pa-badge--processing';
      case 'rejected': return 'pa-badge pa-badge--rejected';
      default: return 'pa-badge pa-badge--pending';
    }
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'confirmed': return '✓ Confirmed';
      case 'processing': return '⏳ Processing';
      case 'rejected': return '✗ Rejected';
      default: return '🕐 Pending';
    }
  }

  formatDate(d: string | Date): string {
    if (!d) return '';
    return new Date(d).toLocaleDateString('sr-Latn-RS', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  formatAmount(n: number): string {
    return (n || 0).toLocaleString('sr-Latn-RS', { minimumFractionDigits: 0 });
  }

  showToast(msg: string, type: 'success' | 'error'): void {
    this.toast = { msg, type };
    setTimeout(() => { this.toast = null; }, 4000);
  }
}
