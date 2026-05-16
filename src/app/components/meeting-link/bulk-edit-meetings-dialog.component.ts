import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ZoomService } from '../../services/zoom.service';

export interface BulkEditMeetingsDialogData {
  selectedMeetings: any[];
}

type DialogStep = 'form' | 'preview' | 'applying' | 'result';

@Component({
  selector: 'app-bulk-edit-meetings-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatChipsModule,
    MatTooltipModule,
  ],
  template: `
    <div class="bulk-dialog-wrap">
      <!-- Header -->
      <div class="bulk-dialog-header">
        <mat-icon class="header-icon">edit_calendar</mat-icon>
        <div>
          <h2 class="header-title">Bulk Edit Meetings</h2>
          <p class="header-sub">
            {{ data.selectedMeetings.length }} scheduled meeting{{ data.selectedMeetings.length !== 1 ? 's' : '' }} selected
            <span *ngIf="batchLabel" class="batch-chip">{{ batchLabel }}</span>
          </p>
        </div>
        <button mat-icon-button class="close-btn" [mat-dialog-close]="null" *ngIf="step !== 'applying'">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <mat-divider></mat-divider>

      <!-- ===== STEP: FORM ===== -->
      <div class="bulk-dialog-body" *ngIf="step === 'form'">
        <div class="info-banner">
          <mat-icon>info</mat-icon>
          <span>Only fill in the fields you want to update. Empty fields are ignored.</span>
        </div>

        <!-- Schedule -->
        <div class="field-section">
          <p class="section-label">Schedule</p>
          <div class="time-card">
            <div class="time-card-header">
              <mat-icon>schedule</mat-icon>
              Start time (IST)
            </div>
            <div class="time-card-body">
              <label class="time-field-label">Class start</label>
              <div class="time-input-row" (click)="openClockPicker(startTimeInput)">
                <input
                  #startTimeInput
                  type="time"
                  step="1"
                  class="time-native-input"
                  [(ngModel)]="formStartClockTime"
                  name="startClockTime"
                  (ngModelChange)="onStartClockInput()"
                  (click)="$event.stopPropagation()"
                />
                <button
                  type="button"
                  class="time-clock-btn"
                  matTooltip="Open clock"
                  aria-label="Open clock to pick time"
                  (click)="$event.stopPropagation(); openClockPicker(startTimeInput)">
                  <mat-icon>schedule</mat-icon>
                </button>
              </div>
              <div class="time-breakdown" [class.time-breakdown--empty]="!hasStartClockTime">
                <div class="time-segments">
                  <div class="time-segment">
                    <span class="time-digit">{{ timeParts?.hour ?? '--' }}</span>
                    <span class="time-segment-label">Hour</span>
                  </div>
                  <span class="time-colon" aria-hidden="true">:</span>
                  <div class="time-segment">
                    <span class="time-digit">{{ timeParts?.minute ?? '--' }}</span>
                    <span class="time-segment-label">Minute</span>
                  </div>
                  <span class="time-colon" aria-hidden="true">:</span>
                  <div class="time-segment">
                    <span class="time-digit">{{ timeParts?.second ?? '--' }}</span>
                    <span class="time-segment-label">Second</span>
                  </div>
                  <span class="time-ampm">{{ timeParts?.ampm ?? '—' }}</span>
                </div>
                <p class="time-readable" *ngIf="hasStartClockTime">{{ formattedStartClockDisplay }}</p>
                <p class="time-readable time-readable--hint" *ngIf="!hasStartClockTime">
                  Tap the clock icon to pick a time. Leave empty for no change.
                </p>
              </div>
              <p class="time-hint">Sets the same time on each meeting's date (IST).</p>
            </div>
          </div>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Duration</mat-label>
            <mat-select [(ngModel)]="formDuration" name="duration">
              <mat-option [value]="null">— No change —</mat-option>
              <mat-option [value]="30">30 minutes</mat-option>
              <mat-option [value]="45">45 minutes</mat-option>
              <mat-option [value]="60">1 hour</mat-option>
              <mat-option [value]="90">1.5 hours</mat-option>
              <mat-option [value]="120">2 hours</mat-option>
              <mat-option [value]="150">2.5 hours</mat-option>
              <mat-option [value]="180">3 hours</mat-option>
            </mat-select>
          </mat-form-field>
        </div>

        <!-- Topic + Agenda + Course Day -->
        <div class="field-section">
          <p class="section-label">Details</p>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Topic</mat-label>
            <input matInput [(ngModel)]="formTopic" name="topic" placeholder="Leave blank for no change">
          </mat-form-field>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Agenda</mat-label>
            <textarea matInput [(ngModel)]="formAgenda" name="agenda" rows="3" placeholder="Leave blank for no change"></textarea>
          </mat-form-field>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Course Day</mat-label>
            <input matInput type="number" [(ngModel)]="formCourseDay" name="courseDay" min="1" max="200" placeholder="Leave blank for no change">
            <mat-hint>1–200. Enter 0 to clear the course day restriction.</mat-hint>
          </mat-form-field>
        </div>

        <!-- Assigned Teacher -->
        <div class="field-section" *ngIf="teachers.length > 0">
          <p class="section-label">Staff</p>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Assigned Teacher</mat-label>
            <mat-select [(ngModel)]="formTeacherId" name="teacher">
              <mat-option [value]="null">— No change —</mat-option>
              <mat-option *ngFor="let t of teachers" [value]="t._id">{{ t.name }}</mat-option>
            </mat-select>
          </mat-form-field>
        </div>

        <!-- Add Students -->
        <div class="field-section">
          <p class="section-label">Add Participants</p>
          <p class="section-hint">These students will be added to every selected meeting.</p>

          <!-- Search + select-all row -->
          <div class="student-search-row">
            <mat-form-field appearance="outline" class="student-search-field">
              <mat-label>Search students</mat-label>
              <input matInput [(ngModel)]="studentSearch" (ngModelChange)="filterStudents()" placeholder="Name or email…">
              <mat-icon matSuffix>search</mat-icon>
            </mat-form-field>
            <button mat-stroked-button class="select-all-btn"
                    *ngIf="!loadingStudents && filteredStudents.length > 0"
                    (click)="toggleSelectAllStudents()">
              <mat-icon>{{ areAllFilteredStudentsSelected() ? 'indeterminate_check_box' : 'select_all' }}</mat-icon>
              {{ areAllFilteredStudentsSelected() ? 'Deselect All' : 'Select All' }}
              <span class="select-all-count" *ngIf="filteredStudents.length > 0">({{ filteredStudents.length }})</span>
            </button>
          </div>

          <div class="student-list" *ngIf="filteredStudents.length > 0">
            <div *ngFor="let s of filteredStudents" class="student-row"
                 [class.selected]="isStudentSelected(s._id)"
                 (click)="toggleStudent(s)">
              <div class="student-check">
                <mat-icon>{{ isStudentSelected(s._id) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
              </div>
              <div class="student-info">
                <span class="student-name">{{ s.name }}</span>
                <span class="student-meta">{{ s.email }} · Batch {{ s.batch }}</span>
              </div>
            </div>
          </div>
          <p class="no-students" *ngIf="filteredStudents.length === 0 && !loadingStudents">
            {{ studentSearch ? 'No matching students' : 'No students available' }}
          </p>
          <div class="loading-row" *ngIf="loadingStudents">
            <mat-spinner diameter="24"></mat-spinner>
            <span>Loading students…</span>
          </div>

          <div class="selected-students-chips" *ngIf="selectedStudentsToAdd.length > 0">
            <span class="chips-label">{{ selectedStudentsToAdd.length }} student{{ selectedStudentsToAdd.length !== 1 ? 's' : '' }} selected:</span>
            <span *ngFor="let s of selectedStudentsToAdd" class="student-chip">
              {{ s.name }}
              <mat-icon class="chip-remove" (click)="removeSelectedStudent(s._id); $event.stopPropagation()">close</mat-icon>
            </span>
          </div>
        </div>

        <!-- Mixed-batch warning -->
        <div class="warn-banner" *ngIf="mixedBatches">
          <mat-icon>warning</mat-icon>
          <span>Selected meetings span multiple batches ({{ batchLabel }}). Students shown are from all batches.</span>
        </div>
      </div>

      <!-- ===== STEP: PREVIEW ===== -->
      <div class="bulk-dialog-body" *ngIf="step === 'preview'">
        <p class="preview-title">Review changes before applying</p>
        <div class="preview-table">
          <div class="preview-row" *ngIf="hasStartClockTime">
            <span class="preview-key">Start Time</span>
            <span class="preview-val">→ {{ clockTimeLabel(formStartClockTime) }} on each meeting's date</span>
          </div>
          <div class="preview-row" *ngIf="formDuration">
            <span class="preview-key">Duration</span>
            <span class="preview-val">→ {{ durationLabel(formDuration) }}</span>
          </div>
          <div class="preview-row" *ngIf="formTopic">
            <span class="preview-key">Topic</span>
            <span class="preview-val">→ "{{ formTopic }}"</span>
          </div>
          <div class="preview-row" *ngIf="formAgenda">
            <span class="preview-key">Agenda</span>
            <span class="preview-val">→ updated</span>
          </div>
          <div class="preview-row" *ngIf="formCourseDay !== null && formCourseDay !== undefined">
            <span class="preview-key">Course Day</span>
            <span class="preview-val">→ {{ formCourseDay === 0 ? 'cleared' : formCourseDay }}</span>
          </div>
          <div class="preview-row" *ngIf="formTeacherId">
            <span class="preview-key">Teacher</span>
            <span class="preview-val">→ {{ teacherName(formTeacherId) }}</span>
          </div>
          <div class="preview-row" *ngIf="selectedStudentsToAdd.length > 0">
            <span class="preview-key">Add Participants</span>
            <span class="preview-val">→ {{ selectedStudentsToAdd.length }} student{{ selectedStudentsToAdd.length !== 1 ? 's' : '' }} added to each meeting</span>
          </div>
          <div class="preview-row no-changes" *ngIf="noChanges">
            <mat-icon>info</mat-icon>
            <span>No changes specified. Please go back and fill in at least one field.</span>
          </div>
        </div>
        <p class="preview-meetings-count">
          This will update <strong>{{ data.selectedMeetings.length }}</strong> scheduled meeting{{ data.selectedMeetings.length !== 1 ? 's' : '' }}.
        </p>
      </div>

      <!-- ===== STEP: APPLYING ===== -->
      <div class="bulk-dialog-body applying-body" *ngIf="step === 'applying'">
        <mat-spinner diameter="48"></mat-spinner>
        <p class="applying-text">Applying changes to {{ data.selectedMeetings.length }} meetings…</p>
        <p class="applying-sub">This may take a moment. Please wait.</p>
      </div>

      <!-- ===== STEP: RESULT ===== -->
      <div class="bulk-dialog-body" *ngIf="step === 'result' && applyResult">
        <div class="result-summary" [class.result-all-ok]="applyResult.summary.failed === 0" [class.result-partial]="applyResult.summary.failed > 0">
          <mat-icon>{{ applyResult.summary.failed === 0 ? 'check_circle' : 'warning' }}</mat-icon>
          <div>
            <p class="result-headline">
              {{ applyResult.summary.updated }} of {{ applyResult.summary.total }} meeting{{ applyResult.summary.total !== 1 ? 's' : '' }} updated successfully.
            </p>
            <p class="result-sub" *ngIf="applyResult.summary.failed > 0">
              {{ applyResult.summary.failed }} meeting{{ applyResult.summary.failed !== 1 ? 's' : '' }} could not be updated.
            </p>
          </div>
        </div>
        <div class="error-list" *ngIf="failedResults.length > 0">
          <p class="error-list-title">Issues:</p>
          <div class="error-row" *ngFor="let r of failedResults">
            <mat-icon>error_outline</mat-icon>
            <span>{{ r.message }}</span>
          </div>
        </div>
      </div>

      <mat-divider></mat-divider>

      <!-- Footer actions -->
      <div class="bulk-dialog-footer">
        <!-- Form step -->
        <ng-container *ngIf="step === 'form'">
          <button mat-stroked-button [mat-dialog-close]="null">Cancel</button>
          <button mat-raised-button color="primary" (click)="goToPreview()">
            Preview Changes
            <mat-icon>arrow_forward</mat-icon>
          </button>
        </ng-container>

        <!-- Preview step -->
        <ng-container *ngIf="step === 'preview'">
          <button mat-stroked-button (click)="step = 'form'">
            <mat-icon>arrow_back</mat-icon>
            Back
          </button>
          <button mat-raised-button color="primary" (click)="applyChanges()" [disabled]="noChanges">
            <mat-icon>check</mat-icon>
            Apply to {{ data.selectedMeetings.length }} Meeting{{ data.selectedMeetings.length !== 1 ? 's' : '' }}
          </button>
        </ng-container>

        <!-- Result step -->
        <ng-container *ngIf="step === 'result'">
          <button mat-raised-button color="primary" (click)="close()">Done</button>
        </ng-container>
      </div>
    </div>
  `,
  styles: [`
    .bulk-dialog-wrap {
      width: 560px;
      max-width: 100%;
      display: flex;
      flex-direction: column;
      font-family: inherit;
    }

    .bulk-dialog-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 20px 20px 16px;
      position: relative;
    }

    .header-icon {
      color: #5c6bc0;
      font-size: 28px;
      width: 28px;
      height: 28px;
      margin-top: 2px;
      flex-shrink: 0;
    }

    .header-title {
      margin: 0 0 4px;
      font-size: 18px;
      font-weight: 600;
      color: #1e293b;
    }

    .header-sub {
      margin: 0;
      font-size: 13px;
      color: #64748b;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .batch-chip {
      background: #e0e7ff;
      color: #3730a3;
      border-radius: 12px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
    }

    .close-btn {
      position: absolute;
      right: 12px;
      top: 12px;
    }

    .bulk-dialog-body {
      padding: 16px 20px;
      overflow-y: auto;
      max-height: 62vh;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .info-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      color: #1e40af;
      margin-bottom: 8px;
    }

    .warn-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      color: #92400e;
      margin-top: 4px;
    }

    .field-section {
      margin-bottom: 8px;
    }

    .section-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #94a3b8;
      margin: 8px 0 4px;
    }

    .section-hint {
      font-size: 12px;
      color: #64748b;
      margin: 0 0 8px;
    }

    .full-width {
      width: 100%;
    }

    .time-card {
      border: 1px solid #e8ecf4;
      border-radius: 12px;
      overflow: hidden;
      background: #fff;
      margin-bottom: 12px;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
    }

    .time-card-header {
      background: #03396c;
      color: #fff;
      padding: 10px 14px;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .time-card-header mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .time-card-body {
      padding: 14px;
    }

    .time-field-label {
      font-weight: 700;
      color: #94a3b8;
      margin-bottom: 6px;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      display: block;
    }

    .time-input-row {
      display: flex;
      align-items: stretch;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
      cursor: pointer;
    }

    .time-native-input {
      flex: 1;
      min-width: 0;
      border: none;
      padding: 10px 12px;
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
      background: transparent;
      font-family: inherit;
    }

    .time-native-input:focus {
      outline: none;
    }

    .time-native-input::-webkit-calendar-picker-indicator {
      display: none;
    }

    .time-clock-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-left: 1px solid #e2e8f0;
      background: #f8fafc;
      padding: 0 14px;
      cursor: pointer;
      color: #03396c;
      transition: background 0.15s;
    }

    .time-clock-btn:hover {
      background: #eff6ff;
    }

    .time-clock-btn mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .time-breakdown {
      margin-top: 12px;
      padding: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
    }

    .time-breakdown--empty .time-digit {
      color: #cbd5e1;
    }

    .time-segments {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      gap: 4px;
      flex-wrap: wrap;
    }

    .time-segment {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 52px;
    }

    .time-digit {
      font-size: 22px;
      font-weight: 700;
      color: #03396c;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }

    .time-segment-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      margin-top: 4px;
    }

    .time-colon {
      font-size: 20px;
      font-weight: 700;
      color: #64748b;
      padding-bottom: 18px;
    }

    .time-ampm {
      font-size: 14px;
      font-weight: 700;
      color: #0369a1;
      padding-bottom: 16px;
      margin-left: 6px;
    }

    .time-readable {
      margin: 10px 0 0;
      text-align: center;
      font-size: 13px;
      font-weight: 600;
      color: #334155;
    }

    .time-readable--hint {
      font-weight: 500;
      color: #94a3b8;
    }

    .time-hint {
      margin: 10px 0 0;
      font-size: 12px;
      color: #64748b;
    }

    .student-search-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .student-search-field {
      flex: 1;
    }

    .select-all-btn {
      margin-top: 4px;
      flex-shrink: 0;
      height: 40px;
      font-size: 12px;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .select-all-count {
      font-weight: 700;
      margin-left: 2px;
    }

    .student-list {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow-y: auto;
      max-height: 180px;
      margin-bottom: 8px;
    }

    .student-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      cursor: pointer;
      transition: background 0.15s;
      border-bottom: 1px solid #f1f5f9;
    }

    .student-row:last-child { border-bottom: none; }

    .student-row:hover { background: #f8fafc; }

    .student-row.selected { background: #eff6ff; }

    .student-check mat-icon {
      font-size: 20px;
      color: #64748b;
    }

    .student-row.selected .student-check mat-icon { color: #3b82f6; }

    .student-info {
      display: flex;
      flex-direction: column;
    }

    .student-name {
      font-size: 13px;
      font-weight: 500;
      color: #1e293b;
    }

    .student-meta {
      font-size: 11px;
      color: #94a3b8;
    }

    .no-students {
      font-size: 13px;
      color: #94a3b8;
      text-align: center;
      padding: 12px 0;
    }

    .loading-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #64748b;
      padding: 8px 0;
    }

    .selected-students-chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
    }

    .chips-label {
      font-size: 12px;
      color: #64748b;
      font-weight: 500;
    }

    .student-chip {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      background: #dbeafe;
      color: #1e40af;
      border-radius: 12px;
      padding: 3px 8px 3px 10px;
      font-size: 12px;
      font-weight: 500;
    }

    .chip-remove {
      font-size: 14px;
      width: 14px;
      height: 14px;
      cursor: pointer;
      opacity: 0.6;
    }

    .chip-remove:hover { opacity: 1; }

    /* Preview */
    .preview-title {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 12px;
    }

    .preview-table {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 12px;
    }

    .preview-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid #f1f5f9;
    }

    .preview-row:last-child { border-bottom: none; }

    .preview-key {
      font-size: 13px;
      font-weight: 600;
      color: #475569;
      min-width: 130px;
    }

    .preview-val {
      font-size: 13px;
      color: #1e293b;
    }

    .preview-row.no-changes {
      color: #92400e;
      gap: 8px;
    }

    .preview-meetings-count {
      font-size: 13px;
      color: #475569;
    }

    /* Applying */
    .applying-body {
      align-items: center;
      justify-content: center;
      min-height: 180px;
      gap: 16px;
    }

    .applying-text {
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
      margin: 0;
    }

    .applying-sub {
      font-size: 13px;
      color: #64748b;
      margin: 0;
    }

    /* Result */
    .result-summary {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 12px;
    }

    .result-all-ok {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
    }

    .result-all-ok mat-icon { color: #16a34a; font-size: 28px; width: 28px; height: 28px; }

    .result-partial {
      background: #fffbeb;
      border: 1px solid #fde68a;
    }

    .result-partial mat-icon { color: #d97706; font-size: 28px; width: 28px; height: 28px; }

    .result-headline {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 4px;
    }

    .result-sub {
      font-size: 13px;
      color: #64748b;
      margin: 0;
    }

    .error-list { margin-top: 4px; }

    .error-list-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      color: #94a3b8;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }

    .error-row {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      font-size: 12px;
      color: #dc2626;
      padding: 4px 0;
    }

    .error-row mat-icon { font-size: 15px; width: 15px; height: 15px; flex-shrink: 0; margin-top: 1px; }

    /* Footer */
    .bulk-dialog-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 10px;
      padding: 14px 20px;
    }
  `]
})
export class BulkEditMeetingsDialogComponent implements OnInit {
  step: DialogStep = 'form';

  // Form fields
  formStartClockTime = '';
  formDuration: number | null = null;
  formTopic = '';
  formAgenda = '';
  formCourseDay: number | null = null;
  formTeacherId: string | null = null;

  // Students
  allStudents: any[] = [];
  filteredStudents: any[] = [];
  selectedStudentsToAdd: any[] = [];
  studentSearch = '';
  loadingStudents = false;

  teachers: any[] = [];
  applyResult: any = null;

  constructor(
    public dialogRef: MatDialogRef<BulkEditMeetingsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BulkEditMeetingsDialogData,
    private zoomService: ZoomService
  ) {}

  ngOnInit(): void {
    this.loadStudents();
    this.loadTeachers();
  }

  get batches(): string[] {
    return [...new Set<string>(this.data.selectedMeetings.map((m) => m.batch).filter(Boolean))];
  }

  get batchLabel(): string {
    return this.batches.join(', ');
  }

  get mixedBatches(): boolean {
    return this.batches.length > 1;
  }

  get noChanges(): boolean {
    return (
      !this.hasStartClockTime &&
      !this.formDuration &&
      !this.formTopic.trim() &&
      !this.formAgenda.trim() &&
      (this.formCourseDay === null || this.formCourseDay === undefined) &&
      !this.formTeacherId &&
      this.selectedStudentsToAdd.length === 0
    );
  }

  get failedResults(): any[] {
    if (!this.applyResult) return [];
    return (this.applyResult.results || [])
      .filter((r: any) => !r.success)
      .slice(0, 5);
  }

  private loadStudents(): void {
    this.loadingStudents = true;
    const batchFilter = !this.mixedBatches && this.batches.length === 1 ? this.batches[0] : undefined;
    this.zoomService.getAllStudents(batchFilter ? { batch: batchFilter } : undefined).subscribe({
      next: (res: any) => {
        this.allStudents = res?.students || res?.data || res || [];
        this.filteredStudents = [...this.allStudents];
        this.loadingStudents = false;
      },
      error: () => { this.loadingStudents = false; }
    });
  }

  private loadTeachers(): void {
    this.zoomService.getTeachers().subscribe({
      next: (res: any) => {
        this.teachers = res?.teachers || res?.data || res || [];
      },
      error: () => { this.teachers = []; }
    });
  }

  filterStudents(): void {
    const q = this.studentSearch.toLowerCase().trim();
    if (!q) {
      this.filteredStudents = [...this.allStudents];
      return;
    }
    this.filteredStudents = this.allStudents.filter(
      (s) => s.name?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q)
    );
  }

  areAllFilteredStudentsSelected(): boolean {
    if (!this.filteredStudents.length) return false;
    return this.filteredStudents.every((s) => this.isStudentSelected(s._id));
  }

  toggleSelectAllStudents(): void {
    if (this.areAllFilteredStudentsSelected()) {
      // Deselect all filtered students
      const filteredIds = new Set(this.filteredStudents.map((s) => s._id));
      this.selectedStudentsToAdd = this.selectedStudentsToAdd.filter((s) => !filteredIds.has(s._id));
    } else {
      // Select all filtered students not already selected
      const newOnes = this.filteredStudents.filter((s) => !this.isStudentSelected(s._id));
      this.selectedStudentsToAdd = [...this.selectedStudentsToAdd, ...newOnes];
    }
  }

  isStudentSelected(id: string): boolean {
    return this.selectedStudentsToAdd.some((s) => s._id === id);
  }

  toggleStudent(student: any): void {
    if (this.isStudentSelected(student._id)) {
      this.removeSelectedStudent(student._id);
    } else {
      this.selectedStudentsToAdd.push(student);
    }
  }

  removeSelectedStudent(id: string): void {
    this.selectedStudentsToAdd = this.selectedStudentsToAdd.filter((s) => s._id !== id);
  }

  durationLabel(minutes: number | null): string {
    if (!minutes) return '';
    if (minutes < 60) return `${minutes} minutes`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h} hour${h !== 1 ? 's' : ''}`;
  }

  get hasStartClockTime(): boolean {
    return !!this.parseClockValue(this.formStartClockTime);
  }

  get timeParts(): { hour: string; minute: string; second: string; ampm: string } | null {
    return this.parseClockValue(this.formStartClockTime);
  }

  get formattedStartClockDisplay(): string {
    const p = this.timeParts;
    if (!p) return '';
    return `${p.hour}:${p.minute}:${p.second} ${p.ampm} IST`;
  }

  openClockPicker(input: HTMLInputElement): void {
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch {
        // fall through to click
      }
    }
    input.focus();
    input.click();
  }

  onStartClockInput(): void {
    const parsed = this.parseClockValue(this.formStartClockTime);
    if (!parsed) return;
    this.formStartClockTime = `${parsed.hour24}:${parsed.minute}:${parsed.second}`;
  }

  private parseClockValue(
    value: string
  ): { hour: string; minute: string; second: string; ampm: string; hour24: string } | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const hour24 = parseInt(match[1], 10);
    const minute = match[2];
    const second = (match[3] ?? '00').padStart(2, '0');
    if (hour24 > 23 || parseInt(minute, 10) > 59 || parseInt(second, 10) > 59) return null;
    const hour12 = hour24 % 12 || 12;
    const ampm = hour24 >= 12 ? 'PM' : 'AM';
    return {
      hour: String(hour12).padStart(2, '0'),
      minute,
      second,
      ampm,
      hour24: String(hour24).padStart(2, '0')
    };
  }

  private normalizeClockForApi(value: string): string {
    const parsed = this.parseClockValue(value);
    if (!parsed) return '';
    return `${parsed.hour24}:${parsed.minute}`;
  }

  clockTimeLabel(clock: string): string {
    const parsed = this.parseClockValue(clock);
    if (!parsed) return clock?.trim() || '';
    return `${parsed.hour}:${parsed.minute}:${parsed.second} ${parsed.ampm}`;
  }

  teacherName(id: string | null): string {
    if (!id) return '';
    return this.teachers.find((t) => t._id === id)?.name || id;
  }

  goToPreview(): void {
    this.step = 'preview';
  }

  applyChanges(): void {
    if (this.noChanges) return;

    this.step = 'applying';

    const meetingIds = this.data.selectedMeetings.map((m) => m._id);

    const updates: Record<string, any> = {};
    const clock = this.normalizeClockForApi(this.formStartClockTime);
    if (clock) updates['startClockTime'] = clock;
    if (this.formDuration) updates['duration'] = this.formDuration;
    if (this.formTopic.trim()) updates['topic'] = this.formTopic.trim();
    if (this.formAgenda.trim()) updates['agenda'] = this.formAgenda.trim();
    if (this.formCourseDay !== null && this.formCourseDay !== undefined) {
      updates['courseDay'] = this.formCourseDay === 0 ? null : this.formCourseDay;
    }
    if (this.formTeacherId) updates['assignedTeacher'] = this.formTeacherId;

    const attendeeUpdates: Record<string, any> = {};
    if (this.selectedStudentsToAdd.length > 0) {
      attendeeUpdates['addStudentIds'] = this.selectedStudentsToAdd.map((s) => s._id);
    }

    this.zoomService.bulkUpdateMeetings({ meetingIds, updates, attendeeUpdates }).subscribe({
      next: (res: any) => {
        this.applyResult = res;
        this.step = 'result';
      },
      error: (err: any) => {
        this.applyResult = {
          summary: { total: meetingIds.length, updated: 0, failed: meetingIds.length },
          results: [{ meetingId: '', success: false, message: err?.error?.message || 'Request failed' }]
        };
        this.step = 'result';
      }
    });
  }

  close(): void {
    this.dialogRef.close(this.applyResult);
  }
}
