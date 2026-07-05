import { AfterViewInit, Component, ElementRef, Inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { SignupPendingApplication } from './payment-hub-api.service';

export interface SignupRejectionDialogData {
  application: SignupPendingApplication;
}

export interface SignupRejectionDialogResult {
  rejectionReason?: string;
}

@Component({
  selector: 'app-signup-rejection-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDividerModule,
  ],
  templateUrl: './signup-rejection-dialog.component.html',
  styleUrls: ['./payment-approval-decision-dialog.component.scss'],
})
export class SignupRejectionDialogComponent implements AfterViewInit {
  @ViewChild('rejectionReasonInput') rejectionReasonInput?: ElementRef<HTMLTextAreaElement>;

  rejectionReason = '';

  constructor(
    private readonly dialogRef: MatDialogRef<SignupRejectionDialogComponent, SignupRejectionDialogResult | undefined>,
    @Inject(MAT_DIALOG_DATA) private readonly data: SignupRejectionDialogData,
  ) {}

  get studentName(): string {
    return (this.data.application.name || '').trim();
  }

  get studentEmail(): string {
    return (this.data.application.email || '').trim();
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.rejectionReasonInput?.nativeElement?.focus(), 0);
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }

  confirm(): void {
    const reason = this.rejectionReason.trim();
    this.dialogRef.close({ rejectionReason: reason || undefined });
  }
}
