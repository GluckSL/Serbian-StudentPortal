import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-student-payments',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './student-payments.component.html',
  styleUrls: ['./student-payments.component.css']
})
export class StudentPaymentsComponent implements OnInit {
  isLoading = true;
  ledger: any = null;
  invoices: any[] = [];
  liveTotals: any = null;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
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
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  formatCurrency(amount: number): string {
    if (!amount && amount !== 0) return '0';
    return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
}
