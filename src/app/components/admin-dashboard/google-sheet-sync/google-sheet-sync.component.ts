import { Component, OnDestroy, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  GoogleSheetSyncService,
  SyncStatus,
  SyncResult,
  OcrBatchSummary,
  OcrTestResult,
  ExtractionData,
  StudentBrief,
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
  status: SyncStatus | null = null;
  loading = false;
  syncLoading = false;
  ocrLoading = false;
  message = '';
  messageType: 'success' | 'error' | 'info' = 'info';
  lastResult: SyncResult | null = null;
  lastOcrResult: OcrBatchSummary | null = null;
  extractions: ExtractionData[] = [];
  extractionsLoading = false;
  currentPage = 1;
  totalPages = 1;
  totalItems = 0;
  pageSize = 20;
  testFile: File | null = null;
  testDocType = '';
  testLoading = false;
  testResult: OcrTestResult | null = null;
  testDocTypes = ['', 'PASSPORT', 'BIRTH_CERTIFICATE', 'DEGREE_TRANSCRIPT', 'CV'];
  searchQuery = '';
  private searchTimeout: any = null;

  showStudentPicker = false;
  studentSearchQuery = '';
  studentSearchResults: StudentBrief[] = [];
  studentSearchLoading = false;
  selectedOcrIds = new Set<string>();
  selectedTableIds = new Set<string>();
  private studentSearchTimeout: any = null;

  activityLogs: ActivityLogEntry[] = [];
  activityJob: ActivityJob | null = null;
  private lastActivityId = 0;
  private activityPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private syncService: GoogleSheetSyncService) {}

  get sheetConnected(): boolean {
    return !!(this.status?.sheetConfigured && this.status.sheetConnection?.titleMatch !== false && !this.status.sheetConnectionError);
  }

  ngOnInit(): void {
    this.loadStatus();
    this.loadExtractions();
    this.fetchActivity();
    this.startActivityPolling();
  }

  ngOnDestroy(): void {
    this.stopActivityPolling();
  }

  get activityProgressPercent(): number {
    if (!this.activityJob?.total) return 0;
    return Math.min(100, Math.round((this.activityJob.current / this.activityJob.total) * 100));
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
    this.syncService.getActivity(this.lastActivityId).subscribe({
      next: (res) => {
        if (res.logs.length) {
          this.activityLogs = [...this.activityLogs, ...res.logs].slice(-400);
          this.lastActivityId = res.lastId;
          this.scrollActivityToBottom();
        }
        this.activityJob = res.job;
        const stillBusy = !!(res.job?.running || this.syncLoading || this.ocrLoading);
        if (!stillBusy && !res.job?.running) {
          // keep polling briefly after job ends to catch final lines
        }
      },
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
    this.activityPollTimer = setInterval(() => this.fetchActivity(), 1500);
  }

  private stopActivityPolling(): void {
    if (this.activityPollTimer) {
      clearInterval(this.activityPollTimer);
      this.activityPollTimer = null;
    }
  }

  loadStatus(): void {
    this.loading = true;
    this.syncService.getStatus().subscribe({
      next: (s) => { this.status = s; this.loading = false; },
      error: (err) => { this.showMessage('Failed to load sync status: ' + err.message, 'error'); this.loading = false; },
    });
  }

  triggerSync(): void {
    this.syncLoading = true;
    this.lastResult = null;
    this.fetchActivity();
    this.syncService.triggerSync().subscribe({
      next: (r) => {
        this.lastResult = r;
        const rows = r.rowsWritten ?? r.synced;
        this.showMessage(`✓ Sync complete: ${rows} rows written (${r.synced}/${r.totalStudents} students)`, r.errors?.length ? 'error' : 'success');
        this.syncLoading = false;
        this.fetchActivity();
        this.loadStatus();
        this.loadExtractions(this.currentPage);
      },
      error: (err) => {
        this.showMessage('✗ Sync failed: ' + err.message, 'error');
        this.syncLoading = false;
        this.fetchActivity();
      },
    });
  }

  runOcrAll(): void {
    this.ocrLoading = true;
    this.lastOcrResult = null;
    this.fetchActivity();
    this.syncService.runOcrAll().subscribe({
      next: (r) => {
        this.lastOcrResult = r;
        this.showMessage(`OCR complete: ${r.ok}/${r.total} processed`, r.errors ? 'error' : 'success');
        this.ocrLoading = false;
        this.fetchActivity();
        this.loadStatus();
        this.loadExtractions();
      },
      error: (err) => {
        if (err.status === 409) {
          this.showMessage('OCR batch is already running in another tab or session.', 'error');
        } else {
          this.showMessage('OCR failed: ' + err.message, 'error');
        }
        this.ocrLoading = false;
        this.fetchActivity();
      },
    });
  }

  loadExtractions(page = 1): void {
    this.extractionsLoading = true;
    this.syncService.getExtractions(page, this.pageSize, this.searchQuery).subscribe({
      next: (res) => {
        this.extractions = res.data;
        this.currentPage = res.page;
        this.totalPages = res.totalPages;
        this.totalItems = res.total;
        this.extractionsLoading = false;
      },
      error: () => { this.extractionsLoading = false; },
    });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.loadExtractions(page);
  }

  get pages(): number[] {
    const total = this.totalPages;
    const current = this.currentPage;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, -1, total];
    if (current >= total - 3) return [1, -1, total - 4, total - 3, total - 2, total - 1, total];
    return [1, -1, current - 1, current, current + 1, -1, total];
  }

  getCandidateName(e: ExtractionData): string {
    const c = e.candidate || {};
    return [c.firstName, c.familyName].filter(Boolean).join(' ') || e.studentId?.name || e.regNo || '-';
  }

  getExtractionStudentId(ext: ExtractionData): string | null {
    const sid = ext.studentId as { _id?: string } | string | null;
    if (!sid) return null;
    if (typeof sid === 'string') return sid;
    return sid._id ? String(sid._id) : null;
  }

  isTableRowSelected(ext: ExtractionData): boolean {
    const id = this.getExtractionStudentId(ext);
    return id ? this.selectedTableIds.has(id) : false;
  }

  toggleTableRow(studentId: string): void {
    if (this.selectedTableIds.has(studentId)) this.selectedTableIds.delete(studentId);
    else this.selectedTableIds.add(studentId);
  }

  isAllTableSelected(): boolean {
    const ids = this.extractions.map((e) => this.getExtractionStudentId(e)).filter((id): id is string => !!id);
    return ids.length > 0 && ids.every((id) => this.selectedTableIds.has(id));
  }

  toggleAllTableRows(): void {
    const ids = this.extractions.map((e) => this.getExtractionStudentId(e)).filter((id): id is string => !!id);
    if (this.isAllTableSelected()) ids.forEach((id) => this.selectedTableIds.delete(id));
    else ids.forEach((id) => this.selectedTableIds.add(id));
  }

  runOcrForTableSelection(): void {
    const ids = Array.from(this.selectedTableIds);
    if (ids.length === 0) {
      this.showMessage('Select students using the checkboxes in the table.', 'info');
      return;
    }
    this.ocrLoading = true;
    this.lastOcrResult = null;
    this.fetchActivity();
    this.syncService.runOcrSelected(ids).subscribe({
      next: (r) => {
        this.lastOcrResult = r;
        this.showMessage(`✓ OCR: ${r.ok}/${r.total} processed`, r.errors ? 'error' : 'success');
        this.ocrLoading = false;
        this.selectedTableIds.clear();
        this.fetchActivity();
        this.loadStatus();
        this.loadExtractions(this.currentPage);
      },
      error: (err) => {
        if (err.status === 409) {
          this.showMessage('OCR batch is already running in another tab or session.', 'error');
        } else {
          this.showMessage('✗ OCR failed: ' + err.message, 'error');
        }
        this.ocrLoading = false;
        this.fetchActivity();
      },
    });
  }

  onSearch(): void {
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.currentPage = 1;
      this.loadExtractions(1);
    }, 400);
  }

  openStudentPicker(): void {
    this.showStudentPicker = true;
    this.studentSearchQuery = '';
    this.studentSearchResults = [];
    this.selectedOcrIds = new Set();
  }

  closeStudentPicker(): void {
    this.showStudentPicker = false;
    this.studentSearchResults = [];
    this.selectedOcrIds = new Set();
  }

  onStudentSearch(): void {
    if (this.studentSearchTimeout) clearTimeout(this.studentSearchTimeout);
    this.studentSearchTimeout = setTimeout(() => {
      const q = this.studentSearchQuery.trim();
      if (!q) { this.studentSearchResults = []; return; }
      this.studentSearchLoading = true;
      this.syncService.searchStudents(q).subscribe({
        next: (res) => { this.studentSearchResults = res.data; this.studentSearchLoading = false; },
        error: () => { this.studentSearchLoading = false; },
      });
    }, 400);
  }

  toggleOcrStudent(id: string): void {
    if (this.selectedOcrIds.has(id)) this.selectedOcrIds.delete(id);
    else this.selectedOcrIds.add(id);
  }

  toggleAllStudentsInResults(): void {
    if (this.studentSearchResults.every(s => this.selectedOcrIds.has(s._id))) {
      this.studentSearchResults.forEach(s => this.selectedOcrIds.delete(s._id));
    } else {
      this.studentSearchResults.forEach(s => this.selectedOcrIds.add(s._id));
    }
  }

  isAllSelected(): boolean {
    return this.studentSearchResults.length > 0 && this.studentSearchResults.every(s => this.selectedOcrIds.has(s._id));
  }

  isSelected(id: string): boolean {
    return this.selectedOcrIds.has(id);
  }

  runOcrForSelected(): void {
    const ids = Array.from(this.selectedOcrIds);
    if (ids.length === 0) return;
    this.closeStudentPicker();
    this.ocrLoading = true;
    this.lastOcrResult = null;
    this.syncService.runOcrSelected(ids).subscribe({
      next: (r) => {
        this.lastOcrResult = r;
        this.showMessage(`OCR complete: ${r.ok}/${r.total} processed`, r.errors ? 'error' : 'success');
        this.ocrLoading = false;
        this.loadStatus();
        this.loadExtractions();
      },
      error: (err) => {
        if (err.status === 409) {
          this.showMessage('OCR batch is already running in another tab or session.', 'error');
        } else {
          this.showMessage('OCR failed: ' + err.message, 'error');
        }
        this.ocrLoading = false;
      },
    });
  }

  onTestFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.testFile = input.files?.[0] || null;
    this.testResult = null;
  }

  runOcrTest(): void {
    if (!this.testFile) return;
    this.testLoading = true;
    this.testResult = null;
    this.syncService.testOcr(this.testFile, this.testDocType).subscribe({
      next: (r) => { this.testResult = r; this.testLoading = false; },
      error: (err) => { this.showMessage('Test OCR failed: ' + err.message, 'error'); this.testLoading = false; },
    });
  }

  getParsedEntries(parsed: Record<string, string>): { key: string; value: string }[] {
    return Object.entries(parsed).filter(([k]) => k !== 'fullText').map(([key, value]) => ({ key, value }));
  }

  private showMessage(msg: string, type: 'success' | 'error' | 'info'): void {
    this.message = msg;
    this.messageType = type;
    setTimeout(() => { if (this.message === msg) this.message = ''; }, 8000);
  }
}
