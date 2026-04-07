// src/app/components/meeting-link/create-zoom-meeting.component.ts

import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ZoomService, Student, Teacher, ZoomAccount } from '../../services/zoom.service';

@Component({
  selector: 'app-create-zoom-meeting',
  standalone: true,
  templateUrl: './create-zoom-meeting.component.html',
  styleUrls: ['./create-zoom-meeting.component.css'],
  imports: [CommonModule, ReactiveFormsModule, FormsModule]
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
  // Date-time modal state
  isStartTimeModalOpen = false;
  todayDate = this.getTodayDateString();
  draftDate = this.todayDate;
  draftHour = '10';
  draftMinute = '00';
  draftPeriod: 'AM' | 'PM' = 'AM';
  readonly hourOptions = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  readonly minuteOptions = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

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

  private getTodayDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseLocalDateTime(value: string | null | undefined): Date | null {
    if (!value) return null;
    const [datePart, timePart] = value.split('T');
    if (!datePart || !timePart) return null;
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);
    if (
      !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) ||
      !Number.isFinite(hours) || !Number.isFinite(minutes)
    ) {
      return null;
    }
    return new Date(year, month - 1, day, hours, minutes, 0, 0);
  }

  private to12HourParts(date: Date): { date: string; hour: string; minute: string; period: 'AM' | 'PM' } {
    let hour = date.getHours();
    const period: 'AM' | 'PM' = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return {
      date: this.getDateFromDate(date),
      hour: String(hour).padStart(2, '0'),
      minute: String(date.getMinutes()).padStart(2, '0'),
      period
    };
  }

  private getDateFromDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  get formattedStartTime(): string {
    const value = this.meetingForm?.get('startTime')?.value;
    const dt = this.parseLocalDateTime(value);
    if (!dt) return '';
    return `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}`;
  }

  openStartTimeModal(): void {
    const current = this.parseLocalDateTime(this.meetingForm.get('startTime')?.value);
    const initial = current || new Date();
    if (!current) {
      initial.setHours(10, 0, 0, 0);
    }
    const parts = this.to12HourParts(initial);
    const today = new Date(this.todayDate);
    const selectedDate = new Date(parts.date);
    this.draftDate = selectedDate < today ? this.todayDate : parts.date;
    this.draftHour = parts.hour;
    this.draftMinute = parts.minute;
    this.draftPeriod = parts.period;
    this.isStartTimeModalOpen = true;
  }

  closeStartTimeModal(): void {
    this.isStartTimeModalOpen = false;
  }

  setStartTimeFromModal(): void {
    const [year, month, day] = this.draftDate.split('-').map(Number);
    let hour24 = Number(this.draftHour) % 12;
    if (this.draftPeriod === 'PM') hour24 += 12;
    const minute = Number(this.draftMinute);

    const selected = new Date(year, month - 1, day, hour24, minute, 0, 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    if (selected < todayStart) {
      this.errorMessage = 'Please select today or a future date.';
      return;
    }

    const local = this.formatDateTimeLocal(selected);
    console.log('[StartTime Modal] Selected Date object:', selected);
    console.log('[StartTime Modal] Local wall-clock stored in form (YYYY-MM-DDTHH:mm):', local);
    this.meetingForm.patchValue({ startTime: local });
    this.meetingForm.get('startTime')?.markAsTouched();
    this.errorMessage = '';
    this.isStartTimeModalOpen = false;
    this.onTimeChange();
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
    const timeZone = this.meetingForm.get('timezone')?.value || 'Asia/Colombo';
    if (startTime && duration) {
      const startTimeUtc = this.zonedLocalToUtcIso(startTime, timeZone);
      console.log('[Availability Check] form.startTime (wall-clock):', startTime, '| tz:', timeZone);
      console.log('[Availability Check] sent UTC ISO:', startTimeUtc, '| duration:', duration);
      this.zoomService.getAvailableZoomHosts(startTimeUtc, duration).subscribe({
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
    const tz = formValue.timezone || 'Asia/Colombo';
    const startTime = this.zonedLocalToUtcIso(formValue.startTime, tz);

    const scheduledInstant = new Date(startTime);
    const wallInMeetingTz = Number.isNaN(scheduledInstant.getTime())
      ? '(invalid)'
      : new Intl.DateTimeFormat('en-GB', {
          timeZone: tz,
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }).format(scheduledInstant);
    const wallInBrowserTz = Number.isNaN(scheduledInstant.getTime())
      ? '(invalid)'
      : new Intl.DateTimeFormat('en-GB', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }).format(scheduledInstant);

    console.log('[Create Meeting] Form wall-clock (picker):', formValue.startTime, '| IANA timezone:', tz);
    console.log('[Create Meeting] Sent to API as UTC ISO:', startTime);
    console.log('[Create Meeting] Same instant shown in meeting timezone:', wallInMeetingTz);
    console.log('[Create Meeting] Same instant shown in browser timezone:', wallInBrowserTz);

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
