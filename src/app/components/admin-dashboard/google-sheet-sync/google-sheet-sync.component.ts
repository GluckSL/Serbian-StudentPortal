import { Component, OnDestroy, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  GoogleSheetSyncService,
  StudentBrief,
  StudentListResponse,
  FilterOptions,
  ActivityLogEntry,
  ActivityJob,
  ActivityLogLevel,
} from '../../../services/google-sheet-sync.service';

@Component({
  selector: 'app-google-sheet-sync',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './google-sheet-sync.component.html',
  styleUrls: ['./google-sheet-sync.component.css'],
})
export class GoogleSheetSyncComponent implements OnInit, OnDestroy {
  @ViewChild('activityLogBody') activityLogBody?: ElementRef<HTMLDivElement>;

  students: StudentBrief[] = [];
  totalItems = 0;
  currentPage = 1;
  totalPages = 1;
  pageSize = 50;
  studentsLoading = false;
  searchQuery = '';
  private searchTimeout: any = null;

  batchFilter = '';
  levelFilter = '';
  batchOptions: string[] = [];
  levelOptions: string[] = [];

  selectedIds = new Set<string>();
  selectAllCurrentPage = false;

  extractLoading = false;
  message = '';
  messageType: 'success' | 'error' | 'info' = 'info';

  activityLogs: ActivityLogEntry[] = [];
  activityJob: ActivityJob | null = null;
  private lastActivityId = 0;
  private activityPollTimer: ReturnType<typeof setTimeout> | null = null;
  private activityPolling = false;

  constructor(private syncService: GoogleSheetSyncService) {}

  ngOnInit(): void {
    this.loadFilterOptions();
    this.loadStudents();
    this.fetchActivity();
  }

  loadFilterOptions(): void {
    this.syncService.getFilterOptions().subscribe({
      next: (opts: FilterOptions) => {
        this.batchOptions = opts.batches;
        this.levelOptions = opts.levels;
      },
    });
  }

  ngOnDestroy(): void {
    this.stopActivityPolling();
  }

  get activityProgressPercent(): number {
    if (!this.activityJob?.total) return 0;
    return Math.min(100, Math.round((this.activityJob.current / this.activityJob.total) * 100));
  }

  get jobIsRunning(): boolean {
    return !!(this.activityJob?.running || this.extractLoading);
  }

  logIcon(level: ActivityLogLevel): string {
    if (level === 'success') return '✓';
    if (level === 'error') return '✗';
    if (level === 'warn') return '!';
    return '·';
  }

  clearActivityLog(): void {
    this.syncService.clearActivityLog().subscribe({
      next: () => {
        this.activityLogs = [];
        this.activityJob = null;
        this.lastActivityId = 0;
      },
    });
  }

  private fetchActivity(): void {
    if (this.activityPolling) return;
    this.activityPolling = true;
    this.syncService.getActivity(this.lastActivityId).subscribe({
      next: (res) => {
        if (res.logs.length) {
          this.activityLogs = [...this.activityLogs, ...res.logs].slice(-400);
          this.lastActivityId = res.lastId;
          this.scrollActivityToBottom();
        }
        this.activityJob = res.job;
        if (!res.job?.running && !this.extractLoading) this.stopActivityPolling();
      },
      complete: () => { this.activityPolling = false; },
      error: () => { this.activityPolling = false; },
    });
  }

  private scrollActivityToBottom(): void {
    setTimeout(() => {
      const el = this.activityLogBody?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }

  private startActivityPolling(): void {
    this.stopActivityPolling();

    const poll = () => {
      this.fetchActivity();
      this.activityPollTimer = setTimeout(poll, 500);
    };

    this.activityPollTimer = setTimeout(poll, 500);
  }

  private stopActivityPolling(): void {
    if (this.activityPollTimer) {
      clearTimeout(this.activityPollTimer);
      this.activityPollTimer = null;
    }
  }

  loadStudents(page = this.currentPage): void {
    this.studentsLoading = true;
    this.syncService.getAllStudents(page, this.pageSize, this.searchQuery, this.batchFilter, this.levelFilter).subscribe({
      next: (res: StudentListResponse) => {
        this.students = res.data;
        this.currentPage = res.page;
        this.totalPages = res.totalPages;
        this.totalItems = res.total;
        this.studentsLoading = false;
        this.selectedIds.clear();
        this.selectAllCurrentPage = false;
      },
      error: () => { this.studentsLoading = false; },
    });
  }

  onSearch(): void {
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.currentPage = 1;
      this.loadStudents(1);
    }, 400);
  }

  onFilterChange(): void {
    this.currentPage = 1;
    this.loadStudents(1);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.loadStudents(page);
  }

  get pages(): number[] {
    const total = this.totalPages;
    const current = this.currentPage;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, -1, total];
    if (current >= total - 3) return [1, -1, total - 4, total - 3, total - 2, total - 1, total];
    return [1, -1, current - 1, current, current + 1, -1, total];
  }

  toggleStudent(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
  }

  toggleAllOnPage(): void {
    this.selectAllCurrentPage = !this.selectAllCurrentPage;
    if (this.selectAllCurrentPage) {
      this.students.forEach(s => this.selectedIds.add(s._id));
    } else {
      this.students.forEach(s => this.selectedIds.delete(s._id));
    }
  }

  isAllOnPageSelected(): boolean {
    return this.students.length > 0 && this.students.every(s => this.selectedIds.has(s._id));
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  runExtract(): void {
    const ids = Array.from(this.selectedIds);
    if (ids.length === 0) return;

    this.extractLoading = true;
    this.fetchActivity();
    this.startActivityPolling();

    this.syncService.extractAndSyncSelected(ids).subscribe({
      next: (r) => {
        this.showMessage(`${r.ok}/${r.total} written to sheet${r.errors ? ` (${r.errors} failed)` : ''}`, r.errors ? 'error' : 'success');
        this.extractLoading = false;
        this.selectedIds.clear();
        this.selectAllCurrentPage = false;
        this.fetchActivity();
      },
      error: (err) => {
        if (err.status === 409) {
          this.showMessage('Extraction is already running in another tab or session.', 'error');
        } else {
          this.showMessage('✗ Extraction failed: ' + err.message, 'error');
        }
        this.extractLoading = false;
        this.fetchActivity();
      },
    });
  }

  private showMessage(msg: string, type: 'success' | 'error' | 'info'): void {
    this.message = msg;
    this.messageType = type;
    setTimeout(() => { if (this.message === msg) this.message = ''; }, 8000);
  }
}
