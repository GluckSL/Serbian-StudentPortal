export const EXCL_STUDENTS_KEY_PREFIX = 'ph_excl_pending_students_';

export interface PendingCurrencyTotals {
  lkr: number;
  inr: number;
  usd: number;
}

/** Per-student excluded pending amounts for one batch (studentId → totals). */
export type ExcludedStudentPendingMap = Record<string, PendingCurrencyTotals>;

export interface ExcludedBatchInfo {
  batchLabel: string;
  studentIds: Set<string>;
}

function emptyTotals(): PendingCurrencyTotals {
  return { lkr: 0, inr: 0, usd: 0 };
}

function normBatchKey(batch: string): string {
  return String(batch || '').trim().toLowerCase();
}

function parseExcludedMap(raw: string | null): ExcludedStudentPendingMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const legacy: ExcludedStudentPendingMap = {};
      for (const id of parsed) {
        if (typeof id === 'string' && id) legacy[id] = emptyTotals();
      }
      return legacy;
    }
    if (parsed && typeof parsed === 'object') {
      const map: ExcludedStudentPendingMap = {};
      for (const [id, val] of Object.entries(parsed)) {
        if (!id) continue;
        const v = val as Partial<PendingCurrencyTotals>;
        map[id] = {
          lkr: Number(v?.lkr) || 0,
          inr: Number(v?.inr) || 0,
          usd: Number(v?.usd) || 0,
        };
      }
      return map;
    }
  } catch {}
  return {};
}

export function loadExcludedStudentsForBatch(batch: string): ExcludedStudentPendingMap {
  try {
    return parseExcludedMap(localStorage.getItem(EXCL_STUDENTS_KEY_PREFIX + batch));
  } catch {
    return {};
  }
}

export function saveExcludedStudentsForBatch(batch: string, map: ExcludedStudentPendingMap): void {
  try {
    const key = EXCL_STUDENTS_KEY_PREFIX + batch;
    if (!Object.keys(map).length) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
}

/** All batches with at least one excluded student (norm key → batch label + ids). */
export function loadExcludedStudentsByBatch(): Map<string, ExcludedBatchInfo> {
  const result = new Map<string, ExcludedBatchInfo>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(EXCL_STUDENTS_KEY_PREFIX)) continue;
      const batchLabel = key.slice(EXCL_STUDENTS_KEY_PREFIX.length);
      const map = loadExcludedStudentsForBatch(batchLabel);
      const studentIds = new Set(Object.keys(map));
      if (studentIds.size) {
        result.set(normBatchKey(batchLabel), { batchLabel, studentIds });
      }
    }
  } catch {}
  return result;
}

export function sumExcludedPendingForBatch(batch: string): PendingCurrencyTotals {
  const map = loadExcludedStudentsForBatch(batch);
  return Object.values(map).reduce(
    (acc, t) => ({
      lkr: acc.lkr + (t.lkr || 0),
      inr: acc.inr + (t.inr || 0),
      usd: acc.usd + (t.usd || 0),
    }),
    emptyTotals(),
  );
}

/** Current-level pending for one student row — matches finance dashboard ongoing pending. */
export function currentLevelPendingFromStudentRow(row: {
  level?: string | null;
  langPendingLKR?: number;
  langPendingINR?: number;
  langPendingUSD?: number;
  levelSlots?: Partial<
    Record<string, { pendingLKR?: number; pendingINR?: number; pendingUSD?: number }>
  >;
}): PendingCurrencyTotals {
  const level = row.level || '';
  const slot = level ? row.levelSlots?.[level] : null;
  if (slot) {
    return {
      lkr: slot.pendingLKR ?? 0,
      inr: slot.pendingINR ?? 0,
      usd: slot.pendingUSD ?? 0,
    };
  }
  return {
    lkr: row.langPendingLKR ?? 0,
    inr: row.langPendingINR ?? 0,
    usd: row.langPendingUSD ?? 0,
  };
}

export function sumExcludedPendingFromStudentRows(
  students: Array<{ studentId: string } & Parameters<typeof currentLevelPendingFromStudentRow>[0]>,
  excludedIds: Set<string>,
): PendingCurrencyTotals {
  return students.reduce((acc, row) => {
    if (!excludedIds.has(row.studentId)) return acc;
    const pending = currentLevelPendingFromStudentRow(row);
    return {
      lkr: acc.lkr + pending.lkr,
      inr: acc.inr + pending.inr,
      usd: acc.usd + pending.usd,
    };
  }, emptyTotals());
}

/** Sum excluded current-level pending per batch (for finance dashboard). */
export function loadAllExcludedPendingByBatch(): Map<string, PendingCurrencyTotals> {
  const result = new Map<string, PendingCurrencyTotals>();
  for (const [normKey, info] of loadExcludedStudentsByBatch()) {
    const total = sumExcludedPendingForBatch(info.batchLabel);
    if (total.lkr > 0 || total.inr > 0 || total.usd > 0) {
      result.set(normKey, total);
    }
  }
  return result;
}

export function isStudentPendingExcluded(batch: string, studentId: string): boolean {
  return studentId in loadExcludedStudentsForBatch(batch);
}

export function toggleStudentPendingExclusion(
  batch: string,
  studentId: string,
  pending: PendingCurrencyTotals,
): boolean {
  const map = loadExcludedStudentsForBatch(batch);
  const excluded = studentId in map;
  if (excluded) {
    delete map[studentId];
  } else {
    map[studentId] = {
      lkr: pending.lkr || 0,
      inr: pending.inr || 0,
      usd: pending.usd || 0,
    };
  }
  saveExcludedStudentsForBatch(batch, map);
  return !excluded;
}

export function subtractExcludedPending(
  batch: string,
  pending: PendingCurrencyTotals,
  excludedByBatch?: Map<string, PendingCurrencyTotals>,
): PendingCurrencyTotals {
  const excl =
    excludedByBatch?.get(normBatchKey(batch)) ?? sumExcludedPendingForBatch(batch);
  return {
    lkr: Math.max(0, (pending.lkr || 0) - (excl.lkr || 0)),
    inr: Math.max(0, (pending.inr || 0) - (excl.inr || 0)),
    usd: Math.max(0, (pending.usd || 0) - (excl.usd || 0)),
  };
}
