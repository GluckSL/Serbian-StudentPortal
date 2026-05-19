import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { SupportTicket } from './help.component';

@Component({
  selector: 'app-help-admin',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
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
  replyError: string | null = null;

  readonly pageSizeOptions = [10, 20, 50];
  pageSize = 20;
  currentPage = 1;
  readonly skeletonKpis = Array.from({ length: 6 }, (_, i) => i);
  readonly skeletonRows = Array.from({ length: 8 }, (_, i) => i);

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
          this.tickets = (res?.data || []).map((t) => ({
            ...t,
            status: this.normalizeTicketStatus(t.status)
          }));
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
        t.ticketNumber?.toLowerCase().includes(q) ||
        (t.batch && String(t.batch).toLowerCase().includes(q)) ||
        (t.regNo && String(t.regNo).toLowerCase().includes(q))
      );
    }
    if (this.filterStatus) {
      result = result.filter(t => t.status === this.filterStatus);
    }
    if (this.filterPriority) {
      result = result.filter(t => t.priority === this.filterPriority);
    }
    this.filteredTickets = result;
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }
  }

  get totalFiltered(): number {
    return this.filteredTickets.length;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalFiltered / this.pageSize));
  }

  get pagedTickets(): SupportTicket[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredTickets.slice(start, start + this.pageSize);
  }

  get paginationLabel(): string {
    if (this.totalFiltered === 0) return 'No tickets to show';
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, this.totalFiltered);
    return `Showing ${start}–${end} of ${this.totalFiltered}`;
  }

  onSearchOrFilterChange(): void {
    this.currentPage = 1;
    this.selectedTicket = null;
    this.applyFilters();
  }

  onPageSizeChange(size: number | string): void {
    this.pageSize = Number(size) || 20;
    this.currentPage = 1;
    this.selectedTicket = null;
  }

  goToPage(page: number): void {
    const next = Math.min(Math.max(1, page), this.totalPages);
    if (next === this.currentPage) return;
    this.currentPage = next;
    this.selectedTicket = null;
  }

  trackTicketById(_index: number, ticket: SupportTicket): string {
    return ticket._id || '';
  }

  /** Keep status in sync with server enum and option values. */
  private normalizeTicketStatus(raw?: string): SupportTicket['status'] {
    const s = String(raw || 'open')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
    const aliases: Record<string, SupportTicket['status']> = {
      open: 'open',
      'in-progress': 'in-progress',
      inprogress: 'in-progress',
      resolved: 'resolved',
      closed: 'closed'
    };
    return aliases[s] || 'open';
  }

  updateStatus(ticket: SupportTicket, newStatus: string): void {
    if (!ticket._id) return;
    const normalized = this.normalizeTicketStatus(newStatus);
    const prevNorm = this.normalizeTicketStatus(ticket.status);
    if (normalized === prevNorm) return;

    ticket.status = normalized;
    this.updatingId = ticket._id;
    this.http
      .patch<{ success: boolean; data: SupportTicket }>(
        `${environment.apiUrl}/support/tickets/${ticket._id}/status`,
        { status: normalized },
        { withCredentials: true }
      )
      .subscribe({
        next: (res) => {
          if (res?.success && res.data) {
            ticket.status = this.normalizeTicketStatus(res.data.status);
          } else {
            ticket.status = prevNorm;
          }
          this.updatingId = null;
        },
        error: () => {
          ticket.status = prevNorm;
          this.updatingId = null;
        }
      });
  }

  viewTicket(ticket: SupportTicket): void {
    this.replyError = null;
    this.selectedTicket = this.selectedTicket?._id === ticket._id ? null : ticket;
  }

  sendReply(ticket: SupportTicket): void {
    if (!ticket._id) return;
    const msg = (this.replyDraft[ticket._id] || '').trim();
    if (!msg) return;

    this.replyingId = ticket._id;
    this.replyError = null;
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
            if (idx >= 0) {
              const prev = this.tickets[idx];
              this.tickets[idx] = {
                ...updated,
                batch: updated.batch ?? prev.batch ?? null,
                regNo: updated.regNo ?? prev.regNo ?? null
              };
            }
            this.applyFilters();
            this.selectedTicket = updated;
            this.replyDraft[ticket._id!] = '';
          }
          this.replyingId = null;
        },
        error: (err) => {
          this.replyError =
            err?.error?.message ||
            err?.error?.msg ||
            err?.message ||
            'Could not send reply. Check your connection or permissions.';
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
  get closedCount(): number { return this.tickets.filter(t => t.status === 'closed').length; }
}
