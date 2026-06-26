import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { StepperSelectionEvent } from '@angular/cdk/stepper';
import { MaterialModule } from '../../shared/material.module';
import { GluckRoomService } from '../../services/gluck-room.service';
import { ClassRecordingsService } from '../../services/class-recordings.service';
import { ZoomService } from '../../services/zoom.service';
import { AuthService } from '../../services/auth.service';
import { lastValueFrom } from 'rxjs';

interface Student {
  _id: string;
  name: string;
  email: string;
  batch: string;
  level: string;
  subscription: string;
  studentStatus: string;
}

interface BatchJourneyRow {
  batchName: string;
  batchCurrentDay: number;
  journeyLength: number;
  journeyActive: boolean;
  plans: string[];
}

const WEEKDAY_META: { sun0: number; label: string; key: string }[] = [
  { sun0: 1, label: 'Monday', key: 'mon' },
  { sun0: 2, label: 'Tuesday', key: 'tue' },
  { sun0: 3, label: 'Wednesday', key: 'wed' },
  { sun0: 4, label: 'Thursday', key: 'thu' },
  { sun0: 5, label: 'Friday', key: 'fri' },
  { sun0: 6, label: 'Saturday', key: 'sat' },
  { sun0: 0, label: 'Sunday', key: 'sun' }
];

@Component({
  selector: 'app-gluck-room-create',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MaterialModule],
  templateUrl: './gluck-room-create.component.html',
  styleUrls: ['./gluck-room-create.component.scss']
})
export class GluckRoomCreateComponent implements OnInit {
  editId: string | null = null;

  // Single mode fields
  sessionName = '';
  batch = '';
  scheduleDate: Date | null = null;
  scheduleTime = '7:00 PM';
  get scheduledStartTime(): string {
    if (!this.scheduleDate) return '';
    const match = this.scheduleTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return '';
    let h = parseInt(match[1], 10);
    const m = match[2];
    if (match[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
    const y = this.scheduleDate.getFullYear();
    const mo = String(this.scheduleDate.getMonth() + 1).padStart(2, '0');
    const d = String(this.scheduleDate.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}T${String(h).padStart(2, '0')}:${m}`;
  }
  maxDurationMinutes = 180;
  courseDay: number | null = null;
  targetJourneyDay: number | null = null;
  level: string | null = null;
  plan = 'PLATINUM';
  agenda = '';
  accessType: 'batch' | 'manual' | 'open' = 'batch';
  allowedBatches: string[] = [];
  allowedStudents: string[] = [];
  allBatches: string[] = [];
  userRole = '';
  submitting = false;
  loading = true;
  error = '';
  loadingBatches = true;

  durationOptions = [15, 30, 45, 60, 90, 120, 180, 240, 300];
  levelOptions = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  planOptions = ['SILVER', 'PLATINUM', 'VISA_DOC_ONLY'];
  commonTimes = [
    '12:00 AM', '12:30 AM', '1:00 AM', '1:30 AM', '2:00 AM', '2:30 AM',
    '3:00 AM', '3:30 AM', '4:00 AM', '4:30 AM', '5:00 AM', '5:30 AM',
    '6:00 AM', '6:30 AM', '7:00 AM', '7:30 AM', '8:00 AM', '8:30 AM',
    '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
    '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
    '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM',
    '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM', '8:30 PM',
    '9:00 PM', '9:30 PM', '10:00 PM', '10:30 PM', '11:00 PM', '11:30 PM',
  ];

  // Journey mode
  scheduleType: 'single' | 'journey' = 'single';
  basicForm!: FormGroup;
  weekForm!: FormGroup;
  batchJourneyRows: BatchJourneyRow[] = [];
  allStudents: Student[] = [];
  filteredStudents: Student[] = [];
  selectedStudents: Student[] = [];
  searchTerm = '';
  schedules: Array<{ journeyDay: number; startTime: string; endTime: string }> = [];
  previewWarnings: string[] = [];
  previewBlocking: string[] = [];
  totalTeachingHours = 0;
  isPreviewing = false;
  isBulkCreating = false;
  bulkProgressDone = 0;
  bulkProgressTotal = 0;
  bulkScheduleId = '';
  readonly weekdayOptions = WEEKDAY_META;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    private gluckRoomService: GluckRoomService,
    private classRecordingsService: ClassRecordingsService,
    private zoomService: ZoomService,
    private auth: AuthService
  ) {}

  get isEditMode(): boolean {
    return !!this.editId;
  }

  get selectedWeekdaysSun0(): number[] {
    return WEEKDAY_META.filter((d) => this.weekForm?.get(d.key)?.value === true).map((d) => d.sun0);
  }

  get batchCurrentDayDisplay(): number | null {
    const b = this.basicForm?.get('batch')?.value;
    if (!b) return null;
    const row = this.batchJourneyRows.find((r) => String(r.batchName).toLowerCase() === String(b).toLowerCase());
    return row ? row.batchCurrentDay : null;
  }

  ngOnInit(): void {
    const user = this.auth.getSnapshotUser();
    this.userRole = user?.role || '';
    this.editId = this.route.snapshot.paramMap.get('id');
    this.bulkScheduleId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const mode = this.route.snapshot.queryParamMap.get('mode');
    this.scheduleType = mode === 'bulk' ? 'journey' : 'single';

    // Reactive form for journey mode
    this.basicForm = this.fb.group({
      topic: ['', [Validators.required, Validators.minLength(3)]],
      batch: ['', Validators.required],
      plan: ['', Validators.required],
      duration: [120, [Validators.required, Validators.min(15), Validators.max(1440)]],
      startClock: ['19:00', Validators.required],
      startingJourneyDay: [{ value: 1, disabled: false }, [Validators.required, Validators.min(1), Validators.max(200)]],
      targetJourneyDay: [100, [Validators.required, Validators.min(1), Validators.max(200)]]
    });

    const wk: Record<string, boolean> = {};
    for (const d of WEEKDAY_META) {
      wk[d.key] = d.sun0 === 1 || d.sun0 === 3 || d.sun0 === 5;
    }
    this.weekForm = this.fb.group(wk);

    this.loadBatches();
    this.loadBatchJourney();
    this.loadStudents();
  }

  loadBatches(): void {
    this.loadingBatches = true;
    this.classRecordingsService.getBatches().subscribe({
      next: (res) => {
        if (res.success && Array.isArray(res.batches)) {
          this.allBatches = res.batches;
        } else {
          this.useFallbackBatches();
        }
        this.loadingBatches = false;
        if (this.editId) this.loadSession();
        else this.loading = false;
      },
      error: () => {
        this.useFallbackBatches();
        this.loadingBatches = false;
        if (this.editId) this.loadSession();
        else this.loading = false;
      }
    });
  }

  private useFallbackBatches(): void {
    const user = this.auth.getSnapshotUser();
    if (user?.assignedBatches?.length) {
      this.allBatches = user.assignedBatches;
    }
    if (!this.editId && this.allBatches.length === 1) {
      this.batch = this.allBatches[0];
      this.allowedBatches = [this.allBatches[0]];
    }
  }

  private loadBatchJourney(): void {
    this.gluckRoomService.getBatchJourneyData().subscribe({
      next: (res) => {
        if (res.success && Array.isArray(res.batches)) {
          this.batchJourneyRows = res.batches;
        }
      }
    });
  }

  private loadStudents(): void {
    this.zoomService.getAllStudents().subscribe({
      next: (res) => {
        if (res?.success) {
          this.allStudents = res.data || [];
          this.filterStudents();
        }
      },
      error: () => {}
    });
  }

  private loadSession(): void {
    if (!this.editId) return;
    this.loading = true;
    this.gluckRoomService.getSession(this.editId).subscribe({
      next: (res) => {
        if (res.success) {
          const s = res.data;
          this.sessionName = s.sessionName || '';
          this.batch = s.batch || '';
          if (s.scheduledStartTime) {
            const d = new Date(s.scheduledStartTime);
            this.scheduleDate = d;
            const h24 = d.getHours();
            const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
            const ampm = h24 >= 12 ? 'PM' : 'AM';
            this.scheduleTime = `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
          }
          this.maxDurationMinutes = s.maxDurationMinutes || 180;
          this.courseDay = s.courseDay || null;
          this.targetJourneyDay = s.targetJourneyDay || null;
          this.level = s.level || null;
          this.plan = s.plan || null;
          this.agenda = s.agenda || '';
          this.accessType = s.accessType || 'batch';
          this.allowedBatches = Array.isArray(s.allowedBatches) ? s.allowedBatches : [];
          this.allowedStudents = Array.isArray(s.allowedStudents)
            ? s.allowedStudents.map((sid: any) => (typeof sid === 'object' ? sid._id : sid))
            : [];
        } else {
          this.error = res.message || 'Failed to load session';
        }
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load session';
        this.loading = false;
      }
    });
  }

  get isAdmin(): boolean {
    return ['ADMIN', 'SUB_ADMIN', 'TEACHER_ADMIN'].includes(this.userRole);
  }

  onBatchChange(): void {
    if (this.accessType === 'batch' && this.batch && !this.allowedBatches.includes(this.batch)) {
      this.allowedBatches = [this.batch];
    }
    // Also update journey form if batch changes
    const row = this.batchJourneyRows.find((r) => String(r.batchName).toLowerCase() === String(this.batch).toLowerCase());
    if (row) {
      const nextStart = Math.min(200, Math.max(1, row.batchCurrentDay + 1));
      this.basicForm?.patchValue({
        startingJourneyDay: nextStart,
        targetJourneyDay: Math.min(row.journeyLength, Math.max(nextStart, row.batchCurrentDay + 40))
      });
    }
    this.selectedStudents = [];
    this.filterStudents();
  }

  onPlanChange(): void {
    this.selectedStudents = [];
    this.filterStudents();
  }

  // ── Single mode submit ──

  onSubmit(): void {
    if (!this.sessionName.trim() || !this.batch || !this.scheduleDate) {
      this.error = 'Session name, batch, and start date are required.';
      return;
    }
    if (!this.courseDay) { this.error = 'Course day is required.'; return; }
    if (!this.targetJourneyDay) { this.error = 'Target journey day is required.'; return; }
    if (!this.plan) { this.error = 'Plan is required.'; return; }

    this.submitting = true;
    this.error = '';

    const payload: any = {
      sessionName: this.sessionName.trim(),
      batch: this.batch,
      scheduledStartTime: this.scheduledStartTime,
      maxDurationMinutes: this.maxDurationMinutes,
      accessType: this.accessType,
      courseDay: this.courseDay,
      targetJourneyDay: this.targetJourneyDay,
      plan: this.plan
    };

    if (this.level) payload.level = this.level;
    if (this.agenda) payload.agenda = this.agenda;

    if (this.accessType === 'batch') {
      payload.allowedBatches = this.allowedBatches.length ? this.allowedBatches : [this.batch];
    }
    if (this.accessType === 'manual') {
      payload.allowedStudents = this.allowedStudents;
    }

    const request = this.editId
      ? this.gluckRoomService.updateSession(this.editId, payload)
      : this.gluckRoomService.createSession(payload);

    request.subscribe({
      next: (res) => {
        this.submitting = false;
        if (res.success) {
          this.router.navigate(['/gluck-room']);
        } else {
          this.error = res.message || 'Failed to save session';
        }
      },
      error: (err) => {
        this.submitting = false;
        this.error = err.error?.message || 'Failed to save session';
      }
    });
  }

  // ── Journey mode ──

  stepperSelectionChanged(ev: StepperSelectionEvent): void {
    if (ev.selectedIndex === 3) {
      void this.runPreview();
    }
  }

  async runPreview(): Promise<boolean> {
    this.error = '';
    if (this.basicForm.invalid) {
      this.basicForm.markAllAsTouched();
      this.error = 'Please complete basic details.';
      return false;
    }
    if (!this.selectedWeekdaysSun0.length) {
      this.error = 'Select at least one weekday.';
      return false;
    }
    if (this.selectedStudents.length === 0) {
      this.error = 'Select at least one student.';
      return false;
    }

    this.isPreviewing = true;
    try {
      const v = this.basicForm.getRawValue();
      const res = await lastValueFrom(
        this.gluckRoomService.bulkPreviewSessions({
          weekdaysSun0: this.selectedWeekdaysSun0,
          startClock: v.startClock,
          startingJourneyDay: Number(v.startingJourneyDay),
          targetJourneyDay: Number(v.targetJourneyDay),
          durationMinutes: Number(v.duration) || 120
        })
      );
      if (!res?.success) {
        this.error = res?.message || 'Preview failed';
        return false;
      }
      const d = res.data;
      this.schedules = (d.schedules || []).map((row: any) => ({
        journeyDay: row.journeyDay,
        startTime: row.startTime,
        endTime: row.endTime
      }));
      this.previewWarnings = d.warnings || [];
      this.previewBlocking = d.blockingErrors || [];
      this.totalTeachingHours = d.totalTeachingHours ?? 0;
      if (this.schedules.length === 0) {
        this.error = 'No class dates generated. Check journey range and weekdays.';
        return false;
      }
      return true;
    } catch (e: any) {
      this.error = e?.error?.message || 'Preview request failed';
      return false;
    } finally {
      this.isPreviewing = false;
    }
  }

  async submitBulkCreate(): Promise<void> {
    this.error = '';
    const ok = await this.runPreview();
    if (!ok) return;

    const v = this.basicForm.getRawValue();
    const common: Record<string, unknown> = {
      sessionName: v.topic,
      batch: v.batch,
      plan: v.plan,
      teacherId: this.auth.getSnapshotUser()?.userId || this.auth.getSnapshotUser()?._id,
      duration: Number(v.duration) || 120,
      timezone: 'Asia/Kolkata',
      agenda: `Gluck Room - Batch ${v.batch}`,
      studentIds: this.selectedStudents.map((s) => s._id),
      bulkScheduleId: this.bulkScheduleId,
      startingJourneyDay: Number(v.startingJourneyDay),
      targetJourneyDay: Number(v.targetJourneyDay),
      weekdaysSun0: this.selectedWeekdaysSun0,
      startClock: String(v.startClock || '19:00').substring(0, 5)
    };

    const rows = this.schedules.map((r) => ({
      journeyDay: r.journeyDay,
      startTime: r.startTime,
      endTime: r.endTime
    }));

    this.isBulkCreating = true;
    this.bulkProgressTotal = rows.length;
    this.bulkProgressDone = 0;
    let created = 0;
    const failures: string[] = [];

    try {
      const res = await lastValueFrom(
        this.gluckRoomService.bulkCreateSessions({
          ...common,
          schedules: rows
        })
      );
      const summary = res?.data?.summary || {};
      created = summary.createdCount || 0;
      this.bulkProgressDone = this.bulkProgressTotal;
      const fs = summary.failedSchedules || [];
      for (const f of fs) {
        failures.push(`${f.startTime}: ${f.message}`);
      }

      if (failures.length) {
        console.warn('Bulk journey failures', failures);
      }
      this.router.navigate(['/gluck-room']);
    } catch (e: any) {
      this.error = e?.error?.message || 'Bulk create failed';
    } finally {
      this.isBulkCreating = false;
    }
  }

  onJourneyBatchChange(): void {
    const batch = this.basicForm.get('batch')?.value;
    const row = this.batchJourneyRows.find((r) => String(r.batchName).toLowerCase() === String(batch).toLowerCase());
    if (row) {
      const nextStart = Math.min(200, Math.max(1, row.batchCurrentDay + 1));
      this.basicForm.patchValue({
        startingJourneyDay: nextStart,
        targetJourneyDay: Math.min(row.journeyLength, Math.max(nextStart, row.batchCurrentDay + 40))
      });
    }
    this.selectedStudents = [];
    this.filterStudents();
  }

  // ── Student management (journey mode) ──

  filterStudents(): void {
    // For journey mode, students are loaded and filtered here
    // For now, use a simplified approach — the actual student list would come from a service
    const batch = this.basicForm?.get('batch')?.value;
    const plan = this.basicForm?.get('plan')?.value;
    const q = this.searchTerm.trim().toLowerCase();
    this.filteredStudents = this.allStudents.filter((s) => {
      if (batch && s.batch !== batch) return false;
      if (plan && s.subscription !== plan) return false;
      if (s.studentStatus !== 'ONGOING') return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  onSearchInput(ev: Event): void {
    this.searchTerm = (ev.target as HTMLInputElement)?.value ?? '';
    this.filterStudents();
  }

  toggleStudent(student: Student): void {
    const i = this.selectedStudents.findIndex((s) => s._id === student._id);
    if (i >= 0) this.selectedStudents.splice(i, 1);
    else this.selectedStudents.push(student);
  }

  isStudentSelected(s: Student): boolean {
    return this.selectedStudents.some((x) => x._id === s._id);
  }

  selectAllFiltered(): void {
    for (const s of this.filteredStudents) {
      if (!this.isStudentSelected(s)) this.selectedStudents.push(s);
    }
  }

  deselectAll(): void {
    this.selectedStudents = [];
  }

  // ── Schedule display helpers ──

  slotMs(local16: string): number {
    const pad = String(local16 || '').substring(0, 16);
    if (pad.length < 16) return NaN;
    return new Date(`${pad}:00+05:30`).getTime();
  }

  rowWeekday(row: { startTime: string }): string {
    const ms = this.slotMs(row.startTime);
    if (!Number.isFinite(ms)) return '\u2014';
    return new Date(ms).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  }

  rowDate(row: { startTime: string }): string {
    const ms = this.slotMs(row.startTime);
    if (!Number.isFinite(ms)) return '\u2014';
    return new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
  }

  rowStartTime(row: { startTime: string }): string {
    const ms = this.slotMs(row.startTime);
    if (!Number.isFinite(ms)) return '\u2014';
    return new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
  }

  rowEndTime(row: { endTime: string }): string {
    const raw = String(row.endTime || '').substring(0, 16);
    if (raw.length < 16) return '\u2014';
    const ms = this.slotMs(raw);
    if (!Number.isFinite(ms)) return '\u2014';
    return new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
  }

  // ── Navigation ──

  cancel(): void {
    this.router.navigate(['/gluck-room']);
  }

  goToSingleMode(): void {
    this.router.navigate(['/gluck-room/create']);
  }
}
