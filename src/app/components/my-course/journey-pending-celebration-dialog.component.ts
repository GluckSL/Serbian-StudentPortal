import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface JourneyPendingCelebrationData {
  currentDay: number;
  nextDay: number;
  /** When true the student was promoted right now (instant); false = promoted at midnight. */
  instant?: boolean;
}

@Component({
  selector: 'app-journey-pending-celebration-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title class="jp-title">
      {{ data.instant ? '🎉 Dan završen!' : 'Čestitamo!' }}
    </h2>
    <mat-dialog-content class="jp-body">
      <ng-container *ngIf="data.instant; else pendingMode">
        <p>
          Odličan rad! Završili ste <strong>sve zadatke za Dan {{ data.currentDay }}</strong>
          — vežbe, Gluck Buddy i snimak časa.
        </p>
        <p class="jp-hint jp-instant">
          Trenutno ste unapređeni na <strong>Dan {{ data.nextDay }}</strong>!
          Sadržaj novog dana je otključan odmah. Nastavite tako! 🚀
        </p>
      </ng-container>
      <ng-template #pendingMode>
        <p>
          Prisustvovali ste uživo času za <strong>Dan {{ data.currentDay }}</strong>. Ispunili ste uslove za nastavak putovanja.
        </p>
        <p class="jp-hint">
          Vaš dan putovanja će napredovati na <strong>Dan {{ data.nextDay }}</strong> u <strong>ponoć</strong> (vremenska zona kursa). Do tada, nastavite da vežbate na Dan {{ data.currentDay }}.
        </p>
      </ng-template>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button color="primary" (click)="close()">{{ data.instant ? 'Idemo!' : 'Razumem' }}</button>
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
      .jp-instant {
        background: #f0fdf4;
        border-color: #86efac;
        color: #166534;
        font-weight: 600;
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
