import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MaterialModule } from '../../../shared/material.module';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../services/notification.service';

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
  regNo?: string;
  batch: string;
  level: string;
  subscription: string;
  studentStatus?: string;
  servicesOpted: string;
  teacherIncharge: string;
  mondayItemId?: string;
}

export interface PreviewStudentRow {
  name: string;
  email?: string;
  regNo?: string;
  batch?: string;
  level?: string;
  subscription?: string;
  studentStatus?: string;
  servicesOpted?: string;
  teacherIncharge?: string;
  mondayItemId?: string;
  detail?: string;
  replacedByName?: string;
  replacedById?: string;
  changes?: SyncChange[];
}

export type DrillDownKey =
  | 'allBoardRows'
  | 'withdrewOnMonday'
  | 'uniqueEmailsToSync'
  | 'duplicateRowsMerged'
  | 'noEmailRows'
  | 'matchedInPortal'
  | 'missingFromPortal'
  | 'portalOnly'
  | 'crmSyncTarget'
  | 'willCreate'
  | 'willUpdate'
  | 'noChanges';

interface DrillDownBuckets {
  allBoardRows: PreviewStudentRow[];
  withdrewOnMonday: PreviewStudentRow[];
  uniqueEmailsToSync: PreviewStudentRow[];
  duplicateRowsMerged: PreviewStudentRow[];
  noEmailRows: PreviewStudentRow[];
  matchedInPortal: PreviewStudentRow[];
  missingFromPortal: PreviewStudentRow[];
  portalOnly: PreviewStudentRow[];
  noChanges: PreviewStudentRow[];
}

interface PortalReconciliation {
  portalTotal: number;
  portalActive: number;
  portalWithdrew: number;
  mondayTotalOnBoard: number;
  mondayWithdrew: number;
  mondayUniqueEmails: number;
  mondayRowsWithoutEmail?: number;
  mondayDuplicateEmailRows: number;
  portalMatchedMonday: number;
  portalMissingFromMonday: number;
  portalExtraNotOnMonday: number;
  crmSyncTarget: number;
}

interface PreviewResponse {
  success: boolean;
  totalOnBoard: number;
  eligibleCount: number;
  eligibleUniqueCount?: number;
  duplicateRowsMerged?: number;
  rowsWithoutEmail?: number;
  reconciliation?: PortalReconciliation;
  drillDown?: DrillDownBuckets;
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

  activeTab: 'new' | 'updated' = 'new';
  searchQuery = '';
  expandedRows = new Set<string>();

  /** Clicked reconciliation / summary card */
  activeDrillDown: DrillDownKey | null = null;
  activeDrillDownLabel = '';

  lastSyncRun: string | null = null;
  lastSyncResult: any = null;
  syncing = false;
  syncResult: any = null;

  constructor(private http: HttpClient, private notify: NotificationService) {}

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
    this.notify.confirm(
      'Run Monday Sync',
      'Are you sure you want to run the Monday.com sync now? This will create new students and update existing ones.',
      'Yes, Run Sync',
      'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
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
    });
  }

  formatSyncDate(d: string | null): string {
    if (!d) return 'Never';
    return new Date(d).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  loadPreview(): void {
    this.loading = true;
    this.error = '';
    this.activeDrillDown = null;
    this.http.get<PreviewResponse>(`${environment.apiUrl}/auth/monday-sync-preview`, { withCredentials: true })
      .subscribe({
        next: (res) => {
          this.data = res;
          this.loading = false;
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to fetch preview';
          this.loading = false;
        }
      });
  }

  selectDrillDown(key: DrillDownKey, label: string): void {
    if (!this.data?.drillDown && key !== 'willCreate' && key !== 'willUpdate') return;
    if (this.activeDrillDown === key) {
      this.clearDrillDown();
      return;
    }
    this.activeDrillDown = key;
    this.activeDrillDownLabel = label;
    this.searchQuery = '';
    this.expandedRows.clear();
  }

  clearDrillDown(): void {
    this.activeDrillDown = null;
    this.activeDrillDownLabel = '';
    this.searchQuery = '';
    this.expandedRows.clear();
  }

  isDrillDownActive(key: DrillDownKey): boolean {
    return this.activeDrillDown === key;
  }

  get drillDownRows(): PreviewStudentRow[] {
    if (!this.data || !this.activeDrillDown) return [];

    let rows: PreviewStudentRow[] = [];
    const d = this.data.drillDown;

    switch (this.activeDrillDown) {
      case 'willCreate':
        rows = this.data.newStudents.map(s => ({ ...s }));
        break;
      case 'willUpdate':
        rows = this.data.updatedStudents.map(s => ({
          name: s.name,
          email: s.email,
          regNo: s.regNo,
          changes: s.changes,
          detail: `${s.changes.length} field(s) will change`,
        }));
        break;
      case 'crmSyncTarget':
        rows = d?.uniqueEmailsToSync ?? [];
        break;
      default:
        rows = (d?.[this.activeDrillDown] as PreviewStudentRow[]) ?? [];
    }

    if (!this.searchQuery.trim()) return rows;
    const q = this.searchQuery.toLowerCase();
    return rows.filter(r =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (r.regNo || '').toLowerCase().includes(q) ||
      (r.detail || '').toLowerCase().includes(q)
    );
  }

  get drillDownCount(): number {
    if (!this.data || !this.activeDrillDown) return 0;
    if (this.activeDrillDown === 'willCreate') return this.data.newStudents.length;
    if (this.activeDrillDown === 'willUpdate') return this.data.updatedStudents.length;
    if (this.activeDrillDown === 'crmSyncTarget') return this.data.drillDown?.uniqueEmailsToSync?.length ?? 0;
    const d = this.data.drillDown;
    if (!d) return 0;
    return (d[this.activeDrillDown as keyof DrillDownBuckets] as PreviewStudentRow[])?.length ?? 0;
  }

  get showChangesColumn(): boolean {
    return this.activeDrillDown === 'willUpdate';
  }

  get showDetailColumn(): boolean {
    return this.activeDrillDown === 'duplicateRowsMerged'
      || this.activeDrillDown === 'noEmailRows'
      || this.activeDrillDown === 'portalOnly';
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
