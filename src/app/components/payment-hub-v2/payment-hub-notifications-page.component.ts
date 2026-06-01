import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PaymentHubAdminNotificationsComponent } from './payment-hub-admin-notifications.component';
import { PaymentNotificationNavService } from './payment-notification-nav.service';

@Component({
  selector: 'app-payment-hub-notifications-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    PaymentHubAdminNotificationsComponent,
  ],
  templateUrl: './payment-hub-notifications-page.component.html',
  styleUrls: ['./payment-hub-notifications-page.component.scss'],
})
export class PaymentHubNotificationsPageComponent implements OnInit {
  constructor(private readonly paymentNotifNav: PaymentNotificationNavService) {}

  ngOnInit(): void {
    this.paymentNotifNav.refresh();
  }

  onUnreadChange(count: number): void {
    this.paymentNotifNav.setUnreadCount(count);
  }
}
