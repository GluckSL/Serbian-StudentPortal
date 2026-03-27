import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-invoice-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './invoice-management.component.html',
  styleUrls: ['./invoice-management.component.css']
})
export class InvoiceManagementComponent implements OnInit {
  isLoading = true;
  invoices: any[] = [];
  filtered: any[] = [];
  summary: any = {};
  searchTerm = '';
  filterStatus = 'all';
  sortField = 'created_at';
  sortDir: 'asc' | 'desc' = 'desc';

  // Payment modal
  showPayModal = false;
  selectedInvoice: any = null;
  payAmount: number = 0;
  payMethod = '';
  payNote = '';
  payProofFile: File | null = null;
  sendReceiptEmail = true;
  processing = false;

  // History modal
  showHistoryModal = false;
  historyInvoice: any = null;

  constructor(private http: HttpClient) {}
  ngOnInit(): void { this.load(); }

  load(): void {
    this.isLoading = true;
    this.http.get<any>('/api/invoices', { withCredentials: true }).subscribe({
      next: (res) => { this.invoices = res.invoices || []; this.summary = res.summary || {}; this.applyFilters(); this.isLoading = false; },
      error: () => { this.isLoading = false; }
    });
  }

  applyFilters(): void {
    let list = [...this.invoices];
    if (this.filterStatus !== 'all') list = list.filter(i => i.payment_status === this.filterStatus);
    if (this.searchTerm.trim()) {
      const t = this.searchTerm.toLowerCase();
      list = list.filter(i => (i.customer_name || '').toLowerCase().includes(t) || (i.customer_email || '').toLowerCase().includes(t) || (i.invoice_number || '').toLowerCase().includes(t));
    }
    list.sort((a, b) => {
      let va = a[this.sortField], vb = b[this.sortField];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      return this.sortDir === 'asc' ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
    });
    this.filtered = list;
  }

  sort(field: string): void {
    if (this.sortField === field) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortField = field; this.sortDir = 'asc'; }
    this.applyFilters();
  }
  sortIcon(field: string): string { return this.sortField !== field ? '↕' : this.sortDir === 'asc' ? '↑' : '↓'; }

  remaining(inv: any): number { return (inv.total_payable || 0) - (inv.amount_paid || 0); }
  paidPct(inv: any): number { return inv.total_payable ? Math.round(((inv.amount_paid || 0) / inv.total_payable) * 100) : 0; }

  openRecordPayment(inv: any): void {
    this.selectedInvoice = inv;
    this.payAmount = this.remaining(inv);
    this.payMethod = '';
    this.payNote = '';
    this.payProofFile = null;
    this.sendReceiptEmail = true;
    this.showPayModal = true;
  }
  closeModal(): void { this.showPayModal = false; this.selectedInvoice = null; this.payProofFile = null; }

  onProofFileSelected(event: any): void {
    this.payProofFile = event.target?.files?.[0] || null;
  }

  confirmPayment(): void {
    if (!this.selectedInvoice || !this.payAmount || this.payAmount <= 0) return;
    this.processing = true;
    const formData = new FormData();
    formData.append('amount', this.payAmount.toString());
    formData.append('method', this.payMethod);
    formData.append('note', this.payNote);
    formData.append('sendEmail', this.sendReceiptEmail ? 'true' : 'false');
    if (this.payProofFile) formData.append('proof', this.payProofFile);
    this.http.post<any>(`/api/invoices/${this.selectedInvoice._id}/record-payment`, formData, { withCredentials: true }).subscribe({
      next: () => { this.processing = false; this.closeModal(); this.load(); },
      error: (err: any) => { this.processing = false; alert(err.error?.message || 'Failed'); }
    });
  }

  // Proof viewer
  showProofModal = false;
  proofUrl = '';
  proofIsPdf = false;

  openHistory(inv: any): void { this.historyInvoice = inv; this.showHistoryModal = true; }

  deleteInvoice(inv: any): void {
    if (!confirm('Delete invoice ' + (inv.invoice_number || '') + '? This cannot be undone.')) return;
    this.http.delete<any>(`/api/invoices/${inv._id}`, { withCredentials: true }).subscribe({
      next: () => this.load(),
      error: (err: any) => alert(err.error?.message || 'Failed to delete')
    });
  }
  closeHistory(): void { this.showHistoryModal = false; this.historyInvoice = null; }

  viewProof(url: string): void {
    this.proofUrl = url;
    this.proofIsPdf = url.toLowerCase().endsWith('.pdf');
    this.showProofModal = true;
  }
  closeProof(): void { this.showProofModal = false; this.proofUrl = ''; }

  isOverdue(dateStr: string): boolean { return dateStr ? new Date() > new Date(dateStr + 'T00:00:00') : false; }
  formatCurrency(amount: number): string { if (!amount && amount !== 0) return '0'; return 'LKR ' + amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
  formatDate(d: string | Date): string { if (!d) return '—'; return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
}
