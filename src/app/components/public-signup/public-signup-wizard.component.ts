// src/app/components/public-signup/public-signup-wizard.component.ts

import { Component, OnInit, Output, EventEmitter } from '@angular/core';
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
export class PublicSignupWizardComponent implements OnInit {
  @Output() backToLogin = new EventEmitter<void>();

  currentStep = 1;
  applicationToken: string | null = null;

  name = '';
  email = '';
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
  password = '';
  confirmPassword = '';
  showPwd = false;
  showConfirmPwd = false;

  cefrRows: CatalogRow[] = [];
  computedAmount = 0;
  paymentFinalized = false;
  catalogLoading = false;

  paymentSubStep: 'ready' | 'proof-done' | 'payment-done' = 'ready';
  proofFile: File | null = null;
  proofFileName = '';

  loading = false;
  error = '';
  success = '';

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
          this.phoneNumber = d.phoneNumber || '';
          this.whatsappNumber = d.whatsappNumber || '';
          this.address = d.address || '';
          this.selectedLearnLanguage = d.medium?.[0] || '';
          this.languageLevelOpted = d.languageLevelOpted || d.level || '';
          this.selectedSubscription = d.subscription || '';
          this.leadSource = d.leadSource || '';
          if (d.emailVerifiedAt) {
            this.emailVerified = true;
            this.otpSubStep = 'done';
          }
          this.selectedSubscription = d.subscription || this.selectedSubscription;
          if (d.status === 'documents_done' || d.status === 'payment_pending') {
            this.currentStep = 2;
            this.computedAmount = d.amount || 0;
            this.paymentFinalized = !!d.amount;
            this.loadCatalog();
          } else if (d.emailVerifiedAt) {
            this.currentStep = 1;
            this.otpSubStep = 'done';
          }
        },
        error: () => { /* start fresh */ },
      });
    }
    this.loadCatalog();
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

  editDetails(): void {
    this.error = '';
    this.success = '';
    this.otpSubStep = 'info';
    this.currentStep = 1;
  }

  backFromPersonalInfo(): void {
    if (this.emailVerified) {
      this.otpSubStep = 'done';
      this.error = '';
    } else {
      this.backToLogin.emit();
    }
  }

  private validatePersonalInfo(): boolean {
    if (!this.name.trim()) {
      this.error = 'Full name is required.';
      return false;
    }
    if (!this.email.includes('@')) {
      this.error = 'Enter a valid email address.';
      return false;
    }
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
          this.otpSubStep = 'done';
          this.success = res.msg || 'Details saved.';
        } else {
          this.emailVerified = false;
          this.otpSubStep = 'otp';
          this.success = res.msg || `Verification code sent to ${this.email}.`;
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
          this.otpSubStep = 'done';
        } else {
          this.otpSubStep = 'otp';
          this.success = res.msg || `Verification code sent to ${this.email}.`;
        }
      },
      error: (err: any) => {
        this.loading = false;
        this.error = err?.error?.msg || 'Could not send verification code. Please try again.';
      },
    });
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
          this.otpSubStep = 'done';
          this.success = '';
          this.error = '';
        },
        error: (err: any) => {
          this.loading = false;
          this.error = err?.error?.msg || 'Verification failed. Please try again.';
        },
      });
  }

  goToPayment(): void {
    if (this.otpSubStep !== 'done') {
      this.error = 'Please verify your email first.';
      return;
    }
    if (!this.languageLevelOpted || !this.selectedSubscription) {
      this.error = 'Please complete German level and plan on the previous step.';
      return;
    }
    this.error = '';
    this.success = '';
    this.currentStep = 2;
    this.preparePaymentStep();
  }

  backFromPayment(): void {
    this.currentStep = 1;
    this.otpSubStep = 'done';
    this.error = '';
  }

  private preparePaymentStep(): void {
    if (this.paymentFinalized && this.computedAmount > 0) {
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
          this.paymentSubStep = 'ready';
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
    const doUpload = () => {
      this.error = '';
      this.loading = true;
      this.svc.uploadPaymentProof(this.applicationToken!, this.proofFile!).subscribe({
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
