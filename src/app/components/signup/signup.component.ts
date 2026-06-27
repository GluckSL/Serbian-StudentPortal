//src/app/component/signup/signup.component.ts

import { Component, OnInit, ViewChild } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { CoursesService } from '../../services/courses.service';
import { NotificationService } from '../../services/notification.service';
import { environment } from '../../../environments/environment';

const DEFAULT_SERVICES_OPTED = [
  'Au Pair',
  'Ausbildung',
  'Dependant',
  'Doc Recognition',
  'Educational Programs',
  'Job Support',
  'Only for language',
  'Opportunity Card',
  'Semi Skilled Jobs',
  'Skilled Jobs',
  'Voluntary Jobs',
] as const;

const ADD_NEW_SERVICE_VALUE = '__ADD_NEW__';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.css']
})
export class SignupComponent implements OnInit {
  /** Silver-plan students may omit batch (e.g. GO Silver journey without a legacy batch label). */
  get isSilverStudent(): boolean {
    return String(this.subscription || '').toUpperCase() === 'SILVER';
  }

  /** Batches for dropdown — always includes the student's current value if set. */
  get studentBatchOptions(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (value: string) => {
      const v = String(value || '').trim();
      if (!v) return;
      const key = v.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(v);
    };
    for (const b of this.batchOptions) add(b);
    add(this.batch);
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  readonly addNewServiceValue = ADD_NEW_SERVICE_VALUE;

  get isCustomServicesOpted(): boolean {
    return this.servicesOptedSelection === ADD_NEW_SERVICE_VALUE;
  }

  /** Services for dropdown — defaults, portal values, and the student's current value. */
  get studentServicesOptedOptions(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (value: string) => {
      const v = String(value || '').trim();
      if (!v) return;
      const key = v.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(v);
    };
    for (const s of DEFAULT_SERVICES_OPTED) add(s);
    for (const s of this.servicesOptedOptions) add(s);
    add(this.loadedServicesOptedRaw);
    if (this.isCustomServicesOpted) add(this.customServicesOpted);
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  name: string = '';
  email: string = '';
  role: string = 'STUDENT'; // default role
  batch: string = '';
  batchOptions: string[] = [];
  medium: string | string[]  = '';
  conversationId: string = '';
  subscription: string = '';
  level: string = 'A1'; // default level
  studentStatus: string = 'UNCERTAIN'; // default status
  phoneNumber: string = '';
  address: string = '';
  age: number | null = null;
  servicesOpted: string = '';
  servicesOptedOptions: string[] = [];
  servicesOptedSelection = '';
  customServicesOpted = '';
  private loadedServicesOptedRaw = '';
  leadSource: string = '';
  languageLevelOpted: string = '';
  dateWithdrew: Date | null = null;
  reasonForWithdrawing: string = '';
  courseCompletionDates: {
    A1CompletionDate?: string | null;
    A2CompletionDate?: string | null;
    B1CompletionDate?: string | null;
    B2CompletionDate?: string | null;
  } = {};
  courseStartDates: {
    A1StartDate?: string | null;
    A2StartDate?: string | null;
    B1StartDate?: string | null;
    B2StartDate?: string | null;
  } = {};
  qualifications: string = '';
  
  // Teacher assignment
  assignedTeacher: string = '';   // ✅ selected teacher ID
  teachers: any[] = [];           // all fetched teachers

  // Teacher fields
  assignedCourses: string[] = []; // selected course IDs
  assignedBatches: string[] = []; // selected batches
  courses: any[] = []; // list fetched from backend

  isEditMode = false; // ✅ flag to track update mode
  studentId: string | null = null;
  validationErrors: string[] = [];

  @ViewChild('signupForm') signupFormRef?: NgForm;

  private readonly fieldLabels: Record<string, string> = {
    role: 'Role',
    name: 'Full Name',
    email: 'Email',
    servicesOptedCustom: 'Services Opted',
    languageLevelOpted: 'Language Level Opted',
    medium: 'Medium',
    subscription: 'Subscription Plan',
    batch: 'Batch',
    level: 'CEFR Level',
    studentStatus: 'Status',
    assignedTeacher: 'Assign Teacher',
    assignedBatches: 'Assigned Batches',
  };


  constructor(
    private authService: AuthService,
    private router: Router,
    private coursesService: CoursesService,
    private route: ActivatedRoute,
    private notify: NotificationService,
    private http: HttpClient,
  ) {}

  ngOnInit(): void {
    this.loadCourses();
    this.loadStudentFilterOptions();

    // Check if an ID is passed in route → Edit mode
    this.studentId = this.route.snapshot.paramMap.get('id');
    if (this.studentId) {
      this.isEditMode = true;
      this.loadUserById(this.studentId);
    }
  }
  // Fetch available courses from backend
  loadCourses() {
    this.coursesService.getCourses().subscribe({
      next: (data) => this.courses = data,
      error: (err) => console.error('Failed to load courses', err)
    });
  }

  loadStudentFilterOptions(): void {
    this.http
      .get<{ success: boolean; batches?: string[]; servicesOpted?: string[] }>(
        `${environment.apiUrl}/admin/students/filter-options`,
        { withCredentials: true },
      )
      .subscribe({
        next: (res) => {
          const batches = (res.batches ?? []).map((b) => String(b).trim()).filter(Boolean);
          this.batchOptions = batches.length ? batches : ['Unassigned'];
          if (!this.batchOptions.some((b) => b.toLowerCase() === 'unassigned')) {
            this.batchOptions = ['Unassigned', ...this.batchOptions];
          }

          this.servicesOptedOptions = (res.servicesOpted ?? [])
            .map((s) => String(s).trim())
            .filter(Boolean);
          this.applyServicesOptedUiState();
        },
        error: () => {
          this.batchOptions = ['Unassigned'];
          this.servicesOptedOptions = [];
          this.applyServicesOptedUiState();
        },
      });
  }

  onServicesOptedChange(value: string): void {
    if (value !== ADD_NEW_SERVICE_VALUE) {
      this.customServicesOpted = '';
    }
  }

  private applyServicesOptedUiState(): void {
    const value = String(this.loadedServicesOptedRaw || '').trim();
    if (!value) {
      this.servicesOptedSelection = '';
      this.customServicesOpted = '';
      this.servicesOpted = '';
      return;
    }

    const match = this.studentServicesOptedOptions.find(
      (option) => option.toLowerCase() === value.toLowerCase(),
    );
    if (match) {
      this.servicesOptedSelection = match;
      this.customServicesOpted = '';
      this.servicesOpted = match;
      return;
    }

    this.servicesOptedSelection = ADD_NEW_SERVICE_VALUE;
    this.customServicesOpted = value;
    this.servicesOpted = value;
  }

  private resolveServicesOpted(): string {
    if (this.servicesOptedSelection === ADD_NEW_SERVICE_VALUE) {
      return String(this.customServicesOpted || '').trim();
    }
    return String(this.servicesOptedSelection || '').trim();
  }

  // Load teachers dynamically when student selects level + medium
  loadTeachers() {
    if (this.level && this.medium) {
      this.authService.getTeachers(this.level, this.medium).subscribe({
        next: (data) => this.teachers = data,
        error: (err) => {
          this.teachers = [];
          console.error('Failed to load teachers', err);
        }
      });
    }
  }


  // ✅ Load existing user for update
  private loadUserById(id: string): void {
    this.authService.getUserById(id).subscribe({
      next: (data) => {
        this.name = data.name;
        this.email = data.email;
        this.role = data.role;  
        if (this.role === 'STUDENT') {
          this.batch = data.batch || '';
          this.medium = data.medium || '';
          this.subscription = data.subscription || '';
          this.level = data.level || 'A1';
          this.assignedTeacher = data.assignedTeacher || '';
          this.conversationId = data.conversationId || '';
          this.studentStatus = data.studentStatus || 'UNCERTAIN';
          this.phoneNumber = data.phoneNumber || '';
          this.address = data.address || '';
          this.age = data.age || null;
          this.loadedServicesOptedRaw = data.servicesOpted || data['programEnrolled'] || '';
          this.applyServicesOptedUiState();
          this.leadSource = data.leadSource || '';
          this.languageLevelOpted = data.languageLevelOpted || '';
          this.dateWithdrew = data.dateWithdrew || null;
          this.reasonForWithdrawing = data.reasonForWithdrawing || '';
          this.courseCompletionDates = {
            A1CompletionDate: data.courseCompletionDates?.A1CompletionDate
              ? new Date(data.courseCompletionDates.A1CompletionDate).toISOString().split('T')[0]
              : null,
            A2CompletionDate: data.courseCompletionDates?.A2CompletionDate
              ? new Date(data.courseCompletionDates.A2CompletionDate).toISOString().split('T')[0]
              : null,
            B1CompletionDate: data.courseCompletionDates?.B1CompletionDate
              ? new Date(data.courseCompletionDates.B1CompletionDate).toISOString().split('T')[0]
              : null,
            B2CompletionDate: data.courseCompletionDates?.B2CompletionDate
              ? new Date(data.courseCompletionDates.B2CompletionDate).toISOString().split('T')[0]
              : null
          };

          this.courseStartDates = {
            A1StartDate: data.courseStartDates?.A1StartDate
              ? new Date(data.courseStartDates.A1StartDate).toISOString().split('T')[0]
              : null,
            A2StartDate: data.courseStartDates?.A2StartDate
              ? new Date(data.courseStartDates.A2StartDate).toISOString().split('T')[0]
              : null,
            B1StartDate: data.courseStartDates?.B1StartDate
              ? new Date(data.courseStartDates.B1StartDate).toISOString().split('T')[0]
              : null,
            B2StartDate: data.courseStartDates?.B2StartDate
              ? new Date(data.courseStartDates.B2StartDate).toISOString().split('T')[0]
              : null
          };

          this.qualifications = data.qualifications || '';
          this.loadTeachers(); // load teachers for selected level + medium
        } else if (this.role === 'TEACHER' || this.role === 'TEACHER_ADMIN') {
          this.medium = data.medium || [];
          this.assignedCourses = data.assignedCourses?.map((c: any) => c._id || c) || [];
          this.assignedBatches = data['assignedBatches'] || [];
        }
      },
      error: (err) => {
        console.error('Failed to load user for edit', err);
      }
    });
  }

  onSubmit() {
    if (this.showValidationFeedback()) {
      return;
    }

    const user: any = {
      name: this.name,
      email: this.email,
      role: this.role,
    };

    if (this.role === 'STUDENT') {
      const batchTrim = String(this.batch || '').trim();
      user.batch = batchTrim || undefined;
      user.medium = this.medium;
      user.conversationId = this.conversationId;
      user.subscription = this.subscription;
      user.level = this.level;
      user.assignedTeacher = this.assignedTeacher;
      user.studentStatus = this.studentStatus;
      user.phoneNumber = this.phoneNumber;
      user.address = this.address;
      user.age = this.age;
      user.servicesOpted = this.resolveServicesOpted();
      user.leadSource = this.leadSource;
      user.languageLevelOpted = this.languageLevelOpted;
      user.dateWithdrew = this.dateWithdrew;
      user.reasonForWithdrawing = this.reasonForWithdrawing;
      user.courseCompletionDates = this.courseCompletionDates;
      user.courseStartDates = this.courseStartDates;
      user.qualifications = this.qualifications;
    }

    if (this.role === 'TEACHER' || this.role === 'TEACHER_ADMIN') {
      user.medium = this.medium;
      user.assignedCourses = this.assignedCourses;
      user.assignedBatches = this.assignedBatches;
    }

    // ✅ Decide whether to create or update
    if (this.isEditMode && this.studentId) {
      // UPDATE existing user
      this.authService.updateUser(this.studentId, user).subscribe({
        next: (response: any) => {
          this.notify.success('User updated successfully!');
          if (this.role === 'STUDENT') {
            this.router.navigate(['/admin-dashboard']);
            return;
          }
          this.router.navigate(['/teachers']);
        },
        error: (error: any) => {
          this.notify.error('Update failed: ' + (error.error?.message || 'Please try again later.'));
          console.error('Update failed', error);
        }
      });
    } else {
      // CREATE new user
      this.authService.signup(user).subscribe({
        next: (response: any) => {
          this.notify.success(user.role + ' Registered Successfully!');

          if (this.role === 'TEACHER' || this.role === 'TEACHER_ADMIN') {
            this.router.navigate(['/teachers']);
            return;
          }
          this.router.navigate(['/admin-dashboard']);
        },
        error: (error: any) => {
          this.notify.error('Registration failed: ' + (error.error?.message || 'Please try again later.'));
          console.error('Register failed', error);
        }
      });
    }

  }
  scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  onCourseChange(event: any, courseId: string) {
    if (event.target.checked) {
      this.assignedCourses.push(courseId);
    } else {
      this.assignedCourses = this.assignedCourses.filter(id => id !== courseId);
    }
  }

  onAssignedBatchesChange(value: string) {
    this.assignedBatches = value.split(',').map(batch => batch.trim());
  }

  private showValidationFeedback(): boolean {
    this.signupFormRef?.form.markAllAsTouched();

    const errors = this.collectValidationErrors();
    this.validationErrors = errors;

    if (!errors.length) {
      return false;
    }

    const message =
      errors.length === 1
        ? `Please complete: ${errors[0]}`
        : `Please complete the following fields: ${errors.join(', ')}`;
    this.notify.warning(message);
    this.scrollToFirstInvalid();
    return true;
  }

  private collectValidationErrors(): string[] {
    const errors: string[] = [];
    const form = this.signupFormRef?.form;

    if (form) {
      for (const [key, control] of Object.entries(form.controls)) {
        if (control.invalid) {
          errors.push(this.fieldLabels[key] || key);
        }
      }
    }

    if (this.role === 'TEACHER' || this.role === 'TEACHER_ADMIN') {
      if (this.assignedCourses.length === 0) {
        errors.push('Assign Courses');
      }
    }

    return [...new Set(errors)];
  }

  private scrollToFirstInvalid(): void {
    setTimeout(() => {
      const invalid = document.querySelector('.signup-card .ng-invalid');
      invalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }

}
