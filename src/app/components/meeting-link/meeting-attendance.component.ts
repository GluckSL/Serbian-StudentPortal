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
      <div class="page-header">
        <div class="page-header__left">
          <button mat-icon-button class="back-btn" (click)="goBack()" aria-label="Go back">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <div>
            <h2 class="page-header__title">Meeting Attendance Report</h2>
            <p class="page-header__sub">Class session analytics &amp; participant mapping</p>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="loading" class="loading-container">
        <div class="loading-spinner"></div>
        <p class="loading-title">Loading attendance data...</p>
        <p class="hint">This may take a few moments if the meeting just ended.</p>
      </div>

      <!-- Error State -->
      <div *ngIf="error && !loading" class="error-card">
        <mat-icon class="error-icon">error_outline</mat-icon>
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
      </div>

      <!-- Attendance Data -->
      <div *ngIf="attendanceData && !loading && !error">
        <!-- Meeting Info -->
        <div class="meeting-info-card">
          <div class="meeting-info-header">
            <div class="meeting-info-title">
              <span class="meeting-badge">Class Session</span>
              <h3>{{ attendanceData.topic }}</h3>
            </div>
            <button class="refetch-btn" (click)="refetchAttendance()" [disabled]="refetching || loading">
              <mat-icon>{{ refetching ? 'hourglass_empty' : 'refresh' }}</mat-icon>
              {{ refetching ? 'Re-fetching...' : 'Re-fetch from Zoom' }}
            </button>
          </div>
          <div class="meeting-details">
            <div class="detail-chip">
              <mat-icon>event</mat-icon>
              <span>{{ formatDate(attendanceData.startTime) }}</span>
            </div>
            <div class="detail-chip">
              <mat-icon>schedule</mat-icon>
              <span>{{ attendanceData.duration }} minutes</span>
            </div>
            <div class="detail-chip">
              <mat-icon>tag</mat-icon>
              <span>ID {{ attendanceData.zoomMeetingId }}</span>
            </div>
          </div>
        </div>

        <!-- Summary Cards -->
        <div class="summary-grid">
          <div class="stat-card stat-card--green">
            <div class="stat-card__icon"><mat-icon>check_circle</mat-icon></div>
            <div class="stat-card__body">
              <div class="stat-card__val">{{ attendanceData.attendedCount }}</div>
              <div class="stat-card__lbl">Attended</div>
            </div>
          </div>

          <div class="stat-card stat-card--red">
            <div class="stat-card__icon"><mat-icon>cancel</mat-icon></div>
            <div class="stat-card__body">
              <div class="stat-card__val">{{ attendanceData.absentCount }}</div>
              <div class="stat-card__lbl">Absent</div>
            </div>
          </div>

          <div class="stat-card stat-card--blue">
            <div class="stat-card__icon"><mat-icon>groups</mat-icon></div>
            <div class="stat-card__body">
              <div class="stat-card__val">{{ attendanceData.totalStudents }}</div>
              <div class="stat-card__lbl">Total Students</div>
            </div>
          </div>

          <div class="stat-card"
               [class.stat-card--green]="getAttendanceRate() >= 75"
               [class.stat-card--amber]="getAttendanceRate() >= 50 && getAttendanceRate() < 75"
               [class.stat-card--red]="getAttendanceRate() < 50">
            <div class="stat-card__icon"><mat-icon>trending_up</mat-icon></div>
            <div class="stat-card__body">
              <div class="stat-card__val">{{ getAttendanceRate() }}%</div>
              <div class="stat-card__lbl">Attendance Rate</div>
            </div>
          </div>
        </div>

        <div *ngIf="mapMessage" class="map-message" [class.map-success]="mapSuccess" [class.map-error]="!mapSuccess">
          <mat-icon>{{ mapSuccess ? 'check_circle' : 'error' }}</mat-icon>
          <span>{{ mapMessage }}</span>
          <button mat-icon-button (click)="mapMessage = ''"><mat-icon>close</mat-icon></button>
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
            <div class="stats-card" *ngIf="attendanceData.matchingStats">
              <div class="section-head">
                <h3>Matching Quality</h3>
                <span class="section-head__hint">How students were linked to Zoom participants</span>
              </div>
              <div class="matching-stats">
                <div class="match-pill match-pill--green">
                  <mat-icon>email</mat-icon>
                  <span class="match-pill__val">{{ attendanceData.matchingStats.emailMatches }}</span>
                  <span class="match-pill__lbl">Email Matches</span>
                </div>
                <div class="match-pill match-pill--blue">
                  <mat-icon>person</mat-icon>
                  <span class="match-pill__val">{{ attendanceData.matchingStats.exactNameMatches }}</span>
                  <span class="match-pill__lbl">Exact Name</span>
                </div>
                <div class="match-pill match-pill--amber">
                  <mat-icon>person_outline</mat-icon>
                  <span class="match-pill__val">{{ attendanceData.matchingStats.partialNameMatches }}</span>
                  <span class="match-pill__lbl">Partial Name</span>
                </div>
                <div class="match-pill match-pill--red" *ngIf="attendanceData.matchingStats.manualReviewRequired > 0">
                  <mat-icon>warning</mat-icon>
                  <span class="match-pill__val">{{ attendanceData.matchingStats.manualReviewRequired }}</span>
                  <span class="match-pill__lbl">Need Review</span>
                </div>
              </div>
            </div>

            <!-- Attendance Table -->
            <div class="table-card">
              <div class="attendance-header-row">
                <div>
                  <h3>Detailed Attendance</h3>
                  <p class="section-head__hint">Per-student status, match quality, and manual overrides</p>
                </div>
                <div class="attendance-actions-group">
                  <button
                    class="action-btn action-btn--outline"
                    (click)="markAllStudentsAttended()"
                    [disabled]="manualMarkingAll || !hasAbsentStudents()">
                    <mat-icon>{{ manualMarkingAll ? 'hourglass_empty' : 'done_all' }}</mat-icon>
                    {{ manualMarkingAll ? 'Marking...' : 'Mark All' }}
                  </button>
                  <button
                    class="action-btn action-btn--add"
                    (click)="toggleAddPanel()">
                    <mat-icon>{{ showAddPanel ? 'expand_less' : 'person_add' }}</mat-icon>
                    {{ showAddPanel ? 'Close' : 'Add Participants' }}
                  </button>
                </div>
              </div>

              <!-- Add Participants Panel -->
              <div *ngIf="showAddPanel" class="add-participants-panel">
                <div class="add-panel-inner">
                  <div class="add-panel-title">
                    <mat-icon>group_add</mat-icon>
                    <span>Add students from batch <strong>{{ attendanceData.batch }}</strong></span>
                  </div>

                  <div *ngIf="loadingBatchStudents" class="add-panel-loading">
                    <div class="loading-spinner" style="width:20px;height:20px;border-width:2px;"></div>
                    <span>Loading batch students...</span>
                  </div>

                  <ng-container *ngIf="!loadingBatchStudents">
                    <mat-form-field appearance="outline" class="add-panel-search">
                      <mat-label>Search by name or email</mat-label>
                      <mat-icon matPrefix>search</mat-icon>
                      <input matInput [(ngModel)]="participantSearch"
                             (ngModelChange)="filterBatchStudents()"
                             placeholder="Type to filter...">
                      <button *ngIf="participantSearch" matSuffix mat-icon-button (click)="participantSearch=''; filterBatchStudents()">
                        <mat-icon>close</mat-icon>
                      </button>
                    </mat-form-field>

                    <div class="batch-student-list">
                      <div *ngFor="let student of filteredBatchStudents" class="batch-student-row">
                        <div class="batch-student-info">
                          <span class="batch-student-name">{{ student.name }}</span>
                          <span class="batch-student-email">{{ student.email }}</span>
                        </div>
                        <ng-container *ngIf="isStudentAlreadyAdded(student); else addBtn">
                          <span class="already-added-badge">
                            <mat-icon>check_circle</mat-icon> Already in list
                          </span>
                        </ng-container>
                        <ng-template #addBtn>
                          <button mat-stroked-button class="add-student-btn"
                            (click)="addParticipant(student)"
                            [disabled]="addingParticipantId === student._id">
                            <mat-icon>{{ addingParticipantId === student._id ? 'hourglass_empty' : 'person_add' }}</mat-icon>
                            {{ addingParticipantId === student._id ? 'Adding...' : 'Add' }}
                          </button>
                        </ng-template>
                      </div>
                      <div *ngIf="filteredBatchStudents.length === 0 && !loadingBatchStudents" class="no-students-hint">
                        <mat-icon>search_off</mat-icon>
                        <span>No students found{{ participantSearch ? ' matching "' + participantSearch + '"' : '' }}</span>
                      </div>
                    </div>
                  </ng-container>
                </div>
              </div>

              <div class="table-wrap">
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

                <ng-container matColumnDef="manualMark">
                  <th mat-header-cell *matHeaderCellDef>Actions</th>
                  <td mat-cell *matCellDef="let record">
                    <div class="row-actions">
                      <button
                        mat-stroked-button
                        color="primary"
                        (click)="markStudentAttended(record)"
                        [disabled]="isMarkingStudent(record) || isAttendedByDuration(record)">
                        <mat-icon>{{ isMarkingStudent(record) ? 'hourglass_empty' : 'check_circle' }}</mat-icon>
                        {{ isAttendedByDuration(record) ? 'Marked' : (isMarkingStudent(record) ? 'Marking...' : 'Mark') }}
                      </button>
                      <button
                        mat-icon-button
                        class="remove-student-btn"
                        (click)="removeParticipant(record)"
                        [disabled]="removingParticipantId === record.studentId?.toString()"
                        matTooltip="Remove from attendance list">
                        <mat-icon>{{ removingParticipantId === record.studentId?.toString() ? 'hourglass_empty' : 'person_remove' }}</mat-icon>
                      </button>
                    </div>
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: displayedColumns;" class="data-row"></tr>
              </table>
              </div>
            </div>
          </mat-tab>

          <!-- TAB 2: Portal join clicks (informational) -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon class="tab-icon">touch_app</mat-icon>
              Portal Join Clicks ({{ getPortalJoinCount() }})
            </ng-template>

            <div class="table-card">
              <div class="all-participants-header">
                <h3>Portal Join Clicks</h3>
                <p class="subtitle">
                  Students who clicked Join in Glück for this class.
                  Informational only — not used for attendance mapping. Compare with
                  All Zoom Participants to spot students who clicked but did not reach Zoom.
                </p>
              </div>
              <div class="empty-hint" *ngIf="getPortalJoinCount() === 0">
                <mat-icon>touch_app</mat-icon>
                <p>No portal join clicks recorded for this meeting yet.</p>
              </div>
              <div class="table-wrap" *ngIf="getPortalJoinCount() > 0">
              <table
                mat-table
                [dataSource]="attendanceData.portalJoins || []"
                class="attendance-table">
                <ng-container matColumnDef="pjName">
                  <th mat-header-cell *matHeaderCellDef>Student Name</th>
                  <td mat-cell *matCellDef="let j">{{ j.name }}</td>
                </ng-container>

                <ng-container matColumnDef="pjEmail">
                  <th mat-header-cell *matHeaderCellDef>Email</th>
                  <td mat-cell *matCellDef="let j">{{ j.email }}</td>
                </ng-container>

                <ng-container matColumnDef="pjJoinedAt">
                  <th mat-header-cell *matHeaderCellDef>First Click</th>
                  <td mat-cell *matCellDef="let j">{{ j.joinedAt ? formatTime(j.joinedAt) : '-' }}</td>
                </ng-container>

                <ng-container matColumnDef="pjLastJoined">
                  <th mat-header-cell *matHeaderCellDef>Last Click</th>
                  <td mat-cell *matCellDef="let j">{{ j.lastJoinedAt ? formatTime(j.lastJoinedAt) : '-' }}</td>
                </ng-container>

                <ng-container matColumnDef="pjJoinCount">
                  <th mat-header-cell *matHeaderCellDef>Clicks</th>
                  <td mat-cell *matCellDef="let j">{{ j.joinCount || 1 }}</td>
                </ng-container>

                <ng-container matColumnDef="pjZoomName">
                  <th mat-header-cell *matHeaderCellDef>Zoom Name Sent</th>
                  <td mat-cell *matCellDef="let j">
                    <span class="zoom-name">{{ j.zoomDisplayName || '-' }}</span>
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="portalJoinColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: portalJoinColumns;" class="data-row"></tr>
              </table>
              </div>
            </div>
          </mat-tab>

          <!-- TAB 3: All Zoom Participants -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon class="tab-icon">groups</mat-icon>
              All Zoom Participants ({{ uniqueZoomParticipantCount }})
            </ng-template>

            <div class="table-card">
              <div class="all-participants-header">
                <h3>All Zoom Participants</h3>
                <div class="participants-stats-bar">
                  <span class="stat-badge stat-unique" matTooltip="Distinct people after merging reconnect sessions">
                    <mat-icon>person</mat-icon>
                    {{ uniqueZoomParticipantCount }} unique
                  </span>
                  <span class="stat-badge stat-raw" matTooltip="Total individual Zoom sessions including reconnects">
                    <mat-icon>repeat</mat-icon>
                    {{ rawZoomSessionCount }} raw sessions
                  </span>
                  <span *ngIf="rawZoomSessionCount > uniqueZoomParticipantCount" class="stat-badge stat-reconnects">
                    {{ rawZoomSessionCount - uniqueZoomParticipantCount }} reconnect sessions
                  </span>
                </div>
                <p class="subtitle">
                  Each row is one unique person — reconnect sessions are merged and counted in the
                  <strong>Reconnects</strong> column. Use "Mark Student" to link an unmapped name to a batch student.
                </p>
              </div>

              <div class="table-wrap">
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

                <ng-container matColumnDef="pSessions">
                  <th mat-header-cell *matHeaderCellDef>Sessions</th>
                  <td mat-cell *matCellDef="let p">
                    <ng-container *ngIf="(p.sessionCount || 1) > 1; else singleSession">
                      <span class="session-badge"
                        [matTooltip]="(p.sessionCount || 1) + ' total sessions — ' + (p.reconnectCount || 0) + ' quick reconnects (gap < 10 min)'">
                        {{ p.sessionCount }}×
                      </span>
                    </ng-container>
                    <ng-template #singleSession>
                      <span class="single-session">1</span>
                    </ng-template>
                  </td>
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
                <tr mat-row *matRowDef="let row; columns: participantColumns;" class="data-row"></tr>
              </table>
              </div>
            </div>
          </mat-tab>
        </mat-tab-group>

        <!-- Actions -->
        <div class="actions-bar">
          <button class="action-btn action-btn--primary" (click)="exportToCSV()">
            <mat-icon>download</mat-icon>
            Export CSV
          </button>
          <button class="action-btn action-btn--amber" (click)="reviewAttendance()"
                  *ngIf="hasItemsNeedingReview()">
            <mat-icon>rate_review</mat-icon>
            Review Matches ({{ getReviewCount() }})
          </button>
          <button class="action-btn action-btn--ghost" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
            Back to Meeting
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    }

    .attendance-container {
      padding: 16px;
      max-width: 1400px;
      margin: 0 auto;
    }

    /* ── Page Header ── */
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: linear-gradient(135deg, #b3cde0 0%, #c5d9ea 100%);
      padding: 14px 18px;
      border-radius: 14px;
      margin-bottom: 16px;
      box-shadow: 0 2px 8px rgba(1, 31, 75, 0.08);
    }

    .page-header__left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .back-btn {
      color: #011f4b !important;
    }

    .page-header__title {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      color: #011f4b;
    }

    .page-header__sub {
      margin: 2px 0 0;
      font-size: 12px;
      color: #011f4b;
      opacity: 0.65;
    }

    /* ── Loading ── */
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      gap: 12px;
      background: #fff;
      border-radius: 14px;
      border: 1px solid #e8ecf4;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }

    .loading-spinner {
      width: 36px;
      height: 36px;
      border: 3px solid #e5e7eb;
      border-top-color: #005b96;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .loading-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #334155;
    }

    .hint {
      color: #64748b;
      font-size: 13px;
      margin: 0;
    }

    /* ── Error ── */
    .error-card {
      text-align: center;
      padding: 40px 24px;
      background: #fff;
      border-radius: 14px;
      border: 1px solid #fecaca;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }

    .error-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #dc2626;
      margin-bottom: 12px;
    }

    .error-card h3 {
      margin: 0 0 8px;
      color: #0f172a;
      font-size: 16px;
    }

    .error-card p {
      color: #64748b;
      font-size: 13px;
      margin: 0 0 16px;
    }

    .error-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
    }

    /* ── Meeting Info ── */
    .meeting-info-card {
      margin-bottom: 16px;
      padding: 20px 22px;
      background: #fff;
      border-radius: 14px;
      border: 1px solid #e8ecf4;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
      border-left: 4px solid #005b96;
    }

    .meeting-info-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    .meeting-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: #dbeafe;
      color: #1d4ed8;
      margin-bottom: 6px;
    }

    .meeting-info-title h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.3;
    }

    .refetch-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      border: 1px solid #bfdbfe;
      background: #eff6ff;
      color: #1d4ed8;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .refetch-btn:hover:not(:disabled) {
      background: #dbeafe;
      border-color: #93c5fd;
    }

    .refetch-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .refetch-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .meeting-details {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .detail-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 999px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      color: #475569;
      font-size: 13px;
      font-weight: 500;
    }

    .detail-chip mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #64748b;
    }

    /* ── Summary Stat Cards ── */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }

    .stat-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 16px;
      border-radius: 14px;
      border: 1px solid #e8ecf4;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
      transition: transform 0.15s, box-shadow 0.15s;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }

    .stat-card__icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .stat-card__icon mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .stat-card__val {
      font-size: 26px;
      font-weight: 800;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }

    .stat-card__lbl {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
      margin-top: 4px;
      font-weight: 600;
    }

    .stat-card--green  { border-color: #bbf7d0; background: linear-gradient(135deg, #f0fdf4, #fff); }
    .stat-card--green  .stat-card__icon { background: #dcfce7; color: #16a34a; }
    .stat-card--green  .stat-card__val  { color: #16a34a; }

    .stat-card--red    { border-color: #fecaca; background: linear-gradient(135deg, #fef2f2, #fff); }
    .stat-card--red    .stat-card__icon { background: #fee2e2; color: #dc2626; }
    .stat-card--red    .stat-card__val  { color: #dc2626; }

    .stat-card--blue   { border-color: #bfdbfe; background: linear-gradient(135deg, #eff6ff, #fff); }
    .stat-card--blue   .stat-card__icon { background: #dbeafe; color: #1d4ed8; }
    .stat-card--blue   .stat-card__val  { color: #1d4ed8; }

    .stat-card--amber  { border-color: #fde68a; background: linear-gradient(135deg, #fffbeb, #fff); }
    .stat-card--amber  .stat-card__icon { background: #fef3c7; color: #b45309; }
    .stat-card--amber  .stat-card__val  { color: #b45309; }

    /* ── Map Message ── */
    .map-message {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-radius: 12px;
      margin-bottom: 16px;
      font-size: 13px;
      font-weight: 500;
    }

    .map-success {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }

    .map-error {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }

    .map-message button { margin-left: auto; }

    /* ── Tabs ── */
    .attendance-tabs {
      margin-bottom: 16px;
    }

    :host ::ng-deep .attendance-tabs .mat-mdc-tab-header {
      background: #fff;
      border-radius: 14px 14px 0 0;
      border: 1px solid #e8ecf4;
      border-bottom: none;
      padding: 0 8px;
    }

    :host ::ng-deep .attendance-tabs .mat-mdc-tab-body-wrapper {
      background: transparent;
    }

    .tab-icon {
      margin-right: 6px;
      font-size: 18px;
      height: 18px;
      width: 18px;
    }

    /* ── Section Cards ── */
    .stats-card, .table-card {
      padding: 18px 20px;
      margin-top: 16px;
      background: #fff;
      border-radius: 14px;
      border: 1px solid #e8ecf4;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }

    .section-head {
      margin-bottom: 14px;
    }

    .section-head h3, .table-card h3, .all-participants-header h3 {
      margin: 0 0 2px;
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
    }

    .section-head__hint {
      font-size: 12px;
      color: #94a3b8;
    }

    /* ── Matching Pills ── */
    .matching-stats {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .match-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-radius: 12px;
      border: 1px solid transparent;
    }

    .match-pill mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .match-pill__val {
      font-size: 18px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }

    .match-pill__lbl {
      font-size: 12px;
      font-weight: 500;
    }

    .match-pill--green { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
    .match-pill--blue  { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
    .match-pill--amber { background: #fffbeb; border-color: #fde68a; color: #b45309; }
    .match-pill--red   { background: #fef2f2; border-color: #fecaca; color: #dc2626; }

    /* ── Table ── */
    .attendance-header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }

    .table-wrap {
      overflow-x: auto;
      border-radius: 10px;
      border: 1px solid #f1f5f9;
    }

    .attendance-table {
      width: 100%;
      min-width: 900px;
    }

    :host ::ng-deep .attendance-table .mat-mdc-header-row {
      background: #03396c;
    }

    :host ::ng-deep .attendance-table .mat-mdc-header-cell {
      color: #fff !important;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: none;
    }

    :host ::ng-deep .attendance-table .mat-mdc-cell {
      font-size: 13px;
      color: #334155;
      border-bottom: 1px solid #f1f5f9;
    }

    :host ::ng-deep .attendance-table .data-row:hover {
      background: #f8fafc;
    }

    /* ── Status Chips ── */
    .status-attended {
      background-color: #dcfce7 !important;
      color: #166534 !important;
      font-weight: 600;
      font-size: 12px;
    }

    .status-absent {
      background-color: #fee2e2 !important;
      color: #991b1b !important;
      font-weight: 600;
      font-size: 12px;
    }

    .chip-unmapped {
      background-color: #fef3c7 !important;
      color: #b45309 !important;
      font-weight: 600;
      font-size: 12px;
    }

    mat-chip mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-right: 4px;
    }

    .warning-icon {
      margin-left: 4px !important;
      margin-right: 0 !important;
      color: #f59e0b;
    }

    /* ── Confidence ── */
    .confidence-cell {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .confidence-high     { background-color: #dcfce7 !important; color: #166534 !important; }
    .confidence-medium   { background-color: #fef3c7 !important; color: #b45309 !important; }
    .confidence-low      { background-color: #fff7ed !important; color: #c2410c !important; }
    .confidence-very-low { background-color: #fee2e2 !important; color: #991b1b !important; }

    .match-method {
      font-size: 11px;
      color: #94a3b8;
      font-style: italic;
    }

    .name-comparison {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .zoom-name { font-weight: 600; color: #0f172a; }

    .name-diff-icon {
      color: #3b82f6;
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .no-match, .no-data {
      color: #cbd5e1;
      font-style: italic;
    }

    /* ── Participant Stats ── */
    .participants-stats-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0 10px;
    }

    .stat-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }

    .stat-badge mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .stat-unique     { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .stat-raw        { background: #f5f3ff; color: #7c3aed; border: 1px solid #ddd6fe; }
    .stat-reconnects { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }

    .session-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      background: #fffbeb;
      color: #b45309;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid #fde68a;
    }

    .single-session { color: #94a3b8; font-size: 13px; }

    .all-participants-header .subtitle {
      color: #64748b;
      font-size: 13px;
      margin: 0;
      line-height: 1.5;
    }

    .empty-hint {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
      gap: 8px;
      color: #94a3b8;
    }

    .empty-hint mat-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
    }

    .empty-hint p { margin: 0; font-size: 13px; }

    /* ── Duration Ring ── */
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

    /* ── Map Form ── */
    .map-inline-form {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .map-input {
      width: 220px;
      font-size: 13px;
    }

    .map-input .mat-mdc-form-field-subscript-wrapper { display: none; }

    /* ── Action Buttons ── */
    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      border: none;
      cursor: pointer;
      transition: all 0.15s;
    }

    .action-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .action-btn--primary {
      background: #005b96;
      color: #fff;
    }
    .action-btn--primary:hover { background: #03396c; }

    .action-btn--outline {
      background: #fff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
    }
    .action-btn--outline:hover:not(:disabled) { background: #eff6ff; }
    .action-btn--outline:disabled { opacity: 0.5; cursor: not-allowed; }

    .action-btn--amber {
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fde68a;
    }
    .action-btn--amber:hover { background: #fde68a; }

    .action-btn--ghost {
      background: #fff;
      color: #475569;
      border: 1px solid #e2e8f0;
    }
    .action-btn--ghost:hover { background: #f8fafc; }

    .actions-bar {
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
      padding: 20px;
      margin-top: 8px;
      background: #fff;
      border-radius: 14px;
      border: 1px solid #e8ecf4;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }

    /* ── Attendance Actions Group ── */
    .attendance-actions-group {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }

    .action-btn--add {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }
    .action-btn--add:hover { background: #dcfce7; border-color: #86efac; }

    /* ── Add Participants Panel ── */
    .add-participants-panel {
      margin: 0 0 16px 0;
      border-radius: 12px;
      border: 1.5px solid #bbf7d0;
      background: linear-gradient(135deg, #f0fdf4 0%, #fff 100%);
      overflow: hidden;
      animation: slideDown 0.2s ease-out;
    }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .add-panel-inner {
      padding: 16px 20px;
    }

    .add-panel-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: #166534;
      margin-bottom: 14px;
    }

    .add-panel-title mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: #16a34a;
    }

    .add-panel-loading {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #64748b;
      font-size: 13px;
      padding: 8px 0;
    }

    .add-panel-search {
      width: 100%;
      max-width: 420px;
      margin-bottom: 4px;
    }

    :host ::ng-deep .add-panel-search .mat-mdc-form-field-subscript-wrapper { display: none; }
    :host ::ng-deep .add-panel-search .mat-mdc-text-field-wrapper { background: #fff; }

    .batch-student-list {
      max-height: 320px;
      overflow-y: auto;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #fff;
      margin-top: 10px;
    }

    .batch-student-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid #f1f5f9;
      gap: 12px;
      transition: background 0.1s;
    }

    .batch-student-row:last-child { border-bottom: none; }
    .batch-student-row:hover { background: #f8fafc; }

    .batch-student-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }

    .batch-student-name {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .batch-student-email {
      font-size: 11px;
      color: #64748b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .add-student-btn {
      flex-shrink: 0;
      font-size: 12px;
      padding: 0 12px;
      height: 32px;
      line-height: 32px;
      color: #1d4ed8;
      border-color: #bfdbfe;
    }

    .add-student-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .already-added-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 600;
      color: #16a34a;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 999px;
      padding: 3px 10px;
      flex-shrink: 0;
    }

    .already-added-badge mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .no-students-hint {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 28px 16px;
      gap: 8px;
      color: #94a3b8;
      font-size: 13px;
    }

    .no-students-hint mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    /* ── Row Actions ── */
    .row-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .remove-student-btn {
      color: #dc2626 !important;
      opacity: 0.75;
      transition: opacity 0.15s;
    }

    .remove-student-btn:hover:not(:disabled) { opacity: 1; }
    .remove-student-btn:disabled { opacity: 0.35; }

    /* ── Responsive ── */
    @media (max-width: 900px) {
      .summary-grid { grid-template-columns: repeat(2, 1fr); }
    }

    @media (max-width: 600px) {
      .attendance-container { padding: 10px; }
      .summary-grid { grid-template-columns: 1fr; }
      .page-header__title { font-size: 16px; }
      .stat-card__val { font-size: 22px; }
      .meeting-info-header { flex-direction: column; }
      .refetch-btn { width: 100%; justify-content: center; }
      .attendance-actions-group { flex-direction: column; width: 100%; }
      .attendance-actions-group .action-btn { width: 100%; justify-content: center; }
    }
  `]
})
export class MeetingAttendanceComponent implements OnInit {
  meetingId: string = '';
  attendanceData: any = null;
  loading: boolean = true;
  error: string = '';
  selectedTab: number = 0;
  
  displayedColumns: string[] = ['name', 'email', 'status', 'confidence', 'zoomName', 'joinTime', 'leaveTime', 'duration', 'manualMark'];
  participantColumns: string[] = ['pName', 'pEmail', 'pJoinTime', 'pLeaveTime', 'pSessions', 'pDuration', 'pMapped', 'pAction'];
  portalJoinColumns: string[] = ['pjName', 'pjEmail', 'pjJoinedAt', 'pjLastJoined', 'pjJoinCount', 'pjZoomName'];

  // Mapping state
  mappingIndex: number = -1;
  mapStudentEmail: string = '';
  mappingLoading: boolean = false;
  mapMessage: string = '';
  mapSuccess: boolean = false;
  manualMarkingStudentId: string = '';
  manualMarkingAll: boolean = false;
  refetching: boolean = false;

  // Add Participants panel state
  showAddPanel: boolean = false;
  loadingBatchStudents: boolean = false;
  batchStudents: any[] = [];
  filteredBatchStudents: any[] = [];
  participantSearch: string = '';
  addingParticipantId: string = '';
  removingParticipantId: string = '';

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

  refetchAttendance(): void {
    if (!this.meetingId || this.refetching || this.loading) return;
    this.refetching = true;
    this.mapMessage = '';

    this.zoomService.refetchAttendance(this.meetingId).subscribe({
      next: (response) => {
        if (response.success) {
          this.attendanceData = response.data;
          this.mapSuccess = true;
          this.mapMessage = 'Attendance re-fetched from Zoom and remapped successfully.';
        } else {
          this.mapSuccess = false;
          this.mapMessage = response.message || 'Failed to re-fetch attendance from Zoom.';
        }
        this.refetching = false;
      },
      error: (err) => {
        this.mapSuccess = false;
        this.mapMessage = err.error?.message || 'Failed to re-fetch attendance from Zoom.';
        this.refetching = false;
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

  markStudentAttended(record: any): void {
    if (!record || this.isAttendedByDuration(record) || !this.meetingId) return;
    const sid = String(record.studentId || '');
    this.manualMarkingStudentId = sid;
    this.mapMessage = '';

    this.zoomService.manualMarkAttendance(this.meetingId, {
      studentId: sid || undefined,
      studentEmail: record.email
    }).subscribe({
      next: (res) => {
        this.mapSuccess = true;
        this.mapMessage = res.message || `${record.name} marked as attended`;
        this.manualMarkingStudentId = '';
        this.loadAttendance();
      },
      error: (err) => {
        this.mapSuccess = false;
        this.mapMessage = err.error?.message || 'Failed to manually mark student attendance';
        this.manualMarkingStudentId = '';
      }
    });
  }

  markAllStudentsAttended(): void {
    if (!this.meetingId || this.manualMarkingAll || !this.hasAbsentStudents()) return;
    this.manualMarkingAll = true;
    this.mapMessage = '';

    this.zoomService.manualMarkAllAttendance(this.meetingId).subscribe({
      next: (res) => {
        this.mapSuccess = true;
        this.mapMessage = res.message || 'All students marked as attended';
        this.manualMarkingAll = false;
        this.loadAttendance();
      },
      error: (err) => {
        this.mapSuccess = false;
        this.mapMessage = err.error?.message || 'Failed to mark all students as attended';
        this.manualMarkingAll = false;
      }
    });
  }

  hasAbsentStudents(): boolean {
    return (this.attendanceData?.attendance || []).some((r: any) => !this.isAttendedByDuration(r));
  }

  // --- Add / Remove Participants ---

  toggleAddPanel(): void {
    this.showAddPanel = !this.showAddPanel;
    if (this.showAddPanel && this.batchStudents.length === 0) {
      this.loadBatchStudents();
    }
  }

  loadBatchStudents(): void {
    const batch = this.attendanceData?.batch;
    if (!batch) return;
    this.loadingBatchStudents = true;
    this.zoomService.getStudentsByBatch(batch).subscribe({
      next: (res) => {
        this.batchStudents = res.students || res.data || res || [];
        this.filterBatchStudents();
        this.loadingBatchStudents = false;
      },
      error: () => {
        this.loadingBatchStudents = false;
      }
    });
  }

  filterBatchStudents(): void {
    const q = (this.participantSearch || '').toLowerCase().trim();
    this.filteredBatchStudents = this.batchStudents.filter((s: any) => {
      if (!q) return true;
      return (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q);
    });
  }

  isStudentAlreadyAdded(student: any): boolean {
    return (this.attendanceData?.attendance || []).some(
      (r: any) => r.studentId && (
        r.studentId === student._id ||
        r.studentId.toString() === student._id?.toString() ||
        (r.email && student.email && r.email.toLowerCase() === student.email.toLowerCase())
      )
    );
  }

  addParticipant(student: any): void {
    if (!student?._id || !this.meetingId) return;
    this.addingParticipantId = student._id;
    this.mapMessage = '';

    this.zoomService.addParticipantToEndedMeeting(this.meetingId, student._id).subscribe({
      next: (res) => {
        this.mapSuccess = true;
        this.mapMessage = res.message || `${student.name} added to attendance list`;
        this.addingParticipantId = '';
        this.loadAttendance();
      },
      error: (err) => {
        this.mapSuccess = false;
        this.mapMessage = err.error?.message || 'Failed to add participant';
        this.addingParticipantId = '';
      }
    });
  }

  removeParticipant(record: any): void {
    const sid = String(record?.studentId || '');
    if (!sid || !this.meetingId) return;
    this.removingParticipantId = sid;
    this.mapMessage = '';

    this.zoomService.removeParticipantFromEndedMeeting(this.meetingId, sid).subscribe({
      next: (res) => {
        this.mapSuccess = true;
        this.mapMessage = res.message || `${record.name} removed from attendance list`;
        this.removingParticipantId = '';
        this.loadAttendance();
      },
      error: (err) => {
        this.mapSuccess = false;
        this.mapMessage = err.error?.message || 'Failed to remove participant';
        this.removingParticipantId = '';
      }
    });
  }

  isMarkingStudent(record: any): boolean {
    return this.manualMarkingStudentId !== '' && String(record?.studentId || '') === this.manualMarkingStudentId;
  }

  // --- Existing methods ---

  get uniqueZoomParticipantCount(): number {
    return this.attendanceData?.allParticipants?.length || 0;
  }

  get rawZoomSessionCount(): number {
    return this.attendanceData?.rawZoomSessionCount
      ?? (this.attendanceData?.allParticipants || []).reduce(
           (sum: number, p: any) => sum + (p.sessionCount || 1), 0
         );
  }

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
      'manual_add': 'Manually Added',
      'manual_mark': 'Manually Marked',
      'manual_mark_all': 'Manually Marked (all)',
      'manual_map': 'Manually Mapped',
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

  getPortalJoinCount(): number {
    return this.attendanceData?.portalJoins?.length || 0;
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
