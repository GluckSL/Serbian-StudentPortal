import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GoogleSheetSyncService, SyncStatus, SyncResult, OcrBatchSummary, OcrTestResult, ExtractionData, StudentBrief } from '../../../services/google-sheet-sync.service';

@Component({
  selector: 'app-google-sheet-sync',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './google-sheet-sync.component.html',
  styleUrls: ['./google-sheet-sync.component.css'],
})
export class GoogleSheetSyncComponent implements OnInit {
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
  private studentSearchTimeout: any = null;

  constructor(private syncService: GoogleSheetSyncService) {}

  ngOnInit(): void {
    this.loadStatus();
    this.loadExtractions();
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
    this.syncService.triggerSync().subscribe({
      next: (r) => {
        this.lastResult = r;
        this.showMessage(`Sync complete: ${r.synced}/${r.totalStudents} students synced`, r.errors?.length ? 'error' : 'success');
        this.syncLoading = false;
        this.loadStatus();
      },
      error: (err) => { this.showMessage('Sync failed: ' + err.message, 'error'); this.syncLoading = false; },
    });
  }

  runOcrAll(): void {
    this.ocrLoading = true;
    this.lastOcrResult = null;
    this.syncService.runOcrAll().subscribe({
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
