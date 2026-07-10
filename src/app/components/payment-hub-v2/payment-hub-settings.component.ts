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
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  PaymentHubApiService,
  CefrRow,
  ReferenceRow,
  SubscriptionRate,
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
  subscriptionRates: SubscriptionRate[] = [];

  readonly knownPlans: ReadonlyArray<{ subscription: string; label: string }> = [
    { subscription: 'PLATINUM', label: 'Platinum' },
    { subscription: 'SILVER', label: 'Silver' },
    { subscription: 'VISA_DOC', label: 'Visa & Docs' },
  ];

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
        // Merge known plans with any saved subscription rates
        const saved = d.subscriptionRates || [];
        this.subscriptionRates = this.knownPlans.map(plan => {
          const existing = saved.find(r => r.subscription === plan.subscription);
          return existing ? { ...existing } : { subscription: plan.subscription, lkr: 0, inr: 0 };
        });
        this.lastUpdated = d.updatedAt ?? null;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snack.open('Nije moguće učitati podešavanja', 'Zatvori', { duration: 4000 });
      },
    });
  }

  addReferenceRow(): void {
    this.referenceRows.push({ label: '', lkr: 0, inr: 0 });
  }

  removeReferenceRow(i: number): void {
    this.referenceRows.splice(i, 1);
  }

  planLabel(subscription: string): string {
    return this.knownPlans.find(p => p.subscription === subscription)?.label ?? subscription;
  }

  save(): void {
    this.saving = true;
    this.api.updateCatalogSettings({
      cefrRows: this.cefrRows,
      referenceRows: this.referenceRows.filter(r => r.label.trim()),
      subscriptionRates: this.subscriptionRates.filter(r => r.lkr > 0 || r.inr > 0),
      defaultInstallmentSchedule: { title: '', notes: '', steps: [] },
    }).subscribe({
      next: (res) => {
        this.saving = false;
        this.lastUpdated = res.data.updatedAt ?? null;
        this.snack.open('Podešavanja uspešno sačuvana.', 'OK', { duration: 4000 });
      },
      error: (e) => {
        this.saving = false;
        this.snack.open(e?.error?.message || 'Čuvanje nije uspelo. Pokušajte ponovo.', 'Zatvori', { duration: 5000 });
      },
    });
  }

  fmtDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('sr-Latn-RS', { dateStyle: 'medium', timeStyle: 'short' });
  }

}
