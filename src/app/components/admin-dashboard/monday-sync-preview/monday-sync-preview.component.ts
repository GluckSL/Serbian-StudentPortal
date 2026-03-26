import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MaterialModule } from '../../../shared/material.module';
import { environment } from '../../../../environments/environment';

interface SyncChange {
  field: string;
  portalValue: string;
  mondayValue: string;
}

interface UpdatedStudent {
  name: string;
  email: string;
  regNo: string;
  changes: SyncChange[];
}

interface NewStudent {
  name: string;
  email: string;
  batch: string;
  level: string;
  subscription: string;
  servicesOpted: string;
  teacherIncharge: string;
}

interface PreviewResponse {
  success: boolean;
  totalOnBoard: number;
  eligibleCount: number;
  newStudents: NewStudent[];
  updatedStudents: UpdatedStudent[];
  skipped: { name: string; reason: string }[];
  summary: {
    willCreate: number;
    willUpdate: number;
    noChanges: number;
    skipped: number;
  };
}

@Component({
  selector: 'app-monday-sync-preview',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './monday-sync-preview.component.html',
  styleUrls: ['./monday-sync-preview.component.css']
})
export class MondaySyncPreviewComponent implements OnInit {
  loading = false;
  error = '';
  data: PreviewResponse | null = null;

  // Filters
  activeTab: 'new' | 'updated' | 'nochange' = 'new';
  searchQuery = '';

  // Expanded rows for updated students
  expandedRows = new Set<string>();

  // Sync status
  lastSyncRun: string | null = null;
  lastSyncResult: any = null;
  syncing = false;
  syncResult: any = null;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadSyncStatus();
  }

  loadSyncStatus(): void {
    this.http.get<any>(`${environment.apiUrl}/auth/monday-sync-status`, { withCredentials: true })
      .subscribe({
        next: (res) => {
          this.lastSyncRun = res.lastRun;
          this.lastSyncResult = res.result;
        },
        error: () => {}
      });
  }

  forceSync(): void {
    if (!confirm('Are you sure you want to run the Monday.com sync now? This will create new students and update existing ones.')) return;
    this.syncing = true;
    this.syncResult = null;
    this.http.post<any>(`${environment.apiUrl}/auth/monday-sync-run`, {}, { withCredentials: true })
      .subscribe({
        next: (res) => {
          this.syncResult = res.result;
          this.syncing = false;
          this.loadSyncStatus();
        },
        error: (err) => {
          this.error = err.error?.message || 'Sync failed';
          this.syncing = false;
        }
      });
  }

  formatSyncDate(d: string | null): string {
    if (!d) return 'Never';
    return new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  loadPreview(): void {
    this.loading = true;
    this.error = '';
    this.http.get<PreviewResponse>(`${environment.apiUrl}/auth/monday-sync-preview`, { withCredentials: true })
      .subscribe({
        next: (res) => { this.data = res; this.loading = false; },
        error: (err) => { this.error = err.error?.message || 'Failed to fetch preview'; this.loading = false; }
      });
  }

  get filteredNew(): NewStudent[] {
    if (!this.data) return [];
    if (!this.searchQuery.trim()) return this.data.newStudents;
    const q = this.searchQuery.toLowerCase();
    return this.data.newStudents.filter(s =>
      s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
    );
  }

  get filteredUpdated(): UpdatedStudent[] {
    if (!this.data) return [];
    if (!this.searchQuery.trim()) return this.data.updatedStudents;
    const q = this.searchQuery.toLowerCase();
    return this.data.updatedStudents.filter(s =>
      s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || s.regNo.toLowerCase().includes(q)
    );
  }

  toggleRow(email: string): void {
    if (this.expandedRows.has(email)) this.expandedRows.delete(email);
    else this.expandedRows.add(email);
  }

  isExpanded(email: string): boolean {
    return this.expandedRows.has(email);
  }
}
