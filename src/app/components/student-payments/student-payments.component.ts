import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

declare var Razorpay: any;

@Component({
  selector: 'app-student-payments',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './student-payments.component.html',
  styleUrls: ['./student-payments.component.css']
})
export class StudentPaymentsComponent implements OnInit {
  isLoading = true;
  ledger: any = null;
  invoices: any[] = [];
  liveTotals: any = null;
  submissions: any[] = [];

  // UI state
  payActionLoading: { [invoiceId: string]: boolean } = {};
  toast: { msg: string; type: 'success' | 'error' } | null = null;

  // Manual payment form modal
  showManualModal = false;
  selectedInvoice: any = null;
  manualForm = {
    amount: '',
    timeOfPayment: '',
    note: '',
    proofFile: null as File | null
  };
  manualSubmitting = false;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadPaymentData();
    this.loadSubmissions();
  }

  loadPaymentData(): void {
    this.http.get<any>('/api/student-payments/my').subscribe({
      next: (res) => {
        this.ledger = res.ledger;
        this.invoices = res.invoices || [];
        this.liveTotals = res.liveTotals || null;
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; }
    });
  }

  loadSubmissions(): void {
    this.http.get<any>('/api/payment-submissions/my').subscribe({
      next: (res) => { this.submissions = res.submissions || []; },
      error: () => {}
    });
  }

  // ── Razorpay Payment ──────────────────────────────────────────────────────

  payWithRazorpay(invoice: any): void {
    this.payActionLoading[invoice._id] = true;

    // Dynamically load Razorpay script if not already loaded
    this.loadRazorpayScript().then(() => {
      this.http.post<any>('/api/payment-submissions/razorpay/create-order', { invoiceId: invoice._id }).subscribe({
        next: (order) => {
          const options = {
            key: order.keyId,
            amount: order.amount,
            currency: order.currency,
            name: 'Glück Global',
            description: `Invoice ${order.invoiceNumber}`,
            image: '/assets/gluck-logo.png',
            order_id: order.orderId,
            prefill: {
              name: order.studentName,
              email: order.studentEmail
            },
            theme: { color: '#03396c' },
            handler: (response: any) => {
              this.verifyRazorpayPayment(invoice, response);
            },
            modal: {
              ondismiss: () => {
                this.payActionLoading[invoice._id] = false;
              }
            }
          };

          const rzp = new Razorpay(options);
          rzp.on('payment.failed', () => {
            this.payActionLoading[invoice._id] = false;
            this.showToast('Plaćanje nije uspelo. Pokušajte ponovo.', 'error');
          });
          rzp.open();
        },
        error: (err) => {
          this.payActionLoading[invoice._id] = false;
          this.showToast(err?.error?.message || 'Nije moguće pokrenuti plaćanje. Pokušajte ponovo.', 'error');
        }
      });
    }).catch(() => {
      this.payActionLoading[invoice._id] = false;
      this.showToast('Nije moguće učitati platni gateway. Proverite internet konekciju.', 'error');
    });
  }

  private verifyRazorpayPayment(invoice: any, response: any): void {
    this.http.post<any>('/api/payment-submissions/razorpay/verify', {
      invoiceId: invoice._id,
      razorpayOrderId: response.razorpay_order_id,
      razorpayPaymentId: response.razorpay_payment_id,
      razorpaySignature: response.razorpay_signature
    }).subscribe({
      next: () => {
        this.payActionLoading[invoice._id] = false;
        this.showToast('Plaćanje primljeno! Čeka se potvrda administratora.', 'success');
        this.loadSubmissions();
        this.loadPaymentData();
      },
      error: (err) => {
        this.payActionLoading[invoice._id] = false;
        this.showToast(err?.error?.message || 'Verifikacija plaćanja nije uspela. Kontaktirajte podršku.', 'error');
      }
    });
  }

  private loadRazorpayScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof Razorpay !== 'undefined') { resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve();
      script.onerror = () => reject();
      document.body.appendChild(script);
    });
  }

  // ── Manual Payment Modal ──────────────────────────────────────────────────

  openManualModal(invoice: any): void {
    this.selectedInvoice = invoice;
    this.manualForm = {
      amount: (invoice.total_payable || '').toString(),
      timeOfPayment: '',
      note: '',
      proofFile: null
    };
    this.showManualModal = true;
  }

  closeManualModal(): void {
    this.showManualModal = false;
    this.selectedInvoice = null;
    this.manualSubmitting = false;
  }

  onProofFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    const ext = /\.(jpe?g|png|gif|webp|heic|heif|pdf)$/i.test(file.name || '');
    if (!ext || file.size > 5 * 1024 * 1024) {
      this.manualForm.proofFile = null;
      input.value = '';
      this.showToast(
        file.size > 5 * 1024 * 1024 ? 'Fajl mora biti 5 MB ili manji.' : 'Izaberite fotografiju ili PDF.',
        'error',
      );
      return;
    }
    this.manualForm.proofFile = file;
  }

  submitManualPayment(): void {
    if (!this.selectedInvoice || !this.manualForm.amount) return;

    this.manualSubmitting = true;
    const formData = new FormData();
    formData.append('invoiceId', this.selectedInvoice._id);
    formData.append('amount', this.manualForm.amount);
    formData.append('timeOfPayment', this.manualForm.timeOfPayment);
    formData.append('note', this.manualForm.note);
    if (this.manualForm.proofFile) {
      formData.append('proof', this.manualForm.proofFile);
    }

    this.http.post<any>('/api/payment-submissions/manual', formData).subscribe({
      next: () => {
        this.manualSubmitting = false;
        this.closeManualModal();
        this.showToast('Dokaz o plaćanju poslat! Čeka se potvrda administratora.', 'success');
        this.loadSubmissions();
      },
      error: (err) => {
        this.manualSubmitting = false;
        this.showToast(err?.error?.message || 'Slanje nije uspelo. Pokušajte ponovo.', 'error');
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  hasActiveSubmission(invoiceId: string): boolean {
    return this.submissions.some(s =>
      s.invoiceId === invoiceId && (s.status === 'pending' || s.status === 'processing')
    );
  }

  getSubmissionForInvoice(invoiceId: string): any | null {
    return this.submissions.find(s => s.invoiceId === invoiceId) || null;
  }

  submissionStatusClass(status: string): string {
    switch (status) {
      case 'confirmed': return 'sp-sub-badge sp-sub-badge--confirmed';
      case 'processing': return 'sp-sub-badge sp-sub-badge--processing';
      case 'rejected': return 'sp-sub-badge sp-sub-badge--rejected';
      default: return 'sp-sub-badge sp-sub-badge--pending';
    }
  }

  submissionStatusLabel(status: string): string {
    switch (status) {
      case 'confirmed': return '✓ Plaćanje potvrđeno';
      case 'processing': return '⏳ Čeka potvrdu (Razorpay)';
      case 'rejected': return '✗ Prijava odbijena';
      default: return '🕐 Na pregledu';
    }
  }

  showToast(msg: string, type: 'success' | 'error'): void {
    this.toast = { msg, type };
    setTimeout(() => { this.toast = null; }, 5000);
  }

  get currency(): string {
    return this.liveTotals?.currency || this.ledger?.currency || 'LKR';
  }

  get totalAmount(): number {
    return this.liveTotals?.totalPackageAmount || this.ledger?.totalPackageAmount || 0;
  }

  get paidAmount(): number {
    return this.liveTotals?.totalPaid ?? this.ledger?.totalPaid ?? 0;
  }

  get balance(): number {
    return this.liveTotals?.pendingPayment ?? this.ledger?.pendingPayment ?? 0;
  }

  get payPct(): number {
    return this.totalAmount ? Math.round((this.paidAmount / this.totalAmount) * 100) : 0;
  }

  get paymentHistory(): any[] {
    return this.ledger?.payments || [];
  }

  get invoiceTotal(): number {
    return this.invoices.reduce((sum, inv) => sum + (inv.total_payable || 0), 0);
  }

  get invoicePaid(): number {
    return this.invoices.filter(i => i.payment_status === 'paid').reduce((sum, inv) => sum + (inv.total_payable || 0), 0);
  }

  isOverdue(dateStr: string): boolean {
    if (!dateStr) return false;
    return new Date() > new Date(dateStr + 'T00:00:00');
  }

  formatDate(d: string | Date): string {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('sr-Latn-RS', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  formatCurrency(amount: number): string {
    if (!amount && amount !== 0) return '0';
    return amount.toLocaleString('sr-Latn-RS', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
}
