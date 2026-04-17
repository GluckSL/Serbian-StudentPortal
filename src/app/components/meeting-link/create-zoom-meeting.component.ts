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
  /** All classes use India Standard Time only (no user-selectable timezone). */
  readonly meetingTimezoneIana = 'Asia/Kolkata';
  readonly meetingTimezoneLabel = 'India (IST)';

  meetingForm!: FormGroup;
  readonly scheduleModes = [
    { value: 'single', label: 'Single Class' },
    { value: 'selected_dates', label: 'Selected Dates' },
    { value: 'weekly', label: 'Weekly (same time)' },
    { value: 'monthly', label: 'Monthly (same date/time)' }
  ] as const;
  selectedStartTimes: string[] = [];
  
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
  isConfirmModalOpen = false;
  successMessage = '';
  errorMessage = '';
  pendingMeetingData: any = null;
  
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
      agenda: [''],
      teacherId: ['', Validators.required],
      zoomHostEmail: ['', Validators.required],
      courseDay: [null, [Validators.min(1), Validators.max(200)]],
      scheduleMode: ['single', Validators.required],
      recurrenceCount: [4, [Validators.required, Validators.min(2), Validators.max(24)]]
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

  get scheduleMode(): string {
    return this.meetingForm?.get('scheduleMode')?.value || 'single';
  }

  get recurrenceCount(): number {
    const value = Number(this.meetingForm?.get('recurrenceCount')?.value);
    return Number.isFinite(value) ? value : 1;
  }

  get selectedDateTimesPreview(): Array<{ value: string; label: string }> {
    return [...this.selectedStartTimes]
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .map((v) => ({ value: v, label: this.formatDateTimeForDisplay(v) }));
  }

  get selectedTeacherLabel(): string {
    const teacherId = this.meetingForm?.get('teacherId')?.value;
    const teacher = this.teachers.find((t) => t._id === teacherId);
    return teacher ? `${teacher.name} (${teacher.email})` : '-';
  }

  get selectedZoomHostLabel(): string {
    const hostEmail = this.meetingForm?.get('zoomHostEmail')?.value;
    const host = this.zoomAccounts.find((a) => a.email === hostEmail);
    return host ? `${host.name} (${host.email})` : (hostEmail || '-');
  }

  get selectedPlanLabel(): string {
    const plan = this.meetingForm?.get('plan')?.value;
    if (plan === 'VISA_DOC_ONLY') return 'VISA & DOC ONLY';
    return plan || '-';
  }

  get confirmStartTimesPreview(): string[] {
    if (!this.pendingMeetingData?.startTimes) return [];
    return this.pendingMeetingData.startTimes
      .map((value: string) => {
        const normalized = value.length >= 16 ? value.substring(0, 16) : value;
        return this.formatDateTimeForDisplay(normalized);
      });
  }

  get selectedScheduleModeLabel(): string {
    const mode = this.scheduleModes.find((m) => m.value === this.scheduleMode);
    return mode?.label || this.scheduleMode;
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

    const startTimeValue = this.formatDateTimeLocal(selected);
    this.meetingForm.patchValue({ startTime: startTimeValue });
    this.meetingForm.get('startTime')?.markAsTouched();

    if (this.scheduleMode === 'selected_dates') {
      this.addSelectedDateTime(startTimeValue);
    }

    this.errorMessage = '';
    this.isStartTimeModalOpen = false;
    this.onTimeChange();
  }

  onScheduleModeChange(): void {
    this.errorMessage = '';
    const mode = this.scheduleMode;
    if (mode !== 'selected_dates') {
      this.selectedStartTimes = [];
    }
    this.onTimeChange();
  }

  private addSelectedDateTime(value: string): void {
    const dt = this.parseLocalDateTime(value);
    if (!dt) return;
    if (dt < new Date()) {
      this.errorMessage = 'Selected date/time must be in the future.';
      return;
    }
    const normalized = this.formatDateTimeLocal(dt);
    if (!this.selectedStartTimes.includes(normalized)) {
      this.selectedStartTimes.push(normalized);
    }
  }

  removeSelectedDateTime(value: string): void {
    this.selectedStartTimes = this.selectedStartTimes.filter((dt) => dt !== value);
  }

  private formatDateTimeForDisplay(localDateTime: string): string {
    const dt = this.parseLocalDateTime(localDateTime);
    if (!dt) return localDateTime;
    return `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}`;
  }

  private getTimeZoneOffsetForLocalDateTime(localDateTime: string, timeZone: string): string {
    const [datePart, timePart] = localDateTime.split('T');
    if (!datePart || !timePart) return 'Z';
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);

    const referenceDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset'
    }).formatToParts(referenceDate);

    const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    const match = offsetPart.match(/^GMT([+-]\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return 'Z';

    const offsetHoursNum = Number(match[1]);
    const sign = offsetHoursNum >= 0 ? '+' : '-';
    const hours = `${sign}${String(Math.abs(offsetHoursNum)).padStart(2, '0')}`;
    const minutes = (match[2] || '00').padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private buildTimezoneAwareIso(localDateTime: string, timeZone: string): string {
    const [datePart, timePart] = localDateTime.split('T');
    if (!datePart || !timePart) return localDateTime;
    const hhmm = timePart.slice(0, 5);
    const offset = this.getTimeZoneOffsetForLocalDateTime(`${datePart}T${hhmm}`, timeZone);
    return `${datePart}T${hhmm}:00${offset}`;
  }

  private generateScheduledStartTimes(): string[] {
    const baseValue = this.meetingForm.get('startTime')?.value;
    const baseDate = this.parseLocalDateTime(baseValue);
    if (!baseDate) return [];

    const mode = this.scheduleMode;
    const selectedTimezone = this.meetingTimezoneIana;
    const now = new Date();

    let result: string[] = [];

    if (mode === 'selected_dates') {
      result = this.selectedStartTimes
        .map((value) => this.parseLocalDateTime(value))
        .filter((d): d is Date => !!d && d >= now)
        .sort((a, b) => a.getTime() - b.getTime())
        .map((d) => this.formatDateTimeLocal(d));
    } else if (mode === 'single') {
      result = baseDate >= now ? [this.formatDateTimeLocal(baseDate)] : [];
    } else {
      const count = Math.max(2, this.recurrenceCount);
      const generated: string[] = [];
      for (let i = 0; i < count; i++) {
        const next = new Date(baseDate);
        if (mode === 'weekly') {
          next.setDate(baseDate.getDate() + i * 7);
        } else {
          next.setMonth(baseDate.getMonth() + i);
        }
        if (next >= now) {
          generated.push(this.formatDateTimeLocal(next));
        }
      }
      result = generated;
    }

    return result;
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
    const generatedTimes = this.generateScheduledStartTimes();
    const firstLocal = generatedTimes.length > 0
      ? generatedTimes[0]
      : this.meetingForm.get('startTime')?.value || null;
    const startTime = firstLocal ? `${firstLocal}:00+05:30` : null;
    const duration = this.meetingForm.get('duration')?.value;
    if (startTime && duration) {
      this.zoomService.getAvailableZoomHosts(startTime, duration).subscribe({
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

    const scheduledStartTimes = this.generateScheduledStartTimes();
    if (scheduledStartTimes.length === 0) {
      this.errorMessage = this.scheduleMode === 'selected_dates'
        ? 'Please add at least one valid date/time for selected dates mode.'
        : 'Please select a valid future start time.';
      return;
    }

    this.successMessage = '';
    this.errorMessage = '';
    const formValue = this.meetingForm.value;
    const startTime = scheduledStartTimes[0];
    this.pendingMeetingData = {
      batch: formValue.batch,
      plan: formValue.plan,
      topic: formValue.topic,
      startTime,
      startTimes: scheduledStartTimes,
      scheduleMode: formValue.scheduleMode,
      duration: formValue.duration,
      timezone: this.meetingTimezoneIana,
      agenda: formValue.agenda || `German Language Class - Batch ${formValue.batch}`,
      studentIds: this.selectedStudents.map(s => s._id),
      teacherId: formValue.teacherId,
      zoomHostEmail: formValue.zoomHostEmail,
      courseDay: formValue.courseDay || null
    };
    this.isConfirmModalOpen = true;
  }

  closeConfirmModal(): void {
    if (this.isCreatingMeeting) return;
    this.isConfirmModalOpen = false;
    this.pendingMeetingData = null;
  }

  confirmCreateMeeting(): void {
    if (!this.pendingMeetingData || this.isCreatingMeeting) return;

    this.isCreatingMeeting = true;
    this.successMessage = '';
    this.errorMessage = '';

    this.zoomService.createMeeting(this.pendingMeetingData).subscribe({
      next: (response) => {
        if (response.success) {
          this.isCreatingMeeting = false;
          this.isConfirmModalOpen = false;
          this.pendingMeetingData = null;
          const emailStatus = response.emailStatus;
          const createdCount = response.summary?.createdCount || (response.data?.meetings?.length ?? (response.data ? 1 : 0));
          const failedCount = response.summary?.failedCount || 0;

          if (emailStatus?.deferred) {
            this.successMessage =
              `✅ ${createdCount} meeting(s) created with ${response.data.attendeesCount || this.selectedStudents.length} students each. ` +
              (emailStatus.message ||
                'Students will receive the join link by email about 10 minutes before class starts.');
          } else if (emailStatus?.allSent) {
            this.successMessage = `✅ Zoom meeting created successfully with ${response.data.attendeesCount} students! All invitation emails sent.`;
          } else if (emailStatus?.totalFailure) {
            this.errorMessage = `⚠️ Meeting created but NO invitation emails were sent.`;
            this.successMessage = `Meeting created successfully but emails failed. Meeting ID: ${response.data.zoomMeetingId}`;
          } else if (emailStatus?.partialFailure) {
            this.errorMessage = `⚠️ Meeting created but ${emailStatus.failed} out of ${emailStatus.attempted} invitation emails failed.`;
            this.successMessage = `Meeting created. ${emailStatus.successful} emails sent, ${emailStatus.failed} failed.`;
          } else {
            this.successMessage = `✅ ${createdCount} Zoom meeting(s) created successfully.`;
          }

          if (failedCount > 0) {
            this.errorMessage = `⚠️ ${failedCount} schedule(s) failed. Please review conflicts and retry those times.`;
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
