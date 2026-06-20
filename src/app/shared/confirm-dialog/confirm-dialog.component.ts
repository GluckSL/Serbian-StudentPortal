// src/app/shared/confirm-dialog/confirm-dialog.component.ts
import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <div class="cd-wrap">
      <div class="cd-header" [class.cd-header--danger]="data.danger">
        <div class="cd-icon-wrap" [class.cd-icon-wrap--danger]="data.danger">
          <i class="fas" [class.fa-trash-alt]="data.danger" [class.fa-question-circle]="!data.danger"></i>
        </div>
        <div>
          <h2 class="cd-title">{{ data.title }}</h2>
          <p class="cd-message">{{ data.message }}</p>
        </div>
      </div>
      <div class="cd-actions">
        <button class="cd-btn cd-btn--cancel" (click)="cancel()">{{ data.cancelText || 'Cancel' }}</button>
        <button class="cd-btn" [class.cd-btn--danger]="data.danger" [class.cd-btn--primary]="!data.danger" (click)="confirm()">
          {{ data.confirmText || 'Confirm' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    @import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css');
    .cd-wrap {
      border-radius: 16px;
      overflow: hidden;
      font-family: 'Inter', 'Roboto', system-ui, sans-serif;
      background: #fff;
      box-shadow: 0 20px 60px rgba(1,31,75,0.18);
    }
    .cd-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 24px 24px 20px;
      background: linear-gradient(135deg, #011f4b 0%, #03396c 100%);
    }
    .cd-header--danger {
      background: linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%);
    }
    .cd-icon-wrap {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: rgba(255,255,255,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .cd-icon-wrap i {
      font-size: 20px;
      color: #fff;
    }
    .cd-title {
      margin: 0 0 4px;
      font-size: 17px;
      font-weight: 700;
      color: #fff;
      line-height: 1.3;
    }
    .cd-message {
      margin: 0;
      font-size: 13px;
      color: rgba(255,255,255,0.8);
      line-height: 1.5;
    }
    .cd-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 20px 24px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }
    .cd-btn {
      padding: 10px 24px;
      border-radius: 8px;
      border: none;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      min-height: 40px;
    }
    .cd-btn--cancel {
      background: #fff;
      color: #475569;
      border: 1px solid #e2e8f0;
    }
    .cd-btn--cancel:hover { background: #f1f5f9; }
    .cd-btn--primary {
      background: #011f4b;
      color: #fff;
    }
    .cd-btn--primary:hover { background: #03396c; box-shadow: 0 2px 8px rgba(1,31,75,0.3); }
    .cd-btn--danger {
      background: #dc2626;
      color: #fff;
    }
    .cd-btn--danger:hover { background: #b91c1c; box-shadow: 0 2px 8px rgba(220,38,38,0.35); }
    @media (max-width: 480px) {
      .cd-actions { flex-direction: column-reverse; }
      .cd-btn { width: 100%; text-align: center; }
    }
  `]
})
export class ConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmDialogData
  ) {}

  confirm(): void { this.dialogRef.close(true); }
  cancel(): void { this.dialogRef.close(false); }
}
