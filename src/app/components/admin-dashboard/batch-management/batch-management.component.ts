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
  batchType: 'new' | 'old';
  strictJourneyRule: boolean;
  strictJourneyThresholdPercent: number;
  journeyActive: boolean;
  studentCount: number;
  teacherName: string | null;
  hasSavedConfig?: boolean;
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
  batches: BatchRow[] = [];
  batchSearch = '';
  selectedBatch: BatchRow | null = null;

  editForm = {
    batchName: '',
    batchType: 'new' as 'new' | 'old',
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

  get filteredBatches(): BatchRow[] {
    const q = this.batchSearch.trim().toLowerCase();
    if (!q) return this.batches;
    return this.batches.filter((b) => b.batchName.toLowerCase().includes(q));
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

  loadBatches(): void {
    this.loading = true;
    this.http
      .get<{ batches: BatchRow[]; upcomingBatches: BatchRow[] }>(this.api, { withCredentials: true })
      .subscribe({
        next: (res) => {
          const all = [...(res.batches || []), ...(res.upcomingBatches || [])];
          const byKey = new Map<string, BatchRow>();
          for (const b of all) {
            const key = b.batchName.trim().toLowerCase();
            if (!byKey.has(key)) byKey.set(key, b);
          }
          this.batches = Array.from(byKey.values()).sort((a, b) =>
            a.batchName.localeCompare(b.batchName, undefined, { sensitivity: 'base', numeric: true })
          );
          this.loading = false;
          if (this.selectedBatch) {
            const refreshed = this.batches.find(
              (b) => b.batchName.toLowerCase() === this.selectedBatch!.batchName.toLowerCase()
            );
            if (refreshed) this.selectBatch(refreshed);
            else this.selectedBatch = null;
          }
        },
        error: (err) => {
          this.loading = false;
          this.notify.error(err.error?.message || 'Failed to load batches');
        }
      });
  }

  selectBatch(batch: BatchRow): void {
    this.selectedBatch = batch;
    this.editForm = {
      batchName: batch.batchName,
      batchType: batch.batchType || 'new',
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
          batchType: 'new',
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

  batchTypeLabel(type: string): string {
    return type === 'old' ? 'Old (live only)' : 'New (full content)';
  }
}
