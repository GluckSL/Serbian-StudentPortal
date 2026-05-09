import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PaymentHubAllPaymentsComponent } from './payment-hub-all-payments.component';

@Component({
  selector: 'app-payment-hub-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    PaymentHubAllPaymentsComponent,
  ],
  templateUrl: './payment-hub-shell.component.html',
  styleUrls: ['./payment-hub-shell.component.scss'],
})
export class PaymentHubShellComponent {}
