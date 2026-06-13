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
  COLUMN_FILTER_LABELS,
  ColumnFilterKey,
  FacetOption,
  facetValueToFilter,
  filterValueToLabel,
  UNSPECIFIED_PROFESSION,
  isNonSkilledProfessionLabel,
} from './krish-dashboard-filters.model';

/** Legacy single-value patches from analytics cards. */
type LegacyFilterPatch = Partial<KrishDashboardFilters> & {
  status?: KrishStatus | null;
  package?: KrishPackage | null;
  serviceName?: string | null;
  profession?: string | null;
  currentLanguageLevel?: string | null;
  documentPaymentStatus?: string | null;
  documentationStatus?: string | null;
  visaStatus?: string | null;
};

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

  // ── Column filter modal (Kanban / pipeline style) ─────────────────────────
  columnFilterOpen: ColumnFilterKey | null = null;
  columnFilterDraft: string[] = [];
  columnFilterDraftB: string[] = [];
  columnFilterSearch = '';

  // ── Constants exposed to template ─────────────────────────────────────────
  readonly PACKAGE_LABELS = PACKAGE_LABELS;
  readonly STATUS_LABELS  = STATUS_LABELS;
  readonly STATUS_COLORS  = STATUS_COLORS;
  readonly SERVICE_OPTED_CATALOG = SERVICE_OPTED_CATALOG;
  readonly UNSPECIFIED_PROFESSION = UNSPECIFIED_PROFESSION;
  readonly COLUMN_FILTER_LABELS = COLUMN_FILTER_LABELS;
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
    const svc = this.filters.serviceNames[0];
    if (!svc || this.filters.serviceNames.length !== 1 || !this.analytics?.professionBreakdowns) {
      this.professionBreakdown = [];
      return;
    }
    this.professionBreakdown = this.analytics.professionBreakdowns[svc] || [];
  }

  primaryServiceName(): string | null {
    return this.filters.serviceNames[0] ?? null;
  }

  hasSummaryFilters(): boolean {
    return (
      !this.filters.statuses.length &&
      !this.filters.packages.length &&
      !this.filters.serviceNames.length
    );
  }

  isSummaryStatusActive(status: KrishStatus): boolean {
    return (
      this.filters.statuses.length === 1 &&
      this.filters.statuses[0] === status &&
      !this.filters.packages.length &&
      !this.filters.serviceNames.length
    );
  }

  private normalizeFilterPatch(patch: LegacyFilterPatch): Partial<KrishDashboardFilters> {
    const next: Partial<KrishDashboardFilters> = { ...patch };
    if ('status' in patch) {
      next.statuses = patch.status ? [patch.status] : [];
      delete (next as LegacyFilterPatch).status;
    }
    if ('package' in patch) {
      next.packages = patch.package ? [patch.package] : [];
      delete (next as LegacyFilterPatch).package;
    }
    if ('serviceName' in patch) {
      next.serviceNames = patch.serviceName ? [patch.serviceName] : [];
      delete (next as LegacyFilterPatch).serviceName;
    }
    if ('profession' in patch) {
      next.professions = patch.profession ? [patch.profession] : [];
      delete (next as LegacyFilterPatch).profession;
    }
    if ('currentLanguageLevel' in patch) {
      next.languageLevels = patch.currentLanguageLevel ? [patch.currentLanguageLevel] : [];
      delete (next as LegacyFilterPatch).currentLanguageLevel;
    }
    if ('documentPaymentStatus' in patch) {
      next.documentPaymentStatuses = patch.documentPaymentStatus ? [patch.documentPaymentStatus] : [];
      delete (next as LegacyFilterPatch).documentPaymentStatus;
    }
    if ('documentationStatus' in patch) {
      next.documentationStatuses = patch.documentationStatus ? [patch.documentationStatus] : [];
      delete (next as LegacyFilterPatch).documentationStatus;
    }
    if ('visaStatus' in patch) {
      next.visaStatuses = patch.visaStatus ? [patch.visaStatus] : [];
      delete (next as LegacyFilterPatch).visaStatus;
    }
    return next;
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

  applyFilter(patch: LegacyFilterPatch): void {
    const normalized = this.normalizeFilterPatch(patch);
    const next: KrishDashboardFilters = { ...this.filters, ...normalized, page: 1 };
    if ('serviceNames' in normalized && !('professions' in normalized)) {
      next.professions = [];
    }
    this.filters = next;
    this.syncProfessionBreakdown();
    this.loadStudents();
    this.scrollToTable();
  }

  applyProfessionFilter(profession: string, status?: KrishStatus | null): void {
    const professionValue =
      profession === UNSPECIFIED_PROFESSION ? '__UNSPECIFIED__' : profession;
    const patch: LegacyFilterPatch = { profession: professionValue, page: 1 };
    if (status !== undefined) {
      patch.status = status;
    }
    this.applyFilter(patch);
    this.cdr.markForCheck();
  }

  /** Sheet-wide profession chip — all statuses, every service (matches Excel total). */
  applySheetProfessionFilter(profession: string): void {
    const professionValue =
      profession === UNSPECIFIED_PROFESSION ? '__UNSPECIFIED__' : profession;
    this.filters = {
      ...this.filters,
      serviceNames: [],
      statuses: [],
      professions: [professionValue],
      page: 1,
    };
    this.professionBreakdown = [];
    this.loadStudents();
    this.scrollToTable();
    this.cdr.markForCheck();
  }

  /** Service chip — first number: current status only (e.g. 23 ongoing). */
  applyServiceProfessionStatusFilter(profession: string): void {
    const status = this.filters.statuses.length === 1 ? this.filters.statuses[0] : null;
    this.applyProfessionFilter(profession, status);
  }

  /** Service chip — total number: all statuses in this service (e.g. 38). */
  applyServiceProfessionTotalFilter(profession: string): void {
    this.applyProfessionFilter(profession, null);
  }

  isProfessionActive(profession: string): boolean {
    const value = profession === UNSPECIFIED_PROFESSION ? '__UNSPECIFIED__' : profession;
    return this.filters.professions.includes(value);
  }

  professionBreakdownTitle(): string {
    const parts = [this.primaryServiceName() || ''];
    if (this.filters.statuses.length === 1) {
      parts.push(STATUS_LABELS[this.filters.statuses[0]]);
    }
    return parts.filter(Boolean).join(' · ');
  }

  professionDisplayTotal(prof: ProfessionStat): number {
    if (this.filters.statuses.length !== 1) return prof.total;
    switch (this.filters.statuses[0]) {
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
      if (!this.filters.statuses.length) return true;
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
    if (this.filters.statuses.length === 1) {
      const statusLabel = STATUS_LABELS[this.filters.statuses[0]].toLowerCase();
      return `${this.primaryServiceName()} only · ${this.skilledProfessionStudentTotal()} ${statusLabel} skilled · ${inService} total skilled in service`;
    }
    return `${this.primaryServiceName()} only · ${inService} skilled students · ${this.allSkilledProfessions().length} categories`;
  }

  professionCompareHint(): string {
    const svc = this.primaryServiceName();
    if (this.filters.statuses.length === 1) {
      const statusLabel = STATUS_LABELS[this.filters.statuses[0]].toLowerCase();
      return `Green chip → all students (every status). Blue chip → click ${statusLabel} number for ${statusLabel} only, or / total for all statuses in ${svc}.`;
    }
    return `Green row matches Excel. Below is ${svc} only.`;
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.professionBreakdown = [];
    this.closeColumnFilter();
    this.loadStudents();
  }

  // ── Column header filters (multi-select modal) ───────────────────────────

  openColumnFilter(key: ColumnFilterKey, event: Event): void {
    event.stopPropagation();
    this.columnFilterOpen = key;
    this.columnFilterSearch = '';
    switch (key) {
      case 'languageLevel':
        this.columnFilterDraft = [...this.filters.languageLevels];
        this.columnFilterDraftB = [];
        break;
      case 'package':
        this.columnFilterDraft = [...this.filters.packages];
        this.columnFilterDraftB = [];
        break;
      case 'service':
        this.columnFilterDraft = [...this.filters.serviceNames];
        this.columnFilterDraftB = [...this.filters.professions];
        break;
      case 'status':
        this.columnFilterDraft = [...this.filters.statuses];
        this.columnFilterDraftB = [];
        break;
      case 'doc':
        this.columnFilterDraft = [...this.filters.documentPaymentStatuses];
        this.columnFilterDraftB = [...this.filters.documentationStatuses];
        break;
      case 'visa':
        this.columnFilterDraft = [...this.filters.visaStatuses];
        this.columnFilterDraftB = [];
        break;
    }
    this.cdr.markForCheck();
  }

  closeColumnFilter(): void {
    this.columnFilterOpen = null;
    this.columnFilterDraft = [];
    this.columnFilterDraftB = [];
    this.columnFilterSearch = '';
    this.cdr.markForCheck();
  }

  columnFilterTitle(): string {
    return this.columnFilterOpen ? COLUMN_FILTER_LABELS[this.columnFilterOpen] : '';
  }

  columnFilterHasSearch(): boolean {
    return this.columnFilterOpen === 'service' || this.columnFilterOpen === 'languageLevel';
  }

  columnFilterOptions(section: 'primary' | 'secondary' = 'primary'): FacetOption[] {
    if (!this.analytics || !this.columnFilterOpen) return [];
    const a = this.analytics;
    switch (this.columnFilterOpen) {
      case 'languageLevel':
        return a.languageLevels || [];
      case 'package':
        return (a.packages || []).map((p) => ({
          value: p.package,
          label: PACKAGE_LABELS[p.package],
          total: p.total,
        }));
      case 'status':
        return this.STATUSES.map((st) => ({
          value: st,
          label: STATUS_LABELS[st],
          total: this.statusTotal(st),
        }));
      case 'service':
        if (section === 'secondary') {
          return (a.sheetProfessions || []).map((p) => ({
            value: p.profession,
            label: p.label,
            total: p.total,
          }));
        }
        return (a.services || []).map((s) => ({
          value: s.serviceName,
          label: s.label,
          total: s.total,
        }));
      case 'doc':
        if (section === 'secondary') return a.documentationStatuses || [];
        return a.documentPaymentStatuses || [];
      case 'visa':
        return a.visaStatuses || [];
      default:
        return [];
    }
  }

  filteredColumnOptions(section: 'primary' | 'secondary' = 'primary'): FacetOption[] {
    const opts = this.columnFilterOptions(section);
    const q = this.columnFilterSearch.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter((o) => o.label.toLowerCase().includes(q));
  }

  isColumnFilterActive(key: ColumnFilterKey): boolean {
    switch (key) {
      case 'languageLevel': return this.filters.languageLevels.length > 0;
      case 'package': return this.filters.packages.length > 0;
      case 'service':
        return this.filters.serviceNames.length > 0 || this.filters.professions.length > 0;
      case 'status': return this.filters.statuses.length > 0;
      case 'doc':
        return this.filters.documentPaymentStatuses.length > 0 ||
          this.filters.documentationStatuses.length > 0;
      case 'visa': return this.filters.visaStatuses.length > 0;
      default: return false;
    }
  }

  columnFilterCount(key: ColumnFilterKey): number {
    switch (key) {
      case 'languageLevel': return this.filters.languageLevels.length;
      case 'package': return this.filters.packages.length;
      case 'service':
        return this.filters.serviceNames.length + this.filters.professions.length;
      case 'status': return this.filters.statuses.length;
      case 'doc':
        return this.filters.documentPaymentStatuses.length + this.filters.documentationStatuses.length;
      case 'visa': return this.filters.visaStatuses.length;
      default: return 0;
    }
  }

  isDraftSelected(value: string, section: 'primary' | 'secondary' = 'primary'): boolean {
    const draft = section === 'secondary' ? this.columnFilterDraftB : this.columnFilterDraft;
    return draft.includes(facetValueToFilter(value));
  }

  toggleDraftValue(value: string, section: 'primary' | 'secondary' = 'primary'): void {
    const mapped = facetValueToFilter(value);
    const draft = section === 'secondary' ? this.columnFilterDraftB : this.columnFilterDraft;
    const idx = draft.indexOf(mapped);
    if (idx >= 0) draft.splice(idx, 1);
    else draft.push(mapped);
    this.cdr.markForCheck();
  }

  selectAllColumnOptions(section: 'primary' | 'secondary' = 'primary'): void {
    const values = this.filteredColumnOptions(section).map((o) => facetValueToFilter(o.value));
    if (section === 'secondary') this.columnFilterDraftB = [...new Set(values)];
    else this.columnFilterDraft = [...new Set(values)];
    this.cdr.markForCheck();
  }

  selectAllColumnFilter(): void {
    this.selectAllColumnOptions('primary');
    if (this.columnFilterOpen === 'service' || this.columnFilterOpen === 'doc') {
      this.selectAllColumnOptions('secondary');
    }
    this.cdr.markForCheck();
  }

  clearColumnFilterDraft(section?: 'primary' | 'secondary'): void {
    if (!section || section === 'primary') this.columnFilterDraft = [];
    if (!section || section === 'secondary') this.columnFilterDraftB = [];
    this.cdr.markForCheck();
  }

  applyColumnFilter(): void {
    if (!this.columnFilterOpen) return;
    const patch: Partial<KrishDashboardFilters> = { page: 1 };
    switch (this.columnFilterOpen) {
      case 'languageLevel':
        patch.languageLevels = [...this.columnFilterDraft];
        break;
      case 'package':
        patch.packages = [...this.columnFilterDraft] as KrishPackage[];
        break;
      case 'service':
        patch.serviceNames = [...this.columnFilterDraft];
        patch.professions = [...this.columnFilterDraftB];
        break;
      case 'status':
        patch.statuses = [...this.columnFilterDraft] as KrishStatus[];
        break;
      case 'doc':
        patch.documentPaymentStatuses = [...this.columnFilterDraft];
        patch.documentationStatuses = [...this.columnFilterDraftB];
        break;
      case 'visa':
        patch.visaStatuses = [...this.columnFilterDraft];
        break;
    }
    this.closeColumnFilter();
    this.filters = { ...this.filters, ...patch };
    this.syncProfessionBreakdown();
    this.loadStudents();
    this.scrollToTable();
    this.cdr.markForCheck();
  }

  private statusTotal(status: KrishStatus): number {
    const t = this.analytics?.totals;
    if (!t) return 0;
    switch (status) {
      case 'ONGOING': return t.ongoing;
      case 'UNCERTAIN': return t.uncertain;
      case 'COMPLETED': return t.completed;
      case 'WITHDREW': return t.withdrew;
      default: return 0;
    }
  }

  removeChip(field: keyof KrishDashboardFilters | 'search'): void {
    if (field === 'search') {
      this.filters.search = '';
    } else if (field === 'counselor') {
      this.filters.counselor = '';
    } else {
      (this.filters as any)[field] = [];
    }
    this.filters.page = 1;
    if (field === 'serviceNames') {
      this.filters.professions = [];
      this.professionBreakdown = [];
    }
    if (field === 'professions' && this.filters.serviceNames.length) {
      this.syncProfessionBreakdown();
    }
    this.loadStudents();
  }

  private formatChipValues(values: string[]): string {
    return values.map((v) => filterValueToLabel(v)).join(', ');
  }

  get activeChips(): { field: string; label: string }[] {
    const chips: { field: string; label: string }[] = [];
    if (this.filters.statuses.length) {
      const labels = this.filters.statuses.map((s) => STATUS_LABELS[s]).join(', ');
      chips.push({ field: 'statuses', label: `Status: ${labels}` });
    }
    if (this.filters.packages.length) {
      const labels = this.filters.packages.map((p) => PACKAGE_LABELS[p]).join(', ');
      chips.push({ field: 'packages', label: `Package: ${labels}` });
    }
    if (this.filters.serviceNames.length) {
      chips.push({
        field: 'serviceNames',
        label: `Service: ${this.formatChipValues(this.filters.serviceNames)}`,
      });
    }
    if (this.filters.professions.length) {
      chips.push({
        field: 'professions',
        label: `Professional: ${this.formatChipValues(this.filters.professions)}`,
      });
    }
    if (this.filters.languageLevels.length) {
      chips.push({
        field: 'languageLevels',
        label: `Language: ${this.formatChipValues(this.filters.languageLevels)}`,
      });
    }
    if (this.filters.documentPaymentStatuses.length) {
      chips.push({
        field: 'documentPaymentStatuses',
        label: `Doc Payment: ${this.formatChipValues(this.filters.documentPaymentStatuses)}`,
      });
    }
    if (this.filters.documentationStatuses.length) {
      chips.push({
        field: 'documentationStatuses',
        label: `Doc Status: ${this.formatChipValues(this.filters.documentationStatuses)}`,
      });
    }
    if (this.filters.visaStatuses.length) {
      chips.push({
        field: 'visaStatuses',
        label: `Visa: ${this.formatChipValues(this.filters.visaStatuses)}`,
      });
    }
    if (this.filters.search) {
      chips.push({ field: 'search', label: `Search: "${this.filters.search}"` });
    }
    return chips;
  }

  onSearchInput(q: string): void {
    this.searchSubject.next(q);
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

  get skeletonCols(): number[] {
    return Array.from({ length: 10 }, (_, i) => i);
  }

  displayField(value?: string | null): string {
    const v = (value || '').trim();
    return v || '—';
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
