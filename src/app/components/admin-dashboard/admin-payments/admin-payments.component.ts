import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import * as Papa from 'papaparse';

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

  activeTab: 'language' | 'documentation' | 'visa' | 'relocation' = 'language';

  searchTerm = '';
  filterService = '';
  filterBatch = '';
  filterCurrency = '';
  sortField = 'studentName';
  sortDir: 'asc' | 'desc' = 'asc';

  showPaymentModal = false;
  selectedPayment: any = null;
  newPayment = { amount: 0, method: '', note: '' };
  saving = false;
  showHistoryModal = false;
  historyPayment: any = null;
  importing = false;
  importResult = '';

  constructor(private http: HttpClient) {}
  ngOnInit(): void { this.loadPayments(); }

  loadPayments(): void {
    this.isLoading = true;
    this.http.get<any>('/api/student-payments').subscribe({
      next: (res) => { this.payments = res.payments || []; this.summary = res.summary || {}; this.applyFilters(); this.isLoading = false; },
      error: () => { this.isLoading = false; }
    });
  }

  get grandSummaryByCurrency(): { currency: string; totalQuoted: number; totalReceived: number; totalPending: number; students: number }[] {
    const map: Record<string, { totalQuoted: number; totalReceived: number; totalPending: number; students: Set<string> }> = {};
    this.filtered.forEach(p => {
      const cur = p.currency || 'LKR';
      if (!map[cur]) map[cur] = { totalQuoted: 0, totalReceived: 0, totalPending: 0, students: new Set() };
      map[cur].students.add(p.email);
      map[cur].totalQuoted += p.totalPackageAmount || 0;
      map[cur].totalReceived += p.totalPaid || 0;
      map[cur].totalPending += p.pendingPayment || 0;
      if (p.docQuoted != null) { map[cur].totalQuoted += p.docQuoted; map[cur].totalReceived += p.docPaid || 0; map[cur].totalPending += (p.docQuoted - (p.docPaid || 0)); }
      if (p.visaQuoted != null) { map[cur].totalQuoted += p.visaQuoted; map[cur].totalReceived += p.visaPaid || 0; map[cur].totalPending += (p.visaQuoted - (p.visaPaid || 0)); }
      if (p.reloQuoted != null) { map[cur].totalQuoted += p.reloQuoted; map[cur].totalReceived += p.reloPaid || 0; map[cur].totalPending += (p.reloQuoted - (p.reloPaid || 0)); }
    });
    return Object.keys(map).sort().map(c => ({ currency: c, totalQuoted: map[c].totalQuoted, totalReceived: map[c].totalReceived, totalPending: map[c].totalPending, students: map[c].students.size }));
  }

  get tabFiltered(): any[] {
    if (this.activeTab === 'language') return this.filtered.filter(p => (p.totalPackageAmount || 0) > 0);
    if (this.activeTab === 'documentation') return this.filtered.filter(p => p.docQuoted != null);
    if (this.activeTab === 'visa') return this.filtered.filter(p => p.visaQuoted != null);
    if (this.activeTab === 'relocation') return this.filtered.filter(p => p.reloQuoted != null);
    return this.filtered;
  }

  get tabSummaryByCurrency(): { currency: string; totalQuoted: number; totalPaid: number; totalPending: number; count: number }[] {
    const map: Record<string, { totalQuoted: number; totalPaid: number; totalPending: number; count: number }> = {};
    this.tabFiltered.forEach(p => {
      const cur = p.currency || 'LKR';
      if (!map[cur]) map[cur] = { totalQuoted: 0, totalPaid: 0, totalPending: 0, count: 0 };
      if (this.activeTab === 'language') { map[cur].totalQuoted += p.totalPackageAmount || 0; map[cur].totalPaid += p.totalPaid || 0; map[cur].totalPending += p.pendingPayment || 0; }
      else if (this.activeTab === 'documentation') { map[cur].totalQuoted += p.docQuoted || 0; map[cur].totalPaid += p.docPaid || 0; map[cur].totalPending += (p.docQuoted || 0) - (p.docPaid || 0); }
      else if (this.activeTab === 'visa') { map[cur].totalQuoted += p.visaQuoted || 0; map[cur].totalPaid += p.visaPaid || 0; map[cur].totalPending += (p.visaQuoted || 0) - (p.visaPaid || 0); }
      else if (this.activeTab === 'relocation') { map[cur].totalQuoted += p.reloQuoted || 0; map[cur].totalPaid += p.reloPaid || 0; map[cur].totalPending += (p.reloQuoted || 0) - (p.reloPaid || 0); }
      map[cur].count++;
    });
    return Object.keys(map).sort().map(c => ({ currency: c, ...map[c] }));
  }

  get currencies(): string[] { return Array.from(new Set(this.payments.map(p => p.currency).filter(Boolean))).sort(); }
  get services(): string[] { return Array.from(new Set(this.payments.map(p => p.service).filter(Boolean))).sort(); }
  get batches(): string[] { return Array.from(new Set(this.payments.map(p => p.batch).filter(Boolean))).sort((a, c) => Number(a) - Number(c)); }
  get filteredCount(): number { return this.tabFiltered.length; }

  switchTab(tab: 'language' | 'documentation' | 'visa' | 'relocation'): void { this.activeTab = tab; }

  applyFilters(): void {
    let list = [...this.payments];
    const term = this.searchTerm.toLowerCase().trim();
    if (term) list = list.filter(p => (p.studentName || '').toLowerCase().includes(term) || (p.email || '').toLowerCase().includes(term) || (p.regNo || '').toLowerCase().includes(term));
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
    if (this.sortField === field) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortField = field; this.sortDir = 'asc'; }
    this.applyFilters();
  }
  sortIcon(field: string): string { return this.sortField !== field ? '↕' : this.sortDir === 'asc' ? '↑' : '↓'; }
  clearFilters(): void { this.searchTerm = ''; this.filterService = ''; this.filterBatch = ''; this.filterCurrency = ''; this.applyFilters(); }
  openHistory(p: any): void { this.historyPayment = p; this.showHistoryModal = true; }
  closeHistory(): void { this.showHistoryModal = false; this.historyPayment = null; }
  openRecordPayment(p: any): void { this.selectedPayment = p; this.newPayment = { amount: 0, method: '', note: '' }; this.showPaymentModal = true; }
  closeModal(): void { this.showPaymentModal = false; this.selectedPayment = null; }

  submitPayment(): void {
    if (!this.newPayment.amount || this.newPayment.amount <= 0) return;
    this.saving = true;
    this.http.post<any>('/api/student-payments/' + this.selectedPayment._id + '/record-payment', this.newPayment).subscribe({
      next: () => { this.saving = false; this.closeModal(); this.loadPayments(); },
      error: () => { this.saving = false; }
    });
  }

  formatCurrency(amount: number, currency?: string): string {
    if (!amount && amount !== 0) return '0';
    const prefix = currency === 'INR' ? '₹' : 'LKR ';
    return prefix + amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  downloadTemplate(): void {
    const headers = ['students name', 'email ID', 'Current status', 'service opted', 'Batch number', 'Total Invoiced', 'complete package payment', 'pending payment', 'Doc Quoted', 'Doc Pay', 'Visa Quoted', 'Visa Pay', 'Relo Quo', 'Relo Pay'];
    const sample = ['John Doe', 'john@example.com', 'Ongoing', 'Ausbildung', '27', ' LKR  150,000.00 ', ' LKR  75,000.00 ', ' LKR  75,000.00 ', ' LKR  300,000.00 ', ' LKR  300,000.00 ', ' LKR  400,000.00 ', ' LKR  200,000.00 ', '', ''];
    const csv = [headers, sample].map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'payment-import-template.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  onCsvUpload(event: any): void {
    const file = event.target?.files?.[0];
    if (!file) return;
    this.importing = true;
    this.importResult = '';
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result: any) => {
        const records = result.data.map((row: any) => ({
          studentName: row['students name'] || row['studentName'] || '',
          email: row['email ID'] || row['email'] || '',
          currentStatus: row['Current status'] || row['currentStatus'] || '',
          serviceOpted: row['service opted'] || row['serviceOpted'] || '',
          batchNumber: row['Batch number'] || row['batchNumber'] || '',
          totalInvoiced: row['Total Invoiced'] || row['totalInvoiced'] || '',
          completePaid: row['complete package payment'] || row['completePaid'] || '',
          pendingPayment: row['pending payment'] || row['pendingPayment'] || '',
          docQuoted: row['Doc Quoted'] || row['docQuoted'] || '',
          docPaid: row['Doc Pay'] || row['docPaid'] || '',
          visaQuoted: row['Visa Quoted'] || row['visaQuoted'] || '',
          visaPaid: row['Visa Pay'] || row['visaPaid'] || '',
          reloQuoted: row['Relo Quo'] || row['reloQuoted'] || '',
          reloPaid: row['Relo Pay'] || row['reloPaid'] || ''
        }));
        this.http.post<any>('/api/student-payments/import', { records }, { withCredentials: true }).subscribe({
          next: (res: any) => { this.importResult = res.message || 'Import complete'; this.importing = false; this.loadPayments(); },
          error: (err: any) => { this.importResult = 'Import failed: ' + (err.error?.message || 'Unknown error'); this.importing = false; }
        });
      },
      error: () => { this.importResult = 'Failed to parse CSV file'; this.importing = false; }
    });
    event.target.value = '';
  }

  exportCSV(): void {
    let headers: string[], mapRow: (p: any) => any[];
    if (this.activeTab === 'language') {
      headers = ['Name', 'Email', 'Batch', 'Service', 'Currency', 'Invoiced', 'Paid', 'Balance', 'Status'];
      mapRow = p => [p.studentName, p.email, p.batch || '', p.service || '', p.currency, p.totalPackageAmount, p.totalPaid, p.pendingPayment, p.pendingPayment > 0 ? 'Pending' : 'Fully Paid'];
    } else if (this.activeTab === 'documentation') {
      headers = ['Name', 'Email', 'Batch', 'Service', 'Currency', 'Quoted', 'Paid', 'Balance'];
      mapRow = p => [p.studentName, p.email, p.batch || '', p.service || '', p.currency, p.docQuoted ?? '', p.docPaid ?? '', p.docQuoted != null ? (p.docQuoted - (p.docPaid || 0)) : ''];
    } else if (this.activeTab === 'visa') {
      headers = ['Name', 'Email', 'Batch', 'Service', 'Currency', 'Quoted', 'Paid', 'Balance'];
      mapRow = p => [p.studentName, p.email, p.batch || '', p.service || '', p.currency, p.visaQuoted ?? '', p.visaPaid ?? '', p.visaQuoted != null ? (p.visaQuoted - (p.visaPaid || 0)) : ''];
    } else {
      headers = ['Name', 'Email', 'Batch', 'Service', 'Currency', 'Quoted', 'Paid', 'Balance'];
      mapRow = p => [p.studentName, p.email, p.batch || '', p.service || '', p.currency, p.reloQuoted ?? '', p.reloPaid ?? '', p.reloQuoted != null ? (p.reloQuoted - (p.reloPaid || 0)) : ''];
    }
    const rows = [headers, ...this.tabFiltered.map(mapRow)];
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `payments-${this.activeTab}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
}
