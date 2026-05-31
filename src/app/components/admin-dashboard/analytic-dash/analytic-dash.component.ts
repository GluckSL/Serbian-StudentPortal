// Sales CRM grid — full Monday-synced student fields (separate route from Directory).

import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../../services/auth.service';
import { Router, RouterModule } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MaterialModule } from '../../../shared/material.module';
import { TeacherService } from '../../../services/teacher.service';
import { environment } from '../../../../environments/environment';
import { BulkStudentUploadComponent } from '../bulk-student-upload.component';
import { TestAccountBadgeComponent } from '../../../shared/test-account-badge/test-account-badge.component';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { NotificationService } from '../../../services/notification.service';

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

@Component({
  selector: 'app-analytic-dash',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MaterialModule,
    RouterModule,
    BulkStudentUploadComponent,
    TestAccountBadgeComponent
  ],
  templateUrl: './analytic-dash.component.html',
  styleUrls: ['./analytic-dash.component.css']
})

export class AnalyticDashComponent implements OnInit {
  students: any[] = [];          // original data
  filteredStudents: any[] = [];  // shown in table
  selectedStudentIds = new Set<string>();
  selectAll = false;

  loading = false;
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

  /** CRM table: optional columns (checkbox/reg/name/actions always shown) */
  private readonly analyticColumnPrefKey = 'analyticDashCrmColumnVisibility';
  readonly crmOptionalColumns: { id: string; label: string }[] = [
    { id: 'email', label: 'Email' },
    { id: 'phone', label: 'Phone' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'address', label: 'Address' },
    { id: 'age', label: 'Age' },
    { id: 'leadSource', label: 'Lead source' },
    { id: 'docPayment', label: 'Documentation payment status' },
    { id: 'enrollment', label: 'Enrollment' },
    { id: 'servicesOpted', label: 'Service opted' },
    { id: 'subscription', label: 'Package' },
    { id: 'languageLevelOpted', label: 'Language level opted' },
    { id: 'level', label: 'Current level' },
    { id: 'batch', label: 'Batch' },
    { id: 'medium', label: 'Medium' },
    { id: 'otherLanguage', label: 'Other language' },
    { id: 'qualifications', label: 'Qualification' },
    { id: 'stream', label: 'Stream' },
    { id: 'batchStarted', label: 'Batch started' },
    { id: 'teacherIncharge', label: 'Teacher in charge (CRM)' },
    { id: 'assignedTeacher', label: 'Assigned teacher' },
    { id: 'studentStatus', label: 'Status' },
    { id: 'dateWithdrew', label: 'Date withdrew' },
    { id: 'reasonWithdrawal', label: 'Reason withdrawal' },
    { id: 'languageExamStatus', label: 'Language exam status' },
    { id: 'examPassed', label: 'Exam passed' },
    { id: 'examReading', label: 'Reading score' },
    { id: 'examListening', label: 'Listening score' },
    { id: 'examWriting', label: 'Writing score' },
    { id: 'examSpeaking', label: 'Speaking score' },
    { id: 'examRemark', label: 'Exam remark' },
    { id: 'candidateStatus', label: 'Candidate status' },
    { id: 'a1Start', label: 'A1 start' },
    { id: 'a1End', label: 'A1 end' },
    { id: 'a2Start', label: 'A2 start' },
    { id: 'a2End', label: 'A2 end' },
    { id: 'b1Start', label: 'B1 start' },
    { id: 'b1End', label: 'B1 end' },
    { id: 'b2Start', label: 'B2 start' },
    { id: 'b2End', label: 'B2 end' },
    { id: 'lastCredentials', label: 'Last credentials' },
    { id: 'registered', label: 'Registered' }
  ];
  columnVisibility: Record<string, boolean> = {};

  // Bulk upload
  showBulkUpload = false;

  toggleFiltersPanel(): void {
    this.filtersPanelOpen = !this.filtersPanelOpen;
  }

  initAnalyticColumnVisibility(): void {
    let saved: Record<string, boolean> | null = null;
    try {
      const raw = localStorage.getItem(this.analyticColumnPrefKey);
      if (raw) saved = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    this.columnVisibility = {};
    for (const c of this.crmOptionalColumns) {
      const v = saved?.[c.id];
      this.columnVisibility[c.id] = typeof v === 'boolean' ? v : true;
    }
  }

  isCrmColVisible(id: string): boolean {
    return !!this.columnVisibility[id];
  }

  toggleCrmColumn(id: string, visible: boolean): void {
    this.columnVisibility[id] = visible;
    try {
      localStorage.setItem(this.analyticColumnPrefKey, JSON.stringify(this.columnVisibility));
    } catch {
      /* ignore */
    }
  }

  showAllCrmColumns(): void {
    for (const c of this.crmOptionalColumns) {
      this.columnVisibility[c.id] = true;
    }
    try {
      localStorage.setItem(this.analyticColumnPrefKey, JSON.stringify(this.columnVisibility));
    } catch {
      /* ignore */
    }
  }

  get visibleCrmColumnCount(): number {
    return this.crmOptionalColumns.filter((c) => this.isCrmColVisible(c.id)).length;
  }

  /** Advanced filter: pick any CRM field, then a value from distinct list in DB */
  advancedFilterExpanded = false;
  advancedFieldInputControl = new FormControl('', { nonNullable: true });
  filteredAdvancedFields$!: Observable<{ id: string; label: string }[]>;
  readonly advancedFilterFieldList: { id: string; label: string }[] = [
    { id: 'level', label: 'Level (CEFR / course)' },
    { id: 'subscription', label: 'Plan / Package' },
    { id: 'batch', label: 'Batch' },
    { id: 'studentStatus', label: 'Student status' },
    { id: 'servicesOpted', label: 'Service opted' },
    { id: 'qualifications', label: 'Qualification' },
    { id: 'languageLevelOpted', label: 'Language level opted' },
    { id: 'leadSource', label: 'Lead source' },
    { id: 'stream', label: 'Stream' },
    { id: 'teacherIncharge', label: 'Teacher in charge (CRM)' },
    { id: 'otherLanguageKnown', label: 'Other language known' },
    { id: 'documentationPaymentStatus', label: 'Documentation payment status' },
    { id: 'languageExamStatus', label: 'Language exam status' },
    { id: 'candidateStatus', label: 'Candidate status' },
    { id: 'phoneNumber', label: 'Phone' },
    { id: 'whatsappNumber', label: 'WhatsApp' },
    { id: 'address', label: 'Address' },
    { id: 'medium', label: 'Medium' },
    { id: 'age', label: 'Age' }
  ];
  selectedAdvancedField: { id: string; label: string } | null = null;
  advancedDistinctValues: string[] = [];
  advancedPendingValue = '';
  loadingAdvancedDistinct = false;
  appliedAdvField = '';
  appliedAdvValue = '';

  toggleAdvancedFilterPanel(): void {
    this.advancedFilterExpanded = !this.advancedFilterExpanded;
  }

  private filterAdvancedFieldList(input: unknown): { id: string; label: string }[] {
    const q =
      typeof input === 'string'
        ? input.toLowerCase().trim()
        : '';
    if (!q) return [...this.advancedFilterFieldList];
    return this.advancedFilterFieldList.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        f.id.toLowerCase().includes(q)
    );
  }

  onAdvancedFieldOptionSelected(f: { id: string; label: string }): void {
    this.selectedAdvancedField = f;
    this.advancedFieldInputControl.setValue(f.label, { emitEvent: false });
    this.advancedPendingValue = '';
    this.advancedDistinctValues = [];
    this.loadDistinctValuesForField(f.id);
  }

  loadDistinctValuesForField(fieldKey: string): void {
    this.loadingAdvancedDistinct = true;
    this.advancedDistinctValues = [];
    this.http
      .get<{ success: boolean; values?: string[]; message?: string }>(
        `${apiUrl}/admin/students/distinct/${encodeURIComponent(fieldKey)}`,
        { withCredentials: true }
      )
      .subscribe({
        next: (res) => {
          this.loadingAdvancedDistinct = false;
          if (res.success) {
            this.advancedDistinctValues = res.values ?? [];
          } else {
            this.notify.error(res.message || 'Could not load values');
          }
        },
        error: () => {
          this.loadingAdvancedDistinct = false;
          this.notify.error('Could not load values for this field');
        }
      });
  }

  applyAdvancedFilter(): void {
    if (!this.selectedAdvancedField) {
      this.notify.warning('Choose a field first (type to search, then pick from the list)');
      return;
    }
    if (!this.advancedPendingValue || String(this.advancedPendingValue).trim() === '') {
      this.notify.warning('Choose a value from the dropdown');
      return;
    }
    this.appliedAdvField = this.selectedAdvancedField.id;
    this.appliedAdvValue = String(this.advancedPendingValue).trim();
    this.fetchStudents(1);
  }

  clearAdvancedFilter(): void {
    this.appliedAdvField = '';
    this.appliedAdvValue = '';
    this.selectedAdvancedField = null;
    this.advancedDistinctValues = [];
    this.advancedPendingValue = '';
    this.advancedFieldInputControl.setValue('');
    this.fetchStudents(this.currentPage);
  }

  get appliedAdvancedFilterSummary(): string {
    if (!this.appliedAdvField || !this.appliedAdvValue) return '';
    const f = this.advancedFilterFieldList.find((x) => x.id === this.appliedAdvField);
    const label = f?.label || this.appliedAdvField;
    return `${label}: ${this.appliedAdvValue}`;
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


  constructor(
    private authService: AuthService,
    private router: Router,
    private http: HttpClient,
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
        this.initAnalyticColumnVisibility();
        this.filteredAdvancedFields$ = this.advancedFieldInputControl.valueChanges.pipe(
          startWith(''),
          map((v) => this.filterAdvancedFieldList(v))
        );
        this.fetchFilterOptions();
        this.fetchStudents();
        this.fetchTeachers();
      },
      error: (err) => {
        //console.error('Not authenticated:', err);
        this.router.navigate(['/auth/login']);
      }
    });
  }

  totalStudentsCount(): number {
    return this.totalStudents;
  }

  hasActiveStudentFilters(): boolean {
    const f = this.filters;
    return !!(
      f.level || f.plan || f.batch || f.studentStatus || f.studentName || f.teacherName ||
      f.servicesOpted || f.qualifications || f.languageLevelOpted ||
      f.phoneCountry || f.loginCountry || this.appliedAdvField
    );
  }

  displayStudentCount(): number {
    return this.hasActiveStudentFilters() ? this.filteredStudentCount : this.totalStudentsCount();
  }

  fetchStudents(page: number = this.currentPage): void {
    this.loading = true;
    this.currentPage = page;

    let params = new HttpParams()
      .set('page', String(this.currentPage))
      .set('limit', String(this.pageSize));

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
    if (this.appliedAdvField && this.appliedAdvValue) {
      params = params.set('advField', this.appliedAdvField).set('advValue', this.appliedAdvValue);
    }

    this.http.get<StudentListResponse>(`${apiUrl}/admin/students`, { params, withCredentials: true }).subscribe({
      next: res => {
        if (res.success) {
          this.students = res.data;
          this.students.forEach(student => {
            //this.loadFeedbackStats(student);
            this.loadCourseProgress(student);
            //console.log('Student data:', student);
          });
          this.filteredStudents = [...this.students];
          this.totalStudents = res.pagination?.total ?? this.students.length;
          this.currentPage = res.pagination?.page ?? this.currentPage;
          this.pageSize = res.pagination?.limit ?? this.pageSize;
          this.totalPages = res.pagination?.pages ?? 1;
          this.filteredStudentCount = this.totalStudents;
          this.selectAll = false;
          this.selectedStudentIds.clear();
          
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
        },
        error: () => {
          /* non-blocking */
        }
      });
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
    this.appliedAdvField = '';
    this.appliedAdvValue = '';
    this.selectedAdvancedField = null;
    this.advancedDistinctValues = [];
    this.advancedPendingValue = '';
    this.advancedFieldInputControl.setValue('');
    this.fetchStudents(1);
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
          }
          const filteredIndex = this.filteredStudents.findIndex(s => s._id === student._id);
          if (filteredIndex !== -1) {
            this.filteredStudents[filteredIndex].lastCredentialsEmailSent = response.lastSent;
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

  formatDate(date: Date | string | null | undefined): string {
    if (!date) return 'Never sent';
    
    try {
      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) return 'Never sent';
      
      return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return 'Never sent';
    }
  }

  formatCrmDate(date: Date | string | null | undefined): string {
    if (!date) return '—';
    try {
      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) return '—';
      return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return '—';
    }
  }

  mediumDisplay(student: any): string {
    const m = student?.medium;
    if (m == null || m === '') return '—';
    if (Array.isArray(m)) return m.length ? m.join(', ') : '—';
    return String(m);
  }

  examScore(student: any, key: 'reading' | 'listening' | 'writing' | 'speaking'): string {
    const v = student?.examScores?.[key];
    if (v === null || v === undefined || v === '') return '—';
    return String(v);
  }

  courseDateCell(student: any, path: string): string {
    const parts = path.split('.');
    let cur: any = student;
    for (const p of parts) {
      cur = cur?.[p];
    }
    return this.formatCrmDate(cur);
  }

  assignedTeacherDisplay(student: any): string {
    const t = student?.assignedTeacher;
    if (t && typeof t === 'object') return t.name || '—';
    return 'Unassigned';
  }

  exportSelectedStudents(): void {
    if (this.selectedStudentIds.size === 0) {
      this.notify.warning('Please select at least one student to export');
      return;
    }

    // Get selected students data
    const selectedStudents = this.students.filter(student => 
      this.selectedStudentIds.has(student._id)
    );

    // Define CSV headers (all 13 fields from Monday.com CRM + additional fields)
    const headers = [
      'RegNo',
      'Name',
      'Email',
      'Level',
      'Subscription',
      'Student Status',
      'Batch',
      'Medium',
      'Phone Number',
      'Address',
      'Age',
      'Program Enrolled',
      'Lead Source',
      'Documentation Payment Status',
      'Assigned Teacher',
      'Created At',
      'Last Credentials Sent'
    ];

    // Build CSV rows
    const rows = selectedStudents.map(student => {
      const teacherName = typeof student.assignedTeacher === 'object' 
        ? student.assignedTeacher?.name || 'Unassigned'
        : student.assignedTeacher || 'Unassigned';

      return [
        student.regNo || 'N/A',
        student.name || 'N/A',
        student.email || 'N/A',
        student.level || 'N/A',
        student.subscription || 'N/A',
        student.studentStatus || 'N/A',
        student.batch || 'N/A',
        student.medium || 'N/A',
        (student as any).phoneNumber || 'N/A',
        (student as any).address || 'N/A',
        (student as any).age || 'N/A',
        (student as any).servicesOpted || 'N/A',
        (student as any).leadSource || 'N/A',
        (student as any).documentationPaymentStatus || 'N/A',
        teacherName,
        student.registeredAt ? new Date(student.registeredAt).toLocaleDateString() : 'N/A',
        this.formatDate(student.lastCredentialsEmailSent)
      ];
    });

    // Create CSV content
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(value => `"${value}"`).join(','))
    ].join('\n');

    // Download CSV file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `students_export_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    this.notify.success(`Successfully exported ${selectedStudents.length} student(s) to CSV`);
  }
}
