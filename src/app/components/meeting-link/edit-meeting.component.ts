import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MaterialModule } from '../../shared/material.module';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ZoomService } from '../../services/zoom.service';

@Component({
  selector: 'app-edit-meeting',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MaterialModule
  ],
  template: `
    <div class="edit-meeting-container">
      <mat-card class="edit-meeting-card">
        <mat-card-header>
          <mat-card-title>
            <mat-icon>edit</mat-icon>
            Edit Meeting
          </mat-card-title>
          <mat-card-subtitle>Update meeting details</mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          <form [formGroup]="editForm" (ngSubmit)="onSubmit()" *ngIf="!loading">
            
            <!-- Meeting Topic -->
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Meeting Topic</mat-label>
              <input matInput formControlName="topic" placeholder="Enter meeting topic">
              <mat-error *ngIf="editForm.get('topic')?.hasError('required')">
                Meeting topic is required
              </mat-error>
            </mat-form-field>

            <!-- Date and Time -->
            <div class="date-time-row">
              <mat-form-field appearance="outline" class="date-field">
                <mat-label>Meeting Date</mat-label>
                <input matInput [matDatepicker]="picker" formControlName="date">
                <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
                <mat-datepicker #picker></mat-datepicker>
                <mat-error *ngIf="editForm.get('date')?.hasError('required')">
                  Date is required
                </mat-error>
              </mat-form-field>

              <mat-form-field appearance="outline" class="time-field">
                <mat-label>Start Time</mat-label>
                <input matInput type="time" formControlName="time">
                <mat-error *ngIf="editForm.get('time')?.hasError('required')">
                  Time is required
                </mat-error>
              </mat-form-field>
            </div>

            <!-- Duration -->
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Duration (minutes)</mat-label>
              <mat-select formControlName="duration">
                <mat-option value="30">30 minutes</mat-option>
                <mat-option value="45">45 minutes</mat-option>
                <mat-option value="60">1 hour</mat-option>
                <mat-option value="90">1.5 hours</mat-option>
                <mat-option value="120">2 hours</mat-option>
                <mat-option value="180">3 hours</mat-option>
              </mat-select>
              <mat-error *ngIf="editForm.get('duration')?.hasError('required')">
                Duration is required
              </mat-error>
            </mat-form-field>

            <!-- Timezone -->
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Timezone</mat-label>
              <mat-select formControlName="timezone">
                <mat-option value="Asia/Colombo">Asia/Colombo (Sri Lanka)</mat-option>
                <mat-option value="Asia/Kolkata">Asia/Kolkata (India)</mat-option>
                <mat-option value="UTC">UTC</mat-option>
                <mat-option value="America/New_York">America/New_York (EST)</mat-option>
                <mat-option value="Europe/London">Europe/London (GMT)</mat-option>
              </mat-select>
            </mat-form-field>

            <!-- Agenda -->
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Meeting Agenda</mat-label>
              <textarea matInput formControlName="agenda" rows="4" 
                        placeholder="Enter meeting agenda or description"></textarea>
            </mat-form-field>

          </form>

          <!-- Loading Spinner -->
          <div *ngIf="loading" class="loading-container">
            <mat-spinner diameter="50"></mat-spinner>
            <p>Updating meeting...</p>
          </div>

        </mat-card-content>

        <mat-card-actions align="end">
          <button mat-button type="button" (click)="onCancel()">
            <mat-icon>cancel</mat-icon>
            Cancel
          </button>
          <button mat-raised-button color="primary" 
                  (click)="onSubmit()" 
                  [disabled]="editForm.invalid || loading">
            <mat-icon>save</mat-icon>
            Update Meeting
          </button>
        </mat-card-actions>

      </mat-card>
    </div>
  `,
  styles: [`
    .edit-meeting-container {
      max-width: 800px;
      margin: 20px auto;
      padding: 20px;
    }

    .edit-meeting-card {
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }

    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }

    .date-time-row {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
    }

    .date-field {
      flex: 2;
    }

    .time-field {
      flex: 1;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px;
    }

    .loading-container p {
      margin-top: 16px;
      color: #666;
    }

    mat-card-header {
      margin-bottom: 20px;
    }

    mat-card-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    mat-card-actions {
      padding: 16px 24px;
      border-top: 1px solid #e0e0e0;
    }

    button {
      margin-left: 8px;
    }

    button mat-icon {
      margin-right: 4px;
    }

    /* Snackbar styling */
    ::ng-deep .success-snackbar {
      background-color: #4caf50 !important;
      color: white !important;
    }

    ::ng-deep .error-snackbar {
      background-color: #f44336 !important;
      color: white !important;
    }

    /* Form validation styling */
    .mat-mdc-form-field.mat-form-field-invalid .mat-mdc-text-field-wrapper {
      border-color: #f44336;
    }

    @media (max-width: 600px) {
      .edit-meeting-container {
        margin: 10px;
        padding: 10px;
      }

      .date-time-row {
        flex-direction: column;
        gap: 0;
      }

      .date-field, .time-field {
        flex: 1;
        margin-bottom: 16px;
      }
    }
  `]
})
export class EditMeetingComponent implements OnInit {
  editForm: FormGroup;
  loading = false;
  meetingId: string = '';
  originalMeeting: any = null;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private zoomService: ZoomService,
    private snackBar: MatSnackBar
  ) {
    this.editForm = this.fb.group({
      topic: ['', Validators.required],
      date: ['', Validators.required],
      time: ['', Validators.required],
      duration: [60, Validators.required],
      timezone: ['Asia/Colombo'],
      agenda: ['']
    });
  }

  ngOnInit(): void {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    if (this.meetingId) {
      this.loadMeetingDetails();
    } else {
      this.router.navigate(['/teacher/meetings']);
    }
  }

  loadMeetingDetails(): void {
    this.loading = true;
    
    this.zoomService.getMeetingDetails(this.meetingId).subscribe({
      next: (response: any) => {
        if (response.success) {
          this.originalMeeting = response.data;
          this.populateForm(response.data);
        } else {
          this.showError('Failed to load meeting details');
          this.router.navigate(['/teacher/meetings']);
        }
        this.loading = false;
      },
      error: (error: any) => {
        console.error('Error loading meeting:', error);
        this.showError('Failed to load meeting details');
        this.router.navigate(['/teacher/meetings']);
        this.loading = false;
      }
    });
  }

  populateForm(meeting: any): void {
    try {
      const startTime = new Date(meeting.startTime);
      
      // Validate the date
      if (isNaN(startTime.getTime())) {
        console.error('Invalid meeting start time:', meeting.startTime);
        this.showError('Invalid meeting date/time data');
        return;
      }

      // Format date for input (YYYY-MM-DD)
      const year = startTime.getFullYear();
      const month = String(startTime.getMonth() + 1).padStart(2, '0');
      const day = String(startTime.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      // Format time for input (HH:MM)
      const hours = String(startTime.getHours()).padStart(2, '0');
      const minutes = String(startTime.getMinutes()).padStart(2, '0');
      const timeString = `${hours}:${minutes}`;

      console.log('Populating form with:', {
        originalStartTime: meeting.startTime,
        parsedDate: startTime,
        dateString: dateString,
        timeString: timeString
      });

      this.editForm.patchValue({
        topic: meeting.topic || '',
        date: dateString,
        time: timeString,
        duration: meeting.duration || 60,
        timezone: meeting.timezone || 'Asia/Colombo',
        agenda: meeting.agenda || ''
      });

    } catch (error) {
      console.error('Error populating form:', error);
      this.showError('Error loading meeting data');
    }
  }

  onSubmit(): void {
    if (this.editForm.valid) {
      this.loading = true;

      const formValue = this.editForm.value;
      
      // Validate and combine date and time
      let startTime: string;
      try {
        const dateValue = formValue.date;
        const timeValue = formValue.time;
        
        console.log('Form values:', { date: dateValue, time: timeValue });
        
        // Handle different date formats
        let dateObj: Date;
        if (dateValue instanceof Date) {
          dateObj = new Date(dateValue);
        } else if (typeof dateValue === 'string') {
          dateObj = new Date(dateValue);
        } else {
          throw new Error('Invalid date format');
        }
        
        // Validate date
        if (isNaN(dateObj.getTime())) {
          throw new Error('Invalid date value');
        }
        
        // Validate time format (HH:MM)
        if (!timeValue || !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeValue)) {
          throw new Error('Invalid time format');
        }
        
        // Format date as YYYY-MM-DD
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${day}`;
        
        // Combine date and time
        const dateTimeString = `${dateString}T${timeValue}:00`;
        console.log('Combined datetime string:', dateTimeString);
        
        // Create final date object and validate
        const finalDateTime = new Date(dateTimeString);
        if (isNaN(finalDateTime.getTime())) {
          throw new Error('Invalid combined date/time');
        }
        
        startTime = finalDateTime.toISOString();
        console.log('Final ISO string:', startTime);
        
      } catch (error) {
        console.error('Date/time validation error:', error);
        this.showError('Invalid date or time format. Please check your inputs.');
        this.loading = false;
        return;
      }

      const updateData = {
        topic: formValue.topic,
        startTime: startTime,
        duration: formValue.duration,
        timezone: formValue.timezone,
        agenda: formValue.agenda
      };

      console.log('Sending update data:', updateData);

      this.zoomService.updateMeeting(this.meetingId, updateData).subscribe({
        next: (response: any) => {
          if (response.success) {
            this.showSuccess('Meeting updated successfully!');
            this.router.navigate(['/teacher/meetings', this.meetingId]);
          } else {
            this.showError(response.message || 'Failed to update meeting');
          }
          this.loading = false;
        },
        error: (error: any) => {
          console.error('Error updating meeting:', error);
          this.showError(error.error?.message || 'Failed to update meeting');
          this.loading = false;
        }
      });
    } else {
      // Show validation errors
      this.markFormGroupTouched();
      this.showError('Please fill in all required fields correctly.');
    }
  }

  onCancel(): void {
    this.router.navigate(['/teacher/meetings', this.meetingId]);
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['success-snackbar']
    });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  private markFormGroupTouched(): void {
    Object.keys(this.editForm.controls).forEach(key => {
      const control = this.editForm.get(key);
      if (control) {
        control.markAsTouched();
      }
    });
  }
}