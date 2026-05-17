// Bulk journey scheduling wizard — reuses Zoom + MeetingLink backend (IST).

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService, Student, Teacher, ZoomAccount, ZoomHostConflict } from '../../services/zoom.service';
import { environment } from '../../../environments/environment';
import { MatSnackBar } from '@angular/material/snack-bar';
import { StepperSelectionEvent } from '@angular/cdk/stepper';

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
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
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

  /** Generated slots from server preview */
  schedules: Array<{
    journeyDay: number;
    startTime: string;
    endTime: string;
  }> = [];

  previewWarnings: string[] = [];
  previewBlocking: string[] = [];
  totalTeachingHours = 0;

  isLoading = false;
  isPreviewing = false;
  isBulkCreating = false;
  bulkProgressDone = 0;
  bulkProgressTotal = 0;
  errorMessage = '';
  searchTerm = '';

  bulkScheduleId = '';

  readonly weekdayOptions = WEEKDAY_META;

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
      targetJourneyDay: [100, [Validators.required, Validators.min(1), Validators.max(200)]]
    });

    const wk: Record<string, boolean> = {};
    for (const d of WEEKDAY_META) {
      wk[d.key] = d.sun0 === 1 || d.sun0 === 3 || d.sun0 === 5;
    }
    this.weekForm = this.fb.group(wk);

    this.loadBatchJourney();
    this.loadTeachers();
    this.loadZoomHosts();
    this.loadStudents();
  }

  get scheduleType(): string {
    return this.basicForm.get('scheduleType')?.value || 'journey';
  }

  get selectedWeekdaysSun0(): number[] {
    return WEEKDAY_META.filter((d) => this.weekForm.get(d.key)?.value === true).map((d) => d.sun0);
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
    const date = dt.toLocaleDateString('en-IN', {
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

  /** First journey slot as ISO for Zoom busy check */
  refreshZoomBusyHint(): void {
    const dur = Number(this.basicForm.get('duration')?.value) || 120;
    const startClock = this.basicForm.get('startClock')?.value || '19:00';
    const wds = this.selectedWeekdaysSun0;
    if (!wds.length) return;
    const now = new Date();
    const ymd = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);
    const probe = `${ymd}T${String(startClock).substring(0, 5)}`;
    const startIso = `${probe}:00+05:30`;
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
      targetJourneyDay: Number(v.targetJourneyDay)
    };
  }

  /** Run preview API and fill schedules + warnings */
  async runPreview(): Promise<boolean> {
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

    this.isPreviewing = true;
    try {
      const res = await lastValueFrom(
        this.zoomService.previewBulkJourneyMeetings(this.buildCorePayload())
      );
      if (!res?.success) {
        this.errorMessage = res?.message || 'Preview failed';
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
        this.errorMessage = 'No class dates generated. Check journey range and weekdays.';
        return false;
      }
      return true;
    } catch (e: any) {
      this.errorMessage = e?.error?.message || 'Preview request failed';
      return false;
    } finally {
      this.isPreviewing = false;
    }
  }

  /** Load preview when opening the final “Preview & confirm” step. */
  stepperSelectionChanged(ev: StepperSelectionEvent): void {
    if (ev.selectedIndex === 3) {
      void this.runPreview();
    }
  }

  /** “Today” in India Standard Time — shown on the schedule step. */
  istTodayDisplay(): string {
    return new Date().toLocaleString('en-IN', {
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

  rowWeekday(row: { startTime: string }): string {
    const ms = this.slotMs(row.startTime);
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'Asia/Kolkata'
    });
  }

  rowDate(row: { startTime: string }): string {
    const ms = this.slotMs(row.startTime);
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleDateString('en-GB', {
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
    const ok = await this.runPreview();
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

  goToWeeklyCreate(): void {
    this.router.navigate(['/teacher/meetings/create']);
  }

  teacherLabel(id: string): string {
    const t = this.teachers.find((x) => x._id === id);
    return t ? `${t.name} (${t.email})` : id || '—';
  }
}
