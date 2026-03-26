// src/app/components/meeting-link/create-zoom-meeting.component.ts

import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ZoomService, Student } from '../../services/zoom.service';
import { AuthService } from '../../services/auth.service';

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
  
  // UI state
  isLoading = false;
  isCreatingMeeting = false;
  showStudentSelector = false;
  successMessage = '';
  errorMessage = '';
  zoomNotConfigured = false;
  
  // Filter options
  batches: string[] = [];
  plan: 'SILVER' | 'PLATINUM' | '' = '';
  levels: string[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  
  // Search
  searchTerm = '';

  constructor(
    private fb: FormBuilder,
    private zoomService: ZoomService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initializeForm();
    this.loadStudents();
    this.checkZoomConfig();
  }

  private checkZoomConfig(): void {
    this.authService.getUserProfile().subscribe({
      next: (user) => {
        if (!user.zoomHostEmail) {
          this.zoomNotConfigured = true;
        }
      }
    });
  }

  private initializeForm(): void {
    // Set default start time to tomorrow at 10:00 AM
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
      agenda: ['']
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
          
          // Extract unique batches
          this.batches = [...new Set(this.allStudents.map(s => s.batch))].sort();
          
          console.log(`✅ Loaded ${this.allStudents.length} students`);
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('❌ Error loading students:', error);
        this.errorMessage = 'Failed to load students';
        this.isLoading = false;
      }
    });
  }

  onFilterChange(): void {
    // const selectedBatch = this.meetingForm.get('batch')?.value;
    // if (selectedBatch) {
    this.selectedStudents = [];
    this.filterStudents();
    //}
  }

  filterStudents(): void {
    const batch = this.meetingForm.get('batch')?.value;
    const plan = this.meetingForm.get('plan')?.value;

    this.filteredStudents = this.allStudents.filter(student => {
      const matchesBatch = !batch || student.batch === batch;
      const matchesPlan = !plan || student.subscription === plan;
      const matchesStatus = student.studentStatus === 'ONGOING'; // ✅ filter only ongoing students

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
      // Remove student
      this.selectedStudents.splice(index, 1);
    } else {
      // Add student
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
    
    // Convert datetime-local to ISO string
    const startTime = new Date(formValue.startTime).toISOString();

    const meetingData = {
      batch: formValue.batch,
      plan: formValue.plan,
      topic: formValue.topic,
      startTime: startTime,
      duration: formValue.duration,
      timezone: formValue.timezone,
      agenda: formValue.agenda || `German Language Class - Batch ${formValue.batch}`,
      studentIds: this.selectedStudents.map(s => s._id)
    };

    console.log('📤 Creating Zoom meeting:', meetingData);

    this.zoomService.createMeeting(meetingData).subscribe({
      next: (response) => {
        if (response.success) {
          this.isCreatingMeeting = false;
          
          // Check email status
          const emailStatus = response.emailStatus;
          
          if (emailStatus.allSent) {
            // All emails sent successfully
            this.successMessage = `✅ Zoom meeting created successfully with ${response.data.attendeesCount} students! All invitation emails sent.`;
          } else if (emailStatus.totalFailure) {
            // All emails failed
            this.errorMessage = `⚠️ Meeting created but NO invitation emails were sent to students. Please check your email configuration.`;
            this.successMessage = `Meeting created successfully but emails failed. Meeting ID: ${response.data.zoomMeetingId}`;
          } else if (emailStatus.partialFailure) {
            // Some emails failed
            this.errorMessage = `⚠️ Meeting created but ${emailStatus.failed} out of ${emailStatus.attempted} invitation emails failed to send.`;
            this.successMessage = `Meeting created. ${emailStatus.successful} emails sent successfully, ${emailStatus.failed} failed.`;
          } else {
            // Default success
            this.successMessage = `✅ Zoom meeting created successfully with ${response.data.attendeesCount} students!`;
          }
          
          console.log('✅ Meeting created:', response.data);
          console.log('📧 Email Status:', emailStatus);
          
          // Show failed students if any
          if (emailStatus.failedStudents && emailStatus.failedStudents.length > 0) {
            console.error('❌ Failed to send emails to:', emailStatus.failedStudents);
          }
          
          // Redirect after 4 seconds (longer to read error message)
          setTimeout(() => {
            this.router.navigate(['/teacher/meetings']);
          }, 4000);
        } else {
          this.errorMessage = response.message || 'Failed to create meeting';
          this.isCreatingMeeting = false;
        }
      },
      error: (error) => {
        console.error('❌ Error creating meeting:', error);
        this.errorMessage = error.error?.message || 'Failed to create Zoom meeting. Please check your Zoom API credentials.';
        this.isCreatingMeeting = false;
      }
    });
  }

  cancel(): void {
    this.router.navigate(['/teacher/meetings']);
  }
}
