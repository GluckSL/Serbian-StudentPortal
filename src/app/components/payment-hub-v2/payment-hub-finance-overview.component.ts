import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { environment } from '../../../environments/environment';
import {
  FinanceCohort,
  formatStudentStatusLabel,
  PortalStudentCounts,
} from './payment-hub-finance-cohort.util';

@Component({
  selector: 'app-payment-hub-finance-overview',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './payment-hub-finance-overview.component.html',
  styleUrls: ['./payment-hub-finance-overview.component.scss', './payment-hub-insights-page.scss'],
})
export class PaymentHubFinanceOverviewComponent implements OnInit {
  loading = true;
  counts: PortalStudentCounts = {
    portalNonTest: 0,
    ongoingNonTest: 0,
    platinumTotal: 0,
    platinumOngoing: 0,
    platinumStatusBreakdown: [],
    silverTotal: 0,
    silverOngoing: 0,
    silverStatusBreakdown: [],
    visaDocsTotal: 0,
    visaDocsOngoing: 0,
    visaDocsStatusBreakdown: [],
  };

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.loadCounts();
  }

  formatStudentStatus = formatStudentStatusLabel;

  batchesRoute(_cohort: FinanceCohort): string {
    return '/admin/finance-dashboard/batches';
  }

  batchesQuery(cohort: FinanceCohort): { cohort: string; status: string } {
    return { cohort, status: 'ONGOING' };
  }

  private loadCounts(): void {
    this.loading = true;
    this.http
      .get<{ success: boolean; studentCounts?: PortalStudentCounts }>(
        `${environment.apiUrl}/admin/students/filter-options`,
        { withCredentials: true },
      )
      .subscribe({
        next: (res) => {
          if (res.success && res.studentCounts) {
            this.counts = {
              ...this.counts,
              ...res.studentCounts,
              platinumStatusBreakdown: res.studentCounts.platinumStatusBreakdown ?? [],
              silverStatusBreakdown: res.studentCounts.silverStatusBreakdown ?? [],
              visaDocsStatusBreakdown: res.studentCounts.visaDocsStatusBreakdown ?? [],
            };
          }
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }
}
