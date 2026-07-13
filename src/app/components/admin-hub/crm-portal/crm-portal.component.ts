import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import html2canvas from 'html2canvas';
import { AuthService } from '../../../services/auth.service';

export type BoardType = 'enrollment' | 'language';
export type TabType = 'enrollment' | 'language' | 'whatsapp';

export interface CrmField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'date' | 'datetime';
  filterable: boolean;
  groupable: boolean;
}

export interface FilterRow {
  field: string;
  operator: string;
  value: string;
  value2: string;
  values: string[];
  fieldMeta?: CrmField;
  fieldValues?: string[];
  loadingFieldValues?: boolean;
  isMulti?: boolean;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PortalCompareMissing {
  crmId: string | null;
  name: string;
  email: string;
  phone: string;
  whatsapp: string;
  status: string;
  package: string;
  batch: string;
  enrolled: string;
  counsellor: string;
  reason: string;
}

export interface PortalCompareResult {
  show: boolean;
  loading: boolean;
  error: string;
  boardType: BoardType | null;
  crmTotal: number;
  crmRawTotal: number;
  crmDuplicatesSkipped: number;
  portalTotal: number;
  matchedInPortal: number;
  missingFromPortal: number;
  missingNoEmail: number;
  missing: PortalCompareMissing[];
  comparedAt: string;
}

export interface CompareInviteResult {
  email: string;
  success: boolean;
  message: string;
}

export interface SalesCounsellorCard {
  name: string;
  watchName?: string;
  lastEnrollment: string | null;
  daysSince: number | null;
  totalEnrollments: number;
  weeklyEnrollments?: number;
  riskType?: string | null;
}

export interface SalesDashboardResult {
  show: boolean;
  loading: boolean;
  error: string;
  green: SalesCounsellorCard[];
  yellow: SalesCounsellorCard[];
  red: SalesCounsellorCard[];
  watchedNames: string[];
  availableCounsellors: string[];
  setupRequired: boolean;
  totals: {
    counsellors: number;
    green: number;
    yellow: number;
    red: number;
    enrollmentsScanned: number;
    availableCounsellors: number;
  };
  trends: {
    green: number;
    yellow: number;
    red: number;
  };
  generatedAt: string;
  reportWindow?: {
    period: 'morning' | 'evening';
    start: string;
    end: string;
    startLabel: string;
    endLabel: string;
    reportText: string;
  };
}

export interface WaAutomationItem {
  title: string;
  description: string;
  schedule: string;
  channels: ('WhatsApp' | 'Email')[];
  /** WhatsApp part requires WHATSAPP_AUTOMATED_JOBS_ENABLED */
  whatsappGated: boolean;
  /** Email sends even when automated WhatsApp jobs are off */
  emailAlways?: boolean;
  icon: string;
  /** Matches NOTIFICATION_TYPES key in the backend */
  automationType: string;
}

export interface WaAutomationBatchSetting {
  allBatches: boolean;
  targetBatches: string[];
  saving?: boolean;
  dirty?: boolean;
}

const TEXT_OPS = [
  { value: 'is', label: 'Is' },
  { value: 'is_not', label: 'Is not' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does not contain' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
];

const NUMBER_OPS = [
  { value: 'is', label: 'Equals' },
  { value: 'is_not', label: 'Not equals' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater than or equal' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less than or equal' },
  { value: 'between', label: 'Between' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
];

const DATE_OPS = [
  { value: 'date_on_or_after', label: 'On or after' },
  { value: 'date_on_or_before', label: 'On or before' },
  { value: 'date_after', label: 'After' },
  { value: 'date_before', label: 'Before' },
  { value: 'between', label: 'Between' },
  { value: 'date_relative', label: 'Relative date' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
];

const DATE_RELATIVE_OPTIONS = [
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'this_year', label: 'This year' },
];

// Columns shown in the results table for each board
const ENROLLMENT_COLUMNS = [
  'candidateName', 'leadSource', 'dateOfEnrollment', 'assignedSalesRepresentative',
  'currentStatus', 'packageOpted', 'assignedBatch', 'teacherInCharge'
];
const ENROLLMENT_LABELS: Record<string, string> = {
  candidateName: 'Name',
  leadSource: 'Lead Source',
  dateOfEnrollment: 'Enrolled',
  assignedSalesRepresentative: 'Counsellor',
  currentStatus: 'Status',
  packageOpted: 'Package',
  assignedBatch: 'Batch',
  teacherInCharge: 'Teacher',
};

const LANGUAGE_COLUMNS = [
  'name', 'enrollmentDate', 'batchNumber', 'currentStatus',
  'currentLevel', 'languageTeamAssignee', 'teacherIncharge', 'programEnrolled'
];
const LANGUAGE_LABELS: Record<string, string> = {
  name: 'Name',
  enrollmentDate: 'Enrolled',
  batchNumber: 'Batch',
  currentStatus: 'Status',
  currentLevel: 'Level',
  languageTeamAssignee: 'Assignee',
  teacherIncharge: 'Teacher',
  programEnrolled: 'Program',
};

@Component({
  selector: 'app-crm-portal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './crm-portal.component.html',
  styleUrls: ['./crm-portal.component.scss'],
})
export class CrmPortalComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // ── Tab state ──────────────────────────────────────────────
  activeTab: TabType = 'enrollment';

  // ── Board state (shared between enrollment and language) ───
  enrollmentState = this.createBoardState('enrollment');
  languageState = this.createBoardState('language');

  // ── WhatsApp state ─────────────────────────────────────────
  wa = { studentId: '', phoneNumber: '', message: '', department: 'Language' };
  waSending = false;
  waSendEnabled = true;
  waAutomatedEnabled = false;

  // Batch targeting for automations
  availableBatches: string[] = [];
  waBatchSettings: Record<string, WaAutomationBatchSetting> = {};
  waBatchSettingsLoading = false;
  openBatchPicker: string | null = null;

  waResult: {
    success: boolean;
    message: string;
    phone?: string;
    sentAt?: string;
    sentMessage?: string;
    deliveryUncertain?: boolean;
    crmEndpoint?: string;
  } | null = null;

  readonly waAutomations: WaAutomationItem[] = [
    {
      title: 'Live class — not joined',
      description: 'Students invited to a scheduled class who have not clicked Join in the portal get a nudge to open the portal and join.',
      schedule: '5 min after class starts',
      channels: ['WhatsApp', 'Email'],
      whatsappGated: true,
      icon: 'videocam',
      automationType: 'ABSENT_DURING_CLASS',
    },
    {
      title: 'Daily tasks incomplete',
      description: 'Reminds students to finish today\'s journey-day exercises and DG bot tasks before the day ends.',
      schedule: 'Every day, 12:00 PM',
      channels: ['WhatsApp', 'Email'],
      whatsappGated: true,
      emailAlways: true,
      icon: 'task_alt',
      automationType: 'DAILY_TASK_REMINDER',
    },
    {
      title: 'Payment overdue',
      description: 'A gentle morning reminder for students with a formal overdue balance in Payment Hub.',
      schedule: 'Every day, 8:00 AM',
      channels: ['WhatsApp'],
      whatsappGated: true,
      icon: 'payments',
      automationType: 'PAYMENT_OVERDUE_REMINDER',
    },
    {
      title: 'Class reminder (before start)',
      description: 'Upcoming live class reminder sent to invited students and the assigned teacher.',
      schedule: 'Up to 30 min before class',
      channels: ['WhatsApp'],
      whatsappGated: true,
      icon: 'schedule',
      automationType: 'CLASS_REMINDER',
    },
    {
      title: 'After-class absence',
      description: 'Students marked absent after attendance is recorded receive a follow-up to catch up.',
      schedule: 'After class ends',
      channels: ['WhatsApp'],
      whatsappGated: true,
      icon: 'event_busy',
      automationType: 'ABSENT_AFTER_CLASS',
    },
    {
      title: 'Missed activities',
      description: 'Students with no completed exercises in the past 7 days are encouraged to log in.',
      schedule: 'Every day, 9:00 AM',
      channels: ['WhatsApp'],
      whatsappGated: true,
      icon: 'fitness_center',
      automationType: 'MISSED_ACTIVITIES',
    },
    {
      title: 'Weekly progress report',
      description: 'Week-over-week summary of classes, exercises, and learning time.',
      schedule: 'Sundays, 8:00 AM',
      channels: ['WhatsApp'],
      whatsappGated: true,
      icon: 'insights',
      automationType: 'WEEKLY_PROGRESS_REPORT',
    },
    {
      title: 'Consecutive absences',
      description: 'Alert when a student misses 3 or more live classes in a row; teacher is notified too.',
      schedule: 'Every day, 10:00 AM',
      channels: ['WhatsApp'],
      whatsappGated: true,
      icon: 'warning',
      automationType: 'CONSECUTIVE_ABSENCE',
    },
  ];

  compare: PortalCompareResult = this.createCompareState();
  compareInviteSending = new Set<string>();
  compareBulkInviting = false;
  compareInviteResults: CompareInviteResult[] = [];
  compareInviteBanner = '';

  salesDashboard: SalesDashboardResult = this.createSalesDashboardState();
  salesWatchDraft: string[] = [];
  salesWatchPickerOpen = false;
  salesWatchSaving = false;
  salesWatchSaveMsg = '';
  salesWatchFilter = '';
  salesImageSaving = false;
  salesImageSaveMsg = '';
  salesChatSending = false;
  salesChatTriggerPeriod: 'morning' | 'evening' | null = null;
  salesChatSendMsg = '';

  @ViewChild('salesDashboardCapture') salesDashboardCapture?: ElementRef<HTMLElement>;

  readonly dateRelativeOptions = DATE_RELATIVE_OPTIONS;

  constructor(
    private http: HttpClient,
    private authService: AuthService,
  ) {}

  ngOnInit(): void {
    this.loadFields(this.enrollmentState);
    this.loadBoard(this.enrollmentState);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Board creation ─────────────────────────────────────────
  private createBoardState(type: BoardType) {
    return {
      type,
      // Fields metadata
      fields: [] as CrmField[],
      fieldsLoaded: false,
      // Simple filter
      showSimpleFilter: true,
      simpleQ: '',
      simpleDateFrom: '',
      simpleDateTo: '',
      simpleFilters: {} as Record<string, string>,
      // Advanced filter
      showAdvanced: false,
      filterLogic: 'and' as 'and' | 'or',
      filterRows: [] as FilterRow[],
      groupByFields: [] as string[],
      // Results
      loading: false,
      error: '',
      mode: 'list' as 'list' | 'grouped',
      items: [] as any[],
      groups: [] as any[],
      collapsedGroups: new Set<string>(),
      // Pagination
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 1,
      // Active query tracking
      lastQueryWasAdvanced: false,
      loadedOnce: false,
    };
  }

  get currentBoard() {
    return this.activeTab === 'enrollment' ? this.enrollmentState : this.languageState;
  }

  // ── Tab navigation ─────────────────────────────────────────
  setTab(tab: TabType): void {
    this.activeTab = tab;
    if (tab === 'enrollment' && !this.enrollmentState.fieldsLoaded) {
      this.loadFields(this.enrollmentState);
    } else if (tab === 'language') {
      if (!this.languageState.fieldsLoaded) {
        this.loadFields(this.languageState);
      }
      if (!this.languageState.loadedOnce) {
        this.loadBoard(this.languageState);
      }
    } else if (tab === 'whatsapp') {
      this.loadWhatsappStatus();
    }
  }

  // ── Field metadata ─────────────────────────────────────────
  loadFields(board: ReturnType<typeof this.createBoardState>): void {
    const endpoint = board.type === 'enrollment'
      ? '/api/crm-portal/enrollment-board/advanced/fields'
      : '/api/crm-portal/language-team-board/advanced/fields';

    this.http.get<any>(endpoint).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        board.fields = res.data || [];
        board.fieldsLoaded = true;
      },
      error: () => { board.fieldsLoaded = true; }
    });
  }

  // ── Simple filter ──────────────────────────────────────────
  runSimpleSearch(board: ReturnType<typeof this.createBoardState>): void {
    board.page = 1;
    board.lastQueryWasAdvanced = false;
    this.loadBoard(board);
  }

  clearSimpleFilters(board: ReturnType<typeof this.createBoardState>): void {
    board.simpleQ = '';
    board.simpleDateFrom = '';
    board.simpleDateTo = '';
    board.simpleFilters = {};
    board.page = 1;
    board.lastQueryWasAdvanced = false;
    this.loadBoard(board);
  }

  // ── Advanced filter ────────────────────────────────────────
  toggleAdvanced(board: ReturnType<typeof this.createBoardState>): void {
    board.showAdvanced = !board.showAdvanced;
    if (board.showAdvanced && !board.fieldsLoaded) {
      this.loadFields(board);
    }
  }

  addFilterRow(board: ReturnType<typeof this.createBoardState>): void {
    board.filterRows.push({
      field: '',
      operator: 'is',
      value: '',
      value2: '',
      values: [],
      isMulti: false,
    });
  }

  removeFilterRow(board: ReturnType<typeof this.createBoardState>, index: number): void {
    board.filterRows.splice(index, 1);
  }

  onFieldChange(board: ReturnType<typeof this.createBoardState>, row: FilterRow): void {
    const meta = board.fields.find(f => f.key === row.field);
    row.fieldMeta = meta;
    row.value = '';
    row.value2 = '';
    row.values = [];
    row.isMulti = false;
    row.fieldValues = undefined;

    if (meta?.kind === 'text') {
      row.operator = 'is';
    } else if (meta?.kind === 'number') {
      row.operator = 'is';
    } else if (meta?.kind === 'date' || meta?.kind === 'datetime') {
      row.operator = 'date_on_or_after';
    }

    if (meta?.kind === 'text' && row.field) {
      this.loadFieldValues(board, row);
    }
  }

  loadFieldValues(board: ReturnType<typeof this.createBoardState>, row: FilterRow): void {
    if (!row.field) return;
    row.loadingFieldValues = true;

    const endpoint = board.type === 'enrollment'
      ? '/api/crm-portal/enrollment-board/advanced/field-values'
      : '/api/crm-portal/language-team-board/advanced/field-values';

    this.http.post<any>(endpoint, {
      field: row.field,
      filters: [],
      filterLogic: 'and',
      limit: 100,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        row.fieldValues = (res.data || []).filter((v: any) => v !== null && v !== '');
        row.loadingFieldValues = false;
      },
      error: () => { row.loadingFieldValues = false; }
    });
  }

  getOperatorsForRow(row: FilterRow): { value: string; label: string }[] {
    const kind = row.fieldMeta?.kind;
    if (kind === 'number') return NUMBER_OPS;
    if (kind === 'date' || kind === 'datetime') return DATE_OPS;
    return TEXT_OPS;
  }

  needsNoValue(op: string): boolean {
    return op === 'is_empty' || op === 'is_not_empty';
  }

  needsSecondValue(op: string): boolean {
    return op === 'between';
  }

  isDateRelative(op: string): boolean {
    return op === 'date_relative';
  }

  toggleGroupBy(board: ReturnType<typeof this.createBoardState>, key: string): void {
    const idx = board.groupByFields.indexOf(key);
    if (idx >= 0) {
      board.groupByFields.splice(idx, 1);
    } else if (board.groupByFields.length < 3) {
      board.groupByFields.push(key);
    }
  }

  runAdvancedQuery(board: ReturnType<typeof this.createBoardState>): void {
    board.page = 1;
    board.lastQueryWasAdvanced = true;
    this.loadBoard(board);
  }

  clearAdvancedFilters(board: ReturnType<typeof this.createBoardState>): void {
    board.filterRows = [];
    board.groupByFields = [];
    board.filterLogic = 'and';
    board.lastQueryWasAdvanced = false;
    board.page = 1;
    this.loadBoard(board);
  }

  // ── Main data load ─────────────────────────────────────────
  loadBoard(board: ReturnType<typeof this.createBoardState>): void {
    board.loading = true;
    board.error = '';
    board.items = [];
    board.groups = [];

    if (board.lastQueryWasAdvanced && board.filterRows.length > 0) {
      this.runAdvancedQueryInternal(board);
    } else if (board.simpleQ || board.simpleDateFrom || board.simpleDateTo || Object.keys(board.simpleFilters).some(k => board.simpleFilters[k])) {
      this.runSimpleFilterInternal(board);
    } else {
      this.runListAll(board);
    }
  }

  private runListAll(board: ReturnType<typeof this.createBoardState>): void {
    // Language team "list all" upstream returns 401; filter with page/limit works.
    if (board.type === 'language') {
      this.runSimpleFilterInternal(board);
      return;
    }

    const endpoint = '/api/crm-portal/enrollment-board';

    this.http.get<any>(endpoint, {
      params: { page: board.page, limit: board.limit }
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => this.handleListResponse(board, res),
      error: (err) => this.handleError(board, err),
    });
  }

  private runSimpleFilterInternal(board: ReturnType<typeof this.createBoardState>): void {
    const endpoint = board.type === 'enrollment'
      ? '/api/crm-portal/enrollment-board/filter'
      : '/api/crm-portal/language-team-board/filter';

    const params: any = { page: board.page, limit: board.limit };
    if (board.simpleQ) params['q'] = board.simpleQ;
    if (board.type === 'enrollment') {
      if (board.simpleDateFrom) params['dateFrom'] = board.simpleDateFrom;
      if (board.simpleDateTo) params['dateTo'] = board.simpleDateTo;
    } else {
      if (board.simpleDateFrom) params['enrollmentDateFrom'] = board.simpleDateFrom;
      if (board.simpleDateTo) params['enrollmentDateTo'] = board.simpleDateTo;
    }
    Object.entries(board.simpleFilters).forEach(([k, v]) => { if (v) params[k] = v; });

    this.http.get<any>(endpoint, { params }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => this.handleListResponse(board, res),
      error: (err) => this.handleError(board, err),
    });
  }

  private runAdvancedQueryInternal(board: ReturnType<typeof this.createBoardState>): void {
    const endpoint = board.type === 'enrollment'
      ? '/api/crm-portal/enrollment-board/advanced/query'
      : '/api/crm-portal/language-team-board/advanced/query';

    const filters = board.filterRows
      .filter(r => r.field && r.operator)
      .map(r => {
        const f: any = { field: r.field, operator: r.operator };
        if (!this.needsNoValue(r.operator)) {
          if (r.isMulti && r.values.length > 0) {
            f.values = r.values;
          } else {
            f.value = r.value;
          }
          if (this.needsSecondValue(r.operator)) f.value2 = r.value2;
        }
        return f;
      });

    const body: any = {
      filters,
      filterLogic: board.filterLogic,
      page: board.page,
      limit: board.limit,
    };

    if (board.groupByFields.length > 0) {
      body.groupBy = board.groupByFields;
      body.groupLimit = 25;
    }

    this.http.post<any>(endpoint, body).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (res.mode === 'grouped') {
          board.mode = 'grouped';
          board.groups = res.groups || [];
          board.total = res.filteredTotal || 0;
          board.totalPages = 1;
          board.loadedOnce = true;
        } else {
          this.handleListResponse(board, res);
        }
        board.loading = false;
      },
      error: (err) => this.handleError(board, err),
    });
  }

  private handleListResponse(board: ReturnType<typeof this.createBoardState>, res: any): void {
    board.mode = 'list';
    board.items = res.data || res.items || [];
    const pg = res.pagination || {};
    board.total = pg.total || res.total || 0;
    board.page = pg.page || res.page || 1;
    board.limit = pg.limit || res.limit || 50;
    board.totalPages = pg.totalPages || res.totalPages || 1;
    board.loading = false;
    board.loadedOnce = true;
  }

  private handleError(board: ReturnType<typeof this.createBoardState>, err: any): void {
    board.error = err?.error?.message || 'Failed to load data. Please try again.';
    board.loading = false;
  }

  // ── Pagination ─────────────────────────────────────────────
  goToPage(board: ReturnType<typeof this.createBoardState>, page: number): void {
    if (page < 1 || page > board.totalPages) return;
    board.page = page;
    this.loadBoard(board);
  }

  changeLimit(board: ReturnType<typeof this.createBoardState>, limit: number): void {
    board.limit = limit;
    board.page = 1;
    this.loadBoard(board);
  }

  getPageNumbers(board: ReturnType<typeof this.createBoardState>): number[] {
    const total = board.totalPages;
    const current = board.page;
    const pages: number[] = [];
    const delta = 2;
    const left = Math.max(1, current - delta);
    const right = Math.min(total, current + delta);
    for (let i = left; i <= right; i++) pages.push(i);
    if (left > 1) { pages.unshift(-1); pages.unshift(1); }
    if (right < total) { pages.push(-1); pages.push(total); }
    return pages;
  }

  // ── Table helpers ──────────────────────────────────────────
  get activeColumns(): string[] {
    return this.activeTab === 'enrollment' ? ENROLLMENT_COLUMNS : LANGUAGE_COLUMNS;
  }

  get activeLabels(): Record<string, string> {
    return this.activeTab === 'enrollment' ? ENROLLMENT_LABELS : LANGUAGE_LABELS;
  }

  getCellValue(row: any, col: string): string {
    const val = row[col];
    if (val === null || val === undefined) return '—';
    if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) {
      return val.substring(0, 10);
    }
    return String(val);
  }

  getStatusClass(status: string): string {
    const s = (status || '').toLowerCase();
    if (s.includes('ongoing')) return 'badge-ongoing';
    if (s.includes('complet')) return 'badge-completed';
    if (s.includes('withdraw') || s.includes('withdrew')) return 'badge-withdrew';
    if (s.includes('waiting') || s.includes('waiting')) return 'badge-waiting';
    return 'badge-default';
  }

  toggleGroup(board: ReturnType<typeof this.createBoardState>, key: string): void {
    if (board.collapsedGroups.has(key)) {
      board.collapsedGroups.delete(key);
    } else {
      board.collapsedGroups.add(key);
    }
  }

  isGroupCollapsed(board: ReturnType<typeof this.createBoardState>, key: string): boolean {
    return board.collapsedGroups.has(key);
  }

  // ── WhatsApp ───────────────────────────────────────────────
  loadWhatsappStatus(): void {
    this.http.get<any>('/api/crm-portal/whatsapp/status')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.waSendEnabled = res?.manualEnabled !== false && res?.enabled !== false;
          this.waAutomatedEnabled = res?.automatedEnabled === true;
        },
        error: () => { this.waSendEnabled = false; this.waAutomatedEnabled = false; },
      });
    this.loadAutomationBatchSettings();
  }

  loadAutomationBatchSettings(): void {
    this.waBatchSettingsLoading = true;
    this.http.get<any>('/api/crm-portal/whatsapp/automation-batch-settings')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.waBatchSettingsLoading = false;
          this.availableBatches = res?.batches || [];
          const settingsMap: Record<string, WaAutomationBatchSetting> = {};
          for (const item of this.waAutomations) {
            const saved = (res?.settings || []).find((s: any) => s.automationType === item.automationType);
            settingsMap[item.automationType] = {
              allBatches: saved ? saved.allBatches : true,
              targetBatches: saved ? (saved.targetBatches || []) : [],
              saving: false,
              dirty: false,
            };
          }
          this.waBatchSettings = settingsMap;
        },
        error: () => { this.waBatchSettingsLoading = false; },
      });
  }

  getBatchSetting(automationType: string): WaAutomationBatchSetting {
    return this.waBatchSettings[automationType] ?? { allBatches: true, targetBatches: [] };
  }

  getBatchSummaryLabel(automationType: string): string {
    const s = this.getBatchSetting(automationType);
    if (s.allBatches || s.targetBatches.length === 0) return 'All batches';
    if (s.targetBatches.length === this.availableBatches.length) return 'All batches';
    return `${s.targetBatches.length} of ${this.availableBatches.length} batches`;
  }

  toggleBatchPicker(automationType: string): void {
    this.openBatchPicker = this.openBatchPicker === automationType ? null : automationType;
  }

  closeBatchPicker(): void {
    this.openBatchPicker = null;
  }

  isBatchSelected(automationType: string, batchName: string): boolean {
    const s = this.getBatchSetting(automationType);
    if (s.allBatches) return true;
    return s.targetBatches.includes(batchName);
  }

  toggleBatch(automationType: string, batchName: string): void {
    if (!this.waBatchSettings[automationType]) return;
    const s = this.waBatchSettings[automationType];

    if (s.allBatches) {
      // Switching from "all" → select all except this one
      s.allBatches = false;
      s.targetBatches = this.availableBatches.filter(b => b !== batchName);
    } else {
      const idx = s.targetBatches.indexOf(batchName);
      if (idx >= 0) {
        s.targetBatches = s.targetBatches.filter(b => b !== batchName);
      } else {
        s.targetBatches = [...s.targetBatches, batchName];
      }
      if (s.targetBatches.length === this.availableBatches.length) {
        s.allBatches = true;
        s.targetBatches = [];
      }
    }
    s.dirty = true;
  }

  selectAllBatches(automationType: string): void {
    if (!this.waBatchSettings[automationType]) return;
    const s = this.waBatchSettings[automationType];
    s.allBatches = true;
    s.targetBatches = [];
    s.dirty = true;
  }

  clearAllBatches(automationType: string): void {
    if (!this.waBatchSettings[automationType]) return;
    const s = this.waBatchSettings[automationType];
    s.allBatches = false;
    s.targetBatches = [];
    s.dirty = true;
  }

  saveBatchSettings(automationType: string): void {
    const s = this.waBatchSettings[automationType];
    if (!s || s.saving) return;

    s.saving = true;
    this.http.put<any>('/api/crm-portal/whatsapp/automation-batch-settings', {
      automationType,
      allBatches: s.allBatches,
      targetBatches: s.targetBatches,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        s.saving = false;
        s.dirty = false;
        this.openBatchPicker = null;
      },
      error: () => { s.saving = false; },
    });
  }

  automationIsActive(item: WaAutomationItem): boolean {
    if (item.emailAlways && item.channels.includes('Email')) return true;
    if (item.channels.includes('WhatsApp') && item.whatsappGated) {
      return this.waAutomatedEnabled;
    }
    return this.waAutomatedEnabled;
  }

  automationStatusLabel(item: WaAutomationItem): string {
    const waOn = this.waAutomatedEnabled;
    const hasWa = item.channels.includes('WhatsApp');
    const hasEmail = item.channels.includes('Email');

    if (hasWa && hasEmail && item.emailAlways) {
      return waOn ? 'WhatsApp + Email active' : 'Email only (WhatsApp off)';
    }
    if (hasWa && hasEmail) {
      return waOn ? 'WhatsApp + Email active' : 'Paused';
    }
    if (hasWa) {
      return waOn ? 'WhatsApp active' : 'Paused';
    }
    return 'Active';
  }

  automationChannelsLabel(item: WaAutomationItem): string {
    return item.channels.join(' + ');
  }

  normalizeWaPhone(raw: string): string {
    let phone = String(raw || '').trim().replace(/[\s\-().]/g, '');
    if (!phone) return '';
    if (!phone.startsWith('+')) {
      phone = phone.startsWith('00') ? `+${phone.slice(2)}` : `+${phone}`;
    }
    return phone;
  }

  isValidWaPhone(phone: string): boolean {
    return /^\+\d{7,19}$/.test(phone);
  }

  displayWaPhone(phone?: string): string {
    if (!phone) return '';
    return phone.startsWith('+') ? phone : `+${phone}`;
  }

  sendWhatsApp(): void {
    const phone = this.normalizeWaPhone(this.wa.phoneNumber);
    const message = String(this.wa.message || '').trim();

    if (!phone || !message) return;

    if (!this.isValidWaPhone(phone)) {
      this.waResult = {
        success: false,
        message: 'Invalid phone number. Use E.164 format: + followed by 7–19 digits (e.g. +919311099671).',
      };
      return;
    }

    this.waSending = true;
    this.waResult = null;

    const body: any = {
      phone_number: phone,
      message,
      department: this.wa.department || 'Language',
    };
    if (this.wa.studentId) body.student_id = parseInt(this.wa.studentId, 10) || undefined;

    this.http.post<any>('/api/crm-portal/whatsapp/send-message', body)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.waResult = {
              success: false,
              message: res?.message || 'CRM did not confirm the message was sent.',
            };
            this.waSending = false;
            if (res?.disabled) this.waSendEnabled = false;
            return;
          }

          const sentAt = res.data?.sent_at
            ? new Date(res.data.sent_at).toLocaleString()
            : undefined;

          this.waResult = {
            success: true,
            message: res.message || 'CRM accepted the WhatsApp request.',
            phone: res.data?.phone_number || phone,
            sentAt,
            sentMessage: res.data?.message || message,
            deliveryUncertain: res.deliveryUncertain === true,
            crmEndpoint: res.crmEndpoint,
          };
          this.waSending = false;
          this.wa.message = '';
        },
        error: (err) => {
          const msg = err?.error?.message;
          this.waResult = {
            success: false,
            message: Array.isArray(msg)
              ? msg.join(', ')
              : (msg || 'Failed to send message. Check phone format and try again.'),
          };
          this.waSending = false;
        },
      });
  }

  // ── Utility ────────────────────────────────────────────────
  trackByIndex = (i: number) => i;
  trackByKey = (_: number, g: any) => g.key;
  trackByStatus = (_: number, s: { status: string }) => s.status;
  objectKeys = Object.keys;
  Math = Math;

  readonly quickStatusesEnrollment = ['Ongoing', 'Not Started Yet', 'Completed', 'Withdrawal'];
  readonly quickStatusesLanguage = ['Ongoing', 'Not Started Yet', 'Completed', 'Withdrawal', 'Language Completed'];

  getQuickStatuses(board: ReturnType<typeof this.createBoardState>): string[] {
    return board.type === 'enrollment' ? this.quickStatusesEnrollment : this.quickStatusesLanguage;
  }

  getStatusFilterKey(board: ReturnType<typeof this.createBoardState>): string {
    return board.type === 'enrollment' ? 'studentStatus' : 'status';
  }

  getActiveFilterCount(board: ReturnType<typeof this.createBoardState>): number {
    let count = 0;
    if (board.simpleQ?.trim()) count++;
    if (board.simpleDateFrom) count++;
    if (board.simpleDateTo) count++;
    count += Object.values(board.simpleFilters).filter(v => String(v || '').trim()).length;
    count += board.filterRows.filter(r => r.field && r.operator).length;
    if (board.groupByFields.length > 0) count++;
    if (board.lastQueryWasAdvanced && board.filterRows.length > 0) count += 0; // already counted rows
    return count;
  }

  getActiveFilterTags(board: ReturnType<typeof this.createBoardState>): { key: string; label: string; value: string }[] {
    const tags: { key: string; label: string; value: string }[] = [];
    if (board.simpleQ?.trim()) tags.push({ key: '__q', label: 'Search', value: board.simpleQ.trim() });
    if (board.simpleDateFrom) tags.push({ key: '__dateFrom', label: 'From', value: board.simpleDateFrom });
    if (board.simpleDateTo) tags.push({ key: '__dateTo', label: 'To', value: board.simpleDateTo });

    const filterLabels: Record<string, string> = board.type === 'enrollment'
      ? { studentStatus: 'Status', intake: 'Batch', counsellor: 'Counsellor' }
      : { status: 'Status', intake: 'Batch', assignedStaff: 'Assignee' };

    Object.entries(board.simpleFilters).forEach(([k, v]) => {
      if (v?.trim()) tags.push({ key: k, label: filterLabels[k] || k, value: v.trim() });
    });

    board.filterRows.forEach((row, i) => {
      if (!row.field || !row.operator) return;
      const label = row.fieldMeta?.label || row.field;
      const val = row.isMulti && row.values.length
        ? row.values.join(', ')
        : (row.value || (this.needsNoValue(row.operator) ? row.operator : ''));
      tags.push({ key: `__adv_${i}`, label, value: val || row.operator });
    });

    if (board.groupByFields.length > 0) {
      tags.push({ key: '__groupBy', label: 'Grouped by', value: board.groupByFields.join(', ') });
    }

    return tags;
  }

  removeFilterTag(board: ReturnType<typeof this.createBoardState>, key: string): void {
    if (key === '__q') board.simpleQ = '';
    else if (key === '__dateFrom') board.simpleDateFrom = '';
    else if (key === '__dateTo') board.simpleDateTo = '';
    else if (key === '__groupBy') board.groupByFields = [];
    else if (key.startsWith('__adv_')) {
      const idx = parseInt(key.replace('__adv_', ''), 10);
      if (!isNaN(idx)) board.filterRows.splice(idx, 1);
      board.lastQueryWasAdvanced = board.filterRows.some(r => r.field && r.operator);
    } else {
      delete board.simpleFilters[key];
    }
    board.page = 1;
    this.loadBoard(board);
  }

  clearAllFilters(board: ReturnType<typeof this.createBoardState>): void {
    board.simpleQ = '';
    board.simpleDateFrom = '';
    board.simpleDateTo = '';
    board.simpleFilters = {};
    board.filterRows = [];
    board.groupByFields = [];
    board.filterLogic = 'and';
    board.lastQueryWasAdvanced = false;
    board.page = 1;
    this.loadBoard(board);
  }

  applyQuickStatus(board: ReturnType<typeof this.createBoardState>, status: string): void {
    const key = this.getStatusFilterKey(board);
    const current = board.simpleFilters[key];
    if (current === status) {
      delete board.simpleFilters[key];
    } else {
      board.simpleFilters[key] = status;
    }
    board.page = 1;
    board.lastQueryWasAdvanced = false;
    this.loadBoard(board);
  }

  isQuickStatusActive(board: ReturnType<typeof this.createBoardState>, status: string): boolean {
    return board.simpleFilters[this.getStatusFilterKey(board)] === status;
  }

  getPageRange(board: ReturnType<typeof this.createBoardState>): { start: number; end: number } {
    if (!board.total || !board.items.length) return { start: 0, end: 0 };
    const start = (board.page - 1) * board.limit + 1;
    const end = start + board.items.length - 1;
    return { start, end };
  }

  getPageStatusCounts(board: ReturnType<typeof this.createBoardState>): { status: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const row of board.items) {
      const status = String(row.currentStatus || 'Unknown').trim() || 'Unknown';
      counts.set(status, (counts.get(status) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }

  getBoardColumns(board: ReturnType<typeof this.createBoardState>): string[] {
    return board.type === 'enrollment' ? ENROLLMENT_COLUMNS : LANGUAGE_COLUMNS;
  }

  getBoardLabels(board: ReturnType<typeof this.createBoardState>): Record<string, string> {
    return board.type === 'enrollment' ? ENROLLMENT_LABELS : LANGUAGE_LABELS;
  }

  isNameColumn(board: ReturnType<typeof this.createBoardState>, col: string): boolean {
    return board.type === 'enrollment' ? col === 'candidateName' : col === 'name';
  }

  isPackageColumn(col: string): boolean {
    return col === 'packageOpted';
  }

  isLeadSourceColumn(col: string): boolean {
    return col === 'leadSource';
  }

  getInitials(name: string): string {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  getPackageClass(pkg: string): string {
    const p = (pkg || '').toLowerCase();
    if (p.includes('platinum')) return 'pkg-platinum';
    if (p.includes('gold')) return 'pkg-gold';
    if (p.includes('silver')) return 'pkg-silver';
    return 'pkg-default';
  }

  getColumnDisplayType(board: ReturnType<typeof this.createBoardState>, col: string): string {
    if (this.isNameColumn(board, col)) return 'name';
    if (col === 'currentStatus') return 'status';
    if (this.isPackageColumn(col)) return 'package';
    if (this.isLeadSourceColumn(col)) return 'lead';
    return 'text';
  }

  refreshBoard(board: ReturnType<typeof this.createBoardState>): void {
    this.loadBoard(board);
  }

  // ── Portal compare ─────────────────────────────────────────
  private createCompareState(): PortalCompareResult {
    return {
      show: false,
      loading: false,
      error: '',
      boardType: null,
      crmTotal: 0,
      crmRawTotal: 0,
      crmDuplicatesSkipped: 0,
      portalTotal: 0,
      matchedInPortal: 0,
      missingFromPortal: 0,
      missingNoEmail: 0,
      missing: [],
      comparedAt: '',
    };
  }

  closeCompare(): void {
    this.compare.show = false;
    this.compareInviteResults = [];
    this.compareInviteBanner = '';
  }

  // ── Sales dashboard (counsellor recency) ───────────────────
  private createSalesDashboardState(): SalesDashboardResult {
    return {
      show: false,
      loading: false,
      error: '',
      green: [],
      yellow: [],
      red: [],
      watchedNames: [],
      availableCounsellors: [],
      setupRequired: false,
      totals: {
        counsellors: 0,
        green: 0,
        yellow: 0,
        red: 0,
        enrollmentsScanned: 0,
        availableCounsellors: 0,
      },
      trends: { green: 0, yellow: 0, red: 0 },
      generatedAt: '',
    };
  }

  closeSalesDashboard(): void {
    this.salesDashboard.show = false;
    this.salesWatchPickerOpen = false;
    this.salesWatchSaveMsg = '';
  }

  openSalesDashboard(
    board: ReturnType<typeof this.createBoardState>,
    reportPeriod?: 'morning' | 'evening'
  ): void {
    if (board.type !== 'enrollment') return;

    this.closeCompare();

    this.salesDashboard = {
      ...this.createSalesDashboardState(),
      show: true,
      loading: true,
    };
    this.salesWatchSaveMsg = '';

    this.http.post<any>('/api/crm-portal/enrollment-board/sales-dashboard', {
      simple: {},
      reportPeriod: reportPeriod ?? this.salesReportPeriod(),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.applySalesDashboardResponse(res),
        error: (err) => {
          this.salesDashboard.loading = false;
          this.salesDashboard.error =
            err?.error?.message || 'Failed to load sales dashboard.';
        },
      });
  }

  private applySalesDashboardResponse(res: any): void {
    if (!res?.success) {
      this.salesDashboard.loading = false;
      this.salesDashboard.error = res?.message || 'Sales dashboard failed.';
      return;
    }
    this.salesDashboard = {
      show: true,
      loading: false,
      error: '',
      green: res.green || [],
      yellow: res.yellow || [],
      red: res.red || [],
      watchedNames: res.watchedNames || [],
      availableCounsellors: res.availableCounsellors || [],
      setupRequired: !!res.setupRequired,
      totals: {
        counsellors: res.totals?.counsellors || 0,
        green: res.totals?.green || 0,
        yellow: res.totals?.yellow || 0,
        red: res.totals?.red || 0,
        enrollmentsScanned: res.totals?.enrollmentsScanned || 0,
        availableCounsellors: res.totals?.availableCounsellors || 0,
      },
      trends: {
        green: res.trends?.green || 0,
        yellow: res.trends?.yellow || 0,
        red: res.trends?.red || 0,
      },
      generatedAt: res.generatedAt || new Date().toISOString(),
      reportWindow: res.reportWindow || undefined,
    };
    this.salesWatchDraft = [...(res.watchedNames || [])];
    if (res.setupRequired) {
      this.salesWatchPickerOpen = true;
    }
  }

  toggleSalesWatchPicker(): void {
    this.salesWatchPickerOpen = !this.salesWatchPickerOpen;
    if (this.salesWatchPickerOpen) {
      this.salesWatchDraft = [...this.salesDashboard.watchedNames];
      this.salesWatchSaveMsg = '';
      this.salesWatchFilter = '';
    }
  }

  get filteredAvailableCounsellors(): string[] {
    const q = this.salesWatchFilter.trim().toLowerCase();
    const list = this.salesDashboard.availableCounsellors || [];
    if (!q) return list;
    return list.filter(n => n.toLowerCase().includes(q));
  }

  isCounsellorWatched(name: string): boolean {
    const key = name.trim().toLowerCase();
    return this.salesWatchDraft.some(n => n.trim().toLowerCase() === key);
  }

  toggleWatchCounsellor(name: string): void {
    const key = name.trim().toLowerCase();
    const idx = this.salesWatchDraft.findIndex(n => n.trim().toLowerCase() === key);
    if (idx >= 0) {
      this.salesWatchDraft = this.salesWatchDraft.filter((_, i) => i !== idx);
    } else {
      this.salesWatchDraft = [...this.salesWatchDraft, name];
    }
  }

  selectAllVisibleCounsellors(): void {
    const next = new Set(this.salesWatchDraft.map(n => n.trim().toLowerCase()));
    const names = [...this.salesWatchDraft];
    for (const n of this.filteredAvailableCounsellors) {
      const key = n.trim().toLowerCase();
      if (!next.has(key)) {
        next.add(key);
        names.push(n);
      }
    }
    this.salesWatchDraft = names;
  }

  clearWatchDraft(): void {
    this.salesWatchDraft = [];
  }

  saveSalesWatchlist(board: ReturnType<typeof this.createBoardState>): void {
    if (this.salesWatchSaving) return;
    this.salesWatchSaving = true;
    this.salesWatchSaveMsg = '';

    this.http.put<any>('/api/crm-portal/enrollment-board/sales-dashboard/settings', {
      counsellorNames: this.salesWatchDraft,
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.salesWatchSaving = false;
          if (!res?.success) {
            this.salesWatchSaveMsg = res?.message || 'Failed to save.';
            return;
          }
          this.salesWatchSaveMsg = `Saved ${res.counsellorNames?.length || 0} counsellor(s).`;
          this.salesWatchPickerOpen = false;
          this.openSalesDashboard(board);
        },
        error: (err) => {
          this.salesWatchSaving = false;
          this.salesWatchSaveMsg =
            err?.error?.message || 'Failed to save counsellor list.';
        },
      });
  }

  formatSalesEnrollmentDate(iso: string | null): string {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  salesDaysLabel(days: number | null): string {
    if (days == null) return 'Inactive';
    const morning = this.salesDashboard.reportWindow?.period === 'morning';
    if (days === 0) return morning ? 'Yesterday' : 'Today';
    if (days === 1) return '1 Day Ago';
    return `${days} Days Ago`;
  }

  salesDaysHighlight(days: number | null): boolean {
    return this.salesDashboard.reportWindow?.period === 'morning' && days === 0;
  }

  salesReportPeriod(): 'morning' | 'evening' {
    const hour = Number(
      new Date().toLocaleString('en-GB', {
        timeZone: 'Asia/Colombo',
        hour: 'numeric',
        hour12: false,
      })
    );
    return hour >= 18 ? 'evening' : 'morning';
  }

  salesReportWindowLabel(): string {
    const w = this.salesDashboard.reportWindow;
    if (!w?.startLabel || !w?.endLabel) return '';
    return `${w.startLabel} to ${w.endLabel}`;
  }

  salesProgressPct(count: number): number {
    const total = this.salesDashboard.totals.counsellors || 0;
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((count / total) * 100)));
  }

  salesGeneratedLabel(): string {
    const iso = this.salesDashboard.generatedAt;
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  async captureSalesDashboardPng(): Promise<string | null> {
    const el = this.salesDashboardCapture?.nativeElement;
    if (!el) return null;

    const bodies = el.querySelectorAll<HTMLElement>('.crm-perf__body');
    const prevMaxHeights: string[] = [];
    bodies.forEach((body, i) => {
      prevMaxHeights[i] = body.style.maxHeight;
      body.style.maxHeight = 'none';
      body.style.overflow = 'visible';
    });

    try {
      await new Promise(r => setTimeout(r, 80));
      const canvas = await html2canvas(el, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      return canvas.toDataURL('image/png');
    } finally {
      bodies.forEach((body, i) => {
        body.style.maxHeight = prevMaxHeights[i] || '';
        body.style.overflow = '';
      });
    }
  }

  async saveSalesDashboardImage(): Promise<void> {
    if (this.salesImageSaving || this.salesDashboard.loading) return;

    this.salesImageSaving = true;
    this.salesImageSaveMsg = '';

    try {
      const dataUrl = await this.captureSalesDashboardPng();
      if (!dataUrl) {
        this.salesImageSaveMsg = 'Nothing to capture yet.';
        return;
      }

      const date = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.download = `counsellor-performance-${date}.png`;
      link.href = dataUrl;
      link.click();

      this.salesImageSaveMsg = 'Image saved.';
      setTimeout(() => { this.salesImageSaveMsg = ''; }, 3000);
    } catch {
      this.salesImageSaveMsg = 'Failed to save image. Try again.';
    } finally {
      this.salesImageSaving = false;
    }
  }

  triggerSalesDashboardChat(period: 'morning' | 'evening', board: ReturnType<typeof this.createBoardState>): void {
    if (this.salesChatSending || this.salesDashboard.loading) return;

    this.salesChatSending = true;
    this.salesChatTriggerPeriod = period;
    this.salesChatSendMsg = '';

    this.http
      .post<any>('/api/crm-portal/enrollment-board/sales-dashboard/trigger-chat', {
        reportPeriod: period,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.salesChatSending = false;
          this.salesChatTriggerPeriod = null;
          if (!res?.success) {
            this.salesChatSendMsg = res?.message || 'Failed to send to Google Chat.';
            return;
          }
          this.salesChatSendMsg = res.message || `Sent ${period === 'morning' ? '10 AM' : '6 PM'} report to Google Chat.`;
          setTimeout(() => { this.salesChatSendMsg = ''; }, 5000);
          this.openSalesDashboard(board, period);
        },
        error: (err) => {
          this.salesChatSending = false;
          this.salesChatTriggerPeriod = null;
          this.salesChatSendMsg =
            err?.error?.message || 'Failed to send to Google Chat.';
        },
      });
  }

  sendSalesDashboardToChat(): void {
    if (this.salesChatSending || this.salesDashboard.loading) return;

    this.salesChatSending = true;
    this.salesChatTriggerPeriod = null;
    this.salesChatSendMsg = '';

    this.captureSalesDashboardPng()
      .then(imagePngBase64 => {
        if (!imagePngBase64) {
          this.salesChatSending = false;
          this.salesChatSendMsg = 'Nothing to capture yet.';
          return;
        }

        this.http
          .post<any>('/api/crm-portal/enrollment-board/sales-dashboard/send-to-chat', {
            imagePngBase64,
            reportPeriod: this.salesReportPeriod(),
          })
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (res) => {
              this.salesChatSending = false;
              if (!res?.success) {
                this.salesChatSendMsg = res?.message || 'Failed to send to Google Chat.';
                return;
              }
              this.salesChatSendMsg = res.message || 'Sent to Google Chat.';
              setTimeout(() => { this.salesChatSendMsg = ''; }, 4000);
            },
            error: (err) => {
              this.salesChatSending = false;
              this.salesChatSendMsg =
                err?.error?.message || 'Failed to send to Google Chat.';
            },
          });
      })
      .catch(() => {
        this.salesChatSending = false;
        this.salesChatSendMsg = 'Failed to capture dashboard image.';
      });
  }

  private buildComparePayload(board: ReturnType<typeof this.createBoardState>): object {
    if (board.lastQueryWasAdvanced && board.filterRows.length > 0) {
      const filters = board.filterRows
        .filter(r => r.field && r.operator)
        .map(r => {
          const f: any = { field: r.field, operator: r.operator };
          if (!this.needsNoValue(r.operator)) {
            if (r.isMulti && r.values.length > 0) {
              f.values = r.values;
            } else {
              f.value = r.value;
            }
            if (this.needsSecondValue(r.operator)) f.value2 = r.value2;
          }
          return f;
        });
      return {
        advanced: {
          filters,
          filterLogic: board.filterLogic,
        },
      };
    }

    const simple: Record<string, string> = {};
    if (board.simpleQ?.trim()) simple['q'] = board.simpleQ.trim();
    if (board.type === 'enrollment') {
      if (board.simpleDateFrom) simple['dateFrom'] = board.simpleDateFrom;
      if (board.simpleDateTo) simple['dateTo'] = board.simpleDateTo;
    } else {
      if (board.simpleDateFrom) simple['enrollmentDateFrom'] = board.simpleDateFrom;
      if (board.simpleDateTo) simple['enrollmentDateTo'] = board.simpleDateTo;
    }
    Object.entries(board.simpleFilters).forEach(([k, v]) => {
      if (String(v || '').trim()) simple[k] = String(v).trim();
    });
    return { simple };
  }

  runPortalCompare(board: ReturnType<typeof this.createBoardState>): void {
    if (board.groupByFields.length > 0 && board.lastQueryWasAdvanced) {
      this.compare = {
        ...this.createCompareState(),
        show: true,
        error: 'Clear group-by in Advanced filters before comparing.',
      };
      return;
    }

    this.closeSalesDashboard();

    const endpoint = board.type === 'enrollment'
      ? '/api/crm-portal/enrollment-board/compare-portal'
      : '/api/crm-portal/language-team-board/compare-portal';

    this.compare = { ...this.createCompareState(), show: true, loading: true, boardType: board.type };
    this.compareInviteResults = [];
    this.compareInviteBanner = '';

    this.http.post<any>(endpoint, this.buildComparePayload(board))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.compare.loading = false;
            this.compare.error = res?.message || 'Compare failed.';
            return;
          }
          this.compare = {
            show: true,
            loading: false,
            error: '',
            boardType: board.type,
            crmTotal: res.crmTotal || 0,
            crmRawTotal: res.crmRawTotal || res.crmTotal || 0,
            crmDuplicatesSkipped: res.crmDuplicatesSkipped || 0,
            portalTotal: res.portalTotal || 0,
            matchedInPortal: res.matchedInPortal || 0,
            missingFromPortal: res.missingFromPortal || 0,
            missingNoEmail: res.missingNoEmail || 0,
            missing: res.missing || [],
            comparedAt: res.comparedAt || new Date().toISOString(),
          };
        },
        error: (err) => {
          this.compare.loading = false;
          this.compare.error = err?.error?.message || 'Failed to compare CRM board with portal.';
        },
      });
  }

  exportCompareCsv(): void {
    if (!this.compare.missing.length) return;
    const headers = ['Name', 'Email', 'Phone', 'Status', 'Package', 'Batch', 'Enrolled', 'Counsellor', 'Reason'];
    const rows = this.compare.missing.map(m => [
      m.name, m.email, m.phone || m.whatsapp, m.status, m.package, m.batch, m.enrolled, m.counsellor, m.reason,
    ]);
    const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-missing-from-portal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  getCompareInviteTargets(): PortalCompareMissing[] {
    return this.compare.missing.filter(
      m => String(m.email || '').includes('@') && m.reason !== 'No email on CRM record'
    );
  }

  isCompareInviteSent(email: string): boolean {
    return this.compareInviteResults.some(
      r => r.email.toLowerCase() === email.toLowerCase() && r.success
    );
  }

  isCompareInviteSending(email: string): boolean {
    return this.compareInviteSending.has(email.toLowerCase());
  }

  sendCompareSignupInvite(row: PortalCompareMissing): void {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email.includes('@') || this.isCompareInviteSending(email)) return;

    this.compareInviteSending.add(email);
    this.authService.sendRegisterInvite(email, row.name, {
      phone: row.phone,
      whatsapp: row.whatsapp,
      crmStudentId: row.crmId || undefined,
      department: this.activeTab === 'language' ? 'Language' : 'Sales',
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.compareInviteSending.delete(email);
        const success = res?.success !== false;
        this.compareInviteResults = [
          ...this.compareInviteResults.filter(r => r.email !== email),
          { email, success, message: res?.msg || (success ? 'Invite sent.' : 'Failed to send invite.') },
        ];
      },
      error: (err) => {
        this.compareInviteSending.delete(email);
        this.compareInviteResults = [
          ...this.compareInviteResults.filter(r => r.email !== email),
          {
            email,
            success: false,
            message: err?.error?.msg || err?.error?.message || 'Failed to send invite.',
          },
        ];
      },
    });
  }

  sendAllCompareSignupInvites(): void {
    const targets = this.getCompareInviteTargets();
    if (!targets.length || this.compareBulkInviting) return;

    this.compareBulkInviting = true;
    this.compareInviteBanner = '';

    const requests = targets.map(row => {
      const email = String(row.email || '').trim().toLowerCase();
      this.compareInviteSending.add(email);
      return this.authService.sendRegisterInvite(email, row.name, {
        phone: row.phone,
        whatsapp: row.whatsapp,
        crmStudentId: row.crmId || undefined,
        department: this.activeTab === 'language' ? 'Language' : 'Sales',
      }).pipe(
        catchError(err => of({
          success: false,
          msg: err?.error?.msg || err?.error?.message || 'Failed to send invite.',
          email,
        })),
        takeUntil(this.destroy$),
      );
    });

    forkJoin(requests).subscribe({
      next: (results) => {
        const merged: CompareInviteResult[] = targets.map((row, i) => {
          const email = String(row.email || '').trim().toLowerCase();
          this.compareInviteSending.delete(email);
          const res = results[i] as { success?: boolean; msg?: string };
          const success = res?.success !== false;
          return {
            email,
            success,
            message: res?.msg || (success ? 'Invite sent.' : 'Failed to send invite.'),
          };
        });
        this.compareInviteResults = merged;
        const sent = merged.filter(r => r.success).length;
        const failed = merged.length - sent;
        this.compareInviteBanner = failed
          ? `Sent ${sent} signup invite(s). ${failed} failed — see row status below.`
          : `Sent signup invite to ${sent} student(s) via email${this.waSendEnabled ? ' + WhatsApp (when phone on file)' : ''}.`;
        this.compareBulkInviting = false;
      },
      error: () => {
        targets.forEach(row => this.compareInviteSending.delete(String(row.email).toLowerCase()));
        this.compareBulkInviting = false;
        this.compareInviteBanner = 'Bulk send failed. Try sending individually.';
      },
    });
  }

  trackByCompareEmail = (_: number, row: PortalCompareMissing) =>
    String(row.email || row.crmId || row.name).toLowerCase();
}
