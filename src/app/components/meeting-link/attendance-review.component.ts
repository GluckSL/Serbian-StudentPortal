// src/app/components/meeting-link/attendance-review.component.ts

import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../shared/material.module';
import { FormsModule } from '@angular/forms';
import { ZoomService } from '../../services/zoom.service';

@Component({
  selector: 'app-attendance-review',
  standalone: true,
  imports: [
    CommonModule,
    MaterialModule,
    FormsModule
  ],
  template: `
    <div class="review-container">
      <!-- Header -->
      <mat-card class="header-card">
        <div class="header-content">
          <button mat-icon-button (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h2>Review Attendance Matching</h2>
        </div>
        <p>Review and correct attendance matches that need manual verification</p>
      </mat-card>

      <!-- Loading State -->
      <div *ngIf="loading" class="loading-container">
        <mat-spinner></mat-spinner>
        <p>Loading attendance data...</p>
      </div>

      <!-- Review Items -->
      <div *ngIf="reviewItems && reviewItems.length > 0 && !loading">
        <mat-card class="review-card" *ngFor="let item of reviewItems; let i = index">
          <div class="review-item">
            <div class="student-info">
              <h3>{{ item.name }}</h3>
              <p>{{ item.email }}</p>
              <mat-chip class="confidence-chip" [class]="getConfidenceClass(item.confidence)">
                {{ item.confidence }}% confidence
              </mat-chip>
            </div>

            <div class="matching-info">
              <h4>Current Match:</h4>
              <div class="current-match" *ngIf="item.attended">
                <p><strong>Zoom Name:</strong> {{ item.zoomName }}</p>
                <p><strong>Method:</strong> {{ getMatchMethodLabel(item.matchMethod) }}</p>
                <p><strong>Join Time:</strong> {{ formatTime(item.joinTime) }}</p>
              </div>
              <div *ngIf="!item.attended" class="no-match">
                <p>No match found</p>
              </div>
            </div>

            <div class="review-actions">
              <mat-form-field appearance="outline">
                <mat-label>Correct Status</mat-label>
                <mat-select [(value)]="item.reviewStatus" (selectionChange)="onStatusChange(i)">
                  <mat-option value="attended">Attended</mat-option>
                  <mat-option value="absent">Absent</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" *ngIf="item.reviewStatus === 'attended' && unmatchedParticipants.length > 0">
                <mat-label>Match with Zoom Participant</mat-label>
                <mat-select [(value)]="item.selectedParticipant">
                  <mat-option [value]="null">No match</mat-option>
                  <mat-option *ngFor="let participant of unmatchedParticipants" [value]="participant">
                    {{ participant.name }} ({{ formatTime(participant.joinTime) }})
                  </mat-option>
                </mat-select>
              </mat-form-field>
            </div>
          </div>
        </mat-card>

        <!-- Save Changes -->
        <div class="save-actions">
          <button mat-raised-button color="primary" (click)="saveChanges()" [disabled]="saving">
            <mat-icon>save</mat-icon>
            {{ saving ? 'Saving...' : 'Save Changes' }}
          </button>
          <button mat-stroked-button (click)="goBack()">
            <mat-icon>cancel</mat-icon>
            Cancel
          </button>
        </div>
      </div>

      <!-- No Review Needed -->
      <mat-card *ngIf="reviewItems && reviewItems.length === 0 && !loading" class="no-review-card">
        <mat-icon class="success-icon">check_circle</mat-icon>
        <h3>All Matches Look Good!</h3>
        <p>No attendance records need manual review.</p>
        <button mat-raised-button color="primary" (click)="goBack()">
          <mat-icon>arrow_back</mat-icon>
          Back to Attendance
        </button>
      </mat-card>
    </div>
  `,
  styles: [`
    .review-container {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .header-card {
      margin-bottom: 20px;
      padding: 20px;
    }

    .header-content {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }

    .header-content h2 {
      margin: 0;
      flex: 1;
    }

    .loading-container {
      text-align: center;
      padding: 60px 20px;
    }

    .review-card {
      margin-bottom: 20px;
      padding: 20px;
    }

    .review-item {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 20px;
      align-items: start;
    }

    .student-info h3 {
      margin: 0 0 5px 0;
      color: #1976d2;
    }

    .student-info p {
      margin: 0 0 10px 0;
      color: #666;
    }

    .confidence-chip {
      font-size: 12px;
    }

    .confidence-high { background-color: #e8f5e9; color: #2e7d32; }
    .confidence-medium { background-color: #fff3e0; color: #e65100; }
    .confidence-low { background-color: #fff8e1; color: #f57c00; }
    .confidence-very-low { background-color: #ffebee; color: #c62828; }

    .matching-info h4 {
      margin: 0 0 10px 0;
      color: #333;
    }

    .current-match p {
      margin: 5px 0;
      font-size: 14px;
    }

    .no-match {
      color: #999;
      font-style: italic;
    }

    .review-actions {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .save-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin-top: 30px;
    }

    .no-review-card {
      text-align: center;
      padding: 60px 40px;
    }

    .success-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: #4caf50;
      margin-bottom: 20px;
    }

    @media (max-width: 768px) {
      .review-item {
        grid-template-columns: 1fr;
        gap: 15px;
      }
    }
  `]
})
export class AttendanceReviewComponent implements OnInit {
  meetingId: string = '';
  reviewItems: any[] = [];
  unmatchedParticipants: any[] = [];
  loading: boolean = true;
  saving: boolean = false;
  error: string = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private zoomService: ZoomService
  ) {}

  ngOnInit(): void {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    if (this.meetingId) {
      this.loadReviewData();
    }
  }

  loadReviewData(): void {
    this.loading = true;
    this.error = '';

    this.zoomService.getAttendance(this.meetingId).subscribe({
      next: (response) => {
        if (response.success) {
          // Filter items that need review
          this.reviewItems = response.data.attendance
            .filter((item: any) => item.needsReview || item.confidence < 80)
            .map((item: any) => ({
              ...item,
              reviewStatus: item.attended ? 'attended' : 'absent',
              selectedParticipant: null
            }));

          // Get unmatched participants for manual matching
          // This would require additional API endpoint to get all participants
          this.unmatchedParticipants = []; // Placeholder
          
          console.log('Review items loaded:', this.reviewItems);
        } else {
          this.error = response.message || 'Failed to load review data';
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading review data:', err);
        this.error = err.error?.message || 'Failed to load review data';
        this.loading = false;
      }
    });
  }

  onStatusChange(index: number): void {
    const item = this.reviewItems[index];
    if (item.reviewStatus === 'absent') {
      item.selectedParticipant = null;
    }
  }

  saveChanges(): void {
    this.saving = true;
    
    // Prepare changes for API
    const changes = this.reviewItems.map(item => ({
      studentId: item.studentId,
      attended: item.reviewStatus === 'attended',
      matchedParticipant: item.selectedParticipant,
      manuallyReviewed: true
    }));

    // This would require a new API endpoint to save manual corrections
    console.log('Saving changes:', changes);
    
    // Simulate API call
    setTimeout(() => {
      this.saving = false;
      this.router.navigate(['/teacher/meetings', this.meetingId, 'attendance']);
    }, 1000);
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
      'exact_name': 'Exact Name',
      'partial_name': 'Partial Name',
      'fuzzy_name': 'Similar Name',
      'no_match': 'No Match'
    };
    return labels[method] || method;
  }

  formatTime(dateString: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  goBack(): void {
    this.router.navigate(['/teacher/meetings', this.meetingId, 'attendance']);
  }
}