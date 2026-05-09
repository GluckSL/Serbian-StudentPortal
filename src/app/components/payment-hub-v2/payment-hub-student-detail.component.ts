import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { PaymentHubApiService, StudentHistory, PaymentRequestItem as PaymentRequest, ApprovalQueueItem } from './payment-hub-api.service';

@Component({
  selector: 'app-payment-hub-student-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatIconModule,
    MatChipsModule,
  ],
  templateUrl: './payment-hub-student-detail.component.html',
  styleUrls: ['./payment-hub-student-detail.component.scss'],
})
export class PaymentHubStudentDetailComponent implements OnInit {
  loading = true;
  studentId = '';
  history: StudentHistory | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.studentId = this.route.snapshot.params['studentId'];
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.getStudentHistory(this.studentId).subscribe({
      next: (res) => {
        this.history = res.data;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snack.open('Could not load student payment history', 'Dismiss', { duration: 4000 });
      },
    });
  }

  viewScreenshot(sub: ApprovalQueueItem): void {
    const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
    if (sub.screenshotViewUrl) {
      open(sub.screenshotViewUrl);
      return;
    }
    this.api.getSubmissionDetail(sub._id).subscribe({
      next: (res) => {
        const url = (res.data as unknown as Record<string, unknown>)?.['screenshotViewUrl'] as string | undefined;
        if (url) open(url);
        else {
          this.snack.open(
            'Proof file not found. It may have been deleted or the stored path no longer matches the file.',
            'Dismiss',
            { duration: 6000 },
          );
        }
      },
      error: () => this.snack.open('Could not load proof link', 'Dismiss', { duration: 4000 }),
    });
  }

  goBack(): void {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/admin/payment-hub';
    }
  }

  fmt(val: number | undefined | null): string {
    if (val === undefined || val === null) return '0';
    return val.toLocaleString('en-IN');
  }

  fmtDate(d: string | undefined | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  fmtDateTime(d: string | undefined | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      REQUESTED: 'pill-grey',
      SUBMITTED: 'pill-blue',
      UNDER_REVIEW: 'pill-amber',
      APPROVED: 'pill-green',
      REJECTED: 'pill-red',
      OVERDUE: 'pill-red',
      FULLY_PAID: 'pill-green',
    };
    return map[status] || 'pill-grey';
  }

  overallStatusClass(status: string): string {
    const map: Record<string, string> = {
      GOOD_STANDING: 'pill-green',
      FULLY_PAID: 'pill-green',
      PENDING: 'pill-amber',
      OVERDUE: 'pill-red',
      NO_REQUESTS: 'pill-grey',
    };
    return map[status] || 'pill-grey';
  }

  dateJoined(): string {
    const s = this.history?.student;
    const d = (s as Record<string, string | undefined>)?.['dateJoined'] || s?.createdAt;
    return d ? this.fmtDate(d) : '—';
  }

  getSubmissions(req: PaymentRequest): ApprovalQueueItem[] {
    return (req.submissions as ApprovalQueueItem[]) || [];
  }

  hasSubmissions(req: PaymentRequest): boolean {
    return (req.submissions?.length ?? 0) > 0;
  }

  /** Avoid arrow functions in templates (HTML parses `>` as tag end). */
  noSubmissionsYet(): boolean {
    if (!this.history?.requests?.length) return true;
    return !this.history.requests.some((r) => this.hasSubmissions(r));
  }
}
