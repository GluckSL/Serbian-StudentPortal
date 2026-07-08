import { Injectable } from '@angular/core';
import { map, Observable, of, tap } from 'rxjs';
import { PaymentHubApiService } from './payment-hub-api.service';
import {
  ExcludedBatchInfo,
  ExcludedStudentPendingMap,
  EXCL_STUDENTS_KEY_PREFIX,
  PendingCurrencyTotals,
} from './payment-hub-pending-exclusion.util';

const EXCL_BATCHES_KEY = 'ph_excl_pending_batches';

function normBatchKey(batch: string): string {
  return String(batch || '').trim().toLowerCase();
}

@Injectable({ providedIn: 'root' })
export class PaymentHubPendingExclusionService {
  private excludedPendingBatches = new Set<string>();
  private excludedStudentByBatchLabel = new Map<string, ExcludedStudentPendingMap>();
  private loaded = false;

  constructor(private readonly api: PaymentHubApiService) {}

  reloadFromServer(): Observable<void> {
    this.loaded = false;
    return this.ensureLoaded();
  }

  ensureLoaded(): Observable<void> {
    if (this.loaded) return of(undefined);
    return this.api.getFinanceVisibleBatches().pipe(
      tap((res) => {
        this.hydrateFromServer(
          res.data?.excludedPendingBatches || [],
          res.data?.excludedStudentPending || {},
        );
        this.loaded = true;
      }),
      map(() => undefined),
    );
  }

  hydrateFromServer(
    batches: string[],
    studentPending: Record<string, ExcludedStudentPendingMap>,
  ): void {
    this.excludedPendingBatches = new Set(batches || []);
    this.excludedStudentByBatchLabel = new Map();
    for (const [batch, map] of Object.entries(studentPending || {})) {
      if (batch && map && typeof map === 'object' && Object.keys(map).length) {
        this.excludedStudentByBatchLabel.set(batch, { ...map });
      }
    }
    this.migrateLocalStorageIfNeeded();
  }

  isBatchPendingExcluded(batch: string): boolean {
    return this.excludedPendingBatches.has(batch);
  }

  toggleBatchPendingExclusion(batch: string): Observable<boolean> {
    const exclude = !this.excludedPendingBatches.has(batch);
    if (exclude) {
      this.excludedPendingBatches.add(batch);
    } else {
      this.excludedPendingBatches.delete(batch);
    }
    this.excludedPendingBatches = new Set(this.excludedPendingBatches);

    return this.api.updateFinancePendingBatchExclusion(batch, exclude).pipe(
      tap({
        next: (res) => {
          this.excludedPendingBatches = new Set(res.data?.excludedPendingBatches || []);
        },
        error: () => {
          if (exclude) {
            this.excludedPendingBatches.delete(batch);
          } else {
            this.excludedPendingBatches.add(batch);
          }
          this.excludedPendingBatches = new Set(this.excludedPendingBatches);
        },
      }),
      map(() => exclude),
    );
  }

  get excludedBatches(): Set<string> {
    return this.excludedPendingBatches;
  }

  isStudentPendingExcluded(batch: string, studentId: string): boolean {
    const map = this.excludedStudentByBatchLabel.get(batch) || {};
    return studentId in map;
  }

  loadExcludedStudentsForBatch(batch: string): ExcludedStudentPendingMap {
    return { ...(this.excludedStudentByBatchLabel.get(batch) || {}) };
  }

  loadExcludedStudentsByBatch(): Map<string, ExcludedBatchInfo> {
    const result = new Map<string, ExcludedBatchInfo>();
    for (const [batchLabel, map] of this.excludedStudentByBatchLabel) {
      const studentIds = new Set(Object.keys(map));
      if (studentIds.size) {
        result.set(normBatchKey(batchLabel), { batchLabel, studentIds });
      }
    }
    return result;
  }

  sumExcludedPendingForBatch(batch: string): PendingCurrencyTotals {
    const map = this.excludedStudentByBatchLabel.get(batch) || {};
    return Object.values(map).reduce(
      (acc, t) => ({
        lkr: acc.lkr + (t.lkr || 0),
        inr: acc.inr + (t.inr || 0),
        usd: acc.usd + (t.usd || 0),
      }),
      { lkr: 0, inr: 0, usd: 0 },
    );
  }

  getExcludedPendingByBatch(): Map<string, PendingCurrencyTotals> {
    const result = new Map<string, PendingCurrencyTotals>();
    for (const [batchLabel] of this.excludedStudentByBatchLabel) {
      const total = this.sumExcludedPendingForBatch(batchLabel);
      if (total.lkr > 0 || total.inr > 0 || total.usd > 0) {
        result.set(normBatchKey(batchLabel), total);
      }
    }
    return result;
  }

  toggleStudentPendingExclusion(
    batch: string,
    studentId: string,
    pending: PendingCurrencyTotals,
  ): Observable<boolean> {
    const map = { ...(this.excludedStudentByBatchLabel.get(batch) || {}) };
    const wasExcluded = studentId in map;
    if (wasExcluded) {
      delete map[studentId];
    } else {
      map[studentId] = {
        lkr: pending.lkr || 0,
        inr: pending.inr || 0,
        usd: pending.usd || 0,
      };
    }
    this.setBatchStudentMap(batch, map);

    return this.api.updateFinancePendingStudentExclusion(batch, studentId, pending).pipe(
      tap({
        next: (res) => {
          const students = res.data?.students || {};
          this.setBatchStudentMap(batch, students);
        },
        error: () => {
          const revert = { ...(this.excludedStudentByBatchLabel.get(batch) || {}) };
          if (wasExcluded) {
            revert[studentId] = {
              lkr: pending.lkr || 0,
              inr: pending.inr || 0,
              usd: pending.usd || 0,
            };
          } else {
            delete revert[studentId];
          }
          this.setBatchStudentMap(batch, revert);
        },
      }),
      map(() => !wasExcluded),
    );
  }

  saveExcludedStudentsForBatch(batch: string, map: ExcludedStudentPendingMap): Observable<void> {
    this.setBatchStudentMap(batch, map);
    return this.api.updateFinanceExcludedStudentsForBatch(batch, map).pipe(
      tap({
        next: (res) => {
          this.setBatchStudentMap(batch, res.data?.students || {});
        },
      }),
      map(() => undefined),
    );
  }

  private setBatchStudentMap(batch: string, map: ExcludedStudentPendingMap): void {
    if (!Object.keys(map).length) {
      this.excludedStudentByBatchLabel.delete(batch);
    } else {
      this.excludedStudentByBatchLabel.set(batch, { ...map });
    }
  }

  /** One-time migration from per-browser localStorage to shared DB settings. */
  private migrateLocalStorageIfNeeded(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const localBatches = localStorage.getItem(EXCL_BATCHES_KEY);
      if (localBatches) {
        const parsed = JSON.parse(localBatches);
        if (Array.isArray(parsed) && parsed.length && !this.excludedPendingBatches.size) {
          for (const batch of parsed) {
            if (typeof batch === 'string' && batch) {
              this.api.updateFinancePendingBatchExclusion(batch, true).subscribe();
            }
          }
        }
        localStorage.removeItem(EXCL_BATCHES_KEY);
      }

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(EXCL_STUDENTS_KEY_PREFIX)) continue;
        const batchLabel = key.slice(EXCL_STUDENTS_KEY_PREFIX.length);
        const raw = localStorage.getItem(key);
        if (!raw) continue;

        const existing = this.excludedStudentByBatchLabel.get(batchLabel);
        if (existing && Object.keys(existing).length) {
          localStorage.removeItem(key);
          continue;
        }

        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            this.api.updateFinanceExcludedStudentsForBatch(batchLabel, parsed).subscribe();
          }
        } catch {}
        localStorage.removeItem(key);
      }
    } catch {}
  }
}
