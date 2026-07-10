// Bulk journey scheduling wizard — reuses Zoom + MeetingLink backend (IST).

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService, Student, Teacher, ZoomAccount, ZoomHostConflict, StudentConflict } from '../../services/zoom.service';
import { environment } from '../../../environments/environment';
import { MatSnackBar } from '@angular/material/snack-bar';
import { StepperSelectionEvent } from '@angular/cdk/stepper';

export interface JourneyScheduleRow {
  journeyDay: number;
  startTime: string;
  endTime: string;
}

/** Sunday = 0 .. Saturday = 6 (matches backend journeyMeetingGenerator). */
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
  selector: 'app-bulk-journey-meeting',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, MaterialModule],
  templateUrl: './bulk-journey-meeting.component.html',
  styleUrls: ['./bulk-journey-meeting.component.css']
})
export class BulkJourneyMeetingComponent implements OnInit {
  readonly meetingTimezoneLabel = 'India (IST)';
  readonly chunkSize = 15;

  basicForm!: FormGroup;
  weekForm!: FormGroup;

  teachers: Teacher[] = [];
  zoomAccounts: ZoomAccount[] = [];
  allStudents: Student[] = [];
  filteredStudents: Student[] = [];
  selectedStudents: Student[] = [];

  batchJourneyRows: Array<{
    batchName: string;
    batchCurrentDay: number;
    journeyLength: number;
    journeyActive: boolean;
  }> = [];

  /** Generated or admin-edited slots (used for final bulk create). */
  schedules: JourneyScheduleRow[] = [];

  previewWarnings: string[] = [];
  previewBlocking: string[] = [];
  studentConflicts: StudentConflict[] = [];
  totalTeachingHours = 0;
  previewSavedAt: string | null = null;
  isResolvingConflict = false;

  /** Row being edited on preview step */
  editingRowIndex: number | null = null;
  editDraft: { journeyDay: number; startDate: string; startClock: string } | null = null;
  isSavingRowEdit = false;

  /** Re-run server preview when re-entering confirm step after changing wizard fields. */
  private shouldRegeneratePreview = true;

  isLoading = false;
  isPreviewing = false;
  isBulkCreating = false;
  bulkProgressDone = 0;
  bulkProgressTotal = 0;
  errorMessage = '';
  searchTerm = '';

  bulkScheduleId = '';

  readonly weekdayOptions = WEEKDAY_META;

  /** Stable list — avoids select reset when change detection re-runs (e.g. after Zoom busy refresh). */
  firstClassWeekdayOptionsList: { value: string; label: string }[] = [
    { value: 'auto', label: 'Automatic (next selected day from today)' }
  ];

  private readonly batchJourneyUrl = `${environment.apiUrl}/batch-journey`;

  constructor(
    private fb: FormBuilder,
    private zoomService: ZoomService,
    private http: HttpClient,
    private router: Router,
    private snack: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.bulkScheduleId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    this.basicForm = this.fb.group({
      topic: ['', [Validators.required, Validators.minLength(3)]],
      batch: ['', Validators.required],
      plan: ['', Validators.required],
      teacherId: ['', Validators.required],
      zoomHostEmail: ['', Validators.required],
      duration: [120, [Validators.required, Validators.min(15), Validators.max(24 * 60)]],
      scheduleType: ['journey', Validators.required],
      startClock: ['19:00', Validators.required],
      startingJourneyDay: [{ value: 1, disabled: false }, [Validators.required, Validators.min(1), Validators.max(200)]],
      targetJourneyDay: [100, [Validators.required, Validators.min(1), Validators.max(200)]],
      /** 'auto' or Sunday=0 .. Saturday=6 string */
      firstClassWeekday: ['auto']
    });

    const wk: Record<string, boolean> = {};
    for (const d of WEEKDAY_META) {
      wk[d.key] = d.sun0 === 1 || d.sun0 === 3 || d.sun0 === 5;
    }
    this.weekForm = this.fb.group(wk);
    this.syncFirstClassWeekdayOptions();
    this.weekForm.valueChanges.subscribe(() => this.syncFirstClassWeekdayOptions());

    this.loadBatchJourney();
    this.loadTeachers();
    this.loadZoomHosts();
    this.loadStudents();
  }

  get scheduleType(): string {
    return this.basicForm.get('scheduleType')?.value || 'journey';
  }

  /** True when all Step 1 fields (topic, batch, plan, teacher, duration, journey mode) are valid. */
  get step1Valid(): boolean {
    const f = this.basicForm;
    return !!(
      f.get('topic')?.valid &&
      f.get('batch')?.valid &&
      f.get('plan')?.valid &&
      f.get('teacherId')?.valid &&
      f.get('duration')?.valid &&
      this.scheduleType === 'journey'
    );
  }

  /** True when at least one weekday is selected and a Zoom host has been chosen. */
  get step2Valid(): boolean {
    return this.selectedWeekdaysSun0.length > 0 && !!this.basicForm.get('zoomHostEmail')?.value;
  }

  get selectedWeekdaysSun0(): number[] {
    return WEEKDAY_META.filter((d) => this.weekForm.get(d.key)?.value === true).map((d) => d.sun0);
  }

  trackByWeekdayOption(_index: number, o: { value: string; label: string }): string {
    return o.value;
  }

  compareFirstClassWeekday(a: string | null | undefined, b: string | null | undefined): boolean {
    return String(a ?? '') === String(b ?? '');
  }

  /** Rebuild weekday dropdown from ticked boxes; keep selection when still valid. */
  private syncFirstClassWeekdayOptions(): void {
    const opts: { value: string; label: string }[] = [
      { value: 'auto', label: 'Automatic (next selected day from today)' }
    ];
    for (const d of WEEKDAY_META) {
      if (this.selectedWeekdaysSun0.includes(d.sun0)) {
        opts.push({ value: String(d.sun0), label: d.label });
      }
    }
    this.firstClassWeekdayOptionsList = opts;

    const ctrl = this.basicForm?.get('firstClassWeekday');
    if (!ctrl) return;
    const pick = ctrl.value;
    if (pick === 'auto' || pick == null || pick === '') return;
    const normalized = String(pick);
    const allowed = new Set(opts.map((o) => o.value));
    if (!allowed.has(normalized)) {
      ctrl.setValue('auto', { emitEvent: false });
    } else if (normalized !== pick) {
      ctrl.setValue(normalized, { emitEvent: false });
    }
  }

  firstClassWeekdayLabel(): string {
    const v = this.basicForm.get('firstClassWeekday')?.value;
    if (v === 'auto' || v == null || v === '') {
      return 'Automatic (next selected day from today)';
    }
    const n = Number(v);
    return WEEKDAY_META.find((d) => d.sun0 === n)?.label ?? String(v);
  }

  onFirstClassWeekdayChange(_ev: Event): void {
    // The reactive form (formControlName + [ngValue]) already updates the control value.
    // Reading el.value from the native element returns Angular's internal serialized key,
    // not the actual option value, so we must not call setValue here.
    this.refreshZoomBusyHint();
  }

  onWeekdayChange(): void {
    this.syncFirstClassWeekdayOptions();
    this.refreshZoomBusyHint();
  }

  get batchCurrentDayDisplay(): number | null {
    const b = this.basicForm.get('batch')?.value;
    if (!b) return null;
    const row = this.batchJourneyRows.find(
      (r) => String(r.batchName).toLowerCase() === String(b).toLowerCase()
    );
    return row ? row.batchCurrentDay : null;
  }

  cancel(): void {
    this.router.navigate(['/teacher/meetings']);
  }

  private loadBatchJourney(): void {
    this.http.get<{ batches: any[]; upcomingBatches: any[] }>(this.batchJourneyUrl, { withCredentials: true }).subscribe({
      next: (res) => {
        const a = res.batches || [];
        const u = res.upcomingBatches || [];
        const map = new Map<string, any>();
        for (const x of [...a, ...u]) {
          if (x?.batchName) map.set(String(x.batchName), x);
        }
        this.batchJourneyRows = Array.from(map.values()).map((x) => ({
          batchName: x.batchName,
          batchCurrentDay: x.batchCurrentDay ?? 1,
          journeyLength: x.journeyLength ?? 200,
          journeyActive: !!x.journeyActive
        }));
        this.batchJourneyRows.sort((p, q) => p.batchName.localeCompare(q.batchName));
      },
      error: () => {
        this.errorMessage = 'Could not load batch journey list.';
      }
    });
  }

  private loadTeachers(): void {
    this.zoomService.getTeachers().subscribe({
      next: (r) => {
        if (r?.success) this.teachers = r.data || [];
      },
      error: () => {}
    });
  }

  private loadZoomHosts(): void {
    this.zoomService.getZoomHosts().subscribe({
      next: (r) => {
        if (r?.success) this.zoomAccounts = r.hosts || [];
      },
      error: () => {}
    });
  }

  private loadStudents(): void {
    this.zoomService.getAllStudents().subscribe({
      next: (r) => {
        if (r?.success) {
          this.allStudents = r.data || [];
          this.filterStudents();
        }
      },
      error: () => {
        this.errorMessage = 'Failed to load students';
      }
    });
  }

  onBatchChange(): void {
    const batch = this.basicForm.get('batch')?.value;
    const row = this.batchJourneyRows.find(
      (r) => String(r.batchName).toLowerCase() === String(batch).toLowerCase()
    );
    if (row) {
      const nextStart = Math.min(200, Math.max(1, row.batchCurrentDay + 1));
      this.basicForm.patchValue({
        startingJourneyDay: nextStart,
        targetJourneyDay: Math.min(row.journeyLength, Math.max(nextStart, row.batchCurrentDay + 40))
      });
    }
    this.selectedStudents = [];
    this.filterStudents();
    this.refreshZoomBusyHint();
  }

  onPlanChange(): void {
    this.selectedStudents = [];
    this.filterStudents();
  }

  filterStudents(): void {
    const batch = this.basicForm.get('batch')?.value;
    const plan = this.basicForm.get('plan')?.value;
    const q = this.searchTerm.trim().toLowerCase();
    this.filteredStudents = this.allStudents.filter((s) => {
      const okBatch = !batch || s.batch === batch;
      const okPlan = !plan || s.subscription === plan;
      const okStatus = s.studentStatus === 'ONGOING';
      const okSearch =
        !q ||
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.email && s.email.toLowerCase().includes(q));
      return okBatch && okPlan && okStatus && okSearch;
    });
  }

  onSearchInput(ev: Event): void {
    const v = (ev.target as HTMLInputElement)?.value ?? '';
    this.searchTerm = v;
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

  get busyZoomAccounts(): ZoomAccount[] {
    return this.zoomAccounts.filter((a) => a.isBusy);
  }

  formatConflictWhen(conflict: ZoomHostConflict): string {
    const dt = new Date(conflict.startTime);
    if (Number.isNaN(dt.getTime())) return '';
    const date = dt.toLocaleDateString('sr-Latn-RS', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    });
    const time = dt.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
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

  private istYmdFromMs(ms: number): string {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(ms));
  }

  private addDaysToIstYmd(ymd: string, days: number): string {
    const dt = new Date(`${ymd}T12:00:00+05:30`);
    dt.setTime(dt.getTime() + days * 86400000);
    return this.istYmdFromMs(dt.getTime());
  }

  private istWeekdaySun0(ms: number): number {
    const long = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long'
    }).format(new Date(ms));
    const map: Record<string, number> = {
      Sunday: 0,
      Monday: 1,
      Tuesday: 2,
      Wednesday: 3,
      Thursday: 4,
      Friday: 5,
      Saturday: 6
    };
    return map[long] ?? 0;
  }

  /** IST instant of the first generated class (for Zoom busy probe). */
  private probeFirstClassStartIso(): string | null {
    const startClock = String(this.basicForm.get('startClock')?.value || '19:00').substring(0, 5);
    const wds = new Set(this.selectedWeekdaysSun0);
    if (!wds.size) return null;
    const nowMs = Date.now();
    const pick = this.basicForm.get('firstClassWeekday')?.value;
    if (pick !== 'auto' && pick != null && pick !== '') {
      const target = Number(pick);
      if (wds.has(target)) {
        let ymd = this.istYmdFromMs(nowMs);
        for (let g = 0; g < 400; g++) {
          const ms = new Date(`${ymd}T${startClock}:00+05:30`).getTime();
          if (this.istWeekdaySun0(ms) === target && ms >= nowMs) {
            return `${ymd}T${startClock}:00+05:30`;
          }
          ymd = this.addDaysToIstYmd(ymd, 1);
        }
        return null;
      }
    }
    let ymd = this.istYmdFromMs(nowMs);
    for (let g = 0; g < 400; g++) {
      const ms = new Date(`${ymd}T${startClock}:00+05:30`).getTime();
      if (wds.has(this.istWeekdaySun0(ms)) && ms >= nowMs) {
        return `${ymd}T${startClock}:00+05:30`;
      }
      ymd = this.addDaysToIstYmd(ymd, 1);
    }
    return null;
  }

  /** First journey slot as ISO for Zoom busy check */
  refreshZoomBusyHint(): void {
    const dur = Number(this.basicForm.get('duration')?.value) || 120;
    const wds = this.selectedWeekdaysSun0;
    if (!wds.length) return;
    const startIso = this.probeFirstClassStartIso();
    if (!startIso) return;
    this.zoomService.getAvailableZoomHosts(startIso, dur).subscribe({
      next: (r) => {
        if (r?.success && Array.isArray(r.data)) this.zoomAccounts = r.data;
      },
      error: () => {}
    });
  }

  /** Build POST body for preview / create */
  private buildCorePayload(): Record<string, unknown> {
    const v = this.basicForm.getRawValue();
    return {
      batch: v.batch,
      plan: v.plan,
      topic: v.topic,
      teacherId: v.teacherId,
      zoomHostEmail: v.zoomHostEmail,
      duration: Number(v.duration) || 120,
      studentIds: this.selectedStudents.map((s) => s._id),
      weekdaysSun0: this.selectedWeekdaysSun0,
      startClock: String(v.startClock || '19:00').substring(0, 5),
      startingJourneyDay: Number(v.startingJourneyDay),
      targetJourneyDay: Number(v.targetJourneyDay),
      firstClassWeekdaySun0:
        v.firstClassWeekday === 'auto' || v.firstClassWeekday == null || v.firstClassWeekday === ''
          ? 'auto'
          : Number(v.firstClassWeekday)
    };
  }

  private validateBeforePreview(): boolean {
    this.errorMessage = '';
    if (this.basicForm.invalid) {
      this.basicForm.markAllAsTouched();
      this.errorMessage = 'Please complete basic details.';
      return false;
    }
    if (this.scheduleType !== 'journey') {
      this.errorMessage = 'Switch to Journey mode or use Create Meeting for other schedules.';
      return false;
    }
    if (!this.selectedWeekdaysSun0.length) {
      this.errorMessage = 'Select at least one weekday.';
      return false;
    }
    if (this.selectedStudents.length === 0) {
      this.errorMessage = 'Select at least one student.';
      return false;
    }
    return true;
  }

  private applyPreviewResponse(d: {
    schedules?: JourneyScheduleRow[];
    warnings?: string[];
    blockingErrors?: string[];
    studentConflicts?: StudentConflict[];
    totalTeachingHours?: number;
  }): boolean {
    this.schedules = (d.schedules || []).map((row) => ({
      journeyDay: Number(row.journeyDay),
      startTime: String(row.startTime || '').substring(0, 16),
      endTime: String(row.endTime || '').substring(0, 16)
    }));
    this.previewWarnings = d.warnings || [];
    this.previewBlocking = d.blockingErrors || [];
    this.studentConflicts = d.studentConflicts || [];
    this.totalTeachingHours = d.totalTeachingHours ?? 0;
    if (this.schedules.length === 0) {
      this.errorMessage = 'No class dates in preview.';
      return false;
    }
    this.previewSavedAt = new Date().toLocaleString('sr-Latn-RS', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    return true;
  }

  /** Generate schedule from wizard settings (discards manual row edits). */
  async runPreview(): Promise<boolean> {
    if (!this.validateBeforePreview()) return false;
    this.editingRowIndex = null;
    this.editDraft = null;

    this.isPreviewing = true;
    try {
      const res = await lastValueFrom(
        this.zoomService.previewBulkJourneyMeetings(this.buildCorePayload())
      );
      if (!res?.success) {
        this.errorMessage = res?.message || 'Preview failed';
        return false;
      }
      const ok = this.applyPreviewResponse(res.data);
      if (!ok) return false;
      this.shouldRegeneratePreview = false;
      return true;
    } catch (e: any) {
      this.errorMessage = e?.error?.message || 'Preview request failed';
      return false;
    } finally {
      this.isPreviewing = false;
    }
  }

  /** Re-check conflicts for current schedules (keeps admin edits). */
  async refreshPreviewWithSchedules(): Promise<boolean> {
    if (!this.validateBeforePreview()) return false;
    if (!this.schedules.length) {
      this.errorMessage = 'No meetings to preview.';
      return false;
    }

    this.isPreviewing = true;
    try {
      const res = await lastValueFrom(
        this.zoomService.previewBulkJourneyMeetings({
          ...this.buildCorePayload(),
          schedules: this.schedules
        })
      );
      if (!res?.success) {
        this.errorMessage = res?.message || 'Preview refresh failed';
        return false;
      }
      return this.applyPreviewResponse(res.data);
    } catch (e: any) {
      this.errorMessage = e?.error?.message || 'Preview refresh failed';
      return false;
    } finally {
      this.isPreviewing = false;
    }
  }

  isEditingRow(idx: number): boolean {
    return this.editingRowIndex === idx;
  }

  startEditRow(idx: number): void {
    const row = this.schedules[idx];
    if (!row) return;
    this.editingRowIndex = idx;
    this.editDraft = {
      journeyDay: row.journeyDay,
      startDate: this.rowStartDateIso(row),
      startClock: this.rowStartClock24(row)
    };
  }

  cancelEditRow(): void {
    this.editingRowIndex = null;
    this.editDraft = null;
  }

  async saveEditRow(idx: number): Promise<void> {
    if (!this.editDraft || this.editingRowIndex !== idx) return;
    const jd = Math.min(200, Math.max(1, Math.round(Number(this.editDraft.journeyDay))));
    if (!Number.isFinite(jd)) {
      this.errorMessage = 'Journey day must be between 1 and 200.';
      return;
    }
    const date = String(this.editDraft.startDate || '').trim();
    const clock = String(this.editDraft.startClock || '').substring(0, 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(clock)) {
      this.errorMessage = 'Enter a valid date and start time.';
      return;
    }

    const startTime = `${date}T${clock}`;
    const ms = this.slotMs(startTime);
    if (!Number.isFinite(ms)) {
      this.errorMessage = 'Invalid date or time.';
      return;
    }
    if (ms < Date.now() - 60000) {
      this.errorMessage = 'Start time cannot be in the past.';
      return;
    }

    const dur = Number(this.basicForm.get('duration')?.value) || 120;
    const endTime = this.formatIstLocal16(ms + dur * 60000);

    this.schedules[idx] = {
      journeyDay: jd,
      startTime: startTime.substring(0, 16),
      endTime: endTime.substring(0, 16)
    };

    this.isSavingRowEdit = true;
    this.editingRowIndex = null;
    this.editDraft = null;
    try {
      await this.refreshPreviewWithSchedules();
      this.snack.open('Row saved — preview updated with your changes.', 'OK', { duration: 4000 });
    } finally {
      this.isSavingRowEdit = false;
    }
  }

  rowStartDateIso(row: { startTime: string }): string {
    return String(row.startTime || '').substring(0, 10);
  }

  rowStartClock24(row: { startTime: string }): string {
    const t = String(row.startTime || '').substring(11, 16);
    return t.length >= 5 ? t : '19:00';
  }

  private formatIstLocal16(ms: number): string {
    const ymd = this.istYmdFromMs(ms);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date(ms));
    const hh = parts.find((x) => x.type === 'hour')?.value || '00';
    const mm = parts.find((x) => x.type === 'minute')?.value || '00';
    return `${ymd}T${hh}:${mm}`;
  }

  /** Load preview when opening the final “Preview & confirm” step. */
  stepperSelectionChanged(ev: StepperSelectionEvent): void {
    const prev = ev.previouslySelectedIndex;
    const cur = ev.selectedIndex;
    if (cur === 1) {
      this.refreshZoomBusyHint();
    }
    if (cur === 3 && (this.shouldRegeneratePreview || !this.schedules.length)) {
      void this.runPreview();
    }
    if (prev === 3 && cur < 3) {
      this.shouldRegeneratePreview = true;
      this.cancelEditRow();
    }
  }

  /** “Today” in India Standard Time — shown on the schedule step. */
  istTodayDisplay(): string {
    return new Date().toLocaleString('sr-Latn-RS', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  /** Parse YYYY-MM-DDTHH:mm as IST wall clock. */
  private slotMs(local16: string): number {
    const pad = String(local16 || '').substring(0, 16);
    if (pad.length < 16) return NaN;
    return new Date(`${pad}:00+05:30`).getTime();
  }

  rowWeekday(row: JourneyScheduleRow): string {
    const ms = this.slotMs(row.startTime);
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleDateString('sr-Latn-RS', {
      weekday: 'long',
      timeZone: 'Asia/Kolkata'
    });
  }

  rowDate(row: { startTime: string }): string {
    const ms = this.slotMs(row.startTime);
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleDateString('sr-Latn-RS', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  rowStartTime(row: { startTime: string }): string {
    const ms = this.slotMs(row.startTime);
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  rowEndTime(row: { endTime: string }): string {
    const raw = String(row.endTime || '').substring(0, 16);
    if (raw.length < 16) return '—';
    const ms = this.slotMs(raw);
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  async submitBulkCreate(): Promise<void> {
    this.errorMessage = '';
    if (this.editingRowIndex != null) {
      this.errorMessage = 'Save or cancel the row you are editing before creating meetings.';
      return;
    }
    const ok = await this.refreshPreviewWithSchedules();
    if (!ok) return;

    const hard = this.previewWarnings.filter(
      (w) =>
        w.includes('Zoom host busy') ||
        w.includes('Teacher overlap') ||
        w.includes('Student overlap') ||
        w.includes('Duplicate future')
    );
    if (hard.length && !this.previewBlocking.length) {
      const proceed = confirm(
        `${hard.length} potential hard conflict(s) reported in preview. Create anyway where possible?`
      );
      if (!proceed) return;
    }
    if (this.previewBlocking.length) {
      this.errorMessage = this.previewBlocking.join('; ');
      return;
    }

    const v = this.basicForm.getRawValue();
    const common: Record<string, unknown> = {
      topic: v.topic,
      batch: v.batch,
      plan: v.plan,
      teacherId: v.teacherId,
      zoomHostEmail: v.zoomHostEmail,
      timezone: 'Asia/Kolkata',
      duration: Number(v.duration) || 120,
      agenda: `German Language Class - Batch ${v.batch}`,
      studentIds: this.selectedStudents.map((s) => s._id),
      bulkScheduleId: this.bulkScheduleId,
      startingJourneyDay: Number(v.startingJourneyDay),
      targetJourneyDay: Number(v.targetJourneyDay)
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
      for (let i = 0; i < rows.length; i += this.chunkSize) {
        const chunk = rows.slice(i, i + this.chunkSize);
        const res = await lastValueFrom(
          this.zoomService.createBulkJourneyMeetingsChunk({
            ...common,
            schedules: chunk
          })
        );
        const n = res?.summary?.createdCount ?? res?.data?.meetings?.length ?? 0;
        created += n;
        this.bulkProgressDone = Math.min(this.bulkProgressTotal, i + chunk.length);
        const fs = res?.summary?.failedSchedules || [];
        for (const f of fs) {
          failures.push(`${f.startTime}: ${f.message}`);
        }
      }

      this.snack.open(
        `Created ${created} meeting(s)` + (failures.length ? `; ${failures.length} failed.` : '.'),
        'OK',
        { duration: 6000 }
      );
      if (failures.length) {
        console.warn('Bulk journey failures', failures);
      }
      await this.router.navigate(['/teacher/meetings']);
    } catch (e: any) {
      this.errorMessage = e?.error?.message || 'Bulk create failed';
    } finally {
      this.isBulkCreating = false;
    }
  }

  /** Remove the clashing students from all future meetings of the conflicting batch, then re-run preview. */
  async resolveStudentConflict(conflict: StudentConflict): Promise<void> {
    const studentIds = conflict.clashingStudents.map((s) => s.studentId);
    const names = conflict.clashingStudents.map((s) => s.name || s.email).join(', ');
    const confirmed = confirm(
      `Remove ${names} from all future scheduled meetings of Batch "${conflict.conflictingBatch}"?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;
    this.isResolvingConflict = true;
    try {
      const res = await lastValueFrom(
        this.zoomService.removeStudentsFromBatch(conflict.conflictingBatch, studentIds)
      );
      if (res?.success) {
        this.snack.open(
          `Removed ${names} from ${res.updatedCount} Batch ${conflict.conflictingBatch} meeting(s). Re-running preview…`,
          'OK',
          { duration: 5000 }
        );
        await this.runPreview();
      } else {
        this.errorMessage = res?.message || 'Failed to remove students from conflicting meetings.';
      }
    } catch (e: any) {
      this.errorMessage = e?.error?.message || 'Failed to remove students from conflicting meetings.';
    } finally {
      this.isResolvingConflict = false;
    }
  }

  goToWeeklyCreate(): void {
    this.router.navigate(['/teacher/meetings/create']);
  }

  teacherLabel(id: string): string {
    const t = this.teachers.find((x) => x._id === id);
    return t ? `${t.name} (${t.email})` : id || '—';
  }
}
