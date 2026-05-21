import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MaterialModule } from '../../shared/material.module';
import { GluckRoomService } from '../../services/gluck-room.service';
import { ClassRecordingsService } from '../../services/class-recordings.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-gluck-room-create',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './gluck-room-create.component.html',
  styleUrls: ['./gluck-room-create.component.scss']
})
export class GluckRoomCreateComponent implements OnInit {
  editId: string | null = null;
  sessionName = '';
  batch = '';
  scheduledStartTime = '';
  maxDurationMinutes = 180;
  courseDay: number | null = null;
  level: string | null = null;
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

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private gluckRoomService: GluckRoomService,
    private classRecordingsService: ClassRecordingsService,
    private auth: AuthService
  ) {}

  get isEditMode(): boolean {
    return !!this.editId;
  }

  ngOnInit(): void {
    const user = this.auth.getSnapshotUser();
    this.userRole = user?.role || '';
    this.editId = this.route.snapshot.paramMap.get('id');
    this.loadBatches();
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

  private loadSession(): void {
    if (!this.editId) return;
    this.loading = true;
    this.gluckRoomService.getSession(this.editId).subscribe({
      next: (res) => {
        if (res.success) {
          const s = res.data;
          this.sessionName = s.sessionName || '';
          this.batch = s.batch || '';
          this.scheduledStartTime = s.scheduledStartTime
            ? new Date(s.scheduledStartTime).toISOString().slice(0, 16)
            : '';
          this.maxDurationMinutes = s.maxDurationMinutes || 180;
          this.courseDay = s.courseDay || null;
          this.level = s.level || null;
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
  }

  onSubmit(): void {
    if (!this.sessionName.trim() || !this.batch || !this.scheduledStartTime) {
      this.error = 'Session name, batch, and start time are required.';
      return;
    }

    this.submitting = true;
    this.error = '';

    const payload: any = {
      sessionName: this.sessionName.trim(),
      batch: this.batch,
      scheduledStartTime: new Date(this.scheduledStartTime).toISOString(),
      maxDurationMinutes: this.maxDurationMinutes,
      accessType: this.accessType
    };

    if (this.courseDay) payload.courseDay = this.courseDay;
    if (this.level) payload.level = this.level;

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

  cancel(): void {
    this.router.navigate(['/gluck-room']);
  }
}
