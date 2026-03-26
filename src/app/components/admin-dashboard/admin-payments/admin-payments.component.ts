import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-admin-payments',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-payments.component.html',
  styleUrls: ['./admin-payments.component.css']
})
export class AdminPaymentsComponent implements OnInit {
  isLoading = true;
  payments: any[] = [];
  filtered: any[] = [];
  summary: any = { totalPackage: 0, totalPaid: 0, totalPending: 0, count: 0 };

  searchTerm = '';
  filterStatus = '';
  filterService = '';
  filterBatch = '';
  filterCurrency = '';
  sortField = 'studentName';
  sortDir: 'asc' | 'desc' = 'asc';

  // Record payment modal
  showPaymentModal = false;
  selectedPayment: any = null;
  newPayment = { amount: 0, method: '', note: '' };
  saving = false;

  // History modal
  showHistoryModal = false;
  historyPayment: any = null;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadPayments();
  }

  loadPayments(): void {
    this.isLoading = true;
    this.http.get<any>('/api/student-payments').subscribe({
      next: (res) => {
        this.payments = res.payments || [];
        this.summary = res.summary || {};
        this.applyFilters();
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; }
    });
  }

  get currencies(): string[] {
    const c = new Set(this.payments.map(p => p.currency).filter(Boolean));
    return Array.from(c).sort();
  }

  get services(): string[] {
    const s = new Set(this.payments.map(p => p.service).filter(Boolean));
    return Array.from(s).sort();
  }

  get batches(): string[] {
    const b = new Set(this.payments.map(p => p.batch).filter(Boolean));
    return Array.from(b).sort((a, c) => Number(a) - Number(c));
  }

  get filteredSummaryByCurrency(): { currency: string; totalPackage: number; totalPaid: number; totalPending: number; count: number }[] {
    const map: Record<string, { totalPackage: number; totalPaid: number; totalPending: number; count: number }> = {};
    this.filtered.forEach(p => {
      const cur = p.currency || 'LKR';
      if (!map[cur]) map[cur] = { totalPackage: 0, totalPaid: 0, totalPending: 0, count: 0 };
      map[cur].totalPackage += p.totalPackageAmount || 0;
      map[cur].totalPaid += p.totalPaid || 0;
      map[cur].totalPending += p.pendingPayment || 0;
      map[cur].count++;
    });
    return Object.keys(map).sort().map(c => ({ currency: c, ...map[c] }));
  }

  get filteredCount(): number {
    return this.filtered.length;
  }

  applyFilters(): void {
    let list = [...this.payments];
    const term = this.searchTerm.toLowerCase().trim();
    if (term) {
      list = list.filter(p =>
        (p.studentName || '').toLowerCase().includes(term) ||
        (p.email || '').toLowerCase().includes(term) ||
        (p.regNo || '').toLowerCase().includes(term)
      );
    }
    if (this.filterStatus === 'pending') list = list.filter(p => p.pendingPayment > 0);
    if (this.filterStatus === 'paid') list = list.filter(p => p.pendingPayment <= 0);
    if (this.filterService) list = list.filter(p => p.service === this.filterService);
    if (this.filterBatch) list = list.filter(p => p.batch === this.filterBatch);
    if (this.filterCurrency) list = list.filter(p => p.currency === this.filterCurrency);

    list.sort((a, b) => {
      let va = a[this.sortField], vb = b[this.sortField];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return this.sortDir === 'asc' ? -1 : 1;
      if (va > vb) return this.sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    this.filtered = list;
  }

  sort(field: string): void {
    if (this.sortField === field) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDir = 'asc';
    }
    this.applyFilters();
  }

  sortIcon(field: string): string {
    if (this.sortField !== field) return '↕';
    return this.sortDir === 'asc' ? '↑' : '↓';
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.filterStatus = '';
    this.filterService = '';
    this.filterBatch = '';
    this.filterCurrency = '';
    this.applyFilters();
  }

  openHistory(p: any): void {
    this.historyPayment = p;
    this.showHistoryModal = true;
  }

  closeHistory(): void {
    this.showHistoryModal = false;
    this.historyPayment = null;
  }

  openRecordPayment(p: any): void {
    this.selectedPayment = p;
    this.newPayment = { amount: 0, method: '', note: '' };
    this.showPaymentModal = true;
  }

  closeModal(): void {
    this.showPaymentModal = false;
    this.selectedPayment = null;
  }

  submitPayment(): void {
    if (!this.newPayment.amount || this.newPayment.amount <= 0) return;
    this.saving = true;
    this.http.post<any>('/api/student-payments/' + this.selectedPayment._id + '/record-payment', this.newPayment).subscribe({
      next: () => {
        this.saving = false;
        this.closeModal();
        this.loadPayments();
      },
      error: () => { this.saving = false; }
    });
  }

  formatCurrency(amount: number, currency?: string): string {
    if (!amount && amount !== 0) return '0';
    const prefix = currency === 'INR' ? '₹' : 'LKR ';
    return prefix + amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  exportCSV(): void {
    const rows = [['Name', 'Email', 'Reg No', 'Batch', 'Service', 'Currency', 'Total Package', 'Total Paid', 'Pending', 'Status']];
    this.filtered.forEach(p => {
      rows.push([
        p.studentName, p.email, p.regNo || '', p.batch || '',
        p.service || '', p.currency, p.totalPackageAmount, p.totalPaid,
        p.pendingPayment, p.pendingPayment > 0 ? 'Pending' : 'Fully Paid'
      ]);
    });
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'student-payments.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
