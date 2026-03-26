//src/app/components/admin-dashboard/admin-dashboard.component.ts

import { Component, OnInit, TrackByFunction } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { Router, RouterModule } from '@angular/router';
import { jwtDecode } from 'jwt-decode';
import { HttpClient, HttpClientModule } from '@angular/common/http';
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
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

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

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    HttpClientModule,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MaterialModule,
    NgChartsModule,
    RouterModule,
    BulkStudentUploadComponent
  ],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.css']
})

export class AdminDashboardComponent implements OnInit {
  students: any[] = [];          // original data
  filteredStudents: any[] = [];  // shown in table
  selectedStudentIds = new Set<string>();
  selectAll = false;

  loading = false;
  error = '';
  filters = { level: '', plan: '', batch: '', assignedTeacher: '', studentStatus: '', studentName: '', teacherName: '' };
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

  // Bulk upload
  showBulkUpload = false;

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
    private feedbackService: FeedbackService,
    private dialog: MatDialog,
    private teacherService: TeacherService,
  ) {}

  ngOnInit(): void {
    // ✅ Check user profile from backend (cookie included automatically)
    this.authService.getUserProfile().subscribe({
      next: (user) => {
        if (user.role !== 'ADMIN' && user.role !== 'TEACHER_ADMIN') {
          this.router.navigate(['/dashboard']);
          return;
        }
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
    return this.students.length;
  }
  
  fetchStudents(): void {
    this.loading = true;

    this.http.get<{ success: boolean; data: Student[] }>(`${apiUrl}/admin/students`, { withCredentials: true }).subscribe({
      next: res => {
        if (res.success) {
          this.students = res.data;
          this.students.forEach(student => {
            //this.loadFeedbackStats(student);
            this.loadCourseProgress(student);
            //console.log('Student data:', student);
          });
          this.filteredStudents = [...this.students];
          this.filteredStudentCount = this.students.length;
          
          // Extract student names for autocomplete
          this.allStudentNames = this.students
            .map(s => s.name)
            .filter((name, index, self) => name && self.indexOf(name) === index)
            .sort();
          
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

    // ✅ Fetch all registered teachers
    fetchTeachers(): void {
      this.teacherService.getAllTeachers()
        .subscribe({
          next: (res) => {
            if (res.success) {
              this.teachers = res.data;
              
              // Extract teacher names for autocomplete
              this.allTeacherNames = this.teachers
                .map(t => t.name)
                .filter((name, index, self) => name && self.indexOf(name) === index)
                .sort();
              
              // Setup autocomplete filtering
              this.filteredTeacherNames = this.teacherNameControl.valueChanges.pipe(
                startWith(''),
                map(value => this._filterTeacherNames(value || ''))
              );
            } else {
              alert('Failed to load teachers');
            }
          },
          error: (err) => {
            //console.error('Error fetching teachers:', err);
          }
        });
    }

  filteredStudentCount: number = 0;

  applyFilters() {
    this.filteredStudents = this.students.filter(student => {
      const course = student.courseAssigned ? student.courseAssigned.toLowerCase() : '';
      const plan   = student.subscription ? student.subscription.toUpperCase() : '';
      const status = student.studentStatus ? student.studentStatus.toLowerCase() : '';
      const assignedTeacherName =
      typeof student.assignedTeacher === 'object' && student.assignedTeacher !== null
        ? (student.assignedTeacher.name?.toLowerCase() || '')
        : (student.assignedTeacher?.toLowerCase() || '');
      const studentName = student.name ? student.name.toLowerCase() : '';

      return (
        (!this.filters.level || student.level === this.filters.level) &&
        (!this.filters.plan   || plan === this.filters.plan.toUpperCase()) &&
        (!this.filters.batch || student.batch === this.filters.batch.toString()) &&
        (!this.filters.assignedTeacher || assignedTeacherName === this.filters.assignedTeacher.toLowerCase()) &&
        (!this.filters.studentStatus || status === this.filters.studentStatus.toLowerCase()) &&
        (!this.filters.studentName || studentName.includes(this.filters.studentName.toLowerCase())) &&
        (!this.filters.teacherName || assignedTeacherName.includes(this.filters.teacherName.toLowerCase()))
      );
    });

    this.filteredStudentCount = this.filteredStudents.length;
  }

  clearFilters() {
    this.filters = { level: '', plan: '', batch: '', assignedTeacher: '', studentStatus: '', studentName: '', teacherName: '' };
    this.studentNameControl.setValue('');
    this.teacherNameControl.setValue('');
    this.applyFilters();
  }
  
  private _filterStudentNames(value: string): string[] {
    const filterValue = value.toLowerCase();
    return this.allStudentNames.filter(name => 
      name.toLowerCase().includes(filterValue)
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
    this.applyFilters();
  }
  
  onTeacherNameSelected(teacherName: string): void {
    this.filters.teacherName = teacherName;
    this.applyFilters();
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
      alert('Please select at least one student');
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
      alert('Please select at least one student to delete');
      return;
    }

    const studentIds = Array.from(this.selectedStudentIds);
    const count = studentIds.length;

    const confirmMessage = `⚠️ WARNING: You are about to permanently delete ${count} student(s).\n\nThis action cannot be undone and will remove:\n- Student account\n- All progress data\n- All session records\n- All associated data\n\nAre you absolutely sure you want to continue?`;
    
    if (!confirm(confirmMessage)) {
      return;
    }

    // Double confirmation for safety
    const doubleConfirm = confirm(`Final confirmation: Delete ${count} student(s)?`);
    if (!doubleConfirm) {
      return;
    }

    console.log('🗑️ [BULK DELETE] Deleting students:', studentIds);

    this.http.post(`${apiUrl}/admin/bulk-delete`, { studentIds }, { withCredentials: true })
      .subscribe({
        next: (res: any) => {
          console.log('✅ [BULK DELETE] SUCCESS:', res);
          alert(`✅ Successfully deleted ${count} student(s)`);
          this.selectedStudentIds.clear();
          this.selectAll = false;
          this.fetchStudents();
        },
        error: (err: any) => {
          console.error('❌ [BULK DELETE] FAILED:', err);
          const errorMessage = err.error?.message || err.message || 'Bulk delete failed';
          alert(`❌ Bulk Delete Failed:\n\n${errorMessage}`);
        }
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
      alert('Please select at least one field to update');
      return;
    }

    const confirmMessage = `Are you sure you want to update ${studentIds.length} student(s)?`;
    if (!confirm(confirmMessage)) return;

    console.log('🔍 [BULK UPDATE] Sending request to backend...');

    this.http.post(`${apiUrl}/admin/bulk-update`, { studentIds, updates }, { withCredentials: true })
      .subscribe({
        next: (res: any) => {
          console.log('✅ [BULK UPDATE] SUCCESS:', res);
          alert(res.message || 'Bulk update successful');
          this.selectedStudentIds.clear();
          this.selectAll = false;
          this.closeBulkEditPanel();
          this.fetchStudents();
        },
        error: err => {
          console.error('❌ [BULK UPDATE] FAILED:', err);
          console.error('❌ [BULK UPDATE] Status:', err.status);
          console.error('❌ [BULK UPDATE] Status Text:', err.statusText);
          console.error('❌ [BULK UPDATE] Error Body:', err.error);
          console.error('❌ [BULK UPDATE] Full Error Object:', JSON.stringify(err, null, 2));
          
          // Show detailed error message
          const errorMessage = err.error?.message || err.message || 'Bulk update failed';
          alert(`Bulk Update Failed:\n\n${errorMessage}\n\nCheck browser console for details (F12)`);
        }
      });
  }

  bulkAssign(): void {
    if (!this.bulkCourseName || !this.bulkAssistantId || !this.bulkApiKey) {
      alert('All fields are required for bulk assignment.');
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
        alert('Bulk assignment successful');
        this.selectedStudentIds.clear();
        this.fetchStudents();
      },
      error: err => {
        //console.error('Bulk assignment failed', err);
        alert('Bulk assignment failed');
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
        alert(`Course and VAPI key assigned to ${student.name}`);
        this.fetchStudents();
      },
      error: err => {
        alert('Failed to assign course');
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
      alert('No feedback to export.');
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
    if (!confirm('Are you sure you want to reset monthly usage for all students?')) return;
    this.http.post('/api/admin/reset-monthly-usage', {}).subscribe({
      next: (res: any) => {
        alert(res.message || 'Monthly usage reset.');
        this.fetchStudents();
      },
      error: err => {
        alert('Failed to reset usage.');
      }
    });
  }

  deleteUser(id: string): void {
    if (confirm('Are you sure you want to delete this user?')) {
      this.authService.deleteUser(id).subscribe({
        next: (response) => {
          alert('User deleted successfully!');
          this.fetchStudents(); // Refresh your user list after deletion
        },
        error: (error) => {
          alert('Failed to delete user: ' + (error.error?.message || 'Please try again.'));
        }
      });
    }
  }

  updateAssignedTeacherByBatchNo(batchNo: string, teacherId: string): void {
    this.authService.updateAssignedTeacherByBatchNo(batchNo, teacherId).subscribe({
      next: (response) => {
        alert('Assigned teacher updated successfully for batch ' + batchNo);
        this.fetchStudents(); // Refresh your user list after update
      },
      error: (error) => {
        alert('Failed to update assigned teacher: ' + (error.error?.message || 'Please try again.'));
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
    if (!confirm(`Are you sure you want to resend credentials to ${student.name}?\n\nThis will generate a new password and send it to ${student.email}`)) {
      return;
    }

    this.resendingCredentials[student._id] = true;

    this.authService.resendCredentials(student._id).subscribe({
      next: (response: any) => {
        alert(`✅ Credentials email sent successfully to ${student.name}!\n\nThe student will receive their new login details at ${student.email}`);
        
        // Update the student's lastCredentialsEmailSent in the local array
        const studentIndex = this.students.findIndex(s => s._id === student._id);
        if (studentIndex !== -1) {
          this.students[studentIndex].lastCredentialsEmailSent = response.lastSent;
        }
        
        // Also update in filtered students
        const filteredIndex = this.filteredStudents.findIndex(s => s._id === student._id);
        if (filteredIndex !== -1) {
          this.filteredStudents[filteredIndex].lastCredentialsEmailSent = response.lastSent;
        }
        
        this.resendingCredentials[student._id] = false;
      },
      error: (error: any) => {
        console.error('Error resending credentials:', error);
        alert(`❌ Failed to send credentials email.\n\nError: ${error.error?.msg || error.message || 'Unknown error'}\n\nPlease try again.`);
        this.resendingCredentials[student._id] = false;
      }
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

  exportSelectedStudents(): void {
    if (this.selectedStudentIds.size === 0) {
      alert('Please select at least one student to export');
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

    alert(`✅ Successfully exported ${selectedStudents.length} student(s) to CSV`);
  }
}
