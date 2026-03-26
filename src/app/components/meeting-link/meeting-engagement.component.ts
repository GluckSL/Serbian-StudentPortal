// src/app/components/meeting-link/meeting-engagement.component.ts

import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';

@Component({
  selector: 'app-meeting-engagement',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule
  ],
  template: `
    <div class="engagement-container">
      <!-- Header -->
      <mat-card class="header-card">
        <div class="header-content">
          <button mat-icon-button (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h2>Meeting Engagement Report</h2>
        </div>
      </mat-card>

      <!-- Loading State -->
      <div *ngIf="loading" class="loading-container">
        <mat-spinner></mat-spinner>
        <p>Loading engagement data...</p>
        <p class="hint">This may take a few moments if the meeting just ended.</p>
      </div>

      <!-- Error State -->
      <mat-card *ngIf="error && !loading" class="error-card">
        <mat-icon color="warn">error</mat-icon>
        <h3>{{ error }}</h3>
        <p *ngIf="error.includes('not yet available') || error.includes('not found')">
          Zoom typically takes 5-10 minutes to process meeting data after it ends. 
          Please wait a few minutes and try again.
        </p>
        <p *ngIf="error.includes('Business') || error.includes('Dashboard')">
          <strong>Account Limitation:</strong> Detailed engagement metrics (camera/mic usage) 
          require a Zoom Business or higher account with Dashboard feature enabled.
        </p>
        <div class="error-actions">
          <button mat-raised-button color="primary" (click)="loadEngagement()" *ngIf="!error.includes('Business')">
            <mat-icon>refresh</mat-icon>
            Retry
          </button>
          <button mat-stroked-button (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
            Back
          </button>
        </div>
      </mat-card>

      <!-- Account Limitation Notice -->
      <mat-card *ngIf="engagementData && hasAccountLimitation()" class="limitation-card">
        <div class="limitation-content">
          <mat-icon class="limitation-icon">info</mat-icon>
          <div>
            <h3>Basic Engagement Metrics</h3>
            <p>Your current Zoom account provides <strong>participation-based engagement metrics</strong>. 
               For detailed camera/microphone usage tracking, upgrade to Zoom Business plan.</p>
            <div class="current-metrics">
              <h4>Available Metrics:</h4>
              <ul>
                <li>✅ Participation duration and rate</li>
                <li>✅ Engagement scores based on attendance</li>
                <li>✅ Meeting completion rates</li>
                <li>✅ Join/leave time tracking</li>
              </ul>
            </div>
            <a href="https://zoom.us/pricing" target="_blank" mat-button color="primary">
              <mat-icon>launch</mat-icon>
              Upgrade for Advanced Metrics
            </a>
          </div>
        </div>
      </mat-card>

      <!-- Engagement Data -->
      <div *ngIf="engagementData && !loading && !error">
        <!-- Summary Cards -->
        <div class="summary-grid">
          <mat-card class="summary-card">
            <mat-icon class="icon-primary">people</mat-icon>
            <h3>{{ engagementData.summary?.totalStudents || engagementData.count || 0 }}</h3>
            <p>Total Participants</p>
          </mat-card>

          <mat-card class="summary-card">
            <mat-icon class="icon-success">schedule</mat-icon>
            <h3>{{ getAverageParticipationTime() }} min</h3>
            <p>Avg Participation</p>
          </mat-card>

          <mat-card class="summary-card">
            <mat-icon class="icon-info">trending_up</mat-icon>
            <h3>{{ getAverageEngagementScore() }}%</h3>
            <p>Avg Engagement</p>
          </mat-card>

          <mat-card class="summary-card">
            <mat-icon class="icon-warn">timer</mat-icon>
            <h3>{{ getCompletionRate() }}%</h3>
            <p>Completion Rate</p>
          </mat-card>
        </div>

        <!-- Engagement Table -->
        <mat-card class="table-card">
          <h3>Detailed Engagement Metrics</h3>
          <table mat-table [dataSource]="engagementData.data" class="engagement-table">
            <!-- Name Column -->
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Participant Name</th>
              <td mat-cell *matCellDef="let record">{{ record.name }}</td>
            </ng-container>

            <!-- Email Column -->
            <ng-container matColumnDef="email">
              <th mat-header-cell *matHeaderCellDef>Email</th>
              <td mat-cell *matCellDef="let record">{{ record.email || '-' }}</td>
            </ng-container>

            <!-- Duration Column -->
            <ng-container matColumnDef="duration">
              <th mat-header-cell *matHeaderCellDef>Total Duration</th>
              <td mat-cell *matCellDef="let record">
                {{ record.durationMinutes || 0 }} min
              </td>
            </ng-container>

            <!-- Camera On Column -->
            <ng-container matColumnDef="cameraOn">
              <th mat-header-cell *matHeaderCellDef>Participation Rate</th>
              <td mat-cell *matCellDef="let record">
                <div class="metric-cell">
                  <mat-chip [class]="getEngagementClass(record.engagement?.participationPercentage || 0)">
                    {{ record.engagement?.participationPercentage || 0 }}%
                  </mat-chip>
                  <span class="metric-label">{{ record.durationMinutes || 0 }} / {{ record.engagement?.actualMeetingDuration || 0 }} min</span>
                </div>
              </td>
            </ng-container>

            <!-- Mic On Column -->
            <ng-container matColumnDef="micOn">
              <th mat-header-cell *matHeaderCellDef>Engagement Score</th>
              <td mat-cell *matCellDef="let record">
                <div class="metric-cell">
                  <mat-chip [class]="getEngagementClass(record.engagement?.engagementScore || 0)">
                    {{ record.engagement?.engagementScore || 0 }}%
                  </mat-chip>
                  <span class="metric-label">{{ getEngagementLabel(record.engagement?.engagementScore || 0) }}</span>
                </div>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
          </table>

          <div *ngIf="!engagementData.data || engagementData.data.length === 0" class="no-data">
            <mat-icon>analytics</mat-icon>
            <p>No engagement data available</p>
          </div>
        </mat-card>

        <!-- Actions -->
        <div class="actions">
          <button mat-raised-button color="primary" (click)="exportToCSV()">
            <mat-icon>download</mat-icon>
            Export CSV
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
    .engagement-container {
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
    .icon-warn { color: #ff9800; }
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

    .table-card {
      padding: 20px;
      margin-bottom: 20px;
    }

    .table-card h3 {
      margin: 0 0 20px 0;
    }

    .engagement-table {
      width: 100%;
    }

    .metric-cell {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .engagement-high {
      background-color: #e8f5e9;
      color: #2e7d32;
    }

    .engagement-medium {
      background-color: #fff3e0;
      color: #e65100;
    }

    .engagement-low {
      background-color: #fff8e1;
      color: #f57c00;
    }

    .engagement-very-low {
      background-color: #ffebee;
      color: #c62828;
    }

    .metric-label {
      font-size: 11px;
      color: #666;
      font-style: italic;
      margin-left: 5px;
    }

    .no-data {
      text-align: center;
      padding: 40px;
      color: #999;
    }

    .no-data mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      margin-bottom: 10px;
    }

    .limitation-card {
      margin-bottom: 20px;
      background-color: #fff3e0;
      border-left: 4px solid #ff9800;
    }

    .limitation-content {
      display: flex;
      align-items: flex-start;
      gap: 15px;
      padding: 20px;
    }

    .limitation-icon {
      color: #ff9800;
      font-size: 32px;
      width: 32px;
      height: 32px;
      margin-top: 5px;
    }

    .limitation-content h3 {
      margin: 0 0 10px 0;
      color: #e65100;
    }

    .limitation-content p {
      margin: 0 0 15px 0;
      color: #bf360c;
    }

    .current-metrics {
      margin: 15px 0;
      padding: 15px;
      background-color: #fff;
      border-radius: 8px;
    }

    .current-metrics h4 {
      margin: 0 0 10px 0;
      color: #e65100;
      font-size: 14px;
    }

    .current-metrics ul {
      margin: 0;
      padding-left: 20px;
      color: #5d4037;
    }

    .current-metrics li {
      margin: 5px 0;
      font-size: 13px;
    }

    .limitation-cell {
      display: flex;
      align-items: center;
      gap: 5px;
      color: #999;
      font-style: italic;
    }

    .limitation-cell mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }
  `]
})
export class MeetingEngagementComponent implements OnInit {
  meetingId: string = '';
  zoomMeetingId: string = '';
  engagementData: any = null;
  loading: boolean = true;
  error: string = '';
  
  displayedColumns: string[] = ['name', 'email', 'duration', 'cameraOn', 'micOn'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private zoomService: ZoomService
  ) {}

  ngOnInit(): void {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    if (this.meetingId) {
      this.loadMeetingAndEngagement();
    }
  }

  loadMeetingAndEngagement(): void {
    // First get meeting details to get Zoom meeting ID
    this.zoomService.getMeetingDetails(this.meetingId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.zoomMeetingId = response.data.zoomMeetingId;
          this.loadEngagement();
        } else {
          this.error = 'Failed to load meeting details';
          this.loading = false;
        }
      },
      error: (err) => {
        console.error('Error loading meeting details:', err);
        this.error = 'Failed to load meeting details';
        this.loading = false;
      }
    });
  }

  loadEngagement(): void {
    this.loading = true;
    this.error = '';

    this.zoomService.getStudentEngagementMetrics(this.zoomMeetingId).subscribe({
      next: (response) => {
        if (response.success) {
          this.engagementData = response;
          console.log('Engagement data loaded:', this.engagementData);
        } else {
          this.error = response.message || 'Failed to load engagement data';
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading engagement:', err);
        this.error = err.error?.message || 'Failed to load engagement data';
        this.loading = false;
      }
    });
  }

  getRoundedPercentage(value: number): number {
    return Math.round(value);
  }

  getEngagementClass(percentage: number): string {
    if (percentage >= 80) return 'engagement-high';
    if (percentage >= 60) return 'engagement-medium';
    if (percentage >= 40) return 'engagement-low';
    return 'engagement-very-low';
  }

  getEngagementLabel(score: number): string {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Very Good';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Fair';
    if (score >= 50) return 'Below Average';
    return 'Poor';
  }

  getAverageParticipationTime(): number {
    if (!this.engagementData?.data || this.engagementData.data.length === 0) {
      return 0;
    }
    const total = this.engagementData.data.reduce((sum: number, record: any) => 
      sum + (record.durationMinutes || 0), 0
    );
    return Math.round(total / this.engagementData.data.length);
  }

  getAverageEngagementScore(): number {
    if (!this.engagementData?.data || this.engagementData.data.length === 0) {
      return 0;
    }
    const total = this.engagementData.data.reduce((sum: number, record: any) => 
      sum + (record.engagement?.participationPercentage || 0), 0
    );
    return Math.round(total / this.engagementData.data.length);
  }

  getCompletionRate(): number {
    if (!this.engagementData?.data || this.engagementData.data.length === 0) {
      return 0;
    }
    const completedCount = this.engagementData.data.filter((record: any) => 
      (record.engagement?.participationPercentage || 0) >= 80
    ).length;
    return Math.round((completedCount / this.engagementData.data.length) * 100);
  }

  hasAccountLimitation(): boolean {
    return this.engagementData?.data?.some((record: any) => 
      record.engagement?.accountLimitation
    ) || false;
  }

  exportToCSV(): void {
    if (!this.engagementData || !this.engagementData.data) {
      return;
    }

    const headers = ['Name', 'Email', 'Duration (min)', 'Meeting Duration (min)', 'Participation Rate (%)', 'Engagement Score (%)', 'Engagement Level', 'Sessions'];
    const rows = this.engagementData.data.map((record: any) => [
      record.name,
      record.email || '-',
      record.durationMinutes || 0,
      record.engagement?.actualMeetingDuration || 0,
      record.engagement?.participationPercentage || 0,
      record.engagement?.engagementScore || 0,
      this.getEngagementLabel(record.engagement?.engagementScore || 0),
      record.sessionCount || 1
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row: any[]) => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `engagement_${this.zoomMeetingId}_${new Date().toISOString().split('T')[0]}.csv`);
    link.click();
    URL.revokeObjectURL(url);
  }

  goBack(): void {
    this.router.navigate(['/teacher/meetings', this.meetingId]);
  }
}
