// src/app/components/login/login.component.ts

import {
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnInit,
  ViewChild
} from '@angular/core';
import { AuthService, getAuthToken, SKIP_SESSION_RESTORE_KEY } from '../../services/auth.service';
import { catchError, finalize, of, timeout } from 'rxjs';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { isSafeReturnUrl } from '../../services/join-class-flow.service';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';


@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, HttpClientModule, CommonModule, RouterModule, TranslatePipe],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  regNo: string = '';
  password: string = '';
  errorMessage: string = '';
  loading: boolean = false;
  showPassword: boolean = false;
  keepSessionActive = true;
  readonly currentYear = new Date().getFullYear();
  showSessionExpiredNotice = false;
  /** True while checking for an existing token session */
  checkingExistingSession = false;
  /** Safe internal path to navigate to after successful login (from ?returnUrl query param). */
  pendingReturnUrl = '';
  // Uncertain / Withdrawal confirmation modal
  showWithdrawalModal = false;
  withdrawalStudentInfo: { studentId: string; studentName: string; batch: string; studentStatus: string; email: string; regNo: string } | null = null;
  loginAttemptTime = '';
  confirmingDecision: 'YES' | 'NO' | null = null;
  withdrawalDecisionError = '';
  withdrawalAckMessage = '';

  // First-login password setup modal
  showPasswordSetupModal = false;
  setupToken = '';
  setupStudentInfo: {
    studentId: string;
    studentName: string;
    email: string;
    regNo: string;
    studentStatus?: string;
  } | null = null;
  setupEmail = '';
  setupNewEmail = '';
  setupOtp = '';
  setupNewPassword = '';
  setupConfirmPassword = '';
  setupShowNew = false;
  setupShowConfirm = false;
  setupError = '';
  setupSuccess = '';
  setupLoading = false;
  setupVerificationCode = '';
  /** 'start' | 'otp-verify' | 'password-set' | 'change-email' | 'change-email-sent' */
  setupStep: 'start' | 'otp-verify' | 'password-set' | 'change-email' | 'change-email-sent' = 'start';
  setupChangeNewEmail = '';
  setupChangeNewPassword = '';
  setupChangeConfirmPassword = '';
  setupShowChangeNewPwd = false;
  setupShowChangeConfirmPwd = false;

  /** Pupil offset in px (translate) for each eye */
  leftPupil = { x: 0, y: 0 };
  rightPupil = { x: 0, y: 0 };

  @ViewChild('eyeLeft', { read: ElementRef }) eyeLeft?: ElementRef<HTMLElement>;
  @ViewChild('eyeRight', { read: ElementRef }) eyeRight?: ElementRef<HTMLElement>;

  private moveRaf = 0;
  private lastMove: MouseEvent | null = null;

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    const session = this.route.snapshot.queryParamMap.get('session');
    // Read returnUrl before clearing query params so it can be used after login.
    const rawReturnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '';
    if (rawReturnUrl && isSafeReturnUrl(rawReturnUrl)) {
      this.pendingReturnUrl = rawReturnUrl;
    }

    if (session === 'expired') {
      this.showSessionExpiredNotice = true;
      // Strip query params from the URL bar but keep pendingReturnUrl in memory.
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
      return;
    }

    // User just logged out (or chose a fresh login): show the form; do not auto-restore.
    try {
      if (sessionStorage.getItem(SKIP_SESSION_RESTORE_KEY) === '1') {
        sessionStorage.removeItem(SKIP_SESSION_RESTORE_KEY);
        this.authService.clearClientSession();
        this.checkingExistingSession = false;
        return;
      }
    } catch {
      /* ignore */
    }

    // No stored token — show the login form immediately (do not wait on the API).
    if (!getAuthToken()) {
      this.checkingExistingSession = false;
      return;
    }

    this.checkingExistingSession = true;
    this.authService.refreshUserProfile().pipe(
      timeout(8000),
      catchError(() => {
        this.authService.clearClientSession();
        return of(null);
      }),
      finalize(() => {
        this.checkingExistingSession = false;
      })
    ).subscribe({
      next: (user) => {
        if (!user) return;
        const resolved = this.authService.resolveUserForNavigation(user);
        const path = this.authService.getPostLoginPath(resolved);
        if (path) {
          void this.router.navigateByUrl(path);
        }
      },
    });
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent): void {
    this.lastMove = event;
    if (this.moveRaf) {
      return;
    }
    this.moveRaf = requestAnimationFrame(() => {
      this.moveRaf = 0;
      const e = this.lastMove;
      if (!e) {
        return;
      }
      this.ngZone.run(() => {
        this.updatePupil(this.eyeLeft, e, (o) => (this.leftPupil = o));
        this.updatePupil(this.eyeRight, e, (o) => (this.rightPupil = o));
      });
    });
  }

  private updatePupil(
    eyeRef: ElementRef<HTMLElement> | undefined,
    e: MouseEvent,
    set: (o: { x: number; y: number }) => void
  ): void {
    const el = eyeRef?.nativeElement;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const maxMove = 9;
    const sensitivity = 0.12;
    if (dist < 0.5) {
      set({ x: 0, y: 0 });
      return;
    }
    const move = Math.min(maxMove, dist * sensitivity);
    dx = (dx / dist) * move;
    dy = (dy / dist) * move;
    set({ x: dx, y: dy });
  }

  pupilTransform(p: { x: number; y: number }): string {
    return `translate(${p.x}px, ${p.y}px)`;
  }

  dismissSessionExpiredNotice(): void {
    this.showSessionExpiredNotice = false;
  }

  onCredentialFocus(): void {
    this.showSessionExpiredNotice = false;
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit(): void {
    this.errorMessage = '';
    this.withdrawalAckMessage = '';
    this.showSessionExpiredNotice = false;
    this.loading = true;

    const user = {
      identifier: this.regNo, // supports both regNo and email via backend
      password: this.password,
      keepSessionActive: this.keepSessionActive
    };

    this.authService.login(user).subscribe({
      next: (response) => {
        // ⚠️ Uncertain / Withdrawal batch — show confirmation modal
        if (response?.requiresConfirmation) {
          this.loading = false;
          this.withdrawalStudentInfo = response.studentInfo;
          this.loginAttemptTime = response.loginAttemptTime;
          this.showWithdrawalModal = true;
          return;
        }

        if (response?.requiresPasswordSetup) {
          this.loading = false;
          this.setupToken = response.setupToken;
          this.setupStudentInfo = response.studentInfo;
          this.setupEmail = response.studentInfo?.email || '';
          this.setupOtp = '';
          this.setupNewPassword = '';
          this.setupConfirmPassword = '';
          this.setupChangeNewEmail = '';
          this.setupChangeNewPassword = '';
          this.setupChangeConfirmPassword = '';
          this.setupError = '';
          this.setupSuccess = '';
          this.setupStep = 'start';
          this.showPasswordSetupModal = true;
          return;
        }

        this.navigateAfterLogin(response.user);
      },
      error: (err) => {
        this.loading = false;

        const serverMsg: string = err.error?.msg || err.error?.message || '';
        if (err.status === 403) {
          this.errorMessage = serverMsg || 'Access denied. Please contact Glück Global support.';
        } else if (err.status === 401 || err.status === 400) {
          this.errorMessage = serverMsg || 'Invalid username or password!';
        } else {
          this.errorMessage = serverMsg || 'Server error. Please try again later.';
        }
      }
    });
  }

  navigateAfterLogin(userFromResponse?: { role?: string; subscription?: string }): void {
    const redirect = (profile?: { role?: string; subscription?: string } | null) => {
      this.loading = false;
      this.setupLoading = false;
      const resolved = this.authService.resolveUserForNavigation(profile, userFromResponse);

      if (this.pendingReturnUrl) {
        void this.router.navigateByUrl(this.pendingReturnUrl);
        return;
      }

      const path = this.authService.getPostLoginPath(resolved);
      if (path) {
        void this.router.navigateByUrl(path);
      } else {
        this.errorMessage = 'Unknown user role.';
      }
    };

    // Login already returned role — redirect immediately; refresh profile in background.
    if (userFromResponse?.role || this.authService.getRoleFromToken()) {
      redirect(userFromResponse);
      this.authService.refreshUserProfile().subscribe({ error: () => {} });
      return;
    }

    this.authService.refreshUserProfile().subscribe({
      next: (profile) => redirect(profile),
      error: () => {
        this.loading = false;
        this.setupLoading = false;
        this.errorMessage = 'Failed to load user profile.';
      },
    });
  }

  startEmailChange(): void {
    this.setupError = '';
    this.setupSuccess = '';
    this.setupChangeNewEmail = '';
    this.setupChangeNewPassword = '';
    this.setupChangeConfirmPassword = '';
    this.setupStep = 'change-email';
  }

  cancelEmailChange(): void {
    this.setupError = '';
    this.setupSuccess = '';
    this.setupStep = 'start';
  }

  /** Flow A: submit email change request to admin */
  submitEmailChangeRequest(): void {
    this.setupError = '';
    const newEmail = this.setupChangeNewEmail.trim().toLowerCase();
    if (!newEmail || !newEmail.includes('@')) {
      this.setupError = 'Enter a valid new email address.';
      return;
    }
    if (this.setupChangeNewPassword.length < 8) {
      this.setupError = 'Password must be at least 8 characters.';
      return;
    }
    if (this.setupChangeNewPassword !== this.setupChangeConfirmPassword) {
      this.setupError = 'Passwords do not match.';
      return;
    }
    this.setupLoading = true;
    this.authService.requestSetupEmailChange({
      setupToken: this.setupToken,
      newEmail,
      newPassword: this.setupChangeNewPassword,
      confirmPassword: this.setupChangeConfirmPassword,
    }).subscribe({
      next: () => {
        this.setupLoading = false;
        this.setupStep = 'change-email-sent';
      },
      error: (err: any) => {
        this.setupLoading = false;
        this.setupError = err?.error?.msg || 'Could not submit request. Please try again.';
      },
    });
  }

  /** Flow B step 1: send OTP to current email */
  sendSetupOtp(): void {
    this.setupError = '';
    this.setupLoading = true;
    this.authService.sendSetupOtp(this.setupToken).subscribe({
      next: (res: any) => {
        this.setupLoading = false;
        this.setupStep = 'otp-verify';
        this.setupSuccess = res.msg || `A verification code was sent to ${this.setupEmail}.`;
      },
      error: (err: any) => {
        this.setupLoading = false;
        this.setupError = err?.error?.msg || 'Could not send verification code. Please try again.';
      },
    });
  }

  /** Flow B step 2a: verify OTP only → get verificationCode */
  verifyOtp(): void {
    this.setupError = '';
    if (!this.setupOtp.trim()) {
      this.setupError = 'Enter the verification code sent to your email.';
      return;
    }
    this.setupLoading = true;
    this.authService.verifySetupOtp({
      setupToken: this.setupToken,
      otp: this.setupOtp.trim(),
    }).subscribe({
      next: (res: any) => {
        this.setupLoading = false;
        this.setupVerificationCode = res.verificationCode;
        this.setupOtp = '';
        this.setupNewPassword = '';
        this.setupConfirmPassword = '';
        this.setupError = '';
        this.setupStep = 'password-set';
      },
      error: (err: any) => {
        this.setupLoading = false;
        this.setupError = err?.error?.msg || 'Could not verify code. Please try again.';
      },
    });
  }

  /** Flow B step 2b: set password after OTP verification → log in */
  setPassword(): void {
    this.setupError = '';
    this.setupSuccess = '';
    if (this.setupNewPassword.length < 8) {
      this.setupError = 'Password must be at least 8 characters.';
      return;
    }
    if (this.setupNewPassword !== this.setupConfirmPassword) {
      this.setupError = 'Passwords do not match.';
      return;
    }
    this.setupLoading = true;
    this.authService.setSetupPassword({
      setupToken: this.setupToken,
      verificationCode: this.setupVerificationCode,
      newPassword: this.setupNewPassword,
      confirmPassword: this.setupConfirmPassword,
      keepSessionActive: this.keepSessionActive,
    }).subscribe({
      next: () => {
        this.showPasswordSetupModal = false;
        this.setupToken = '';
        this.setupStudentInfo = null;
        this.navigateAfterLogin();
      },
      error: (err: any) => {
        this.setupLoading = false;
        this.setupError = err?.error?.msg || 'Could not set password. Please try again.';
      },
    });
  }

  confirmWithdrawal(decision: 'YES' | 'NO'): void {
    if (!this.withdrawalStudentInfo || this.confirmingDecision) return;

    this.confirmingDecision = decision;
    this.withdrawalDecisionError = '';

    this.authService.confirmWithdrawalStatus({
      studentId: this.withdrawalStudentInfo.studentId,
      decision,
      loginAttemptTime: this.loginAttemptTime,
      keepSessionActive: this.keepSessionActive
    }).subscribe({
      next: (response) => {
        this.confirmingDecision = null;
        this.showWithdrawalModal = false;
        this.authService.clearClientSession();
        this.errorMessage = '';
        this.regNo = '';
        this.password = '';

        this.withdrawalAckMessage =
          response?.message ||
          (decision === 'YES'
            ? 'Our team will reach you within 24-72 hours. You cannot log in until your account status is updated by the Gluck Global team.'
            : 'Thank you. Your response has been recorded and our team has been notified.');
      },
      error: () => {
        this.confirmingDecision = null;
        this.withdrawalDecisionError = 'Something went wrong. Please try again.';
      }
    });
  }
}
