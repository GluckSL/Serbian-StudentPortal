import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface JourneyPendingCelebrationData {
  currentDay: number;
  nextDay: number;
}

@Component({
  selector: 'app-journey-pending-celebration-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title class="jp-title">Congratulations!</h2>
    <mat-dialog-content class="jp-body">
      <p>
        You attended your live class for <strong>Day {{ data.currentDay }}</strong>. You’re eligible to move on in your journey.
      </p>
      <p class="jp-hint">
        Your journey day will advance to <strong>Day {{ data.nextDay }}</strong> at <strong>midnight</strong> (course timezone). Until then, keep practicing on Day {{ data.currentDay }}.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button color="primary" (click)="close()">Got it</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .jp-title {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 800;
        color: #1e1b4b;
      }
      .jp-body {
        font-size: 0.95rem;
        line-height: 1.55;
        color: #334155;
        padding-top: 8px;
      }
      .jp-hint {
        margin-top: 12px;
        padding: 10px 12px;
        background: #eef2ff;
        border-radius: 10px;
        border: 1px solid #c7d2fe;
        font-size: 0.88rem;
        color: #3730a3;
      }
    `
  ]
})
export class JourneyPendingCelebrationDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<JourneyPendingCelebrationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: JourneyPendingCelebrationData
  ) {}

  close(): void {
    this.dialogRef.close();
  }
}
