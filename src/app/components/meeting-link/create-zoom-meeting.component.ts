// src/app/components/meeting-link/create-zoom-meeting.component.ts

import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ZoomService, Student, Teacher, ZoomAccount } from '../../services/zoom.service';

@Component({
  selector: 'app-create-zoom-meeting',
  standalone: true,
  templateUrl: './create-zoom-meeting.component.html',
  styleUrls: ['./create-zoom-meeting.component.css'],
  imports: [CommonModule, ReactiveFormsModule]
})
export class CreateZoomMeetingComponent implements OnInit {
  meetingForm!: FormGroup;
  
  // Student selection
  allStudents: Student[] = [];
  filteredStudents: Student[] = [];
  selectedStudents: Student[] = [];
  
  // Teacher & Zoom account selection
  teachers: Teacher[] = [];
  zoomAccounts: ZoomAccount[] = [];

  // UI state
  isLoading = false;
  isCreatingMeeting = false;
  successMessage = '';
  errorMessage = '';
  
  // Filter options
  batches: string[] = [];
  levels: string[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  
  // Search
  searchTerm = '';

  constructor(
    private fb: FormBuilder,
    private zoomService: ZoomService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initializeForm();
    this.loadStudents();
    this.loadTeachers();
    this.loadZoomAccounts();
  }

  private initializeForm(): void {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    
    this.meetingForm = this.fb.group({
      batch: ['', Validators.required],
      plan: ['', Validators.required],
      topic: ['', [Validators.required, Validators.minLength(3)]],
      startTime: [this.formatDateTimeLocal(tomorrow), Validators.required],
      duration: [60, [Validators.required, Validators.min(15), Validators.max(300)]],
      timezone: ['Asia/Colombo', Validators.required],
      agenda: [''],
      teacherId: ['', Validators.required],
      zoomHostEmail: ['', Validators.required],
      courseDay: [null, [Validators.min(1), Validators.max(200)]]
    });
  }

  private formatDateTimeLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  loadStudents(): void {
    this.isLoading = true;
    this.zoomService.getAllStudents().subscribe({
      next: (response) => {
        if (response.success) {
          this.allStudents = response.data;
          this.filteredStudents = [...this.allStudents];
          this.batches = [...new Set(this.allStudents.map(s => s.batch))].sort();
        }
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load students';
        this.isLoading = false;
      }
    });
  }

  loadTeachers(): void {
    this.zoomService.getTeachers().subscribe({
      next: (response) => {
        if (response.success) {
          this.teachers = response.data;
        }
      },
      error: () => console.error('Failed to load teachers')
    });
  }

  loadZoomAccounts(): void {
    this.zoomService.getZoomHosts().subscribe({
      next: (response) => {
        if (response.success) {
          this.zoomAccounts = response.hosts;
        }
      },
      error: () => console.error('Failed to load zoom accounts')
    });
  }

  /** Re-check zoom account availability when time/duration changes */
  onTimeChange(): void {
    const startTime = this.meetingForm.get('startTime')?.value;
    const duration = this.meetingForm.get('duration')?.value;
    if (startTime && duration) {
      this.zoomService.getAvailableZoomHosts(new Date(startTime).toISOString(), duration).subscribe({
        next: (response) => {
          if (response.success) {
            this.zoomAccounts = response.data;
          }
        }
      });
    }
  }

  onFilterChange(): void {
    this.selectedStudents = [];
    this.filterStudents();
  }

  filterStudents(): void {
    const batch = this.meetingForm.get('batch')?.value;
    const plan = this.meetingForm.get('plan')?.value;

    this.filteredStudents = this.allStudents.filter(student => {
      const matchesBatch = !batch || student.batch === batch;
      const matchesPlan = !plan || student.subscription === plan;
      const matchesStatus = student.studentStatus === 'ONGOING';
      const matchesSearch = !this.searchTerm ||
        student.name.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        student.email.toLowerCase().includes(this.searchTerm.toLowerCase());
      return matchesBatch && matchesPlan && matchesStatus && matchesSearch;
    });
  }

  onSearchChange(event: any): void {
    this.searchTerm = event.target.value;
    this.filterStudents();
  }

  toggleStudentSelection(student: Student): void {
    const index = this.selectedStudents.findIndex(s => s._id === student._id);
    if (index > -1) {
      this.selectedStudents.splice(index, 1);
    } else {
      this.selectedStudents.push(student);
    }
  }

  isStudentSelected(student: Student): boolean {
    return this.selectedStudents.some(s => s._id === student._id);
  }

  selectAllFiltered(): void {
    this.filteredStudents.forEach(student => {
      if (!this.isStudentSelected(student)) {
        this.selectedStudents.push(student);
      }
    });
  }

  deselectAll(): void {
    this.selectedStudents = [];
  }

  removeSelectedStudent(student: Student): void {
    const index = this.selectedStudents.findIndex(s => s._id === student._id);
    if (index > -1) {
      this.selectedStudents.splice(index, 1);
    }
  }

  onSubmit(): void {
    if (this.meetingForm.invalid) {
      this.meetingForm.markAllAsTouched();
      this.errorMessage = 'Please fill in all required fields';
      return;
    }

    if (this.selectedStudents.length === 0) {
      this.errorMessage = 'Please select at least one student';
      return;
    }

    this.isCreatingMeeting = true;
    this.successMessage = '';
    this.errorMessage = '';

    const formValue = this.meetingForm.value;
    const startTime = new Date(formValue.startTime).toISOString();

    const meetingData = {
      batch: formValue.batch,
      plan: formValue.plan,
      topic: formValue.topic,
      startTime,
      duration: formValue.duration,
      timezone: formValue.timezone,
      agenda: formValue.agenda || `German Language Class - Batch ${formValue.batch}`,
      studentIds: this.selectedStudents.map(s => s._id),
      teacherId: formValue.teacherId,
      zoomHostEmail: formValue.zoomHostEmail,
      courseDay: formValue.courseDay || null
    };

    this.zoomService.createMeeting(meetingData).subscribe({
      next: (response) => {
        if (response.success) {
          this.isCreatingMeeting = false;
          const emailStatus = response.emailStatus;
          
          if (emailStatus.allSent) {
            this.successMessage = `✅ Zoom meeting created successfully with ${response.data.attendeesCount} students! All invitation emails sent.`;
          } else if (emailStatus.totalFailure) {
            this.errorMessage = `⚠️ Meeting created but NO invitation emails were sent.`;
            this.successMessage = `Meeting created successfully but emails failed. Meeting ID: ${response.data.zoomMeetingId}`;
          } else if (emailStatus.partialFailure) {
            this.errorMessage = `⚠️ Meeting created but ${emailStatus.failed} out of ${emailStatus.attempted} invitation emails failed.`;
            this.successMessage = `Meeting created. ${emailStatus.successful} emails sent, ${emailStatus.failed} failed.`;
          } else {
            this.successMessage = `✅ Zoom meeting created successfully with ${response.data.attendeesCount} students!`;
          }
          
          setTimeout(() => {
            this.router.navigate(['/teacher/meetings']);
          }, 4000);
        } else {
          this.errorMessage = response.message || 'Failed to create meeting';
          this.isCreatingMeeting = false;
        }
      },
      error: (error) => {
        this.errorMessage = error.error?.message || 'Failed to create Zoom meeting.';
        this.isCreatingMeeting = false;
      }
    });
  }

  cancel(): void {
    this.router.navigate(['/teacher/meetings']);
  }
}
