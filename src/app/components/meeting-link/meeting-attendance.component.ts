// src/app/components/meeting-link/meeting-attendance.component.ts

import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';

@Component({
  selector: 'app-meeting-attendance',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MaterialModule
  ],
  template: `
    <div class="attendance-container">
      <!-- Header -->
      <mat-card class="header-card">
        <div class="header-content">
          <button mat-icon-button (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h2>Meeting Attendance Report</h2>
        </div>
      </mat-card>

      <!-- Loading State -->
      <div *ngIf="loading" class="loading-container">
        <mat-spinner></mat-spinner>
        <p>Loading attendance data...</p>
        <p class="hint">This may take a few moments if the meeting just ended.</p>
      </div>

      <!-- Error State -->
      <mat-card *ngIf="error && !loading" class="error-card">
        <mat-icon color="warn">error</mat-icon>
        <h3>{{ error }}</h3>
        <p *ngIf="error.includes('not yet available')">
          Zoom typically takes 5-10 minutes to process meeting data after it ends. 
          Please wait a few minutes and try again.
        </p>
        <div class="error-actions">
          <button mat-raised-button color="primary" (click)="loadAttendance()">
            <mat-icon>refresh</mat-icon>
            Retry
          </button>
          <button mat-stroked-button (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
            Back
          </button>
        </div>
      </mat-card>

      <!-- Attendance Data -->
      <div *ngIf="attendanceData && !loading && !error">
        <!-- Meeting Info -->
        <mat-card class="meeting-info-card">
          <h3>{{ attendanceData.topic }}</h3>
          <div class="meeting-details">
            <div class="detail-item">
              <mat-icon>event</mat-icon>
              <span>{{ formatDate(attendanceData.startTime) }}</span>
            </div>
            <div class="detail-item">
              <mat-icon>schedule</mat-icon>
              <span>{{ attendanceData.duration }} minutes</span>
            </div>
            <div class="detail-item">
              <mat-icon>tag</mat-icon>
              <span>Meeting ID: {{ attendanceData.zoomMeetingId }}</span>
            </div>
          </div>
        </mat-card>

        <!-- Summary Cards -->
        <div class="summary-grid">
          <mat-card class="summary-card">
            <mat-icon class="icon-success">check_circle</mat-icon>
            <h3>{{ attendanceData.attendedCount }}</h3>
            <p>Attended</p>
          </mat-card>

          <mat-card class="summary-card">
            <mat-icon class="icon-warn">cancel</mat-icon>
            <h3>{{ attendanceData.absentCount }}</h3>
            <p>Absent</p>
          </mat-card>

          <mat-card class="summary-card">
            <mat-icon class="icon-info">people</mat-icon>
            <h3>{{ attendanceData.totalStudents }}</h3>
            <p>Total Students</p>
          </mat-card>

          <mat-card class="summary-card">
            <mat-icon class="icon-primary">percent</mat-icon>
            <h3>{{ getAttendanceRate() }}%</h3>
            <p>Attendance Rate</p>
          </mat-card>
        </div>

        <!-- Tabs: Matched Students / All Zoom Participants -->
        <mat-tab-group class="attendance-tabs" [(selectedIndex)]="selectedTab" animationDuration="200ms">

          <!-- TAB 1: Matched Students (existing) -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon class="tab-icon">how_to_reg</mat-icon>
              Matched Students ({{ attendanceData.attendance?.length || 0 }})
            </ng-template>

            <!-- Matching Statistics -->
            <mat-card class="stats-card" *ngIf="attendanceData.matchingStats">
              <h3>Matching Quality</h3>
              <div class="matching-stats">
                <div class="stat-item">
                  <mat-icon class="icon-success">email</mat-icon>
                  <span>{{ attendanceData.matchingStats.emailMatches }} Email Matches</span>
                </div>
                <div class="stat-item">
                  <mat-icon class="icon-info">person</mat-icon>
                  <span>{{ attendanceData.matchingStats.exactNameMatches }} Exact Name</span>
                </div>
                <div class="stat-item">
                  <mat-icon class="icon-warn">person_outline</mat-icon>
                  <span>{{ attendanceData.matchingStats.partialNameMatches }} Partial Name</span>
                </div>
                <div class="stat-item" *ngIf="attendanceData.matchingStats.manualReviewRequired > 0">
                  <mat-icon class="icon-error">warning</mat-icon>
                  <span>{{ attendanceData.matchingStats.manualReviewRequired }} Need Review</span>
                </div>
              </div>
            </mat-card>

            <!-- Attendance Table -->
            <mat-card class="table-card">
              <h3>Detailed Attendance</h3>
              <table mat-table [dataSource]="attendanceData.attendance" class="attendance-table">
                <ng-container matColumnDef="name">
                  <th mat-header-cell *matHeaderCellDef>Student Name</th>
                  <td mat-cell *matCellDef="let record">{{ record.name }}</td>
                </ng-container>

                <ng-container matColumnDef="email">
                  <th mat-header-cell *matHeaderCellDef>Email</th>
                  <td mat-cell *matCellDef="let record">{{ record.email }}</td>
                </ng-container>

                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef>Status</th>
                  <td mat-cell *matCellDef="let record">
                    <mat-chip [class]="getAttendanceChipClass(record)">
                      <mat-icon>{{ isAttendedByDuration(record) ? 'check_circle' : 'cancel' }}</mat-icon>
                      {{ isAttendedByDuration(record) ? 'Attended' : 'Absent' }}
                      <mat-icon *ngIf="record.needsReview" class="warning-icon">warning</mat-icon>
                    </mat-chip>
                  </td>
                </ng-container>

                <ng-container matColumnDef="confidence">
                  <th mat-header-cell *matHeaderCellDef>Match Quality</th>
                  <td mat-cell *matCellDef="let record">
                    <div class="confidence-cell">
                      <mat-chip [class]="getConfidenceClass(record.confidence)" *ngIf="record.attended">
                        {{ record.confidence }}%
                      </mat-chip>
                      <span class="match-method" *ngIf="record.attended">{{ getMatchMethodLabel(record.matchMethod) }}</span>
                      <span *ngIf="!record.attended" class="no-match">-</span>
                    </div>
                  </td>
                </ng-container>

                <ng-container matColumnDef="zoomName">
                  <th mat-header-cell *matHeaderCellDef>Zoom Display Name</th>
                  <td mat-cell *matCellDef="let record">
                    <div class="name-comparison" *ngIf="record.attended">
                      <span class="zoom-name">{{ record.zoomName }}</span>
                      <mat-icon *ngIf="record.name !== record.zoomName" class="name-diff-icon" 
                               matTooltip="Display name differs from registered name">
                        info
                      </mat-icon>
                    </div>
                    <span *ngIf="!record.attended" class="no-data">-</span>
                  </td>
                </ng-container>

                <ng-container matColumnDef="joinTime">
                  <th mat-header-cell *matHeaderCellDef>Join Time</th>
                  <td mat-cell *matCellDef="let record">
                    {{ record.joinTime ? formatTime(record.joinTime) : '-' }}
                  </td>
                </ng-container>

                <ng-container matColumnDef="leaveTime">
                  <th mat-header-cell *matHeaderCellDef>Leave Time</th>
                  <td mat-cell *matCellDef="let record">
                    {{ record.leaveTime ? formatTime(record.leaveTime) : '-' }}
                  </td>
                </ng-container>

                <ng-container matColumnDef="duration">
                  <th mat-header-cell *matHeaderCellDef>Duration / Attendance</th>
                  <td mat-cell *matCellDef="let record">
                    <div class="duration-cell">
                      <div class="ring-wrap">
                        <svg viewBox="0 0 36 36" class="progress-ring">
                          <path class="ring-bg" d="M18 2.5a15.5 15.5 0 1 1 0 31a15.5 15.5 0 1 1 0-31"/>
                          <path class="ring-fg" [class.ring-good]="isAttendedByDuration(record)" [class.ring-bad]="!isAttendedByDuration(record)"
                            d="M18 2.5a15.5 15.5 0 1 1 0 31a15.5 15.5 0 1 1 0-31"
                            [style.strokeDasharray]="getCircleDash(record)"/>
                        </svg>
                        <span class="ring-text">{{ getAttendancePercent(record) }}%</span>
                      </div>
                      <span>{{ record.durationMinutes || 0 }} / {{ attendanceData.duration || 0 }} min</span>
                    </div>
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
              </table>
            </mat-card>
          </mat-tab>

          <!-- TAB 2: All Zoom Participants -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon class="tab-icon">groups</mat-icon>
              All Zoom Participants ({{ attendanceData.allParticipants?.length || 0 }})
            </ng-template>

            <mat-card class="table-card">
              <div class="all-participants-header">
                <h3>All Zoom Participants</h3>
                <p class="subtitle">Everyone who joined this Zoom meeting, including unmatched participants. Use the "Mark Student" button to manually link a participant to a batch student.</p>
              </div>

              <!-- Success/Error message -->
              <div *ngIf="mapMessage" class="map-message" [class.map-success]="mapSuccess" [class.map-error]="!mapSuccess">
                <mat-icon>{{ mapSuccess ? 'check_circle' : 'error' }}</mat-icon>
                <span>{{ mapMessage }}</span>
                <button mat-icon-button (click)="mapMessage = ''"><mat-icon>close</mat-icon></button>
              </div>

              <table mat-table [dataSource]="attendanceData.allParticipants" class="attendance-table">
                <ng-container matColumnDef="pName">
                  <th mat-header-cell *matHeaderCellDef>Zoom Display Name</th>
                  <td mat-cell *matCellDef="let p">
                    <span class="zoom-name">{{ p.name || '-' }}</span>
                  </td>
                </ng-container>

                <ng-container matColumnDef="pEmail">
                  <th mat-header-cell *matHeaderCellDef>Zoom Email</th>
                  <td mat-cell *matCellDef="let p">{{ p.email || '-' }}</td>
                </ng-container>

                <ng-container matColumnDef="pJoinTime">
                  <th mat-header-cell *matHeaderCellDef>Join Time</th>
                  <td mat-cell *matCellDef="let p">{{ p.joinTime ? formatTime(p.joinTime) : '-' }}</td>
                </ng-container>

                <ng-container matColumnDef="pLeaveTime">
                  <th mat-header-cell *matHeaderCellDef>Leave Time</th>
                  <td mat-cell *matCellDef="let p">{{ p.leaveTime ? formatTime(p.leaveTime) : '-' }}</td>
                </ng-container>

                <ng-container matColumnDef="pDuration">
                  <th mat-header-cell *matHeaderCellDef>Duration</th>
                  <td mat-cell *matCellDef="let p">
                    <div class="duration-cell">
                      <div class="ring-wrap">
                        <svg viewBox="0 0 36 36" class="progress-ring">
                          <path class="ring-bg" d="M18 2.5a15.5 15.5 0 1 1 0 31a15.5 15.5 0 1 1 0-31"/>
                          <path class="ring-fg" [class.ring-good]="getParticipantPercent(p) >= 70" [class.ring-bad]="getParticipantPercent(p) < 70"
                            d="M18 2.5a15.5 15.5 0 1 1 0 31a15.5 15.5 0 1 1 0-31"
                            [style.strokeDasharray]="getParticipantPercent(p) + ', 100'"/>
                        </svg>
                        <span class="ring-text">{{ getParticipantPercent(p) }}%</span>
                      </div>
                      <span>{{ p.durationMinutes || 0 }} / {{ attendanceData.duration || 0 }} min</span>
                    </div>
                  </td>
                </ng-container>

                <ng-container matColumnDef="pMapped">
                  <th mat-header-cell *matHeaderCellDef>Mapped Status</th>
                  <td mat-cell *matCellDef="let p">
                    <mat-chip *ngIf="p.isMapped" class="status-attended">
                      <mat-icon>link</mat-icon>
                      {{ p.mappedTo?.name }}
                    </mat-chip>
                    <mat-chip *ngIf="!p.isMapped" class="chip-unmapped">
                      <mat-icon>link_off</mat-icon>
                      Unmapped
                    </mat-chip>
                  </td>
                </ng-container>

                <ng-container matColumnDef="pAction">
                  <th mat-header-cell *matHeaderCellDef>Action</th>
                  <td mat-cell *matCellDef="let p; let i = index">
                    <!-- Show mapping form inline -->
                    <div *ngIf="mappingIndex === i" class="map-inline-form">
                      <mat-form-field appearance="outline" class="map-input">
                        <mat-label>Student Email</mat-label>
                        <input matInput [(ngModel)]="mapStudentEmail" placeholder="student@email.com"
                               (keyup.enter)="confirmMap(p)" (keyup.escape)="cancelMap()">
                      </mat-form-field>
                      <button mat-mini-fab color="primary" (click)="confirmMap(p)" [disabled]="mappingLoading"
                              matTooltip="Confirm mapping">
                        <mat-icon>{{ mappingLoading ? 'hourglass_empty' : 'check' }}</mat-icon>
                      </button>
                      <button mat-mini-fab color="warn" (click)="cancelMap()" matTooltip="Cancel">
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>
                    <button *ngIf="mappingIndex !== i" mat-stroked-button color="primary" (click)="startMap(i, p)">
                      <mat-icon>person_add</mat-icon>
                      {{ p.isMapped ? 'Re-map' : 'Mark Student' }}
                    </button>
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="participantColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: participantColumns;"></tr>
              </table>
            </mat-card>
          </mat-tab>
        </mat-tab-group>

        <!-- Actions -->
        <div class="actions">
          <button mat-raised-button color="primary" (click)="exportToCSV()">
            <mat-icon>download</mat-icon>
            Export CSV
          </button>
          <button mat-raised-button color="accent" (click)="reviewAttendance()" 
                  *ngIf="hasItemsNeedingReview()">
            <mat-icon>rate_review</mat-icon>
            Review Matches ({{ getReviewCount() }})
          </button>
          <button mat-stroked-button (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
            Back to Meeting
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .attendance-container {
      padding: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }

    .header-card {
      margin-bottom: 20px;
    }

    .header-content {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .header-content h2 {
      margin: 0;
      flex: 1;
    }

    .loading-container {
      text-align: center;
      padding: 60px 20px;
    }

    .loading-container mat-spinner {
      margin: 0 auto 20px;
    }

    .hint {
      color: #666;
      font-size: 14px;
      margin-top: 10px;
    }

    .error-card {
      text-align: center;
      padding: 40px;
    }

    .error-card mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      margin-bottom: 20px;
    }

    .error-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin-top: 20px;
    }

    .meeting-info-card {
      margin-bottom: 20px;
      padding: 20px;
    }

    .meeting-info-card h3 {
      margin: 0 0 15px 0;
      color: #1976d2;
    }

    .meeting-details {
      display: flex;
      gap: 30px;
      flex-wrap: wrap;
    }

    .detail-item {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #666;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }

    .summary-card {
      text-align: center;
      padding: 30px 20px;
    }

    .summary-card mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      margin-bottom: 10px;
    }

    .icon-success { color: #4caf50; }
    .icon-warn { color: #f44336; }
    .icon-info { color: #2196f3; }
    .icon-primary { color: #1976d2; }

    .summary-card h3 {
      margin: 10px 0 5px 0;
      font-size: 32px;
      font-weight: bold;
    }

    .summary-card p {
      margin: 0;
      color: #666;
    }

    .attendance-tabs {
      margin-bottom: 20px;
    }

    .tab-icon {
      margin-right: 6px;
      font-size: 20px;
      height: 20px;
      width: 20px;
    }

    .table-card {
      padding: 20px;
      margin-bottom: 20px;
      margin-top: 16px;
    }

    .table-card h3 {
      margin: 0 0 20px 0;
    }

    .attendance-table {
      width: 100%;
    }

    .status-attended {
      background-color: #e8f5e9;
      color: #2e7d32;
    }

    .status-absent {
      background-color: #ffebee;
      color: #c62828;
    }

    .chip-unmapped {
      background-color: #fff3e0;
      color: #e65100;
    }

    mat-chip mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 5px;
    }

    .warning-icon {
      margin-left: 5px !important;
      margin-right: 0 !important;
      color: #ff9800;
    }

    .stats-card {
      padding: 20px;
      margin-bottom: 20px;
      margin-top: 16px;
    }

    .stats-card h3 {
      margin: 0 0 15px 0;
      color: #1976d2;
    }

    .matching-stats {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #f5f5f5;
      border-radius: 6px;
    }

    .icon-error { color: #f44336; }

    .confidence-cell {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .confidence-high {
      background-color: #e8f5e9;
      color: #2e7d32;
    }

    .confidence-medium {
      background-color: #fff3e0;
      color: #e65100;
    }

    .confidence-low {
      background-color: #fff8e1;
      color: #f57c00;
    }

    .confidence-very-low {
      background-color: #ffebee;
      color: #c62828;
    }

    .match-method {
      font-size: 11px;
      color: #666;
      font-style: italic;
    }

    .name-comparison {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .zoom-name {
      font-weight: 500;
    }

    .name-diff-icon {
      color: #2196f3;
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .no-match, .no-data {
      color: #999;
      font-style: italic;
    }

    .actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }

    .duration-cell {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ring-wrap {
      width: 36px;
      height: 36px;
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .progress-ring {
      width: 36px;
      height: 36px;
      transform: rotate(-90deg);
    }

    .ring-bg, .ring-fg {
      fill: none;
      stroke-width: 3;
      stroke-linecap: round;
    }

    .ring-bg { stroke: #e2e8f0; }
    .ring-fg { stroke: #3b82f6; }
    .ring-good { stroke: #16a34a; }
    .ring-bad { stroke: #dc2626; }

    .ring-text {
      position: absolute;
      font-size: 9px;
      font-weight: 700;
      color: #334155;
    }

    .all-participants-header h3 {
      margin: 0 0 4px 0;
    }

    .all-participants-header .subtitle {
      color: #666;
      font-size: 13px;
      margin: 0 0 16px 0;
    }

    .map-inline-form {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .map-input {
      width: 220px;
      font-size: 13px;
    }

    .map-input .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }

    .map-message {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 14px;
    }

    .map-success {
      background: #e8f5e9;
      color: #2e7d32;
    }

    .map-error {
      background: #ffebee;
      color: #c62828;
    }

    .map-message button {
      margin-left: auto;
    }
  `]
})
export class MeetingAttendanceComponent implements OnInit {
  meetingId: string = '';
  attendanceData: any = null;
  loading: boolean = true;
  error: string = '';
  selectedTab: number = 0;
  
  displayedColumns: string[] = ['name', 'email', 'status', 'confidence', 'zoomName', 'joinTime', 'leaveTime', 'duration'];
  participantColumns: string[] = ['pName', 'pEmail', 'pJoinTime', 'pLeaveTime', 'pDuration', 'pMapped', 'pAction'];

  // Mapping state
  mappingIndex: number = -1;
  mapStudentEmail: string = '';
  mappingLoading: boolean = false;
  mapMessage: string = '';
  mapSuccess: boolean = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private zoomService: ZoomService
  ) {}

  ngOnInit(): void {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    if (this.meetingId) {
      this.loadAttendance();
    }
  }

  loadAttendance(): void {
    this.loading = true;
    this.error = '';

    this.zoomService.getAttendance(this.meetingId).subscribe({
      next: (response) => {
        if (response.success) {
          this.attendanceData = response.data;
          console.log('Attendance data loaded:', this.attendanceData);
        } else {
          this.error = response.message || 'Failed to load attendance data';
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading attendance:', err);
        this.error = err.error?.message || 'Failed to load attendance data';
        this.loading = false;
      }
    });
  }

  // --- Mapping methods ---

  startMap(index: number, participant: any): void {
    this.mappingIndex = index;
    this.mapStudentEmail = '';
    this.mapMessage = '';
  }

  cancelMap(): void {
    this.mappingIndex = -1;
    this.mapStudentEmail = '';
  }

  confirmMap(participant: any): void {
    if (!this.mapStudentEmail.trim()) return;

    this.mappingLoading = true;
    this.mapMessage = '';

    this.zoomService.mapParticipantToStudent(this.meetingId, {
      participantName: participant.name,
      participantEmail: participant.email,
      studentEmail: this.mapStudentEmail.trim()
    }).subscribe({
      next: (res) => {
        this.mapSuccess = true;
        this.mapMessage = res.message || 'Participant mapped successfully!';
        this.mappingLoading = false;
        this.mappingIndex = -1;
        this.mapStudentEmail = '';
        this.selectedTab = 0;
        this.loadAttendance();
      },
      error: (err) => {
        this.mapSuccess = false;
        this.mapMessage = err.error?.message || 'Failed to map participant. Check the student email.';
        this.mappingLoading = false;
      }
    });
  }

  getParticipantPercent(p: any): number {
    const totalMinutes = Number(this.attendanceData?.duration || 0);
    const pMinutes = Number(p?.durationMinutes || 0);
    if (totalMinutes <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((pMinutes / totalMinutes) * 100)));
  }

  // --- Existing methods ---

  getAttendanceRate(): number {
    if (!this.attendanceData || this.attendanceData.totalStudents === 0) {
      return 0;
    }
    const attended = (this.attendanceData.attendance || []).filter((r: any) => this.isAttendedByDuration(r)).length;
    return Math.round((attended / this.attendanceData.totalStudents) * 100);
  }

  getConfidenceClass(confidence: number): string {
    if (confidence >= 90) return 'confidence-high';
    if (confidence >= 70) return 'confidence-medium';
    if (confidence >= 50) return 'confidence-low';
    return 'confidence-very-low';
  }

  getMatchMethodLabel(method: string): string {
    const labels: { [key: string]: string } = {
      'email': 'Email Match',
      'email_local': 'Email + Zoom name',
      'exact_name': 'Exact Name',
      'partial_name': 'Partial Name',
      'fuzzy_name': 'Similar Name',
      'containment': 'Name Match (partial)',
      'single_participant': 'Single participant (review)',
      'no_match': 'No Match'
    };
    return labels[method] || method;
  }

  formatDate(date: string | Date): string {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatTime(dateString: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  exportToCSV(): void {
    if (!this.attendanceData || !this.attendanceData.attendance) {
      return;
    }

    const headers = ['Name', 'Email', 'Status', 'Confidence (%)', 'Match Method', 'Zoom Name', 'Join Time', 'Leave Time', 'Duration (min)', 'Needs Review'];
    const rows = this.attendanceData.attendance.map((record: any) => [
      record.name,
      record.email,
      this.isAttendedByDuration(record) ? 'Attended' : 'Absent',
      record.confidence || 0,
      this.getMatchMethodLabel(record.matchMethod || ''),
      record.zoomName || '-',
      record.joinTime ? this.formatTime(record.joinTime) : '-',
      record.leaveTime ? this.formatTime(record.leaveTime) : '-',
      record.durationMinutes || 0,
      record.needsReview ? 'Yes' : 'No'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row: any[]) => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `attendance_${this.attendanceData.zoomMeetingId}_${new Date().toISOString().split('T')[0]}.csv`);
    link.click();
    URL.revokeObjectURL(url);
  }

  goBack(): void {
    this.router.navigate(['/teacher/meetings', this.meetingId]);
  }

  reviewAttendance(): void {
    this.router.navigate(['/teacher/meetings', this.meetingId, 'attendance', 'review']);
  }

  hasItemsNeedingReview(): boolean {
    return this.attendanceData?.attendance?.some((item: any) => item.needsReview) || false;
  }

  getReviewCount(): number {
    return this.attendanceData?.attendance?.filter((item: any) => item.needsReview)?.length || 0;
  }

  getAttendancePercent(record: any): number {
    const totalMinutes = Number(this.attendanceData?.duration || 0);
    const studentMinutes = Number(record?.durationMinutes || 0);
    if (totalMinutes <= 0) return 0;
    const pct = Math.round((studentMinutes / totalMinutes) * 100);
    return Math.max(0, Math.min(100, pct));
  }

  isAttendedByDuration(record: any): boolean {
    return this.getAttendancePercent(record) >= 70;
  }

  getAttendanceChipClass(record: any): string {
    return this.isAttendedByDuration(record) ? 'status-attended' : 'status-absent';
  }

  getCircleDash(record: any): string {
    return `${this.getAttendancePercent(record)}, 100`;
  }
}
