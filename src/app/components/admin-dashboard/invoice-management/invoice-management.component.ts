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
  showPayModal = false;
  selectedInvoice: any = null;
  payMethod = '';
  payNote = '';
  processing = false;

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
  openMarkPaid(inv: any): void { this.selectedInvoice = inv; this.payMethod = ''; this.payNote = ''; this.showPayModal = true; }
  closeModal(): void { this.showPayModal = false; this.selectedInvoice = null; }
  confirmMarkPaid(): void {
    if (!this.selectedInvoice) return;
    this.processing = true;
    this.http.post<any>(`/api/invoices/${this.selectedInvoice._id}/mark-paid`, { method: this.payMethod, note: this.payNote }, { withCredentials: true }).subscribe({
      next: () => { this.processing = false; this.closeModal(); this.load(); },
      error: (err: any) => { this.processing = false; alert(err.error?.message || 'Failed'); }
    });
  }
  markUnpaid(inv: any): void {
    if (!confirm('Revert invoice ' + inv.invoice_number + ' to unpaid?')) return;
    this.http.post<any>(`/api/invoices/${inv._id}/mark-unpaid`, {}, { withCredentials: true }).subscribe({
      next: () => this.load(),
      error: (err: any) => alert(err.error?.message || 'Failed')
    });
  }
  isOverdue(dateStr: string): boolean { return dateStr ? new Date() > new Date(dateStr + 'T00:00:00') : false; }
  formatCurrency(amount: number): string { if (!amount && amount !== 0) return '0'; return 'LKR ' + amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
}
