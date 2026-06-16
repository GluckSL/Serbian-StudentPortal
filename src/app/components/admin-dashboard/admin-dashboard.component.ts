//src/app/components/admin-dashboard/admin-dashboard.component.ts

import { Component, OnInit, TrackByFunction } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { Router, RouterModule } from '@angular/router';
import { jwtDecode } from 'jwt-decode';
import { HttpClient, HttpParams } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { FeedbackService } from '../../services/feedback.service';
import { NgChartsModule } from 'ng2-charts';
import { SafeUrlPipe } from '../../pipes/safe-url.pipe';
import { MaterialModule } from '../../shared/material.module';
import { MatDialog } from '@angular/material/dialog';
import { HttpHeaders } from '@angular/common/http';
import {TeacherService} from '../../services/teacher.service';
import { environment } from '../../../environments/environment';
import { BulkStudentUploadComponent } from './bulk-student-upload.component';
import { CorrectDetailsComponent } from './correct-details.component';
import { TestAccountBadgeComponent } from '../../shared/test-account-badge/test-account-badge.component';
import { forkJoin, Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { NotificationService } from '../../services/notification.service';
import * as XLSX from 'xlsx';

const apiUrl = environment.apiUrl;  // Base API URL

type VapiStatus = 'active' | 'paused' | 'finished';

interface CourseProgress {
  courseId?: string;
  courseName: string;
  progressPercentage: number;
  lastUpdated: string;
}

interface Student {
  student: { fluency: number; grammar: number; accent: number; overallCFBR: number; currentLevel: string; };
  _id: string;
  regNo?: string;
  name: string;
  email: string;
  batch?: string;
  medium?: string;
  courseAssigned: string;
  registeredAt: string;
  subscription: string;
  level: string;
  studentStatus: string;
  lastCredentialsEmailSent?: Date | string | null;
  lastLogin?: Date | string | null;
  displayPassword?: string | null;
  passwordDisplayState?: 'VISIBLE' | 'UNAVAILABLE';
  feedbackStats?: {
    currentLevel: string;
    fluency: number;
    grammar: number;
    accent: number;
    overallCFBR: number;
  };
  courseProgress?: CourseProgress[];

  remainingMinutes?: number;
  planUpgradeDate?: string;
  remainingDays?: number;
}

interface FeedbackEntry {
  timestamp: string;
  studentName: string;
  studentId: string;
  summary: string;
  conversationTime: number;
  fluency: string;
  accent: string;
  grammar: string;
  overallCfbr: string;
  commonMistakes: string;
  currentLevel: string;
  suggestedImprovement: string;
}

interface TeacherResponse {
  success: boolean;
  data: any[];
}

interface StudentListResponse {
  success: boolean;
  data: Student[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

interface StudentDataIssueRow {
  _id: string;
  regNo: string;
  name: string;
  email: string;
  batch: string;
  level: string;
  subscription: string;
  studentStatus: string;
  crmExternalId: string;
  issueTypes: string[];
  issueDetail: string;
  severity: 'danger' | 'warning';
}

interface PlanStatusBreakdownEntry {
  status: string;
  count: number;
}

interface PortalStudentCounts {
  portalTotal: number;
  portalActive: number;
  portalWithdrew: number;
  portalCrmLinked: number;
  portalSignupForm: number;
  portalTestAccounts: number;
  portalNonTest: number;
  ongoingNonTest: number;
  platinumTotal: number;
  platinumOngoing: number;
  platinumStatusBreakdown: PlanStatusBreakdownEntry[];
  silverTotal: number;
  silverOngoing: number;
  silverStatusBreakdown: PlanStatusBreakdownEntry[];
  visaDocsTotal: number;
  visaDocsOngoing: number;
  visaDocsStatusBreakdown: PlanStatusBreakdownEntry[];
}

interface StudentDataIssuesResponse {
  success: boolean;
  students: StudentDataIssueRow[];
  summary: {
    totalIssueRows: number;
    dangerCount: number;
    warningCount: number;
    byType: Record<string, number>;
  };
  reconciliation: {
    portalTotal: number;
    crmUniqueEmails: number;
    portalMatchedCrm: number;
    portalExtraNotOnCrm: number;
    mondayBoardRows: number;
  } | null;
  mondayError: string | null;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MaterialModule,
    NgChartsModule,
    RouterModule,
    BulkStudentUploadComponent,
    CorrectDetailsComponent,
    TestAccountBadgeComponent
  ],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.css']
})

export class AdminDashboardComponent implements OnInit {
  students: any[] = [];          // original data
  filteredStudents: any[] = [];  // shown in table
  selectedStudentIds = new Set<string>();
  selectAll = false;

  /** True when the logged-in user is a full ADMIN (can see student passwords) */
  isFullAdmin = false;
  /** Tracks which student rows have their password revealed */
  loading = true;
  exportingAll = false;
  readonly skeletonActionPills = [0, 1, 2];
  readonly skeletonFilterFields = [0, 1, 2, 3, 4, 5];
  readonly skeletonTableRows = [0, 1, 2, 3, 4, 5, 6, 7];
  readonly skeletonTableCols = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  error = '';
  filters = {
    level: '',
    plan: '',
    batch: '',
    assignedTeacher: '',
    studentStatus: '',
    studentName: '',
    teacherName: '',
    servicesOpted: '',
    qualifications: '',
    languageLevelOpted: '',
    phoneCountry: '',
    loginCountry: ''
  };

  /** Distinct values for CRM dropdowns (from `/admin/students/filter-options`) */
  filterOptions = {
    batches: [] as string[],
    servicesOpted: [] as string[],
    qualifications: [] as string[],
    languageLevelOpted: [] as string[],
    phoneCountries: [] as string[],
    loginCountries: [] as string[]
  };

  /** Optional table columns (off by default); preferences in localStorage */
  private readonly studentColumnPrefKey = 'adminStudentTableOptionalColumns';
  readonly optionalColumns: { id: string; label: string }[] = [
    { id: 'servicesOpted', label: 'Service opted' },
    { id: 'qualifications', label: 'Qualification' },
    { id: 'languageLevelOpted', label: 'Language level opted' },
    { id: 'leadSource', label: 'Lead source' },
    { id: 'stream', label: 'Stream' },
    { id: 'enrollmentDate', label: 'Enrollment date' },
    { id: 'teacherIncharge', label: 'Teacher in charge (CRM)' },
    { id: 'whatsappNumber', label: 'WhatsApp' },
    { id: 'phoneCountry', label: 'Phone country' },
    { id: 'lastLoginCountry', label: 'Login country' }
  ];
  columnVisibility: Record<string, boolean> = {};

  plan: string[] = ['PLATINUM', 'SILVER'];
  level: string[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  teachers: any[] = [];
  
  // Autocomplete for student name
  studentNameControl = new FormControl('');
  filteredStudentNames!: Observable<string[]>;
  allStudentNames: string[] = [];
  
  // Autocomplete for teacher name
  teacherNameControl = new FormControl('');
  filteredTeacherNames!: Observable<string[]>;
  allTeacherNames: string[] = [];

  /** Filter form collapsed by default; use header “Filter” control to expand */
  filtersPanelOpen = false;

  // Bulk upload
  showBulkUpload = false;

  // Correct Details (Excel reconciliation)
  showCorrectDetails = false;

  toggleFiltersPanel(): void {
    this.filtersPanelOpen = !this.filtersPanelOpen;
  }

  // Bulk edit properties
  showBulkEditPanel = false;
  bulkUpdates = {
    assignedTeacher: '',
    level: '',
    studentStatus: '',
    subscription: '',
    batch: ''
  };

  feedbackMap: Record<string, any[]> = {};
  selectedStudentName?: string;
  feedbackLoading: boolean = false;
  feedbackError: string | null = null;

  bulkCourseName: string = '';
  bulkAssistantId: string = '';
  bulkApiKey: string = '';
  selectedStudentId!: string;

  characterCount = 0;
  characterLimit = 0;
  remainingMinutes = 0;
  planUpgradeDate: string | null = null;

  assignBatchNo: string = '';
  assignTeacherId: string = '';
  showAssignTeacherByBatch = false;

  batchTeachers: any[] = [];
  loadingTeachers = false;

  resendingCredentials: { [key: string]: boolean } = {};

  showInviteModal = false;
  inviteEmail = '';
  inviteName = '';
  inviteSending = false;
  inviteError = '';

  constructor(
    private authService: AuthService,
    private router: Router,
    private http: HttpClient,
    private feedbackService: FeedbackService,
    private dialog: MatDialog,
    private teacherService: TeacherService,
    private notify: NotificationService,
  ) {}

  ngOnInit(): void {
    // ✅ Check user profile from backend (cookie included automatically)
    this.authService.getUserProfile().subscribe({
      next: (user) => {
        if (user.role !== 'ADMIN' && user.role !== 'TEACHER_ADMIN' && user.role !== 'SUB_ADMIN') {
          this.router.navigate(['/dashboard']);
          return;
        }
        this.isFullAdmin = user.role === 'ADMIN';
        this.initColumnVisibility();
        this.fetchStudents();
        this.fetchFilterOptions();
        // Teachers only power autocomplete — load after the student table request starts.
        setTimeout(() => this.fetchTeachers(), 0);
      },
      error: () => {
        this.loading = false;
        this.router.navigate(['/auth/login']);
      }
    });
  }

  totalStudentsCount(): number {
    return this.totalStudents;
  }

  /** Use filtered total when filters are active (0 is valid, not “show all”). */
  displayStudentCount(): number {
    return this.hasActiveStudentFilters() ? this.filteredStudentCount : this.totalStudentsCount();
  }

  formatStudentStatus(status: string): string {
    const labels: Record<string, string> = {
      UNCERTAIN: 'Uncertain',
      COMPLETED: 'Completed',
      WITHDREW: 'Withdrew',
      DROPPED: 'Dropped',
      ONGOING: 'Ongoing',
    };
    return labels[String(status || '').toUpperCase()] || status;
  }
  
  private buildStudentListParams(page: number, limit: number): HttpParams {
    let params = new HttpParams()
      .set('page', String(page))
      .set('limit', String(limit));

    if (this.filters.level) params = params.set('level', this.filters.level);
    if (this.filters.plan) params = params.set('plan', this.filters.plan);
    if (this.filters.batch) params = params.set('batch', String(this.filters.batch));
    if (this.filters.studentStatus) params = params.set('studentStatus', this.filters.studentStatus);
    if (this.filters.studentName) params = params.set('studentName', this.filters.studentName);
    if (this.filters.teacherName) params = params.set('teacherName', this.filters.teacherName);
    if (this.filters.servicesOpted) params = params.set('servicesOpted', this.filters.servicesOpted);
    if (this.filters.qualifications) params = params.set('qualifications', this.filters.qualifications);
    if (this.filters.languageLevelOpted) params = params.set('languageLevelOpted', this.filters.languageLevelOpted);
    if (this.filters.phoneCountry) params = params.set('phoneCountry', this.filters.phoneCountry);
    if (this.filters.loginCountry) params = params.set('loginCountry', this.filters.loginCountry);

    return params;
  }

  fetchStudents(page: number = this.currentPage): void {
    this.loading = true;
    this.currentPage = page;

    const params = this.buildStudentListParams(this.currentPage, this.pageSize);

    this.http.get<StudentListResponse>(`${apiUrl}/admin/students`, { params, withCredentials: true }).subscribe({
      next: res => {
        if (res.success) {
          this.students = res.data;
          this.filteredStudents = [...this.students];
          this.totalStudents = res.pagination?.total ?? this.students.length;
          this.currentPage = res.pagination?.page ?? this.currentPage;
          this.pageSize = res.pagination?.limit ?? this.pageSize;
          this.totalPages = res.pagination?.pages ?? 1;
          this.filteredStudentCount = this.totalStudents;
          this.selectAll = false;
          this.selectedStudentIds.clear();
          
          // Hints for autocomplete (name, reg no, email on current result set)
          this.allStudentNames = this.buildStudentSearchHints(this.students);
          
          // Setup autocomplete filtering
          this.filteredStudentNames = this.studentNameControl.valueChanges.pipe(
            startWith(''),
            map(value => this._filterStudentNames(value || ''))
          );
        } else {
          this.error = 'Failed to load students';
        }
        this.loading = false;
      },
      error: err => {
        //console.error('Error fetching students:', err);
        this.error = err.error?.msg || 'Failed to load students';
        this.loading = false;
      }
    });
    }

  portalStudentCounts: PortalStudentCounts = {
    portalTotal: 0,
    portalActive: 0,
    portalWithdrew: 0,
    portalCrmLinked: 0,
    portalSignupForm: 0,
    portalTestAccounts: 0,
    portalNonTest: 0,
    ongoingNonTest: 0,
    platinumTotal: 0,
    platinumOngoing: 0,
    platinumStatusBreakdown: [],
    silverTotal: 0,
    silverOngoing: 0,
    silverStatusBreakdown: [],
    visaDocsTotal: 0,
    visaDocsOngoing: 0,
    visaDocsStatusBreakdown: [],
  };

  dataIssuesPanelOpen = false;
  dataIssuesLoading = false;
  dataIssuesError = '';
  dataIssuesStudents: StudentDataIssueRow[] = [];
  dataIssuesSummary: StudentDataIssuesResponse['summary'] | null = null;
  dataIssuesReconciliation: StudentDataIssuesResponse['reconciliation'] | null = null;
  dataIssuesMondayError: string | null = null;
  dataIssuesTypeFilter = '';

  readonly dataIssueTypeLabels: Record<string, string> = {
    duplicate_email: 'Duplicate email',
    duplicate_crm_id: 'Duplicate CRM id',
    missing_email: 'Missing email',
    placeholder_email: 'Placeholder email',
    no_crm_link: 'No CRM link',
    portal_only: 'Not on CRM board'
  };

  fetchFilterOptions(): void {
    this.http
      .get<{
        success: boolean;
        batches?: string[];
        servicesOpted?: string[];
        qualifications?: string[];
        languageLevelOpted?: string[];
        phoneCountries?: string[];
        loginCountries?: string[];
        studentCounts?: PortalStudentCounts;
      }>(`${apiUrl}/admin/students/filter-options`, { withCredentials: true })
      .subscribe({
        next: (res) => {
          if (!res.success) return;
          this.filterOptions.batches = res.batches ?? [];
          this.filterOptions.servicesOpted = res.servicesOpted ?? [];
          this.filterOptions.qualifications = res.qualifications ?? [];
          this.filterOptions.languageLevelOpted = res.languageLevelOpted ?? [];
          this.filterOptions.phoneCountries = res.phoneCountries ?? [];
          this.filterOptions.loginCountries = res.loginCountries ?? [];
          if (res.studentCounts) {
            this.portalStudentCounts = {
              ...this.portalStudentCounts,
              ...res.studentCounts,
              platinumStatusBreakdown: res.studentCounts.platinumStatusBreakdown ?? [],
              silverStatusBreakdown: res.studentCounts.silverStatusBreakdown ?? [],
              visaDocsStatusBreakdown: res.studentCounts.visaDocsStatusBreakdown ?? [],
            };
          }
        },
        error: () => {
          /* non-blocking */
        }
      });
  }

  initColumnVisibility(): void {
    let saved: Record<string, boolean> | null = null;
    try {
      const raw = localStorage.getItem(this.studentColumnPrefKey);
      if (raw) saved = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    this.columnVisibility = {};
    for (const c of this.optionalColumns) {
      this.columnVisibility[c.id] =
        saved && typeof saved[c.id] === 'boolean' ? saved[c.id] : false;
    }
  }

  isColVisible(columnId: string): boolean {
    return !!this.columnVisibility[columnId];
  }

  toggleOptionalColumn(columnId: string, visible: boolean): void {
    this.columnVisibility[columnId] = visible;
    try {
      localStorage.setItem(this.studentColumnPrefKey, JSON.stringify(this.columnVisibility));
    } catch {
      /* ignore */
    }
  }

  // ✅ Fetch all registered teachers
  fetchTeachers(): void {
    this.teacherService.getAllTeachers().subscribe({
      next: (res) => {
        if (res.success) {
          this.teachers = res.data;

          this.allTeacherNames = this.teachers
            .map(t => t.name)
            .filter((name, index, self) => name && self.indexOf(name) === index)
            .sort();

          this.filteredTeacherNames = this.teacherNameControl.valueChanges.pipe(
            startWith(''),
            map(value => this._filterTeacherNames(value || ''))
          );
        } else {
          this.notify.error('Failed to load teachers');
        }
      },
      error: () => {
        /* non-blocking */
      }
    });
  }

  filteredStudentCount: number = 0;
  currentPage: number = 1;
  pageSize: number = 20;
  totalPages: number = 1;
  totalStudents: number = 0;

  applyFilters() {
    this.fetchStudents(1);
  }

  applySearchFilters(): void {
    this.filters.studentName = (this.studentNameControl.value || '').toString().trim();
    this.filters.teacherName = (this.teacherNameControl.value || '').toString().trim();
    this.applyFilters();
  }

  clearFilters() {
    this.filters = {
      level: '',
      plan: '',
      batch: '',
      assignedTeacher: '',
      studentStatus: '',
      studentName: '',
      teacherName: '',
      servicesOpted: '',
      qualifications: '',
      languageLevelOpted: '',
      phoneCountry: '',
      loginCountry: ''
    };
    this.studentNameControl.setValue('');
    this.teacherNameControl.setValue('');
    this.fetchStudents(1);
  }

  hasActiveStudentFilters(): boolean {
    const f = this.filters;
    return !!(
      f.level || f.plan || f.batch || f.studentStatus || f.studentName || f.teacherName ||
      f.servicesOpted || f.qualifications || f.languageLevelOpted ||
      f.phoneCountry || f.loginCountry
    );
  }

  countryCellDisplay(student: any, field: 'phoneCountry' | 'lastLoginCountry'): string {
    const v = student?.[field];
    return v && String(v).trim() ? String(v).trim() : '—';
  }

  get filteredDataIssuesStudents(): StudentDataIssueRow[] {
    if (!this.dataIssuesTypeFilter) return this.dataIssuesStudents;
    return this.dataIssuesStudents.filter((s) => s.issueTypes.includes(this.dataIssuesTypeFilter));
  }

  toggleDataIssuesPanel(): void {
    this.dataIssuesPanelOpen = !this.dataIssuesPanelOpen;
    if (this.dataIssuesPanelOpen && !this.dataIssuesStudents.length && !this.dataIssuesLoading) {
      this.loadDataIssues();
    }
  }

  loadDataIssues(): void {
    this.dataIssuesLoading = true;
    this.dataIssuesError = '';
    this.http
      .get<StudentDataIssuesResponse>(`${apiUrl}/admin/students/data-issues`, { withCredentials: true })
      .subscribe({
        next: (res) => {
          this.dataIssuesLoading = false;
          if (!res.success) {
            this.dataIssuesError = 'Scan failed';
            return;
          }
          this.dataIssuesStudents = res.students || [];
          this.dataIssuesSummary = res.summary || null;
          this.dataIssuesReconciliation = res.reconciliation || null;
          this.dataIssuesMondayError = res.mondayError || null;
        },
        error: (err) => {
          this.dataIssuesLoading = false;
          this.dataIssuesError = err.error?.message || 'Failed to load data issues';
        }
      });
  }

  closeDataIssuesPanel(): void {
    this.dataIssuesPanelOpen = false;
    this.dataIssuesTypeFilter = '';
  }

  issueTypeLabel(type: string): string {
    return this.dataIssueTypeLabels[type] || type;
  }

  filterDataIssuesByType(type: string): void {
    this.dataIssuesTypeFilter = this.dataIssuesTypeFilter === type ? '' : type;
  }

  crmCellDisplay(student: any, field: string): string {
    const v = student?.[field];
    if (v === null || v === undefined || v === '') return '—';
    return String(v);
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) {
      return;
    }
    this.fetchStudents(page);
  }

  getPaginationPages(): number[] {
    const maxWindow = 5;
    const half = Math.floor(maxWindow / 2);
    let start = Math.max(1, this.currentPage - half);
    let end = Math.min(this.totalPages, start + maxWindow - 1);

    if (end - start + 1 < maxWindow) {
      start = Math.max(1, end - maxWindow + 1);
    }

    const pages: number[] = [];
    for (let p = start; p <= end; p++) {
      pages.push(p);
    }
    return pages;
  }

  get pageStart(): number {
    if (this.totalStudents === 0) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    if (this.totalStudents === 0) return 0;
    return Math.min(this.currentPage * this.pageSize, this.totalStudents);
  }
  
  private buildStudentSearchHints(students: Student[]): string[] {
    const hints = new Set<string>();
    for (const s of students) {
      if (s.name?.trim()) hints.add(s.name.trim());
      if (s.regNo?.trim()) hints.add(s.regNo.trim());
      if (s.email?.trim()) hints.add(s.email.trim());
    }
    return Array.from(hints).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  private _filterStudentNames(value: string): string[] {
    const filterValue = value.toLowerCase();
    return this.allStudentNames.filter(hint =>
      hint.toLowerCase().includes(filterValue)
    );
  }
  
  private _filterTeacherNames(value: string): string[] {
    const filterValue = value.toLowerCase();
    return this.allTeacherNames.filter(name => 
      name.toLowerCase().includes(filterValue)
    );
  }
  
  onStudentNameSelected(studentName: string): void {
    this.filters.studentName = studentName;
  }
  
  onTeacherNameSelected(teacherName: string): void {
    this.filters.teacherName = teacherName;
  }

  toggleStudentSelection(studentId: string): void {
    if (this.selectedStudentIds.has(studentId)) {
      this.selectedStudentIds.delete(studentId);
    } else {
      this.selectedStudentIds.add(studentId);
    }
    this.updateSelectAllState();
  }

  toggleSelectAll(): void {
    if (this.selectAll) {
      // Select all filtered students
      this.filteredStudents.forEach(student => {
        this.selectedStudentIds.add(student._id);
      });
    } else {
      // Deselect all
      this.selectedStudentIds.clear();
    }
  }

  updateSelectAllState(): void {
    const filteredIds = this.filteredStudents.map(s => s._id);
    this.selectAll = filteredIds.length > 0 && 
                     filteredIds.every(id => this.selectedStudentIds.has(id));
  }

  isSelected(studentId: string): boolean {
    return this.selectedStudentIds.has(studentId);
  }

  getSelectedCount(): number {
    return this.selectedStudentIds.size;
  }

  openBulkEditPanel(): void {
    if (this.selectedStudentIds.size === 0) {
      this.notify.warning('Please select at least one student');
      return;
    }
    this.showBulkEditPanel = true;
  }

  closeBulkEditPanel(): void {
    this.showBulkEditPanel = false;
    this.bulkUpdates = {
      assignedTeacher: '',
      level: '',
      studentStatus: '',
      subscription: '',
      batch: ''
    };
  }

  bulkDeleteStudents(): void {
    if (this.selectedStudentIds.size === 0) {
      this.notify.warning('Please select at least one student to delete');
      return;
    }

    const studentIds = Array.from(this.selectedStudentIds);
    const count = studentIds.length;

    this.notify.confirm(
      'Delete Students',
      `WARNING: You are about to permanently delete ${count} student(s). This action cannot be undone and will remove all student data, progress, and session records.`,
      'Yes, Delete', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;

      this.notify.confirm('Final Confirmation', `Delete ${count} student(s) permanently?`, 'Yes, Delete', 'Cancel').subscribe(ok2 => {
        if (!ok2) return;

        console.log('🗑️ [BULK DELETE] Deleting students:', studentIds);

        this.http.post(`${apiUrl}/admin/bulk-delete`, { studentIds }, { withCredentials: true })
          .subscribe({
            next: (res: any) => {
              console.log('✅ [BULK DELETE] SUCCESS:', res);
              this.notify.success(`Successfully deleted ${count} student(s)`);
              this.selectedStudentIds.clear();
              this.selectAll = false;
              this.fetchStudents();
            },
            error: (err: any) => {
              console.error('❌ [BULK DELETE] FAILED:', err);
              const errorMessage = err.error?.message || err.message || 'Bulk delete failed';
              this.notify.error(`Bulk Delete Failed: ${errorMessage}`);
            }
          });
      });
    });
  }

  applyBulkUpdate(): void {
    const studentIds = Array.from(this.selectedStudentIds);
    
    console.log('🔍 [BULK UPDATE] Selected Student IDs:', studentIds);
    console.log('🔍 [BULK UPDATE] Number of students:', studentIds.length);
    
    // Build updates object (only include non-empty values)
    const updates: any = {};
    if (this.bulkUpdates.assignedTeacher) updates.assignedTeacher = this.bulkUpdates.assignedTeacher;
    if (this.bulkUpdates.level) updates.level = this.bulkUpdates.level;
    if (this.bulkUpdates.studentStatus) updates.studentStatus = this.bulkUpdates.studentStatus;
    if (this.bulkUpdates.subscription) updates.subscription = this.bulkUpdates.subscription;
    if (this.bulkUpdates.batch) updates.batch = this.bulkUpdates.batch;

    console.log('🔍 [BULK UPDATE] Updates object:', updates);
    console.log('🔍 [BULK UPDATE] API URL:', `${apiUrl}/admin/bulk-update`);

    if (Object.keys(updates).length === 0) {
      this.notify.warning('Please select at least one field to update');
      return;
    }

    this.notify.confirm('Bulk Update', `Update ${studentIds.length} student(s)?`).subscribe(ok => {
      if (!ok) return;

      console.log('🔍 [BULK UPDATE] Sending request to backend...');

      this.http.post(`${apiUrl}/admin/bulk-update`, { studentIds, updates }, { withCredentials: true })
        .subscribe({
          next: (res: any) => {
            console.log('✅ [BULK UPDATE] SUCCESS:', res);
            this.notify.success(res.message || 'Bulk update successful');
            this.selectedStudentIds.clear();
            this.selectAll = false;
            this.closeBulkEditPanel();
            this.fetchStudents();
          },
          error: err => {
            console.error('❌ [BULK UPDATE] FAILED:', err);
            const errorMessage = err.error?.message || err.message || 'Bulk update failed';
            this.notify.error(`Bulk Update Failed: ${errorMessage}`);
          }
        });
    });
  }

  bulkAssign(): void {
    if (!this.bulkCourseName || !this.bulkAssistantId || !this.bulkApiKey) {
      this.notify.warning('All fields are required for bulk assignment.');
      return;
    }
    const studentIds = Array.from(this.selectedStudentIds);
    const body = {
      studentIds,
      courseName: this.bulkCourseName,
      assistantId: this.bulkAssistantId,
      apiKey: this.bulkApiKey
    };
    this.http.post('/api/admin/bulk-assign', body).subscribe({
      next: () => {
        this.notify.success('Bulk assignment successful');
        this.selectedStudentIds.clear();
        this.fetchStudents();
      },
      error: err => {
        this.notify.error('Bulk assignment failed');
      }
    });
  }

  loadCourseProgress(student: Student): void {
    this.fetchCourseProgress(student._id);
  }

  assignCourseToStudent(student: Student): void {    
    const body = {
      studentId: student._id,
      courseName: student.courseAssigned
    };
    this.http.post('/api/admin/assign-course', body).subscribe({
      next: () => {
        this.notify.success(`Course assigned to ${student.name}`);
        this.fetchStudents();
      },
      error: err => {
        this.notify.error('Failed to assign course');
      }
    });
  }

  updateVapiStatus(studentId: string, newStatus: VapiStatus): void {
    this.http.post('/api/admin/update-vapi-status', { studentId, newStatus }).subscribe({
      next: () => {
        this.fetchStudents();
      },
      error: err => {
      }
    });
  }

  onStatusChange(event: Event, studentId: string): void {
    const selectElement = event.target as HTMLSelectElement;
    const newStatus = selectElement.value as VapiStatus;
    this.updateVapiStatus(studentId, newStatus);
  }

  trackById(index: number, student: Student): string {
    return student._id;
  }

  loadFeedbackForStudent(studentId: string): void {
    this.feedbackLoading = true;
    this.feedbackError = null;
    this.http.get<FeedbackEntry[]>(`/api/feedback/student/${studentId}`).subscribe({
      next: (data) => {
        this.feedbackMap[studentId] = data;
        this.selectedStudentId = studentId;
        this.feedbackLoading = false;
      },
      error: (err) => {
        this.feedbackError = 'Failed to load feedback';
        this.feedbackLoading = false;
      }
    });
  }

  exportFeedbackAsCSV(studentId: string): void {
    const feedbackList = this.feedbackMap[studentId] || [];
    if (feedbackList.length === 0) {
      this.notify.warning('No feedback to export.');
      return;
    }
    const headers = [
      'Student Name', 'Timestamp', 'Summary', 'Conversation Time',
      'Fluency', 'Accent', 'Grammar', 'Overall CFBR',
      'Common Mistakes', 'Level', 'Suggestions'
    ];
    const rows = feedbackList.map(fb => [
      fb.studentName || fb.studentId,
      fb.timestamp,
      fb.summary,
      fb.conversationTime,
      fb.fluency,
      fb.accent,
      fb.grammar,
      fb.overallCfbr,
      fb.commonMistakes,
      fb.currentLevel,
      fb.suggestedImprovement
    ]);
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.map(v => `"${v}"`).join(','))
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `feedback_${studentId}.csv`);
    link.click();
    URL.revokeObjectURL(url);
  }

  fetchCourseProgress(studentId: string): void {
    this.http.get<CourseProgress[]>(`/api/admin/course-progress/${studentId}`).subscribe({
      next: (progress) => {
        const student = this.students.find(s => s._id === studentId);
        if (student) {
          student.courseProgress = progress;
        }
      },
      error: err => {
      }
    });
  }

  resetMonthlyUsage(): void {
    this.notify.confirm('Reset Monthly Usage', 'Are you sure you want to reset monthly usage for all students?', 'Yes, Reset', 'Cancel').subscribe(ok => {
      if (!ok) return;
      this.http.post('/api/admin/reset-monthly-usage', {}).subscribe({
        next: (res: any) => {
          this.notify.success(res.message || 'Monthly usage reset.');
          this.fetchStudents();
        },
        error: err => {
          this.notify.error('Failed to reset usage.');
        }
      });
    });
  }

  viewStudentDetails(student: any): void {
    const tree = this.router.createUrlTree(['/admin/students', student._id], {
      queryParams: {
        name: student.name || '',
        email: student.email || '',
        regNo: student.regNo || '',
        batch: student.batch || '',
        level: student.level || '',
        subscription: student.subscription || '',
        medium: student.medium || ''
      }
    });
    const url = this.router.serializeUrl(tree);
    window.open(url, '_blank', 'noopener');
  }

  deleteUser(id: string): void {
    this.notify.confirm('Delete User', 'Are you sure you want to delete this user?', 'Yes, Delete', 'Cancel').subscribe(ok => {
      if (!ok) return;
      this.authService.deleteUser(id).subscribe({
        next: (response) => {
          this.notify.success('User deleted successfully!');
          this.fetchStudents();
        },
        error: (error) => {
          this.notify.error('Failed to delete user: ' + (error.error?.message || 'Please try again.'));
        }
      });
    });
  }

  updateAssignedTeacherByBatchNo(batchNo: string, teacherId: string): void {
    this.authService.updateAssignedTeacherByBatchNo(batchNo, teacherId).subscribe({
      next: (response) => {
        this.notify.success('Assigned teacher updated successfully for batch ' + batchNo);
        this.fetchStudents();
      },
      error: (error) => {
        this.notify.error('Failed to update assigned teacher: ' + (error.error?.message || 'Please try again.'));
      }
    });
  }

  openAssignTeacherByBatchModal(): void {
    this.showAssignTeacherByBatch = !this.showAssignTeacherByBatch;
  }

  onBatchChange(batchValue: number | string): void {
    if (!batchValue) {
      this.batchTeachers = [];
      return;
    }

    // ensure string because DB stores "1", "30", etc.
    const batch = String(batchValue);

    this.loadingTeachers = true;

    this.authService.getTeachersByBatch(batch).subscribe({
      next: (res) => {
        this.batchTeachers = res || [];
        this.loadingTeachers = false;
      },
      error: () => {
        this.batchTeachers = [];
        this.loadingTeachers = false;
      }
    });
  }

  forcingPasswordReset: Record<string, boolean> = {};
  bulkForcingPasswordReset = false;

  forcePasswordReset(student: Student): void {
    this.notify.confirm(
      'Force password reset',
      `Sign out ${student.name} (${student.email}), email them a verification code, and require a new password on next login? Their current password still works until they complete the reset.`,
      'Yes, reset', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      this.forcingPasswordReset[student._id] = true;
      this.authService.forcePasswordReset(student._id).subscribe({
        next: (res) => {
          this.notify.success(res?.msg || `Password reset email sent to ${student.email}`);
          if (res?.displayPassword) {
            this.patchStudentDisplayPassword(student._id, res.displayPassword);
          }
          this.forcingPasswordReset[student._id] = false;
        },
        error: (err: any) => {
          this.notify.error(err?.error?.msg || 'Could not initiate password reset');
          this.forcingPasswordReset[student._id] = false;
        }
      });
    });
  }

  bulkForcePasswordReset(): void {
    const count = this.getSelectedCount();
    if (count === 0) {
      this.notify.warning('Select at least one student from the table.');
      return;
    }

    this.notify.confirm(
      'Sign out selected students',
      `Expire login for ${count} selected student(s)? They will be signed out immediately and must log in again to change their password. A verification code will be emailed to each student.`,
      'Yes, sign them out',
      'Cancel'
    ).subscribe(ok => {
      if (!ok) return;

      const studentIds = Array.from(this.selectedStudentIds);
      this.bulkForcingPasswordReset = true;
      this.authService.bulkForcePasswordReset(studentIds).subscribe({
        next: (res) => {
          if (res?.successCount) {
            this.notify.success(res.msg || `Signed out ${res.successCount} student(s).`);
          } else {
            this.notify.error(res?.msg || 'Could not sign out selected students.');
          }
          this.bulkForcingPasswordReset = false;
        },
        error: (err: any) => {
          this.notify.error(err?.error?.msg || 'Could not sign out selected students.');
          this.bulkForcingPasswordReset = false;
        }
      });
    });
  }

  private patchStudentDisplayPassword(studentId: string, displayPassword: string): void {
    const patch = (s: Student) => {
      s.displayPassword = displayPassword;
      s.passwordDisplayState = 'VISIBLE';
    };
    const i = this.students.findIndex(s => s._id === studentId);
    if (i !== -1) patch(this.students[i]);
    const j = this.filteredStudents.findIndex(s => s._id === studentId);
    if (j !== -1) patch(this.filteredStudents[j]);
  }

  resendCredentials(student: Student): void {
    this.notify.confirm(
      'Resend Credentials',
      `Resend login credentials to ${student.name} (${student.email})? A new password will be generated.`,
      'Yes, Send', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;

      this.resendingCredentials[student._id] = true;

      this.authService.resendCredentials(student._id).subscribe({
        next: (response: any) => {
          this.notify.success(`Credentials sent to ${student.name} at ${student.email}`);
          
          const studentIndex = this.students.findIndex(s => s._id === student._id);
          if (studentIndex !== -1) {
            this.students[studentIndex].lastCredentialsEmailSent = response.lastSent;
            if (response.displayPassword) {
              this.students[studentIndex].displayPassword = response.displayPassword;
            }
          }
          const filteredIndex = this.filteredStudents.findIndex(s => s._id === student._id);
          if (filteredIndex !== -1) {
            this.filteredStudents[filteredIndex].lastCredentialsEmailSent = response.lastSent;
            if (response.displayPassword) {
              this.filteredStudents[filteredIndex].displayPassword = response.displayPassword;
            }
          }
          this.resendingCredentials[student._id] = false;
        },
        error: (error: any) => {
          console.error('Error resending credentials:', error);
          this.notify.error(`Failed to send credentials: ${error.error?.msg || error.message || 'Unknown error'}`);
          this.resendingCredentials[student._id] = false;
        }
      });
    });
  }

  formatDateTime(date: Date | string | null | undefined, emptyLabel = '—'): string {
    if (!date) return emptyLabel;
    try {
      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) return emptyLabel;
      return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return emptyLabel;
    }
  }

  formatDate(date: Date | string | null | undefined): string {
    return this.formatDateTime(date, 'Never sent');
  }

  formatLastLogin(date: Date | string | null | undefined): string {
    return this.formatDateTime(date, 'Never logged in');
  }

  exportSelectedStudents(): void {
    if (this.selectedStudentIds.size === 0) {
      this.notify.warning('Please select at least one student to export');
      return;
    }

    const selectedStudents = this.students.filter((student) =>
      this.selectedStudentIds.has(student._id)
    );
    this.downloadStudentsExcel(selectedStudents, 'selected');
    this.notify.success(`Successfully exported ${selectedStudents.length} student(s) to Excel`);
  }

  exportAllStudents(): void {
    if (this.exportingAll) return;

    const total = this.displayStudentCount();
    if (total === 0) {
      this.notify.warning('No students to export');
      return;
    }

    this.exportingAll = true;
    const limit = 100;
    const pages = Math.max(1, Math.ceil(total / limit));
    const requests: Observable<StudentListResponse>[] = [];

    for (let page = 1; page <= pages; page++) {
      requests.push(
        this.http.get<StudentListResponse>(`${apiUrl}/admin/students`, {
          params: this.buildStudentListParams(page, limit),
          withCredentials: true,
        })
      );
    }

    forkJoin(requests).subscribe({
      next: (responses) => {
        const allStudents: Student[] = [];
        for (const res of responses) {
          if (res.success && Array.isArray(res.data)) {
            allStudents.push(...res.data);
          }
        }
        this.downloadStudentsExcel(allStudents, 'all');
        this.notify.success(`Successfully exported ${allStudents.length} student(s) to Excel`);
        this.exportingAll = false;
      },
      error: () => {
        this.notify.error('Failed to export students');
        this.exportingAll = false;
      },
    });
  }

  private readonly studentExportHeaders = [
    'Name',
    'Email',
    'Address',
    'Current Level',
    'Service Opted',
    'Package Opted',
    'Batch',
    'Status',
    'Medium',
  ] as const;

  private studentToExportRow(student: Student): Record<(typeof this.studentExportHeaders)[number], string> {
    const raw = student as Student & {
      address?: string;
      servicesOpted?: string;
      medium?: string | string[];
    };
    const medium = Array.isArray(raw.medium)
      ? raw.medium.filter(Boolean).join(', ')
      : String(raw.medium || '');

    return {
      Name: raw.name || '',
      Email: raw.email || '',
      Address: raw.address || '',
      'Current Level': raw.level || '',
      'Service Opted': raw.servicesOpted || '',
      'Package Opted': raw.subscription || '',
      Batch: raw.batch || '',
      Status: this.formatStudentStatus(raw.studentStatus) || raw.studentStatus || '',
      Medium: medium,
    };
  }

  private downloadStudentsExcel(students: Student[], scope: 'selected' | 'all'): void {
    const rows = students.map((student) => this.studentToExportRow(student));
    const ws = XLSX.utils.json_to_sheet(rows, { header: [...this.studentExportHeaders] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    const timestamp = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `students_export_${scope}_${timestamp}.xlsx`);
  }

  openInviteModal(): void {
    this.inviteEmail = '';
    this.inviteName = '';
    this.inviteError = '';
    this.showInviteModal = true;
  }

  closeInviteModal(): void {
    if (this.inviteSending) return;
    this.showInviteModal = false;
    this.inviteError = '';
  }

  sendRegisterInvite(): void {
    const email = String(this.inviteEmail || '').trim();
    if (!email || !email.includes('@')) {
      this.inviteError = 'Please enter a valid email address.';
      return;
    }

    this.inviteSending = true;
    this.inviteError = '';
    const name = String(this.inviteName || '').trim() || undefined;

    this.authService.sendRegisterInvite(email, name).subscribe({
      next: (res) => {
        this.inviteSending = false;
        this.showInviteModal = false;
        this.notify.success(res?.msg || `Registration invite sent to ${email}.`);
      },
      error: (err) => {
        this.inviteSending = false;
        this.inviteError = err?.error?.msg || err?.error?.message || 'Failed to send invite. Please try again.';
      },
    });
  }
}
