import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';

import { KrishDashboardApiService } from './krish-dashboard-api.service';
import {
  DEFAULT_FILTERS,
  KrishAnalytics,
  KrishDashboardFilters,
  KrishPackage,
  KrishStatus,
  PACKAGE_LABELS,
  PaginationMeta,
  ProfessionStat,
  SalesStudent,
  SalesStudentNote,
  SalesStudentSvc,
  SERVICE_OPTED_CATALOG,
  STATUS_COLORS,
  STATUS_LABELS,
  UNSPECIFIED_PROFESSION,
  isNonSkilledProfessionLabel,
} from './krish-dashboard-filters.model';

@Component({
  selector: 'app-krish-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './krish-dashboard.component.html',
  styleUrls: ['./krish-dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KrishDashboardComponent implements OnInit, OnDestroy {
  @ViewChild('tableAnchor') tableAnchor!: ElementRef;
  @ViewChild('importFileInput') importFileInput!: ElementRef<HTMLInputElement>;

  // ── Analytics ────────────────────────────────────────────────────────────
  analytics: KrishAnalytics | null = null;
  analyticsLoading = true;
  professionBreakdown: ProfessionStat[] = [];

  // ── Student Table ────────────────────────────────────────────────────────
  students: SalesStudent[] = [];
  pagination: PaginationMeta = { total: 0, page: 1, limit: 25, pages: 0 };
  tableLoading = true;

  // ── Filters ───────────────────────────────────────────────────────────────
  filters: KrishDashboardFilters = { ...DEFAULT_FILTERS };
  private readonly searchSubject = new Subject<string>();

  // ── Drawer ────────────────────────────────────────────────────────────────
  drawerStudent: SalesStudent | null = null;
  drawerLoading = false;
  drawerTab: 'info' | 'notes' | 'followups' | 'timeline' = 'info';

  // ── Create / Edit dialog ─────────────────────────────────────────────────
  showFormDialog = false;
  formMode: 'create' | 'edit' = 'create';
  formData: Partial<SalesStudent> & { serviceNames?: string[] } = {};
  formSaving = false;
  formError = '';

  // ── Import dialog ─────────────────────────────────────────────────────────
  showImportDialog = false;
  importStep: 'upload' | 'preview' | 'committing' | 'done' = 'upload';
  importFile: File | null = null;
  importFileForCommit: File | null = null;
  importPreview: {
    valid: any[];
    invalid: any[];
    validCount: number;
    invalidCount: number;
    warningCount?: number;
    duplicateEmailCount?: number;
    duplicateNameCount?: number;
    importCount?: number;
    professionCount?: number;
    totalRows: number;
  } | null = null;
  importLoading = false;
  importResult: {
    imported: number;
    updated?: number;
    merged?: number;
    skipped?: number;
    emailAdjusted?: number;
    failed: any[];
  } | null = null;
  importError = '';
  resetLoading = false;

  // ── Note form (inside drawer) ─────────────────────────────────────────────
  noteForm = { type: 'NOTE', content: '', followUpDate: '' };
  noteSaving = false;

  // ── Constants exposed to template ─────────────────────────────────────────
  readonly PACKAGE_LABELS = PACKAGE_LABELS;
  readonly STATUS_LABELS  = STATUS_LABELS;
  readonly STATUS_COLORS  = STATUS_COLORS;
  readonly SERVICE_OPTED_CATALOG = SERVICE_OPTED_CATALOG;
  readonly UNSPECIFIED_PROFESSION = UNSPECIFIED_PROFESSION;
  readonly PACKAGES: KrishPackage[] = ['PLATINUM', 'SILVER', 'VISA_DOCS'];
  readonly STATUSES: KrishStatus[]  = ['UNCERTAIN', 'ONGOING', 'COMPLETED', 'WITHDREW'];

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly api: KrishDashboardApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadAnalytics();
    this.loadStudents();

    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe((q) => {
      this.filters.search = q;
      this.filters.page = 1;
      this.loadStudents();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  loadAnalytics(): void {
    this.analyticsLoading = true;
    this.api.getAnalytics().subscribe({
      next: (res) => {
        if (res.success) {
          this.analytics = res.data;
          this.syncProfessionBreakdown();
        }
        this.analyticsLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.analyticsLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  /** Instant profession cards from preloaded analytics — no extra API call. */
  syncProfessionBreakdown(): void {
    if (!this.filters.serviceName || !this.analytics?.professionBreakdowns) {
      this.professionBreakdown = [];
      return;
    }
    this.professionBreakdown =
      this.analytics.professionBreakdowns[this.filters.serviceName] || [];
  }

  loadStudents(): void {
    const showSkeleton = this.students.length === 0;
    if (showSkeleton) {
      this.tableLoading = true;
      this.cdr.markForCheck();
    }
    this.api.getStudents(this.filters).subscribe({
      next: (res) => {
        if (res.success) {
          this.students = res.data;
          this.pagination = res.pagination;
        }
        this.tableLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.tableLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  // ── Filter actions ────────────────────────────────────────────────────────

  applyFilter(patch: Partial<KrishDashboardFilters>): void {
    const next: KrishDashboardFilters = { ...this.filters, ...patch, page: 1 };
    if ('serviceName' in patch && patch.serviceName !== this.filters.serviceName) {
      next.profession = null;
    }
    if ('status' in patch || 'serviceName' in patch) {
      next.profession = null;
    }
    this.filters = next;
    this.syncProfessionBreakdown();
    this.loadStudents();
    this.scrollToTable();
  }

  applyProfessionFilter(profession: string, status?: KrishStatus | null): void {
    const professionValue =
      profession === UNSPECIFIED_PROFESSION ? '__UNSPECIFIED__' : profession;
    const patch: Partial<KrishDashboardFilters> = { profession: professionValue, page: 1 };
    if (status !== undefined) {
      patch.status = status;
    }
    this.filters = { ...this.filters, ...patch };
    this.loadStudents();
    this.scrollToTable();
    this.cdr.markForCheck();
  }

  /** Sheet-wide profession chip — all statuses, every service (matches Excel total). */
  applySheetProfessionFilter(profession: string): void {
    const professionValue =
      profession === UNSPECIFIED_PROFESSION ? '__UNSPECIFIED__' : profession;
    this.filters = {
      ...this.filters,
      serviceName: null,
      status: null,
      profession: professionValue,
      page: 1,
    };
    this.professionBreakdown = [];
    this.loadStudents();
    this.scrollToTable();
    this.cdr.markForCheck();
  }

  /** Service chip — first number: current status only (e.g. 23 ongoing). */
  applyServiceProfessionStatusFilter(profession: string): void {
    this.applyProfessionFilter(profession, this.filters.status ?? null);
  }

  /** Service chip — total number: all statuses in this service (e.g. 38). */
  applyServiceProfessionTotalFilter(profession: string): void {
    this.applyProfessionFilter(profession, null);
  }

  isProfessionActive(profession: string): boolean {
    const value = profession === UNSPECIFIED_PROFESSION ? '__UNSPECIFIED__' : profession;
    return this.filters.profession === value;
  }

  professionBreakdownTitle(): string {
    const parts = [this.filters.serviceName || ''];
    if (this.filters.status) {
      parts.push(STATUS_LABELS[this.filters.status]);
    }
    return parts.filter(Boolean).join(' · ');
  }

  professionDisplayTotal(prof: ProfessionStat): number {
    if (!this.filters.status) return prof.total;
    switch (this.filters.status) {
      case 'ONGOING': return prof.ongoing;
      case 'UNCERTAIN': return prof.uncertain ?? 0;
      case 'COMPLETED': return prof.completed ?? 0;
      case 'WITHDREW': return prof.withdrew ?? 0;
      default: return prof.total;
    }
  }

  /** Professions with a non-zero count for the active status filter. */
  visibleProfessionBreakdown(): ProfessionStat[] {
    const list = this.professionBreakdown.filter((p) => {
      if (!this.filters.status) return true;
      return this.professionDisplayTotal(p) > 0;
    });
    return list;
  }

  skilledProfessionBreakdown(): ProfessionStat[] {
    return this.visibleProfessionBreakdown()
      .filter((p) => !isNonSkilledProfessionLabel(p.profession))
      .sort((a, b) => this.professionDisplayTotal(b) - this.professionDisplayTotal(a));
  }

  otherProfessionBreakdown(): ProfessionStat[] {
    return this.visibleProfessionBreakdown()
      .filter((p) => isNonSkilledProfessionLabel(p.profession))
      .sort((a, b) => this.professionDisplayTotal(b) - this.professionDisplayTotal(a));
  }

  allSkilledProfessions(): ProfessionStat[] {
    return this.professionBreakdown
      .filter((p) => !isNonSkilledProfessionLabel(p.profession))
      .sort((a, b) => b.total - a.total);
  }

  allOtherProfessions(): ProfessionStat[] {
    return this.professionBreakdown.filter((p) =>
      isNonSkilledProfessionLabel(p.profession),
    );
  }

  sheetSkilledProfessions(): ProfessionStat[] {
    return (this.analytics?.sheetProfessions || [])
      .filter((p) => !isNonSkilledProfessionLabel(p.profession))
      .sort((a, b) => b.total - a.total);
  }

  sheetSkilledTotal(): number {
    return this.sheetSkilledProfessions().reduce((sum, p) => sum + p.total, 0);
  }

  sheetProfessionMeta(): string {
    const list = this.sheetSkilledProfessions();
    if (!list.length) return '';
    return `${list.length} skilled categories · ${this.sheetSkilledTotal()} students (matches Excel / ChatGPT)`;
  }

  skilledProfessionStudentTotal(): number {
    return this.skilledProfessionBreakdown().reduce(
      (sum, p) => sum + this.professionDisplayTotal(p),
      0,
    );
  }

  allSkilledInServiceTotal(): number {
    return this.allSkilledProfessions().reduce((sum, p) => sum + p.total, 0);
  }

  professionBreakdownMeta(): string {
    const skilled = this.skilledProfessionBreakdown();
    const inService = this.allSkilledInServiceTotal();
    if (!skilled.length && !this.allSkilledProfessions().length) {
      return 'No professional data — re-import Excel with Professional Categories column';
    }
    if (this.filters.status) {
      const statusLabel = STATUS_LABELS[this.filters.status].toLowerCase();
      return `${this.filters.serviceName} only · ${this.skilledProfessionStudentTotal()} ${statusLabel} skilled · ${inService} total skilled in service`;
    }
    return `${this.filters.serviceName} only · ${inService} skilled students · ${this.allSkilledProfessions().length} categories`;
  }

  professionCompareHint(): string {
    if (this.filters.status) {
      const statusLabel = STATUS_LABELS[this.filters.status].toLowerCase();
      return `Green chip → all students (every status). Blue chip → click ${statusLabel} number for ${statusLabel} only, or / total for all statuses in ${this.filters.serviceName}.`;
    }
    return `Green row matches Excel. Below is ${this.filters.serviceName} only.`;
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.professionBreakdown = [];
    this.loadStudents();
  }

  removeChip(field: 'status' | 'package' | 'serviceName' | 'profession' | 'search'): void {
    (this.filters as any)[field] = field === 'search' ? '' : null;
    this.filters.page = 1;
    if (field === 'serviceName') {
      this.filters.profession = null;
      this.professionBreakdown = [];
    }
    if (field === 'profession' && this.filters.serviceName) {
      this.syncProfessionBreakdown();
    }
    this.loadStudents();
  }

  onSearchInput(q: string): void {
    this.searchSubject.next(q);
  }

  get activeChips(): { field: string; label: string }[] {
    const chips: { field: string; label: string }[] = [];
    if (this.filters.status)
      chips.push({ field: 'status', label: `Status: ${STATUS_LABELS[this.filters.status]}` });
    if (this.filters.package)
      chips.push({ field: 'package', label: `Package: ${PACKAGE_LABELS[this.filters.package]}` });
    if (this.filters.serviceName)
      chips.push({ field: 'serviceName', label: `Service: ${this.filters.serviceName}` });
    if (this.filters.profession) {
      const label =
        this.filters.profession === '__UNSPECIFIED__'
          ? UNSPECIFIED_PROFESSION
          : this.filters.profession;
      chips.push({ field: 'profession', label: `Professional: ${label}` });
    }
    if (this.filters.search)
      chips.push({ field: 'search', label: `Search: "${this.filters.search}"` });
    return chips;
  }

  // ── Sorting ───────────────────────────────────────────────────────────────

  sortBy(field: string): void {
    if (this.filters.sortBy === field) {
      this.filters.sortDir = this.filters.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.filters.sortBy = field;
      this.filters.sortDir = 'asc';
    }
    this.filters.page = 1;
    this.loadStudents();
  }

  sortIcon(field: string): string {
    if (this.filters.sortBy !== field) return 'unfold_more';
    return this.filters.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  // ── Pagination ────────────────────────────────────────────────────────────

  goToPage(p: number): void {
    if (p < 1 || p > this.pagination.pages) return;
    this.filters.page = p;
    this.loadStudents();
    this.scrollToTable();
  }

  get pageNumbers(): number[] {
    const total = this.pagination.pages;
    const cur   = this.filters.page;
    const delta = 2;
    const pages: number[] = [];
    for (let i = Math.max(1, cur - delta); i <= Math.min(total, cur + delta); i++) {
      pages.push(i);
    }
    return pages;
  }

  private scrollToTable(): void {
    setTimeout(() => {
      this.tableAnchor?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  // ── Drawer ────────────────────────────────────────────────────────────────

  openDrawer(student: SalesStudent): void {
    this.drawerStudent = student;
    this.drawerTab = 'info';
    this.drawerLoading = true;
    this.cdr.markForCheck();
    this.api.getStudent(student._id).subscribe({
      next: (res) => {
        if (res.success) this.drawerStudent = res.data;
        this.drawerLoading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.drawerLoading = false; this.cdr.markForCheck(); },
    });
  }

  closeDrawer(): void {
    this.drawerStudent = null;
    this.cdr.markForCheck();
  }

  drawerNotes(): SalesStudentNote[] {
    return (this.drawerStudent as any)?.notes?.filter((n: any) => n.type === 'NOTE') ?? [];
  }

  drawerFollowUps(): SalesStudentNote[] {
    return (this.drawerStudent as any)?.notes?.filter((n: any) => n.type === 'FOLLOW_UP') ?? [];
  }

  drawerServices(): SalesStudentSvc[] {
    return this.drawerStudent?.services ?? [];
  }

  drawerTimeline(): any[] {
    return (this.drawerStudent as any)?.statusHistory ?? [];
  }

  // ── Note form ─────────────────────────────────────────────────────────────

  submitNote(): void {
    if (!this.drawerStudent || !this.noteForm.content.trim()) return;
    this.noteSaving = true;
    const payload = {
      type: this.noteForm.type,
      content: this.noteForm.content,
      ...(this.noteForm.followUpDate ? { followUpDate: this.noteForm.followUpDate } : {}),
    };
    this.api.addNote(this.drawerStudent._id, payload).subscribe({
      next: () => {
        this.noteForm = { type: 'NOTE', content: '', followUpDate: '' };
        this.noteSaving = false;
        this.openDrawer(this.drawerStudent!);
      },
      error: () => { this.noteSaving = false; this.cdr.markForCheck(); },
    });
  }

  toggleFollowUp(studentId: string, noteId: string, done: boolean): void {
    this.api.updateNote(studentId, noteId, { isCompleted: done }).subscribe({
      next: () => this.openDrawer(this.drawerStudent!),
      error: () => {},
    });
  }

  // ── Create / Edit dialog ──────────────────────────────────────────────────

  openCreateDialog(): void {
    this.formMode = 'create';
    this.formData = { status: 'UNCERTAIN', package: 'PLATINUM', serviceNames: [] };
    this.formError = '';
    this.showFormDialog = true;
    this.cdr.markForCheck();
  }

  openEditDialog(student: SalesStudent): void {
    this.formMode = 'edit';
    this.formData = {
      ...student,
      serviceNames: (student.services || []).map((s) => s.serviceName),
    };
    this.formError = '';
    this.showFormDialog = true;
    this.cdr.markForCheck();
  }

  closeFormDialog(): void {
    this.showFormDialog = false;
    this.cdr.markForCheck();
  }

  toggleFormService(name: string): void {
    const names = this.formData.serviceNames || [];
    const idx = names.indexOf(name);
    if (idx >= 0) names.splice(idx, 1);
    else names.push(name);
    this.formData = { ...this.formData, serviceNames: [...names] };
  }

  isFormServiceSelected(name: string): boolean {
    return (this.formData.serviceNames || []).includes(name);
  }

  saveStudent(): void {
    this.formSaving = true;
    this.formError = '';
    const payload: any = { ...this.formData };
    payload.services = (payload.serviceNames || []).map((name: string) => ({ serviceName: name }));
    delete payload.serviceNames;

    const obs = this.formMode === 'create'
      ? this.api.createStudent(payload)
      : this.api.updateStudent(payload._id, payload);

    obs.subscribe({
      next: () => {
        this.formSaving = false;
        this.showFormDialog = false;
        this.loadStudents();
        this.loadAnalytics();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.formSaving = false;
        this.formError = err?.error?.message || 'Failed to save student';
        this.cdr.markForCheck();
      },
    });
  }

  confirmDelete(student: SalesStudent): void {
    if (!confirm(`Delete ${student.name} from the Sales database? This cannot be undone.`)) return;
    this.api.deleteStudent(student._id).subscribe({
      next: () => {
        if (this.drawerStudent?._id === student._id) this.closeDrawer();
        this.loadStudents();
        this.loadAnalytics();
      },
      error: () => alert('Failed to delete student'),
    });
  }

  resetAllData(): void {
    if (
      !confirm(
        'Delete ALL sales students and reset the dashboard to zero? You can re-import your Excel file after this.'
      )
    ) {
      return;
    }
    this.resetLoading = true;
    this.api.resetAllSalesData().subscribe({
      next: (res) => {
        this.resetLoading = false;
        if (res.success) {
          this.closeDrawer();
          this.loadStudents();
          this.loadAnalytics();
        } else {
          alert(res.message || 'Failed to reset data');
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.resetLoading = false;
        alert(err?.error?.message || 'Failed to reset data');
        this.cdr.markForCheck();
      },
    });
  }

  // ── Import dialog ─────────────────────────────────────────────────────────

  openImportDialog(): void {
    this.showImportDialog = true;
    this.importStep = 'upload';
    this.importFile = null;
    this.importFileForCommit = null;
    this.importPreview = null;
    this.importResult = null;
    this.importError = '';
    this.cdr.markForCheck();
  }

  closeImportDialog(): void {
    this.showImportDialog = false;
    this.cdr.markForCheck();
  }

  onImportFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.importFile = input.files?.[0] ?? null;
    this.importFileForCommit = this.importFile;
    this.cdr.markForCheck();
  }

  triggerFileInput(): void {
    this.importFileInput?.nativeElement?.click();
  }

  uploadForPreview(): void {
    if (!this.importFile) return;
    this.importFileForCommit = this.importFile;
    this.importLoading = true;
    this.importError = '';
    this.api.previewImport(this.importFile).subscribe({
      next: (res) => {
        if (res.success) {
          this.importPreview = res.data;
          this.importStep = 'preview';
        } else {
          this.importError = res.message || 'Failed to parse file';
        }
        this.importLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.importError = err?.error?.message || 'Failed to parse file';
        this.importLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  commitImport(): void {
    const count = this.importPreview?.importCount ?? this.importPreview?.validCount ?? 0;
    const file = this.importFileForCommit || this.importFile;
    if (!count) return;
    if (!file) {
      this.importError = 'File is no longer available. Please choose your Excel file again.';
      this.importStep = 'upload';
      this.cdr.markForCheck();
      return;
    }
    this.importStep = 'committing';
    this.importLoading = true;
    this.importError = '';
    this.api.commitImport(file).subscribe({
      next: (res) => {
        if (res.success) {
          this.importResult = res.data;
          this.importStep = 'done';
          this.loadStudents();
          this.loadAnalytics();
        } else {
          this.importError = res.message || 'Import failed';
          this.importStep = 'preview';
        }
        this.importLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.importError =
          err?.error?.message ||
          (err?.status === 0 ? 'Could not reach server — check that the backend is running.' : 'Import failed');
        this.importStep = 'preview';
        this.importLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  // ── Export ────────────────────────────────────────────────────────────────

  exportData(format: 'csv' | 'xlsx'): void {
    const url = this.api.getExportUrl(this.filters, format);
    window.open(url, '_blank');
  }

  // ── Template helpers ──────────────────────────────────────────────────────

  packageStat(pkg: KrishPackage) {
    return this.analytics?.packages?.find((p) => p.package === pkg);
  }

  serviceChips(student: SalesStudent): string[] {
    return (student.services || []).map((s) => s.serviceName);
  }

  get serviceSkeletonRows(): number[] {
    return Array.from({ length: 4 }, (_, i) => i);
  }

  trackById(_i: number, item: { _id: string }) {
    return item._id;
  }

  get skeletonRows(): number[] {
    return Array.from({ length: 6 }, (_, i) => i);
  }

  formatDate(d?: string): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** Normalize legacy HOLD and unknown statuses for display. */
  displayStatus(status?: string): string {
    if (!status || status === 'HOLD') return STATUS_LABELS.WITHDREW;
    return STATUS_LABELS[status as KrishStatus] ?? status;
  }

  statusColor(status?: string): string {
    if (!status || status === 'HOLD') return STATUS_COLORS.WITHDREW;
    return STATUS_COLORS[status as KrishStatus] ?? '#6b7280';
  }

  displayProfession(profession?: string | null): string {
    const v = (profession || '').trim();
    if (!v) return UNSPECIFIED_PROFESSION;
    return v;
  }

  isOtherProfessionChip(prof: ProfessionStat): boolean {
    return isNonSkilledProfessionLabel(prof.profession);
  }

  importRowCount(): number {
    return this.importPreview?.importCount ?? this.importPreview?.validCount ?? 0;
  }

  importWarningCount(): number {
    return this.importPreview?.warningCount ?? this.importPreview?.invalidCount ?? 0;
  }

  minOf(a: number, b: number): number {
    return Math.min(a, b);
  }
}
