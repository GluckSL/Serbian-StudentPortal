import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PaymentHubRequestPaymentsComponent } from './payment-hub-request-payments.component';

/** Standalone admin page: Send Request + Pending Approvals (same as former Req Payment tab). */
@Component({
  selector: 'app-payment-hub-request-shell',
  standalone: true,
  imports: [CommonModule, PaymentHubRequestPaymentsComponent],
  templateUrl: './payment-hub-request-shell.component.html',
  styleUrls: ['./payment-hub-request-shell.component.scss'],
})
export class PaymentHubRequestShellComponent {}
