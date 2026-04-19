import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MaterialModule } from '../../../shared/material.module';
import { MatSnackBar } from '@angular/material/snack-bar';
import { environment } from '../../../../environments/environment';

interface TestAccount {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  batch?: string;
  level?: string;
}

interface SearchResult {
  _id: string;
  name: string;
  regNo: string;
  email: string;
  batch?: string;
  level?: string;
  isTestAccount: boolean;
}

@Component({
  selector: 'app-test-accounts',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './test-accounts.component.html',
  styleUrls: ['./test-accounts.component.css']
})
export class TestAccountsComponent implements OnInit {
  accounts: TestAccount[] = [];
  loadingAccounts = false;

  searchQuery = '';
  searchResults: SearchResult[] = [];
  searching = false;
  private searchTimer: any;

  markingId: string | null = null;
  unmarkingId: string | null = null;

  private readonly base = `${environment.apiUrl}/test-accounts`;

  /** Cookie-based JWT auth requires credentials on cross-origin API calls. */
  private readonly httpOpts = { withCredentials: true as const };

  constructor(private http: HttpClient, private snackBar: MatSnackBar) {}

  ngOnInit(): void {
    this.loadAccounts();
  }

  loadAccounts(): void {
    this.loadingAccounts = true;
    this.http.get<{ accounts: TestAccount[] }>(this.base, this.httpOpts).subscribe({
      next: (res) => {
        this.accounts = res.accounts || [];
        this.loadingAccounts = false;
      },
      error: () => {
        this.snackBar.open('Failed to load test accounts', 'Close', { duration: 3000 });
        this.loadingAccounts = false;
      }
    });
  }

  onSearchChange(): void {
    clearTimeout(this.searchTimer);
    if (!this.searchQuery.trim()) {
      this.searchResults = [];
      return;
    }
    this.searchTimer = setTimeout(() => this.doSearch(), 350);
  }

  private doSearch(): void {
    const q = this.searchQuery.trim();
    if (!q) return;
    this.searching = true;
    this.http.get<{ results: SearchResult[] }>(`${this.base}/search`, {
      ...this.httpOpts,
      params: { q }
    }).subscribe({
      next: (res) => {
        this.searchResults = res.results || [];
        this.searching = false;
      },
      error: () => {
        this.searching = false;
        this.snackBar.open('Search failed', 'Close', { duration: 3000 });
      }
    });
  }

  isAlreadyTest(user: SearchResult): boolean {
    return user.isTestAccount || this.accounts.some((a) => a._id === user._id);
  }

  markAsTest(user: SearchResult): void {
    if (this.markingId) return;
    this.markingId = user._id;
    this.http.post<{ user: TestAccount }>(`${this.base}/mark`, { userId: user._id }, this.httpOpts).subscribe({
      next: () => {
        this.markingId = null;
        this.snackBar.open(`${user.name} marked as test account`, 'Close', { duration: 3000 });
        this.loadAccounts();
        // Refresh search to reflect new flag
        this.doSearch();
      },
      error: (err) => {
        this.markingId = null;
        this.snackBar.open(err?.error?.message || 'Failed to mark account', 'Close', { duration: 3000 });
      }
    });
  }

  removeMark(account: TestAccount): void {
    if (this.unmarkingId) return;
    this.unmarkingId = account._id;
    this.http.post<any>(`${this.base}/unmark`, { userId: account._id }, this.httpOpts).subscribe({
      next: () => {
        this.unmarkingId = null;
        this.snackBar.open(`${account.name} removed from test accounts`, 'Close', { duration: 3000 });
        this.loadAccounts();
        if (this.searchQuery.trim()) this.doSearch();
      },
      error: (err) => {
        this.unmarkingId = null;
        this.snackBar.open(err?.error?.message || 'Failed to remove flag', 'Close', { duration: 3000 });
      }
    });
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
  }
}
