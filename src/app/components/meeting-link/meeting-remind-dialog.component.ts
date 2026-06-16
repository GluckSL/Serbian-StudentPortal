import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { ZoomService } from '../../services/zoom.service';

export interface MeetingRemindDialogData {
  meetingId: string;
  topic: string;
}

interface RemindStudent {
  studentId: string;
  name: string;
  email: string;
  hasJoined: boolean;
  joinedAt?: string | null;
  selected: boolean;
}

@Component({
  selector: 'app-meeting-remind-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatDividerModule,
  ],
  template: `
    <div class="remind-dialog">
      <div class="remind-dialog-header">
        <mat-icon class="header-icon">notifications_active</mat-icon>
        <div>
          <h2>Send class reminder</h2>
          <p class="subtitle">{{ data.topic }}</p>
        </div>
        <button mat-icon-button [mat-dialog-close]="null" [disabled]="sending">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <mat-divider></mat-divider>

      <div class="remind-dialog-body" *ngIf="loading">
        <mat-spinner diameter="36"></mat-spinner>
        <p>Loading student join status…</p>
      </div>

      <div class="remind-dialog-body" *ngIf="!loading && loadError">
        <mat-icon color="warn">error_outline</mat-icon>
        <p>{{ loadError }}</p>
        <button mat-stroked-button (click)="loadPreview()">Retry</button>
      </div>

      <div class="remind-dialog-body" *ngIf="!loading && !loadError">
        <div class="summary-banner" *ngIf="preview">
          <mat-icon>groups</mat-icon>
          <span>
            {{ preview.joinedCount }} joined · {{ preview.notJoinedCount }} not joined
            ({{ preview.totalStudents }} total)
          </span>
        </div>

        <section *ngIf="notJoinedStudents.length">
          <h3>Not joined — selected by default</h3>
          <p class="section-hint">These students have not clicked Join in the portal yet.</p>
          <div class="student-list">
            <label class="student-row" *ngFor="let s of notJoinedStudents">
              <mat-checkbox [(ngModel)]="s.selected" [disabled]="sending"></mat-checkbox>
              <span class="student-info">
                <span class="student-name">{{ s.name }}</span>
                <span class="student-email">{{ s.email }}</span>
              </span>
              <span class="status-badge status-badge--absent">Not joined</span>
            </label>
          </div>
        </section>

        <section *ngIf="joinedStudents.length">
          <h3>Already joined</h3>
          <p class="section-hint">Select students who may have left early and need another reminder.</p>
          <div class="student-list">
            <label class="student-row" *ngFor="let s of joinedStudents">
              <mat-checkbox [(ngModel)]="s.selected" [disabled]="sending"></mat-checkbox>
              <span class="student-info">
                <span class="student-name">{{ s.name }}</span>
                <span class="student-email">{{ s.email }}</span>
              </span>
              <span class="status-badge status-badge--joined">
                Joined{{ s.joinedAt ? ' · ' + formatJoinedAt(s.joinedAt) : '' }}
              </span>
            </label>
          </div>
        </section>

        <p class="empty-hint" *ngIf="!notJoinedStudents.length && !joinedStudents.length">
          No students are enrolled in this class.
        </p>

        <p class="send-error" *ngIf="sendError">{{ sendError }}</p>
      </div>

      <mat-divider></mat-divider>

      <div class="remind-dialog-actions">
        <button mat-button [mat-dialog-close]="null" [disabled]="sending">Cancel</button>
        <button
          mat-flat-button
          color="primary"
          (click)="confirmSend()"
          [disabled]="loading || !!loadError || sending || selectedCount() === 0">
          <mat-spinner diameter="18" *ngIf="sending" class="btn-spinner"></mat-spinner>
          <span *ngIf="!sending">Confirm &amp; send ({{ selectedCount() }})</span>
          <span *ngIf="sending">Sending…</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .remind-dialog { min-width: 320px; max-width: 520px; font-family: 'Inter', system-ui, sans-serif; }
    .remind-dialog-header {
      display: flex; align-items: flex-start; gap: 12px; padding: 16px 16px 12px;
    }
    .remind-dialog-header h2 { margin: 0; font-size: 18px; font-weight: 700; color: #011f4b; }
    .subtitle { margin: 4px 0 0; font-size: 13px; color: #64748b; }
    .header-icon { color: #000e89; font-size: 28px; width: 28px; height: 28px; margin-top: 2px; }
    .remind-dialog-header button:last-child { margin-left: auto; }
    .remind-dialog-body { padding: 16px; max-height: 60vh; overflow-y: auto; }
    .remind-dialog-body > mat-spinner { margin: 24px auto; display: block; }
    .summary-banner {
      display: flex; align-items: center; gap: 8px;
      background: #e7f3ff; border: 1px solid #b8daff; border-radius: 8px;
      padding: 10px 12px; font-size: 13px; color: #011f4b; margin-bottom: 16px;
    }
    .summary-banner mat-icon { font-size: 18px; width: 18px; height: 18px; color: #000e89; }
    section { margin-bottom: 18px; }
    section h3 { margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #011f4b; }
    .section-hint { margin: 0 0 10px; font-size: 12px; color: #64748b; }
    .student-list { display: flex; flex-direction: column; gap: 6px; }
    .student-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border: 1px solid #e8ecf4; border-radius: 8px;
      background: #fafbfc; cursor: pointer;
    }
    .student-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .student-name { font-size: 13px; font-weight: 600; color: #0f172a; }
    .student-email { font-size: 11px; color: #64748b; overflow: hidden; text-overflow: ellipsis; }
    .status-badge {
      font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 999px; white-space: nowrap;
    }
    .status-badge--absent { background: #fee2e2; color: #b91c1c; }
    .status-badge--joined { background: #d1fae5; color: #047857; }
    .empty-hint, .send-error { font-size: 13px; color: #64748b; text-align: center; }
    .send-error { color: #b91c1c; margin-top: 8px; }
    .remind-dialog-actions {
      display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px;
    }
    .btn-spinner { display: inline-block; margin-right: 6px; vertical-align: middle; }
  `],
})
export class MeetingRemindDialogComponent implements OnInit {
  loading = true;
  sending = false;
  loadError = '';
  sendError = '';
  preview: any = null;
  notJoinedStudents: RemindStudent[] = [];
  joinedStudents: RemindStudent[] = [];

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: MeetingRemindDialogData,
    private dialogRef: MatDialogRef<MeetingRemindDialogComponent>,
    private zoomService: ZoomService,
  ) {}

  ngOnInit(): void {
    this.loadPreview();
  }

  loadPreview(): void {
    this.loading = true;
    this.loadError = '';
    this.zoomService.getJoinReminderPreview(this.data.meetingId).subscribe({
      next: (res) => {
        if (!res?.success) {
          this.loadError = res?.message || 'Could not load join status';
          this.loading = false;
          return;
        }
        this.preview = res.data;
        this.notJoinedStudents = (res.data.notJoined || []).map((s: any) => ({
          ...s,
          selected: true,
        }));
        this.joinedStudents = (res.data.joined || []).map((s: any) => ({
          ...s,
          selected: false,
        }));
        this.loading = false;
      },
      error: (err) => {
        this.loadError = err.error?.message || 'Could not load join status';
        this.loading = false;
      },
    });
  }

  selectedCount(): number {
    return [...this.notJoinedStudents, ...this.joinedStudents].filter((s) => s.selected).length;
  }

  formatJoinedAt(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      });
    } catch {
      return '';
    }
  }

  confirmSend(): void {
    const ids = [...this.notJoinedStudents, ...this.joinedStudents]
      .filter((s) => s.selected && s.studentId)
      .map((s) => s.studentId);

    if (!ids.length) return;

    this.sending = true;
    this.sendError = '';

    this.zoomService.sendJoinReminder(this.data.meetingId, ids).subscribe({
      next: (res) => {
        this.sending = false;
        if (res?.success) {
          this.dialogRef.close({ sent: res.data?.successful || ids.length });
        } else {
          this.sendError = res?.message || 'Failed to send reminders';
        }
      },
      error: (err) => {
        this.sending = false;
        this.sendError = err.error?.message || 'Failed to send reminders';
      },
    });
  }
}
