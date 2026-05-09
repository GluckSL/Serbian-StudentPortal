import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  PaymentHubApiService,
  CefrRow,
  ReferenceRow,
  InstallmentSchedule,
  ScheduleStep,
} from './payment-hub-api.service';

@Component({
  selector: 'app-payment-hub-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  templateUrl: './payment-hub-settings.component.html',
  styleUrls: ['./payment-hub-settings.component.scss'],
})
export class PaymentHubSettingsComponent implements OnInit {
  loading = true;
  saving = false;

  cefrRows: CefrRow[] = [];
  referenceRows: ReferenceRow[] = [];
  schedule: InstallmentSchedule = { title: '', notes: '', steps: [] };

  lastUpdated: string | null = null;

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.api.getCatalogSettings().subscribe({
      next: (res) => {
        const d = res.data;
        this.cefrRows = (d.cefrRows || []).map(r => ({ ...r })).sort((a, b) => a.order - b.order);
        this.referenceRows = (d.referenceRows || []).map(r => ({ ...r }));
        this.schedule = {
          title: d.defaultInstallmentSchedule?.title ?? '',
          notes: d.defaultInstallmentSchedule?.notes ?? '',
          steps: (d.defaultInstallmentSchedule?.steps || []).map(s => ({ ...s })),
        };
        this.lastUpdated = d.updatedAt ?? null;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snack.open('Could not load settings', 'Dismiss', { duration: 4000 });
      },
    });
  }

  addReferenceRow(): void {
    this.referenceRows.push({ label: '', lkr: 0, inr: 0 });
  }

  removeReferenceRow(i: number): void {
    this.referenceRows.splice(i, 1);
  }

  addStep(): void {
    (this.schedule.steps ??= []).push({ label: '', daysFromEnrollment: null, amountLkr: null, amountInr: null });
  }

  removeStep(i: number): void {
    this.schedule.steps?.splice(i, 1);
  }

  save(): void {
    this.saving = true;
    this.api.updateCatalogSettings({
      cefrRows: this.cefrRows,
      referenceRows: this.referenceRows.filter(r => r.label.trim()),
      defaultInstallmentSchedule: this.schedule,
    }).subscribe({
      next: (res) => {
        this.saving = false;
        this.lastUpdated = res.data.updatedAt ?? null;
        this.snack.open('Settings saved successfully.', 'OK', { duration: 4000 });
      },
      error: (e) => {
        this.saving = false;
        this.snack.open(e?.error?.message || 'Save failed. Please try again.', 'Dismiss', { duration: 5000 });
      },
    });
  }

  fmtDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  trackStep(_i: number, s: ScheduleStep): unknown { return _i; }
}
