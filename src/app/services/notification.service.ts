// src/app/services/notification.service.ts
import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Observable, map } from 'rxjs';
import { ConfirmDialogComponent, ConfirmDialogData } from '../shared/confirm-dialog/confirm-dialog.component';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  constructor(
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  success(message: string, duration = 3000): void {
    this.snackBar.open(message, '✕', {
      duration,
      panelClass: ['snack-success'],
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  error(message: string, duration = 5000): void {
    this.snackBar.open(message, '✕', {
      duration,
      panelClass: ['snack-error'],
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  info(message: string, duration = 3000): void {
    this.snackBar.open(message, '✕', {
      duration,
      panelClass: ['snack-info'],
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  warning(message: string, duration = 4000): void {
    this.snackBar.open(message, '✕', {
      duration,
      panelClass: ['snack-warning'],
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  confirm(title: string, message: string, confirmText = 'Confirm', cancelText = 'Cancel'): Observable<boolean> {
    const data: ConfirmDialogData = { title, message, confirmText, cancelText };
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data,
      width: '420px',
      maxWidth: '90vw',
      disableClose: false,
      panelClass: 'confirm-dialog-panel',
    });
    return ref.afterClosed().pipe(map(result => result === true));
  }
}
