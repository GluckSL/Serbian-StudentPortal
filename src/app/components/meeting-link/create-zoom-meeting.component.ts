// src/app/components/meeting-link/create-zoom-meeting.component.ts

import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ZoomService, Student, Teacher, ZoomAccount, ZoomHostConflict } from '../../services/zoom.service';
import { TestAccountBadgeComponent } from '../../shared/test-account-badge/test-account-badge.component';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-create-zoom-meeting',
  standalone: true,
  templateUrl: './create-zoom-meeting.component.html',
  styleUrls: ['./create-zoom-meeting.component.css'],
  imports: [CommonModule, ReactiveFormsModule, FormsModule, TestAccountBadgeComponent, MatTooltipModule]
})
export class CreateZoomMeetingComponent implements OnInit {
  /** All classes use India Standard Time only (no user-selectable timezone). */
  readonly meetingTimezoneIana = 'Asia/Kolkata';
  readonly meetingTimezoneLabel = 'India (IST)';

  meetingForm!: FormGroup;
  readonly scheduleModes = [
    { value: 'selected_dates', label: 'Selected Dates' },
    { value: 'weekly', label: 'Weekly (same time Mon–Sun)' },
    { value: 'monthly', label: 'Monthly (same date/time)' }
  ] as const;
  selectedStartTimes: string[] = [];
  courseDaysByStart: Record<string, number | null> = {};
  editableScheduleSlots: Array<{ raw: string; label: string }> = [];
  
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
    this.refreshEditableScheduleSlots();
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
      scheduleMode: ['selected_dates', Validators.required],
      recurrenceCount: [4, [Validators.required, Validators.min(1), Validators.max(24)]]
    });
  }

  private readonly istTimeZone = 'Asia/Kolkata';

  private formatDateTimeLocal(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.istTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const pick = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`;
  }

  private getTodayDateString(): string {
    return this.formatDateTimeLocal(new Date()).substring(0, 10);
  }

  private parseLocalDateTime(value: string | null | undefined): Date | null {
    if (!value) return null;
    const pad = String(value).trim().substring(0, 16);
    if (pad.length < 16) return null;
    const d = new Date(`${pad}:00+05:30`);
    return Number.isNaN(d.getTime()) ? null : d;
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
    return this.meetingForm?.get('scheduleMode')?.value || 'selected_dates';
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

  get confirmPendingSlots(): Array<{ raw: string; label: string }> {
    if (!this.pendingMeetingData?.startTimes) return [];
    return this.pendingMeetingData.startTimes.map((value: string) => {
      const normalized = value.length >= 16 ? value.substring(0, 16) : value;
      return { raw: value, label: this.formatDateTimeForDisplay(normalized) };
    });
  }

  private normalizeSlotKey(value: string): string {
    return typeof value === 'string' && value.length >= 16 ? value.substring(0, 16) : value;
  }

  private parseCourseDayInput(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = parseInt(String(value), 10);
    if (!Number.isFinite(n) || n < 1 || n > 200) return null;
    return n;
  }

  getCourseDayForSlot(raw: string): number | '' {
    const key = this.normalizeSlotKey(raw);
    const value = this.courseDaysByStart[key];
    return Number.isFinite(Number(value)) ? Number(value) : '';
  }

  getConfirmCourseDayLabel(raw: string): string {
    const key = this.normalizeSlotKey(raw);
    const value = this.pendingMeetingData?.courseDaysByStart?.[key];
    const parsed = this.parseCourseDayInput(value);
    return parsed != null ? `Day ${parsed}` : 'Day -';
  }

  updateCourseDayForSlot(raw: string, value: unknown): void {
    const key = this.normalizeSlotKey(raw);
    const parsed = this.parseCourseDayInput(value);
    this.courseDaysByStart[key] = parsed;
  }

  slotCourseDayInvalid(raw: string): boolean {
    const value = this.getCourseDayForSlot(raw);
    return !Number.isFinite(Number(value));
  }

  allEditableCourseDaysValid(): boolean {
    const slots = this.editableScheduleSlots;
    if (slots.length === 0) return false;
    return slots.every((slot) => !this.slotCourseDayInvalid(slot.raw));
  }

  private refreshEditableScheduleSlots(): void {
    const generated = this.generateScheduledStartTimes();
    const defaultCourseDay = this.parseCourseDayInput(this.meetingForm?.get('courseDay')?.value);
    const nextMap: Record<string, number | null> = {};
    this.editableScheduleSlots = generated.map((slot) => {
      const key = this.normalizeSlotKey(slot);
      const existing = this.courseDaysByStart[key];
      nextMap[key] = existing != null ? existing : defaultCourseDay;
      return { raw: slot, label: this.formatDateTimeForDisplay(key) };
    });
    this.courseDaysByStart = nextMap;
  }

  removePendingStartTime(raw: string): void {
    if (!this.pendingMeetingData?.startTimes || this.isCreatingMeeting) return;
    const times: string[] = this.pendingMeetingData.startTimes.filter((t: string) => t !== raw);
    if (times.length === 0) return;
    const key = this.normalizeSlotKey(raw);
    if (this.pendingMeetingData.courseDaysByStart && typeof this.pendingMeetingData.courseDaysByStart === 'object') {
      delete this.pendingMeetingData.courseDaysByStart[key];
    }
    this.pendingMeetingData.startTimes = times;
    this.pendingMeetingData.startTime = times[0];
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
    this.refreshEditableScheduleSlots();
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

  private addCalendarDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  /** Monday 00:00 of the calendar week that contains `date` (week = Mon–Sun). */
  private getMondayOfWeekContaining(date: Date): Date {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    const dow = monday.getDay(); // 0 Sun .. 6 Sat
    const daysFromMonday = dow === 0 ? -6 : 1 - dow;
    monday.setDate(monday.getDate() + daysFromMonday);
    return monday;
  }

  /** Sunday (calendar date) of the week that contains `date`. */
  private getSundayOfWeekContaining(date: Date): Date {
    return this.addCalendarDays(this.getMondayOfWeekContaining(date), 6);
  }

  private sameLocalClock(target: Date, clockSource: Date): Date {
    const d = new Date(target);
    d.setHours(clockSource.getHours(), clockSource.getMinutes(), 0, 0);
    return d;
  }

  private isSameCalendarDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  /**
   * Weekly: same clock time every day from the chosen date through Sunday of that week,
   * then full Mon–Sun weeks for each additional "occurrence" (week count).
   */
  private generateWeeklyStartTimes(baseDate: Date, now: Date, weekCount: number): string[] {
    const generated: string[] = [];
    const sundayFirstWeek = this.sameLocalClock(this.getSundayOfWeekContaining(baseDate), baseDate);

    let cursor = this.sameLocalClock(
      new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()),
      baseDate
    );

    while (true) {
      if (cursor >= now) {
        generated.push(this.formatDateTimeLocal(cursor));
      }
      if (this.isSameCalendarDay(cursor, sundayFirstWeek)) {
        break;
      }
      cursor = this.sameLocalClock(this.addCalendarDays(cursor, 1), baseDate);
    }

    const mondayFirstWeek = this.getMondayOfWeekContaining(baseDate);
    const mondayWithClock = this.sameLocalClock(mondayFirstWeek, baseDate);

    for (let w = 1; w < weekCount; w++) {
      const weekMonday = this.addCalendarDays(mondayWithClock, w * 7);
      for (let i = 0; i < 7; i++) {
        const slot = this.sameLocalClock(this.addCalendarDays(weekMonday, i), baseDate);
        if (slot >= now) {
          generated.push(this.formatDateTimeLocal(slot));
        }
      }
    }

    return generated;
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
      const count = Math.max(1, this.recurrenceCount);
      const generated: string[] = [];
      if (mode === 'weekly') {
        result = this.generateWeeklyStartTimes(baseDate, now, count);
      } else {
        for (let i = 0; i < count; i++) {
          const next = new Date(baseDate);
          next.setMonth(baseDate.getMonth() + i);
          if (next >= now) {
            generated.push(this.formatDateTimeLocal(next));
          }
        }
        result = generated;
      }
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

  /** IST ISO strings for all slots being scheduled (used for portal busy check). */
  private buildSlotIsoTimes(): string[] {
    const generatedTimes = this.generateScheduledStartTimes();
    const locals = generatedTimes.length > 0
      ? generatedTimes
      : [this.meetingForm.get('startTime')?.value].filter(Boolean);
    return locals.map((local) => this.buildTimezoneAwareIso(local, this.meetingTimezoneIana));
  }

  get busyZoomAccounts(): ZoomAccount[] {
    return this.zoomAccounts.filter((a) => a.isBusy);
  }

  formatConflictWhen(conflict: ZoomHostConflict): string {
    const dt = new Date(conflict.startTime);
    if (Number.isNaN(dt.getTime())) return '';
    const date = dt.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: this.meetingTimezoneIana
    });
    const time = dt.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: this.meetingTimezoneIana
    });
    const mins = conflict.duration || 60;
    return `${date} ${time} (${mins} min)`;
  }

  conflictTooltip(conflicts: ZoomHostConflict[] | undefined): string {
    if (!conflicts?.length) {
      return 'Busy — another class is booked on this Zoom account in the portal at your selected time.';
    }
    return conflicts
      .map((c) => {
        const batch = c.batch ? ` · Batch ${c.batch}` : '';
        return `${c.topic}${batch}\n${this.formatConflictWhen(c)}`;
      })
      .join('\n\n');
  }

  /** Re-check zoom account availability when time/duration changes */
  onTimeChange(): void {
    const slotIsos = this.buildSlotIsoTimes();
    const duration = this.meetingForm.get('duration')?.value;
    if (slotIsos.length > 0 && duration) {
      this.zoomService.getAvailableZoomHosts(slotIsos[0], duration, slotIsos).subscribe({
        next: (response) => {
          if (response.success) {
            this.zoomAccounts = response.data;
          }
        }
      });
    }
    this.refreshEditableScheduleSlots();
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
    const normalizedCourseDaysByStart = scheduledStartTimes.reduce((acc: Record<string, number>, slot: string) => {
      const key = this.normalizeSlotKey(slot);
      const value = this.parseCourseDayInput(this.courseDaysByStart[key]);
      if (value != null) {
        acc[key] = value;
      }
      return acc;
    }, {});
    if (Object.keys(normalizedCourseDaysByStart).length !== scheduledStartTimes.length) {
      this.errorMessage = 'Please enter a valid Course Day (1-200) for each scheduled class.';
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
      courseDay: normalizedCourseDaysByStart[this.normalizeSlotKey(startTime)] ?? null,
      courseDaysByStart: normalizedCourseDaysByStart
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
    const slots = this.pendingMeetingData.startTimes as string[] | undefined;
    if (!slots || slots.length === 0) {
      this.errorMessage = 'Add at least one scheduled time before confirming.';
      return;
    }
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
                'Students will receive a reminder email about 10 minutes before class starts with instructions to join via the portal.');
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
