// src/app/components/public-signup/public-signup-wizard.component.ts

import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { PublicSignupService } from '../../services/public-signup.service';
import {
  BANK_DETAILS_INR,
  BANK_DETAILS_LKR,
  detectCurrencyFromPhone,
  formatMoney,
} from '../../utils/bank-details.util';

interface CatalogRow {
  code: string;
  inr: number;
  lkr: number;
}

@Component({
  selector: 'app-public-signup-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './public-signup-wizard.component.html',
  styleUrls: ['./public-signup-wizard.component.css'],
})
export class PublicSignupWizardComponent implements OnInit, OnDestroy {
  @Output() backToLogin = new EventEmitter<void>();

  currentStep = 1;
  applicationToken: string | null = null;

  name = '';
  email = '';
  emailConfirm = '';
  phoneNumber = '';
  whatsappNumber = '';
  address = '';
  selectedLearnLanguage = '';
  languageLevelOpted = '';
  selectedSubscription = '';
  leadSource = '';

  otpSubStep: 'info' | 'otp' | 'done' = 'info';
  /** Set after OTP verification — editing details won't require a new code unless email changes */
  emailVerified = false;
  otp = '';
  otpResendCooldown = 0;
  resendOtpLoading = false;
  private resendCooldownTimer: ReturnType<typeof setInterval> | null = null;
  password = '';
  confirmPassword = '';
  showPwd = false;
  showConfirmPwd = false;

  cefrRows: CatalogRow[] = [];
  computedAmount = 0;
  paymentFinalized = false;
  catalogLoading = false;

  paymentSubStep: 'choose-method' | 'ready' | 'proof-done' | 'payment-done' = 'choose-method';
  paymentMethodChoice: 'manual' | 'razorpay' | null = null;
  proofFile: File | null = null;
  proofFileName = '';
  proofPaidAmount: number | null = null;
  proofPaymentDateTime = '';
  proofAccountHolderName = '';

  loading = false;
  error = '';
  success = '';
  resendCooldown = 0;

  readonly SUBSCRIPTIONS = [
    { value: 'SILVER', label: 'Silver' },
    { value: 'PLATINUM', label: 'Platinum' },
  ];

  readonly LEARN_FROM_LANGUAGE_OPTIONS = ['English', 'Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Other'];
  readonly GERMAN_LEVEL_OPTIONS = ['A1', 'A2', 'B1', 'B2'];
  readonly bankDetailsInr = BANK_DETAILS_INR;
  readonly bankDetailsLkr = BANK_DETAILS_LKR;

  constructor(
    private svc: PublicSignupService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    const urlToken = this.route.snapshot.queryParamMap.get('token');
    const storedToken = this.svc.getToken();
    const token = urlToken || storedToken;
    if (token) {
      this.applicationToken = token;
      this.svc.saveToken(token);
      this.svc.resumeApplication(token).subscribe({
        next: (res: any) => {
          const d = res?.data;
          if (!d) return;
          this.name = d.name || '';
          this.email = d.email || '';
          this.emailConfirm = d.email || '';
          this.phoneNumber = d.phoneNumber || '';
          this.whatsappNumber = d.whatsappNumber || '';
          this.address = d.address || '';
          this.selectedLearnLanguage = d.medium?.[0] || '';
          this.languageLevelOpted = d.languageLevelOpted || d.level || '';
          this.selectedSubscription = d.subscription || '';
          this.leadSource = d.leadSource || '';
          if (d.emailVerifiedAt) {
            this.emailVerified = true;
            this.otpSubStep = 'info';
          }
          this.selectedSubscription = d.subscription || this.selectedSubscription;
          if (d.status === 'documents_done' || d.status === 'payment_pending') {
            this.currentStep = 2;
            this.computedAmount = d.amount || 0;
            this.paymentFinalized = !!d.amount;
            this.paymentMethodChoice = 'manual';
            this.paymentSubStep = 'ready';
            this.loadCatalog();
          } else if (d.emailVerifiedAt) {
            this.enterPaymentStep();
          }
        },
        error: () => { /* start fresh */ },
      });
    }
    this.loadCatalog();
  }

  ngOnDestroy(): void {
    this.clearResendCooldownTimer();
  }

  loadCatalog(): void {
    this.catalogLoading = true;
    this.svc.getCatalog().subscribe({
      next: (res: any) => {
        this.cefrRows = res?.cefr || [];
        this.catalogLoading = false;
      },
      error: () => {
        this.catalogLoading = false;
      },
    });
  }

  get selectedCurrency(): 'INR' | 'LKR' {
    return detectCurrencyFromPhone(this.phoneNumber, this.whatsappNumber);
  }

  /** Razorpay checkout is INR-only on this portal. */
  get canPayWithRazorpay(): boolean {
    return this.selectedCurrency === 'INR';
  }

  get previewAmount(): number {
    if (!this.languageLevelOpted) return 0;
    const row = this.cefrRows.find((r) => r.code === this.languageLevelOpted);
    if (!row) return 0;
    return this.selectedCurrency === 'LKR' ? row.lkr : row.inr;
  }

  get formattedPreviewAmount(): string {
    const a = this.previewAmount;
    if (!a) return '';
    return formatMoney(a, this.selectedCurrency);
  }

  get formattedAmount(): string {
    const a = this.computedAmount || this.previewAmount;
    if (!a) return '—';
    return formatMoney(a, this.selectedCurrency);
  }

  get planLabel(): string {
    return this.SUBSCRIPTIONS.find((s) => s.value === this.selectedSubscription)?.label || this.selectedSubscription || '—';
  }

  get isLkrPayment(): boolean {
    return this.selectedCurrency === 'LKR';
  }

  get activeBankTitle(): string {
    return this.isLkrPayment ? 'Sri Lanka' : 'India';
  }

  get activeBankDetails() {
    return this.isLkrPayment ? this.bankDetailsLkr : this.bankDetailsInr;
  }

  get activeBankTransferHint(): string {
    return this.isLkrPayment
      ? 'Transfer the total in LKR to the account below, then upload your payment screenshot.'
      : 'Transfer the total in INR to the account below (NEFT/IMPS/UPI), then upload your payment screenshot.';
  }

  selectLearnLanguage(lang: string): void {
    this.selectedLearnLanguage = lang;
  }

  backFromPersonalInfo(): void {
    if (this.emailVerified) {
      this.error = '';
      this.enterPaymentStep(false);
    } else {
      this.backToLogin.emit();
    }
  }

  private validatePersonalInfo(): boolean {
    if (!this.name.trim()) {
      this.error = 'Full name is required.';
      return false;
    }
    const normalizedEmail = this.email.trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      this.error = 'Enter a valid email address.';
      return false;
    }
    const normalizedConfirm = this.emailConfirm.trim().toLowerCase();
    if (!normalizedConfirm.includes('@')) {
      this.error = 'Confirm your email address.';
      return false;
    }
    if (normalizedEmail !== normalizedConfirm) {
      this.error = 'Email addresses do not match. Check for typos before sending the code.';
      return false;
    }
    this.email = normalizedEmail;
    this.emailConfirm = normalizedConfirm;
    if (!this.selectedLearnLanguage) {
      this.error = 'Please select the language you want to learn German from.';
      return false;
    }
    if (!this.languageLevelOpted) {
      this.error = 'Please select your German level.';
      return false;
    }
    if (!this.selectedSubscription) {
      this.error = 'Please select a plan.';
      return false;
    }
    return true;
  }

  private buildStartPayload() {
    return {
      applicationToken: this.applicationToken || undefined,
      name: this.name.trim(),
      email: this.email.trim().toLowerCase(),
      phoneNumber: this.phoneNumber,
      whatsappNumber: this.whatsappNumber,
      address: this.address,
      medium: [this.selectedLearnLanguage],
      languageLevelOpted: this.languageLevelOpted,
      subscription: this.selectedSubscription,
      leadSource: this.leadSource,
    };
  }

  submitPersonalInfo(): void {
    if (this.emailVerified) {
      this.saveDetails();
    } else {
      this.sendOtp();
    }
  }

  saveDetails(): void {
    this.error = '';
    if (!this.validatePersonalInfo()) return;

    this.loading = true;
    this.svc.start(this.buildStartPayload()).subscribe({
      next: (res: any) => {
        this.loading = false;
        this.applicationToken = res.applicationToken;
        this.svc.saveToken(res.applicationToken);
        if (res.alreadyVerified) {
          this.emailVerified = true;
          this.enterPaymentStep();
        } else {
          this.emailVerified = false;
          this.otpSubStep = 'otp';
          this.success = res.msg || `Verification code sent to ${this.email}.`;
          this.startResendCooldown(45);
          // #region agent log
          const em = (this.email || '').trim().toLowerCase();
          const at = em.indexOf('@');
          fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Debug-Session-Id': '24071c'
            },
            body: JSON.stringify({
              sessionId: '24071c',
              location: 'public-signup-wizard:saveDetails',
              message: 'client OTP step shown',
              data: {
                domain: at > 0 ? em.slice(at + 1) : '',
                localLen: at > 0 ? em.slice(0, at).length : 0,
                alreadyVerified: !!res.alreadyVerified
              },
              timestamp: Date.now(),
              hypothesisId: 'A,E',
              runId: 'pre-fix'
            })
          }).catch(() => {});
          // #endregion
        }
      },
      error: (err: any) => {
        this.loading = false;
        this.error = err?.error?.msg || 'Could not save your details. Please try again.';
      },
    });
  }

  sendOtp(): void {
    this.error = '';
    if (!this.validatePersonalInfo()) return;

    this.loading = true;
    this.svc.start(this.buildStartPayload()).subscribe({
      next: (res: any) => {
        this.loading = false;
        this.applicationToken = res.applicationToken;
        this.svc.saveToken(res.applicationToken);
        if (res.alreadyVerified) {
          this.emailVerified = true;
          this.enterPaymentStep();
        } else {
          this.otpSubStep = 'otp';
          this.success = res.msg || `Verification code sent to ${this.email}.`;
          this.startResendCooldown(45);
          // #region agent log
          const em = (this.email || '').trim().toLowerCase();
          const at = em.indexOf('@');
          fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Debug-Session-Id': '24071c'
            },
            body: JSON.stringify({
              sessionId: '24071c',
              location: 'public-signup-wizard:sendOtp',
              message: 'client OTP step shown',
              data: {
                domain: at > 0 ? em.slice(at + 1) : '',
                localLen: at > 0 ? em.slice(0, at).length : 0,
                alreadyVerified: !!res.alreadyVerified
              },
              timestamp: Date.now(),
              hypothesisId: 'A,E',
              runId: 'pre-fix'
            })
          }).catch(() => {});
          // #endregion
        }
      },
      error: (err: any) => {
        this.loading = false;
        this.error = err?.error?.msg || 'Could not send verification code. Please try again.';
      },
    });
  }

  resendOtp(): void {
    if (!this.applicationToken || this.otpResendCooldown > 0 || this.resendOtpLoading || this.loading) {
      return;
    }
    this.error = '';
    this.resendOtpLoading = true;
    this.svc.resendOtp(this.applicationToken).subscribe({
      next: (res: any) => {
        this.resendOtpLoading = false;
        this.otp = '';
        this.success = res.msg || `A new code was sent to ${this.email}.`;
        this.startResendCooldown(45);
      },
      error: (err: any) => {
        this.resendOtpLoading = false;
        this.error = err?.error?.msg || 'Could not resend code. Please try again.';
      },
    });
  }

  private startResendCooldown(seconds: number = 30): void {
    this.clearResendCooldownTimer();
    this.resendCooldown = seconds;
    this.otpResendCooldown = seconds;
    this.resendCooldownTimer = setInterval(() => {
      this.resendCooldown--;
      this.otpResendCooldown--;
      if (this.resendCooldown <= 0 || this.otpResendCooldown <= 0) {
        this.clearResendCooldownTimer();
      }
    }, 1000);
  }

  private clearResendCooldownTimer(): void {
    if (this.resendCooldownTimer) {
      clearInterval(this.resendCooldownTimer);
      this.resendCooldownTimer = null;
    }
    this.otpResendCooldown = 0;
    this.resendCooldown = 0;
  }

  verifyOtp(): void {
    this.error = '';
    if (!this.otp.trim()) {
      this.error = 'Enter the verification code.';
      return;
    }
    if (this.password.length < 8) {
      this.error = 'Password must be at least 8 characters.';
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match.';
      return;
    }

    this.loading = true;
    this.svc
      .verifyEmail({
        applicationToken: this.applicationToken!,
        otp: this.otp.trim(),
        password: this.password,
        confirmPassword: this.confirmPassword,
      })
      .subscribe({
        next: () => {
          this.loading = false;
          this.emailVerified = true;
          this.success = '';
          this.error = '';
          this.enterPaymentStep();
        },
        error: (err: any) => {
          this.loading = false;
          this.error = err?.error?.msg || 'Verification failed. Please try again.';
        },
      });
  }

  /** After email verification — go straight to payment method cards. */
  enterPaymentStep(prepare = true): void {
    if (!this.emailVerified) {
      this.error = 'Please verify your email first.';
      return;
    }
    if (!this.languageLevelOpted || !this.selectedSubscription) {
      this.error = 'Please complete German level and plan first.';
      this.currentStep = 1;
      this.otpSubStep = 'info';
      return;
    }
    this.error = '';
    this.success = '';
    this.currentStep = 2;
    this.paymentSubStep = 'choose-method';
    this.paymentMethodChoice = null;
    if (prepare) {
      this.preparePaymentStep();
    }
  }

  backFromPayment(): void {
    this.error = '';
    if (this.paymentSubStep === 'ready' && this.paymentMethodChoice) {
      this.paymentMethodChoice = null;
      this.paymentSubStep = 'choose-method';
      return;
    }
    this.currentStep = 1;
    this.otpSubStep = 'info';
    this.paymentMethodChoice = null;
    this.paymentSubStep = 'choose-method';
  }

  selectPaymentMethod(method: 'manual' | 'razorpay'): void {
    if (method === 'razorpay' && !this.canPayWithRazorpay) {
      return;
    }
    this.paymentMethodChoice = method;
    this.paymentSubStep = 'ready';
    this.error = '';
    this.success = '';
  }

  private preparePaymentStep(): void {
    if (this.paymentFinalized && this.computedAmount > 0) {
      if (!this.paymentMethodChoice) {
        this.paymentSubStep = 'choose-method';
      }
      return;
    }
    this.loading = true;
    this.svc
      .finalize({
        applicationToken: this.applicationToken!,
        level: this.languageLevelOpted,
        subscription: this.selectedSubscription,
        currency: this.selectedCurrency,
      })
      .subscribe({
        next: (res: any) => {
          this.loading = false;
          this.computedAmount = res.amount;
          this.paymentFinalized = true;
          this.paymentMethodChoice = null;
          this.paymentSubStep = 'choose-method';
        },
        error: (err: any) => {
          this.loading = false;
          this.error = err?.error?.msg || 'Could not prepare payment. Please try again.';
        },
      });
  }

  payWithRazorpay(): void {
    const startRazorpay = () => {
      this.error = '';
      this.loading = true;
      this.loadRazorpayScript()
      .then(() => {
        this.svc.createRazorpayOrder(this.applicationToken!).subscribe({
          next: (res: any) => {
            this.loading = false;
            this.openRazorpay(res);
          },
          error: (err: any) => {
            this.loading = false;
            this.error = err?.error?.msg || 'Could not initiate payment. Please try again.';
          },
        });
      })
      .catch(() => {
        this.loading = false;
        this.error = 'Could not load Razorpay. Please check your internet connection.';
      });
    };

    if (this.paymentFinalized) {
      startRazorpay();
      return;
    }
    this.loading = true;
    this.svc
      .finalize({
        applicationToken: this.applicationToken!,
        level: this.languageLevelOpted,
        subscription: this.selectedSubscription,
        currency: this.selectedCurrency,
      })
      .subscribe({
        next: (res: any) => {
          this.computedAmount = res.amount;
          this.paymentFinalized = true;
          startRazorpay();
        },
        error: (err: any) => {
          this.loading = false;
          this.error = err?.error?.msg || 'Could not prepare payment. Please try again.';
        },
      });
  }

  private loadRazorpayScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof (window as any)['Razorpay'] !== 'undefined') {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Razorpay script failed to load'));
      document.body.appendChild(script);
    });
  }

  private openRazorpay(orderData: any): void {
    const options = {
      key: orderData.keyId,
      amount: orderData.amount,
      currency: orderData.currency,
      name: 'Glück Global',
      description: `German Language Course — ${this.languageLevelOpted} / ${this.planLabel}`,
      order_id: orderData.orderId,
      prefill: { name: orderData.studentName, email: orderData.studentEmail },
      theme: { color: '#6c3fc5' },
      handler: (response: any) => {
        this.verifyRazorpay(response);
      },
      modal: {
        ondismiss: () => {
          this.error = 'Payment cancelled. You can try again.';
        },
      },
    };
    try {
      const rzp = new (window as any)['Razorpay'](options);
      rzp.open();
    } catch {
      this.error = 'Razorpay could not be loaded. Please check your connection and try again.';
    }
  }

  private verifyRazorpay(response: any): void {
    this.loading = true;
    this.svc
      .verifyRazorpay({
        applicationToken: this.applicationToken!,
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      })
      .subscribe({
        next: () => {
          this.loading = false;
          this.paymentSubStep = 'payment-done';
          this.currentStep = 3;
          this.svc.clearToken();
        },
        error: (err: any) => {
          this.loading = false;
          this.error = err?.error?.msg || 'Payment verification failed. Please contact support.';
        },
      });
  }

  onProofFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.proofFile = input.files[0];
    this.proofFileName = this.proofFile.name;
  }

  submitProof(): void {
    if (!this.proofFile) {
      this.error = 'Please select a payment screenshot or PDF.';
      return;
    }
    const paidAmount = Number(this.proofPaidAmount);
    if (!paidAmount || paidAmount <= 0) {
      this.error = 'Please enter the total amount you paid.';
      return;
    }
    if (!this.proofPaymentDateTime) {
      this.error = 'Please enter the date and time of payment.';
      return;
    }
    const holder = this.proofAccountHolderName.trim();
    if (!holder || holder.length < 2) {
      this.error = 'Please enter the account holder name used for payment.';
      return;
    }
    const paymentDateTime = new Date(this.proofPaymentDateTime);
    if (Number.isNaN(paymentDateTime.getTime())) {
      this.error = 'Date and time of payment is invalid.';
      return;
    }
    const doUpload = () => {
      this.error = '';
      this.loading = true;
      this.svc.uploadPaymentProof(this.applicationToken!, this.proofFile!, {
        paidAmount,
        paymentDateTime: paymentDateTime.toISOString(),
        accountHolderName: holder,
      }).subscribe({
        next: () => {
          this.loading = false;
          this.paymentSubStep = 'proof-done';
          this.currentStep = 3;
          this.svc.clearToken();
        },
        error: (err: any) => {
          this.loading = false;
          this.error = err?.error?.msg || 'Upload failed. Please try again.';
        },
      });
    };

    if (!this.paymentFinalized) {
      this.loading = true;
      this.svc
        .finalize({
          applicationToken: this.applicationToken!,
          level: this.languageLevelOpted,
          subscription: this.selectedSubscription,
          currency: this.selectedCurrency,
        })
        .subscribe({
          next: (res: any) => {
            this.computedAmount = res.amount;
            this.paymentFinalized = true;
            doUpload();
          },
          error: (err: any) => {
            this.loading = false;
            this.error = err?.error?.msg || 'Could not save payment details. Please try again.';
          },
        });
    } else {
      doUpload();
    }
  }
}
