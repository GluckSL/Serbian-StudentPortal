import { Injectable } from '@angular/core';

const STORAGE_KEY = 'gluck_payment_import_history';
const MAX_ENTRIES = 50;

export interface PaymentImportHistoryCurrencyTotals {
  LKR: number;
  INR: number;
  USD: number;
}

export interface PaymentImportHistory {
  id: string;
  uploadedBy: { name: string; email: string };
  uploadedAt: string;
  sourceFileName: string;
  totalRows: number;
  mappedRows: number;
  failedRows: number;
  warningRows: number;
  duplicateRows: number;
  currencyTotals: PaymentImportHistoryCurrencyTotals;
}

@Injectable({ providedIn: 'root' })
export class PaymentImportHistoryService {
  append(entry: PaymentImportHistory): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list: PaymentImportHistory[] = raw ? (JSON.parse(raw) as PaymentImportHistory[]) : [];
      list.unshift(entry);
      const trimmed = list.slice(0, MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      /* quota / private mode */
    }
  }

  listRecent(limit = 20): PaymentImportHistory[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw) as PaymentImportHistory[];
      return list.slice(0, limit);
    } catch {
      return [];
    }
  }
}
