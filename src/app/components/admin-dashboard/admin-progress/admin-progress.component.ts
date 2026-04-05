import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-admin-progress',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-progress.component.html',
  styleUrls: ['./admin-progress.component.css']
})
export class AdminProgressComponent implements OnInit {
  isLoading = true;
  students: any[] = [];
  filtered: any[] = [];
  selectedIds = new Set<string>();

  searchTerm = '';
  filterBatch = '';
  filterStatus = '';
  filterLevel = '';
  sortField = 'overallPct';
  sortDir: 'desc' | 'asc' = 'desc';

  // Detail panel
  selectedStudent: any = null;

  // Journey modal
  journeyModal = false;
  journeyLoading = false;
  journeyData: any = null;
  journeyStudentName = '';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http.get<any[]>('/api/student-progress/admin/overview').subscribe({
      next: (res) => { this.students = res; this.applyFilters(); this.isLoading = false; },
      error: () => { this.isLoading = false; }
    });
  }

  get batches(): string[] {
    return Array.from(new Set(this.students.map(s => s.batch).filter(Boolean))).sort((a, b) => Number(a) - Number(b));
  }
  get levels(): string[] {
    return Array.from(new Set(this.students.map(s => s.level).filter(Boolean))).sort();
  }

  get avgOverall(): number {
    if (!this.filtered.length) return 0;
    return Math.round(this.filtered.reduce((s, st) => s + st.overallPct, 0) / this.filtered.length);
  }
  get avgAttendance(): number {
    const withAtt = this.filtered.filter(s => s.attendance.total > 0);
    if (!withAtt.length) return 0;
    return Math.round(withAtt.reduce((s, st) => s + st.attendance.rate, 0) / withAtt.length);
  }
  get avgLearning(): number {
    if (!this.filtered.length) return 0;
    return Math.round(this.filtered.reduce((s, st) => s + st.learningPct, 0) / this.filtered.length);
  }
  get lowAttendanceCount(): number {
    return this.filtered.filter(s => s.attendance.total > 0 && s.attendance.rate < 70).length;
  }

  applyFilters(): void {
    let list = [...this.students];
    const term = this.searchTerm.toLowerCase().trim();
    if (term) {
      list = list.filter(s =>
        s.name.toLowerCase().includes(term) ||
        s.email.toLowerCase().includes(term) ||
        (s.regNo || '').toLowerCase().includes(term)
      );
    }
    if (this.filterBatch) list = list.filter(s => s.batch === this.filterBatch);
    if (this.filterStatus) list = list.filter(s => s.status === this.filterStatus);
    if (this.filterLevel) list = list.filter(s => s.level === this.filterLevel);

    list.sort((a, b) => {
      let va = a[this.sortField], vb = b[this.sortField];
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
      if (va < vb) return this.sortDir === 'asc' ? -1 : 1;
      if (va > vb) return this.sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    this.filtered = list;
  }

  sort(field: string): void {
    if (this.sortField === field) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
    else { this.sortField = field; this.sortDir = 'desc'; }
    this.applyFilters();
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

  isSelected(studentId: string): boolean {
    return this.selectedIds.has(studentId);
  }

  toggleSelection(studentId: string, checked: boolean): void {
    if (checked) this.selectedIds.add(studentId);
    else this.selectedIds.delete(studentId);
  }

  get allFilteredSelected(): boolean {
    return this.filtered.length > 0 && this.filtered.every((s) => this.selectedIds.has(s._id));
  }

  toggleSelectAllFiltered(checked: boolean): void {
    if (checked) {
      this.filtered.forEach((s) => this.selectedIds.add(s._id));
    } else {
      this.filtered.forEach((s) => this.selectedIds.delete(s._id));
    }
  }

  get selectedStudents(): any[] {
    return this.filtered.filter((s) => this.selectedIds.has(s._id));
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
    if (!this.filtered.length) return;
    const csv = this.toCsv(this.filtered);
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
    this.journeyStudentName = s.name;
    this.journeyModal = true;
    this.journeyLoading = true;
    this.journeyData = null;
    this.http.get('/api/student-progress/admin/journey/' + s._id).subscribe({
      next: (res) => { this.journeyData = res; this.journeyLoading = false; },
      error: () => { this.journeyLoading = false; }
    });
  }

  closeJourney(): void {
    this.journeyModal = false;
    this.journeyData = null;
  }

  // Journey computed helpers
  get jProfile() { return this.journeyData?.profile || {}; }
  get jLevelProgression() { return this.journeyData?.levelProgression || []; }
  get jLessonsByLevel() { return this.journeyData?.lessonsByLevel || {}; }
  get jPayments() {
    const p = this.journeyData?.payments || {};
    return { source: p.source || 'invoices', currency: p.currency || 'LKR', invoices: p.invoices || [], totalPackageAmount: p.totalPackageAmount || p.totalAmount || 0, totalAmount: p.totalAmount || p.totalPackageAmount || 0, paidAmount: p.paidAmount || 0, pendingAmount: p.pendingAmount || 0, paymentHistory: p.payments || [] };
  }
  get jVisa() { return this.journeyData?.visa || { steps: [], stages: [], currentStep: 0, totalSteps: 0, route: '', history: [], dates: {} }; }
  get jAttendance() { return this.journeyData?.attendance || { attended: 0, total: 0 }; }
  get jBotUsage() { return this.journeyData?.botUsage || { todayMinutes: 0, weekMinutes: 0, targetMinutesPerWeek: 180 }; }
  get jDocuments() { return this.journeyData?.documents || []; }
  get jHistory() { return this.journeyData?.history || []; }

  get jLevelPath(): string { return this.jLevelProgression.map((l: any) => l.level).join(' → '); }
  get jCurrentLevelLabel(): string { const cur = this.jLevelProgression.find((l: any) => l.status === 'in-progress'); return cur ? cur.level + ' in progress' : this.jProfile.currentLevel || ''; }
  get jAttendanceRate(): number { return this.jAttendance.total ? Math.round((this.jAttendance.attended / this.jAttendance.total) * 100) : 0; }
  get jBotWeekPct(): number { return this.jBotUsage.targetMinutesPerWeek ? Math.min(100, Math.round((this.jBotUsage.weekMinutes / this.jBotUsage.targetMinutesPerWeek) * 100)) : 0; }
  get jDocsSubmitted(): number { return this.jDocuments.filter((d: any) => d.status === 'verified').length; }
  get jDocsPct(): number { return this.jDocuments.length ? Math.round((this.jDocsSubmitted / this.jDocuments.length) * 100) : 0; }
  get jLearningPct(): number { const lp = this.jLevelProgression; const c = lp.filter((l: any) => l.status === 'completed').length; return lp.length ? Math.round((c / lp.length) * 100) : 0; }
  get jPayPct(): number { return this.jPayments.totalAmount ? Math.round((this.jPayments.paidAmount / this.jPayments.totalAmount) * 100) : 0; }
  get jVisaPct(): number { return this.jVisa.steps.length > 1 ? Math.round((this.jVisa.currentStep / (this.jVisa.steps.length - 1)) * 100) : 0; }
  get jOverallPct(): number {
    const lp = this.jLevelProgression;
    const learningPct = lp.length ? lp.filter((l: any) => l.status === 'completed').length / lp.length : 0;
    const docsPct = this.jDocuments.length ? this.jDocsSubmitted / this.jDocuments.length : 0;
    const payPct = this.jPayments.totalAmount ? this.jPayments.paidAmount / this.jPayments.totalAmount : 0;
    const visaPct = this.jVisa.steps.length > 1 ? this.jVisa.currentStep / (this.jVisa.steps.length - 1) : 0;
    return Math.round((learningPct * 0.4 + docsPct * 0.2 + payPct * 0.2 + visaPct * 0.2) * 100);
  }
  get jVisaStageDates(): any[] {
    return (this.jVisa.stages || []).filter((s: any) => s.stageDate && s.stageDateLabel).map((s: any) => ({ label: s.stageDateLabel, date: s.stageDate }));
  }
  isOverdue(dateStr: string): boolean { return new Date() > new Date(dateStr + 'T00:00:00'); }
}
