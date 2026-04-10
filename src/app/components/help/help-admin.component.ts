import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { SupportTicket } from './help.component';

@Component({
  selector: 'app-help-admin',
  standalone: true,
  imports: [CommonModule, HttpClientModule, RouterModule, FormsModule],
  templateUrl: './help-admin.component.html',
  styleUrls: ['./help-admin.component.css']
})
export class HelpAdminComponent implements OnInit {
  tickets: SupportTicket[] = [];
  filteredTickets: SupportTicket[] = [];
  loading = false;
  error = '';
  searchQuery = '';
  filterStatus = '';
  filterPriority = '';
  updatingId: string | null = null;
  selectedTicket: SupportTicket | null = null;
  replyDraft: Record<string, string> = {};
  replyingId: string | null = null;

  readonly statuses = ['open', 'in-progress', 'resolved', 'closed'];

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

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadTickets();
  }

  loadTickets(): void {
    this.loading = true;
    this.error = '';
    this.http
      .get<{ success: boolean; data: SupportTicket[] }>(
        `${environment.apiUrl}/support/tickets`,
        { withCredentials: true }
      )
      .subscribe({
        next: (res) => {
          this.tickets = res?.data || [];
          this.applyFilters();
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Failed to load tickets.';
          this.loading = false;
        }
      });
  }

  applyFilters(): void {
    let result = [...this.tickets];
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      result = result.filter(t =>
        t.subject?.toLowerCase().includes(q) ||
        t.name?.toLowerCase().includes(q) ||
        t.email?.toLowerCase().includes(q) ||
        t.ticketNumber?.toLowerCase().includes(q)
      );
    }
    if (this.filterStatus) {
      result = result.filter(t => t.status === this.filterStatus);
    }
    if (this.filterPriority) {
      result = result.filter(t => t.priority === this.filterPriority);
    }
    this.filteredTickets = result;
  }

  updateStatus(ticket: SupportTicket, newStatus: string): void {
    if (!ticket._id) return;
    this.updatingId = ticket._id;
    this.http
      .patch<{ success: boolean; data: SupportTicket }>(
        `${environment.apiUrl}/support/tickets/${ticket._id}/status`,
        { status: newStatus },
        { withCredentials: true }
      )
      .subscribe({
        next: (res) => {
          if (res?.success) {
            ticket.status = res.data.status;
          }
          this.updatingId = null;
        },
        error: () => {
          this.updatingId = null;
        }
      });
  }

  viewTicket(ticket: SupportTicket): void {
    this.selectedTicket = this.selectedTicket?._id === ticket._id ? null : ticket;
  }

  sendReply(ticket: SupportTicket): void {
    if (!ticket._id) return;
    const msg = (this.replyDraft[ticket._id] || '').trim();
    if (!msg) return;

    this.replyingId = ticket._id;
    this.http
      .post<{ success: boolean; data: SupportTicket; message?: string }>(
        `${environment.apiUrl}/support/tickets/${ticket._id}/reply`,
        { message: msg },
        { withCredentials: true }
      )
      .subscribe({
        next: (res) => {
          if (res?.success) {
            // update local ticket
            const updated = res.data;
            const idx = this.tickets.findIndex(t => t._id === updated._id);
            if (idx >= 0) this.tickets[idx] = updated;
            this.applyFilters();
            this.selectedTicket = updated;
            this.replyDraft[ticket._id!] = '';
          }
          this.replyingId = null;
        },
        error: () => {
          this.replyingId = null;
        }
      });
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
    const map: Record<string, string> = { low: 'priority-low', medium: 'priority-medium', high: 'priority-high' };
    return map[priority || 'medium'] || 'priority-medium';
  }

  getCategoryLabel(value: string): string {
    return this.categories.find(c => c.value === value)?.label || value;
  }

  get openCount(): number { return this.tickets.filter(t => t.status === 'open').length; }
  get inProgressCount(): number { return this.tickets.filter(t => t.status === 'in-progress').length; }
  get resolvedCount(): number { return this.tickets.filter(t => t.status === 'resolved').length; }
  get highPriorityCount(): number { return this.tickets.filter(t => t.priority === 'high' && t.status === 'open').length; }
}
