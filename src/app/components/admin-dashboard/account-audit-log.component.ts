import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';

const apiUrl = environment.apiUrl;

interface AuditFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

interface UserAuditLogRow {
  _id: string;
  targetUserId?: string;
  targetUserRole: string;
  targetUserName: string;
  targetUserRegNo: string;
  targetUserEmail: string;
  action: string;
  source: string;
  changedFields: AuditFieldChange[];
  userSnapshot?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  actorId?: string;
  actorName: string;
  actorRole: string;
  actorIp: string;
  occurredAt: string;
}

@Component({
  selector: 'app-account-audit-log',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account-audit-log.component.html',
  styleUrls: ['./account-audit-log.component.css'],
})
export class AccountAuditLogComponent implements OnInit {
  loading = false;
  error = '';
  rows: UserAuditLogRow[] = [];
  expandedId: string | null = null;
  total = 0;
  page = 1;
  pages = 1;

  filters = {
    q: '',
    action: '',
    targetUserRole: '',
    from: '',
    to: '',
  };

  readonly actions = ['', 'CREATE', 'UPDATE', 'DELETE', 'PASSWORD_RESET', 'BULK_UPDATE'];
  readonly roles = ['', 'STUDENT', 'TEACHER', 'TEACHER_ADMIN', 'ADMIN', 'SUB_ADMIN'];

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.fetchLogs();
  }

  fetchLogs(page = this.page): void {
    this.loading = true;
    this.error = '';
    this.page = page;

    let params = new HttpParams()
      .set('page', String(page))
      .set('limit', '50');

    if (this.filters.q.trim()) params = params.set('q', this.filters.q.trim());
    if (this.filters.action) params = params.set('action', this.filters.action);
    if (this.filters.targetUserRole) params = params.set('targetUserRole', this.filters.targetUserRole);
    if (this.filters.from) params = params.set('from', this.filters.from);
    if (this.filters.to) params = params.set('to', this.filters.to);

    this.http
      .get<{ success: boolean; data: UserAuditLogRow[]; total: number; pages: number; message?: string }>(
        `${apiUrl}/admin/user-audit-logs`,
        { params }
      )
      .subscribe({
        next: (res) => {
          if (!res.success) {
            this.error = res.message || 'Failed to load audit logs';
            this.rows = [];
            return;
          }
          this.rows = res.data || [];
          this.total = res.total || 0;
          this.pages = res.pages || 1;
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to load audit logs';
          this.rows = [];
        },
        complete: () => {
          this.loading = false;
        },
      });
  }

  applyFilters(): void {
    this.fetchLogs(1);
  }

  clearFilters(): void {
    this.filters = { q: '', action: '', targetUserRole: '', from: '', to: '' };
    this.fetchLogs(1);
  }

  toggleExpand(id: string): void {
    this.expandedId = this.expandedId === id ? null : id;
  }

  formatWhen(value: string): string {
    if (!value) return '—';
    return new Date(value).toLocaleString();
  }

  actorLabel(row: UserAuditLogRow): string {
    if (row.actorName) return `${row.actorName} (${row.actorRole || 'unknown'})`;
    return 'Unknown / system';
  }

  targetLabel(row: UserAuditLogRow): string {
    const parts = [row.targetUserName, row.targetUserRegNo, row.targetUserRole].filter(Boolean);
    return parts.join(' · ') || '—';
  }

  formatValue(value: unknown): string {
    if (value == null || value === '') return '—';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }
}
