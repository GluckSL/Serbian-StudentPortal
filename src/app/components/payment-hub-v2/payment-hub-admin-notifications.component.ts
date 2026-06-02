import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PaymentHubApiService, PaymentHubNotification } from './payment-hub-api.service';
import { PaymentNotificationNavService } from './payment-notification-nav.service';

@Component({
  selector: 'app-payment-hub-admin-notifications',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './payment-hub-admin-notifications.component.html',
  styleUrls: ['./payment-hub-admin-notifications.component.scss'],
})
export class PaymentHubAdminNotificationsComponent implements OnInit {
  @Output() unreadCountChange = new EventEmitter<number>();

  loading = true;
  syncing = false;
  items: PaymentHubNotification[] = [];
  unreadCount = 0;
  total = 0;
  totalPages = 1;
  page = 1;
  readonly pageSize = 10;
  filter: 'all' | 'unread' = 'all';
  category: 'language' | 'exercises' | 'classes' = 'language';
  batchLevel = '';
  studentStatus = '';
  readonly levelOptions = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly studentStatusOptions = ['', 'ONGOING', 'COMPLETED', 'WITHDREW', 'UNCERTAIN'];

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
    private readonly paymentNotifNav: PaymentNotificationNavService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api
      .getPaymentNotifications({
        page: this.page,
        limit: this.pageSize,
        unreadOnly: this.filter === 'unread',
        type: this.selectedType,
        batchLevel: this.batchLevel || undefined,
        studentStatus: this.studentStatus || undefined,
      })
      .subscribe({
        next: (res) => {
          this.items = res.data || [];
          this.total = res.total ?? 0;
          this.totalPages = res.totalPages ?? 1;
          this.unreadCount = res.unreadCount ?? 0;
          this.unreadCountChange.emit(this.unreadCount);
          this.paymentNotifNav.setUnreadCount(this.unreadCount);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snack.open('Could not load notifications', 'Dismiss', { duration: 4000 });
        },
      });
  }

  setFilter(mode: 'all' | 'unread'): void {
    this.filter = mode;
    this.page = 1;
    this.load();
  }

  setCategory(category: 'language' | 'exercises' | 'classes'): void {
    this.category = category;
    this.page = 1;
    this.load();
  }

  onFilterChange(): void {
    this.page = 1;
    this.load();
  }

  prevPage(): void {
    if (this.page > 1) {
      this.page--;
      this.load();
    }
  }

  nextPage(): void {
    if (this.page < this.totalPages) {
      this.page++;
      this.load();
    }
  }

  get showingFrom(): number {
    if (!this.total) return 0;
    return (this.page - 1) * this.pageSize + 1;
  }

  get showingTo(): number {
    return Math.min(this.page * this.pageSize, this.total);
  }

  runSync(): void {
    this.syncing = true;
    this.api.syncJourneyDueNotifications().subscribe({
      next: () => {
        this.syncing = false;
        this.snack.open('Notifications refreshed', 'OK', { duration: 3000 });
        this.load();
      },
      error: (e) => {
        this.syncing = false;
        this.snack.open(e?.error?.message || 'Sync failed', 'Dismiss', { duration: 4000 });
      },
    });
  }

  markRead(n: PaymentHubNotification): void {
    if (n.isRead) return;
    this.api.markPaymentNotificationRead(n._id).subscribe({
      next: () => {
        this.load();
      },
    });
  }

  markAllRead(): void {
    this.api.markAllPaymentNotificationsRead().subscribe({
      next: () => {
        this.page = 1;
        this.load();
      },
    });
  }

  studentLink(n: PaymentHubNotification): string[] {
    const id = n.metadata?.studentId || n.relatedEntityId;
    return id ? ['/admin/payment-hub/student', id] : ['/admin/payment-hub'];
  }

  dueLabel(n: PaymentHubNotification): string {
    const m = n.metadata;
    if (n.type === 'JOURNEY_EXERCISE_MISSED_TODAY') {
      const count = Number(m?.missedCount || m?.missedItems?.length || 0);
      return count > 0 ? `${count} missed` : '—';
    }
    if (n.type === 'JOURNEY_CLASS_ABSENT_TODAY') {
      const count = Number(m?.absentCount || m?.absentItems?.length || 0);
      return count > 0 ? `${count} absent` : '—';
    }
    if (m?.currency != null && m?.dueAmount != null) {
      return `${m.currency} ${Math.round(m.dueAmount).toLocaleString()}`;
    }
    return '—';
  }

  journeyDay(n: PaymentHubNotification): number | null {
    const d = n.metadata?.journeyDay;
    return d != null && Number.isFinite(Number(d)) ? Number(d) : null;
  }

  get selectedType(): string {
    if (this.category === 'exercises') return 'JOURNEY_EXERCISE_MISSED_TODAY';
    if (this.category === 'classes') return 'JOURNEY_CLASS_ABSENT_TODAY';
    return 'JOURNEY_LANGUAGE_FEE_DUE';
  }
}
