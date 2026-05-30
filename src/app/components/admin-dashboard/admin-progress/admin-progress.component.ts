import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { TestAccountBadgeComponent } from '../../../shared/test-account-badge/test-account-badge.component';
import {
  StudentJourneyDetailModalComponent,
  StudentJourneyPreview
} from '../student-journey-detail-modal/student-journey-detail-modal.component';

interface OverviewResponse {
  data: any[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
  summary: { avgOverall: number; avgLearning: number; avgAttendance: number; lowAttendanceCount: number };
  availableBatches: string[];
  availableLevels: string[];
}

@Component({
  selector: 'app-admin-progress',
  standalone: true,
  imports: [CommonModule, FormsModule, TestAccountBadgeComponent, StudentJourneyDetailModalComponent],
  templateUrl: './admin-progress.component.html',
  styleUrls: ['./admin-progress.component.css']
})
export class AdminProgressComponent implements OnInit {
  Math = Math;
  isLoading = true;

  data: any[] = [];
  total = 0;
  page = 1;
  pageSize = 50;
  totalPages = 1;

  summary = { avgOverall: 0, avgLearning: 0, avgAttendance: 0, lowAttendanceCount: 0 };
  availableBatches: string[] = [];
  availableLevels: string[] = [];

  selectedIds = new Set<string>();
  selectedStudent: any = null;

  searchTerm = '';
  filterBatch = '';
  filterStatus = '';
  filterLevel = '';
  sortField = 'overallPct';
  sortDir: 'desc' | 'asc' = 'desc';

  // Journey modal
  journeyModal = false;
  journeyStudentId = '';
  journeyStudentName = '';
  journeyPreview: StudentJourneyPreview | null = null;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.fetchData();
  }

  private buildParams(): HttpParams {
    let params = new HttpParams()
      .set('page', String(this.page))
      .set('limit', String(this.pageSize))
      .set('sortField', this.sortField)
      .set('sortDir', this.sortDir);
    if (this.searchTerm.trim()) params = params.set('search', this.searchTerm.trim());
    if (this.filterBatch) params = params.set('batch', this.filterBatch);
    if (this.filterStatus) params = params.set('status', this.filterStatus);
    if (this.filterLevel) params = params.set('level', this.filterLevel);
    return params;
  }

  private fetchData(): void {
    this.isLoading = true;
    this.http.get<OverviewResponse>('/api/student-progress/admin/overview', { params: this.buildParams() }).subscribe({
      next: (res) => {
        this.data = res.data;
        this.total = res.total;
        this.page = res.page;
        this.totalPages = res.totalPages;
        this.summary = res.summary;
        this.availableBatches = res.availableBatches;
        this.availableLevels = res.availableLevels;
        this.selectedIds.clear();
        this.selectedStudent = null;
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; }
    });
  }

  applyFilters(): void {
    this.page = 1;
    this.fetchData();
  }

  sort(field: string): void {
    if (this.sortField === field) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
    else { this.sortField = field; this.sortDir = 'desc'; }
    this.fetchData();
  }

  sortIcon(field: string): string {
    if (this.sortField !== field) return '↕';
    return this.sortDir === 'asc' ? '↑' : '↓';
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.filterBatch = '';
    this.filterStatus = '';
    this.filterLevel = '';
    this.applyFilters();
  }

  onPageChange(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.fetchData();
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.page = 1;
    this.fetchData();
  }

  get paginatorPages(): number[] {
    const pages: number[] = [];
    const start = Math.max(1, this.page - 2);
    const end = Math.min(this.totalPages, this.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  isSelected(studentId: string): boolean {
    return this.selectedIds.has(studentId);
  }

  toggleSelection(studentId: string, checked: boolean): void {
    if (checked) this.selectedIds.add(studentId);
    else this.selectedIds.delete(studentId);
  }

  get allFilteredSelected(): boolean {
    return this.data.length > 0 && this.data.every((s) => this.selectedIds.has(s._id));
  }

  toggleSelectAllFiltered(checked: boolean): void {
    if (checked) {
      this.data.forEach((s) => this.selectedIds.add(s._id));
    } else {
      this.data.forEach((s) => this.selectedIds.delete(s._id));
    }
  }

  get selectedStudents(): any[] {
    return this.data.filter((s) => this.selectedIds.has(s._id));
  }

  private csvValue(value: unknown): string {
    const safe = value == null ? '' : String(value);
    return `"${safe.replace(/"/g, '""')}"`;
  }

  private toCsv(students: any[]): string {
    const headers = [
      'Student Name',
      'Reg No',
      'Email',
      'Batch',
      'Level',
      'Overall %',
      'Learning %',
      'Attendance %',
      'Attendance Sessions',
      'Docs Verified',
      'Docs Total',
      'Payment %',
      'Payment Currency',
      'Visa %',
      'Status',
      'Teacher',
      'Service'
    ];

    const rows = students.map((s) => [
      s.name || '',
      s.regNo || '',
      s.email || '',
      s.batch || '',
      s.level || '',
      s.overallPct ?? 0,
      s.learningPct ?? 0,
      s.attendance?.rate ?? 0,
      `${s.attendance?.attended ?? 0}/${s.attendance?.total ?? 0}`,
      s.docs?.verified ?? 0,
      s.docs?.total ?? 0,
      s.payment?.pct ?? '',
      s.payment?.currency || '',
      s.visa?.pct ?? '',
      s.status || '',
      s.teacher || '',
      s.service || ''
    ]);

    return [headers, ...rows]
      .map((row) => row.map((col) => this.csvValue(col)).join(','))
      .join('\n');
  }

  private downloadCsv(filename: string, csv: string): void {
    // BOM helps Excel open UTF-8 CSV correctly.
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  exportAllFiltered(): void {
    if (!this.data.length) return;
    const csv = this.toCsv(this.data);
    this.downloadCsv(`student-progress-all-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  exportSelected(): void {
    const selected = this.selectedStudents;
    if (!selected.length) return;
    const csv = this.toCsv(selected);
    this.downloadCsv(`student-progress-selected-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  exportSingle(student: any, event?: Event): void {
    event?.stopPropagation();
    const safeName = (student?.name || 'student').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const csv = this.toCsv([student]);
    this.downloadCsv(`student-progress-${safeName || 'student'}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  selectStudent(s: any): void {
    this.selectedStudent = this.selectedStudent?._id === s._id ? null : s;
  }

  barColor(pct: number): string {
    if (pct >= 75) return '#22c55e';
    if (pct >= 40) return '#f59e0b';
    return '#ef4444';
  }

  formatDate(d: string | Date): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // ── Journey modal ──
  openJourney(s: any, event: Event): void {
    event.stopPropagation();
    this.journeyStudentId = s._id;
    this.journeyStudentName = s.name || '';
    this.journeyPreview = {
      email: s.email,
      subscription: s.subscription,
      medium: s.medium,
      level: s.level,
      regNo: s.regNo,
      batch: s.batch
    };
    this.journeyModal = true;
  }

  closeJourney(): void {
    this.journeyModal = false;
    this.journeyStudentId = '';
    this.journeyStudentName = '';
    this.journeyPreview = null;
  }
}
