import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../services/notification.service';

interface BatchRow {
  batchName: string;
  journeyLength: number;
  batchCurrentDay: number;
  batchStartDate: string | null;
  autoDay: boolean;
  notes: string;
  batchType: 'general' | 'new' | 'old';
  strictJourneyRule: boolean;
  strictJourneyThresholdPercent: number;
  journeyActive: boolean;
  studentCount: number;
  teacherName: string | null;
  hasSavedConfig?: boolean;
  level?: string | null;
  levelCounts?: Record<string, number>;
}

interface BatchStudent {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  level: string;
  studentStatus: string;
  currentCourseDay: number;
  selected?: boolean;
}

interface SearchStudent {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  batch: string;
  level: string;
}

type BatchTab = 'all' | 'upcoming';

@Component({
  selector: 'app-batch-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './batch-management.component.html',
  styleUrls: ['./batch-management.component.scss']
})
export class BatchManagementComponent implements OnInit {
  private readonly api = `${environment.apiUrl}/batch-journey`;
  private readonly adminApi = `${environment.apiUrl}/admin`;

  loading = true;
  saving = false;
  allBatches: BatchRow[] = [];
  upcomingBatches: BatchRow[] = [];
  activeTab: BatchTab = 'all';
  batchSearch = '';
  filterLevel = '';
  filterBatchType = '';
  selectedBatch: BatchRow | null = null;

  readonly levels = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly levelLabels = ['All levels', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly batchTypeOptions: { value: string; label: string }[] = [
    { value: '', label: 'All types' },
    { value: 'general', label: 'General' },
    { value: 'new', label: 'New' },
    { value: 'old', label: 'Old' }
  ];

  editForm = {
    batchName: '',
    batchType: 'old' as 'general' | 'new' | 'old',
    notes: '',
    journeyLength: 200,
    batchCurrentDay: 1,
    batchStartDate: '' as string,
    journeyActive: false,
    strictJourneyRule: false,
    strictJourneyThresholdPercent: 100
  };

  students: BatchStudent[] = [];
  studentsLoading = false;
  studentSearch = '';

  showCreateModal = false;
  newBatchName = '';
  newJourneyLength = 200;
  creating = false;

  showAddStudents = false;
  addStudentSearch = '';
  searchResults: SearchStudent[] = [];
  searchLoading = false;
  addingStudents = false;
  selectedAddIds = new Set<string>();

  constructor(
    private http: HttpClient,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadBatches();
  }

  get tabBatches(): BatchRow[] {
    return this.activeTab === 'upcoming' ? this.upcomingBatches : this.allBatches;
  }

  get filteredBatches(): BatchRow[] {
    const q = this.batchSearch.trim().toLowerCase();
    return this.tabBatches.filter((b) => {
      if (q && !b.batchName.toLowerCase().includes(q)) return false;
      if (this.filterBatchType && b.batchType !== this.filterBatchType) return false;
      if (this.filterLevel) {
        const counts = b.levelCounts || {};
        if (!(counts[this.filterLevel] > 0)) return false;
      }
      return true;
    });
  }

  get hasActiveFilters(): boolean {
    return !!(this.batchSearch.trim() || this.filterLevel || this.filterBatchType);
  }

  get filteredStudents(): BatchStudent[] {
    const q = this.studentSearch.trim().toLowerCase();
    if (!q) return this.students;
    return this.students.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.regNo?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q)
    );
  }

  get selectedStudentIds(): string[] {
    return this.students.filter((s) => s.selected).map((s) => s._id);
  }

  setTab(tab: BatchTab): void {
    this.activeTab = tab;
    if (this.selectedBatch && !this.filteredBatches.some((b) => b.batchName === this.selectedBatch!.batchName)) {
      this.selectedBatch = null;
    }
  }

  clearFilters(): void {
    this.batchSearch = '';
    this.filterLevel = '';
    this.filterBatchType = '';
  }

  levelSummary(batch: BatchRow): string {
    const counts = batch.levelCounts || {};
    const parts = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([lv, n]) => `${lv}: ${n}`);
    return parts.length ? parts.join(', ') : '—';
  }

  loadBatches(): void {
    this.loading = true;
    this.http
      .get<{ batches: BatchRow[]; upcomingBatches: BatchRow[] }>(this.api, { withCredentials: true })
      .subscribe({
        next: (res) => {
          this.allBatches = this.sortBatches(res.batches || []);
          this.upcomingBatches = this.sortBatches(res.upcomingBatches || []);
          this.loading = false;
          if (this.selectedBatch) {
            const pool = [...this.allBatches, ...this.upcomingBatches];
            const refreshed = pool.find(
              (b) => b.batchName.toLowerCase() === this.selectedBatch!.batchName.toLowerCase()
            );
            if (refreshed) {
              const wasUpcoming = !this.selectedBatch.journeyActive;
              const nowUpcoming = !refreshed.journeyActive;
              if (wasUpcoming !== nowUpcoming) {
                this.activeTab = nowUpcoming ? 'upcoming' : 'all';
              }
              this.selectBatch(refreshed);
            } else {
              this.selectedBatch = null;
            }
          }
        },
        error: (err) => {
          this.loading = false;
          this.notify.error(err.error?.message || 'Failed to load batches');
        }
      });
  }

  private sortBatches(list: BatchRow[]): BatchRow[] {
    return [...list].sort((a, b) =>
      a.batchName.localeCompare(b.batchName, undefined, { sensitivity: 'base', numeric: true })
    );
  }

  selectBatch(batch: BatchRow): void {
    this.selectedBatch = batch;
    this.editForm = {
      batchName: batch.batchName,
      batchType: (batch.batchType || 'old') as 'general' | 'new' | 'old',
      notes: batch.notes || '',
      journeyLength: batch.journeyLength || 200,
      batchCurrentDay: batch.batchCurrentDay || 1,
      batchStartDate: batch.batchStartDate ? batch.batchStartDate.slice(0, 10) : '',
      journeyActive: !!batch.journeyActive,
      strictJourneyRule: !!batch.strictJourneyRule,
      strictJourneyThresholdPercent: batch.strictJourneyThresholdPercent ?? 100
    };
    this.loadBatchStudents(batch.batchName);
  }

  loadBatchStudents(batchName: string): void {
    this.studentsLoading = true;
    this.http
      .get<{ students: BatchStudent[] }>(`${this.api}/${encodeURIComponent(batchName)}/students`, {
        withCredentials: true
      })
      .subscribe({
        next: (res) => {
          this.students = (res.students || []).map((s) => ({ ...s, selected: false }));
          this.studentsLoading = false;
        },
        error: (err) => {
          this.studentsLoading = false;
          this.notify.error(err.error?.message || 'Failed to load students');
        }
      });
  }

  saveBatchSettings(): void {
    if (!this.selectedBatch) return;
    const oldName = this.selectedBatch.batchName;
    const newName = this.editForm.batchName.trim();
    if (!newName) {
      this.notify.error('Batch name is required');
      return;
    }

    this.saving = true;
    const body: Record<string, unknown> = {
      batchType: this.editForm.batchType,
      notes: this.editForm.notes,
      journeyLength: this.editForm.journeyLength,
      journeyActive: this.editForm.journeyActive,
      strictJourneyRule: this.editForm.strictJourneyRule,
      strictJourneyThresholdPercent: this.editForm.strictJourneyThresholdPercent
    };
    if (!this.editForm.batchStartDate) {
      body['batchStartDate'] = '';
      body['batchCurrentDay'] = this.editForm.batchCurrentDay;
    } else {
      body['batchStartDate'] = this.editForm.batchStartDate;
    }
    if (newName.toLowerCase() !== oldName.toLowerCase()) {
      body['newBatchName'] = newName;
    }

    this.http
      .put(`${this.api}/${encodeURIComponent(oldName)}`, body, { withCredentials: true })
      .subscribe({
        next: (res: { batchName?: string; message?: string }) => {
          this.saving = false;
          this.notify.success(res.message || 'Batch saved');
          const savedName = res.batchName || newName;
          if (this.selectedBatch) {
            this.selectedBatch = { ...this.selectedBatch, batchName: savedName };
            this.editForm.batchName = savedName;
          }
          this.loadBatchStudents(savedName);
          this.loadBatches();
        },
        error: (err) => {
          this.saving = false;
          this.notify.error(err.error?.message || 'Failed to save batch');
        }
      });
  }

  createBatch(): void {
    const name = this.newBatchName.trim();
    if (!name) {
      this.notify.error('Enter a batch name');
      return;
    }
    this.creating = true;
    this.http
      .put(
        `${this.api}/${encodeURIComponent(name)}`,
        {
          createOnly: true,
          journeyLength: this.newJourneyLength,
          batchType: 'old',
          notes: ''
        },
        { withCredentials: true }
      )
      .subscribe({
        next: () => {
          this.creating = false;
          this.showCreateModal = false;
          this.newBatchName = '';
          this.notify.success(`Batch "${name}" created`);
          this.activeTab = 'upcoming';
          this.loadBatches();
        },
        error: (err) => {
          this.creating = false;
          this.notify.error(err.error?.message || 'Failed to create batch');
        }
      });
  }

  openAddStudents(): void {
    this.showAddStudents = true;
    this.addStudentSearch = '';
    this.searchResults = [];
    this.selectedAddIds.clear();
  }

  closeAddStudents(): void {
    this.showAddStudents = false;
  }

  searchStudentsToAdd(): void {
    const q = this.addStudentSearch.trim();
    if (q.length < 2) {
      this.searchResults = [];
      return;
    }
    this.searchLoading = true;
    this.http
      .get<{ success: boolean; data: SearchStudent[] }>(`${this.adminApi}/students`, {
        params: { studentName: q, limit: '30', page: '1' },
        withCredentials: true
      })
      .subscribe({
        next: (res) => {
          const current = this.selectedBatch?.batchName?.toLowerCase() || '';
          this.searchResults = (res.data || []).filter(
            (s) => (s.batch || '').toLowerCase() !== current
          );
          this.searchLoading = false;
        },
        error: () => {
          this.searchLoading = false;
          this.searchResults = [];
        }
      });
  }

  toggleAddStudent(id: string): void {
    if (this.selectedAddIds.has(id)) this.selectedAddIds.delete(id);
    else this.selectedAddIds.add(id);
  }

  confirmAddStudents(): void {
    if (!this.selectedBatch || this.selectedAddIds.size === 0) return;
    this.addingStudents = true;
    this.http
      .put(
        `${this.api}/${encodeURIComponent(this.selectedBatch.batchName)}/students`,
        { addStudentIds: Array.from(this.selectedAddIds) },
        { withCredentials: true }
      )
      .subscribe({
        next: (res: { message?: string; studentsAdded?: number }) => {
          this.addingStudents = false;
          this.notify.success(res.message || `Added ${res.studentsAdded ?? 0} student(s)`);
          this.closeAddStudents();
          this.loadBatchStudents(this.selectedBatch!.batchName);
          this.loadBatches();
        },
        error: (err) => {
          this.addingStudents = false;
          this.notify.error(err.error?.message || 'Failed to add students');
        }
      });
  }

  removeSelectedStudents(): void {
    const ids = this.selectedStudentIds;
    if (!this.selectedBatch || ids.length === 0) return;
    this.notify
      .confirm(
        'Remove from batch',
        `Remove ${ids.length} student(s) from "${this.selectedBatch.batchName}"? They will be set to Unassigned.`,
        'Remove',
        'Cancel'
      )
      .subscribe((ok) => {
        if (!ok) return;
        this.saving = true;
        this.http
          .put(
            `${this.api}/${encodeURIComponent(this.selectedBatch!.batchName)}/students`,
            { removeStudentIds: ids },
            { withCredentials: true }
          )
          .subscribe({
            next: () => {
              this.saving = false;
              this.notify.success('Students removed from batch');
              this.loadBatchStudents(this.selectedBatch!.batchName);
              this.loadBatches();
            },
            error: (err) => {
              this.saving = false;
              this.notify.error(err.error?.message || 'Failed to remove students');
            }
          });
      });
  }

  batchTypeDisplay(type: string | undefined | null): string {
    const t = String(type || '').toLowerCase();
    if (t === 'new') return 'New';
    if (t === 'general') return 'General';
    return 'Old';
  }

  batchTypeLabel(type: string): string {
    const t = String(type || '').toLowerCase();
    if (t === 'old') return 'Old (live classes & recordings only)';
    if (t === 'new') return 'New (modules, exercises & live classes)';
    return 'General (no module content; live classes & recordings)';
  }
}
