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
        <span class="cd-icon">{{ data.danger ? '⚠️' : 'ℹ️' }}</span>
        <h2 class="cd-title">{{ data.title }}</h2>
      </div>
      <div class="cd-body">
        <p class="cd-message">{{ data.message }}</p>
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
    .cd-wrap {
      border-radius: 16px;
      overflow: hidden;
      font-family: 'Inter', 'Roboto', system-ui, sans-serif;
      background: #fff;
    }
    .cd-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 20px 24px 16px;
      background: linear-gradient(135deg, #f0f4ff, #e8f0fe);
      border-bottom: 1px solid #e2e8f0;
    }
    .cd-header--danger {
      background: linear-gradient(135deg, #fff5f5, #ffe4e4);
      border-bottom-color: #fecaca;
    }
    .cd-icon { font-size: 24px; line-height: 1; }
    .cd-title {
      margin: 0;
      font-size: 17px;
      font-weight: 700;
      color: #1e293b;
      line-height: 1.3;
    }
    .cd-body {
      padding: 20px 24px;
    }
    .cd-message {
      margin: 0;
      font-size: 14px;
      color: #475569;
      line-height: 1.6;
      white-space: pre-line;
    }
    .cd-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 0 24px 20px;
    }
    .cd-btn {
      padding: 9px 22px;
      border-radius: 8px;
      border: none;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .cd-btn--cancel {
      background: #f1f5f9;
      color: #475569;
    }
    .cd-btn--cancel:hover { background: #e2e8f0; }
    .cd-btn--primary {
      background: #405980;
      color: #fff;
    }
    .cd-btn--primary:hover { background: #2f4362; }
    .cd-btn--danger {
      background: #dc2626;
      color: #fff;
    }
    .cd-btn--danger:hover { background: #b91c1c; }
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
