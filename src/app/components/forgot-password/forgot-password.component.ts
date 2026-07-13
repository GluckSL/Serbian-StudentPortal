import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../services/auth.service';

type Step = 'request' | 'reset' | 'success';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.css'],
})
export class ForgotPasswordComponent {
  step: Step = 'request';

  // Step 1
  email = '';
  requestLoading = false;
  requestError = '';

  // Step 2
  otp = '';
  newPassword = '';
  confirmPassword = '';
  showNew = false;
  showConfirm = false;
  resetLoading = false;
  resetError = '';

  readonly currentYear = new Date().getFullYear();

  constructor(private authService: AuthService) {}

  submitRequest(): void {
    this.requestError = '';
    const email = this.email.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      this.requestError = 'Please enter a valid email address.';
      return;
    }
    this.requestLoading = true;
    this.authService.requestPasswordReset(email).subscribe({
      next: () => {
        this.requestLoading = false;
        this.step = 'reset';
      },
      error: (err: any) => {
        this.requestLoading = false;
        this.requestError = err?.error?.msg || 'Something went wrong. Please try again.';
      },
    });
  }

  submitReset(): void {
    this.resetError = '';
    if (!this.otp.trim()) {
      this.resetError = 'Please enter the code sent to your email.';
      return;
    }
    if (this.newPassword.length < 8) {
      this.resetError = 'Password must be at least 8 characters.';
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.resetError = 'Passwords do not match.';
      return;
    }
    this.resetLoading = true;
    this.authService.resetPassword({
      email: this.email.trim().toLowerCase(),
      otp: this.otp.trim(),
      newPassword: this.newPassword,
      confirmPassword: this.confirmPassword,
    }).subscribe({
      next: () => {
        this.resetLoading = false;
        this.step = 'success';
      },
      error: (err: any) => {
        this.resetLoading = false;
        this.resetError = err?.error?.msg || 'Something went wrong. Please try again.';
      },
    });
  }

  resendOtp(): void {
    this.step = 'request';
    this.otp = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.resetError = '';
  }
}
