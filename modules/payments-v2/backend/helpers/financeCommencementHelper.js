/**
 * Next-level commencement date + projected collection for finance dashboard & emails.
 * Mirrors frontend payment-hub-finance-dashboard logic.
 */

const {
  buildLevelPriceMap,
  currentLevelTotalsForBatchRow,
} = require('./paymentHubStatsAggregator');

const TOTAL_JOURNEY_DAYS_BY_LEVEL = {
  A1: 42,
  A2: 84,
  B1: 145,
  B2: 200,
  C1: 200,
  C2: 200,
};

function dominantLevelFromCounts(levelCounts) {
  let best = null;
  let max = 0;
  for (const [lv, n] of Object.entries(levelCounts || {})) {
    const count = Number(n) || 0;
    if (count > max) {
      max = count;
      best = String(lv || '').trim().toUpperCase();
    }
  }
  return best || null;
}

function totalJourneyDaysForLevel(level) {
  const key = String(level || 'A1').trim().toUpperCase();
  return TOTAL_JOURNEY_DAYS_BY_LEVEL[key] ?? TOTAL_JOURNEY_DAYS_BY_LEVEL.A1;
}

function nextLevelAfter(currentLevel) {
  const map = { A1: 'A2', A2: 'B1', B1: 'B2' };
  return map[String(currentLevel || '').trim().toUpperCase()] || null;
}

function currentJourneyDayForBatchRow(batchRow) {
  if (batchRow.batchCurrentDay != null && Number.isFinite(Number(batchRow.batchCurrentDay))) {
    return Math.min(200, Math.max(1, Math.floor(Number(batchRow.batchCurrentDay))));
  }
  if (batchRow.maxStudentDay != null && Number.isFinite(Number(batchRow.maxStudentDay))) {
    return Math.min(200, Math.max(1, Math.floor(Number(batchRow.maxStudentDay))));
  }
  if (batchRow.avgJourneyDay != null && Number.isFinite(Number(batchRow.avgJourneyDay))) {
    return Math.min(200, Math.max(1, Math.floor(Number(batchRow.avgJourneyDay))));
  }
  return null;
}

function projectedNextLevelAmount(batchRow, catalog, nextLevel) {
  const students = batchRow.studentCount || 0;
  if (!nextLevel || students <= 0) {
    return { lkr: 0, inr: 0 };
  }

  const levelPriceMap = buildLevelPriceMap(catalog);
  const fee = levelPriceMap.get(String(nextLevel).toUpperCase()) || { LKR: 0, INR: 0 };
  const scoped = currentLevelTotalsForBatchRow(batchRow);
  const hasLkr = (scoped.expectedLKR || 0) + (scoped.receivedLKR || 0) + (scoped.pendingLKR || 0) > 0;
  const hasInr = (scoped.expectedINR || 0) + (scoped.receivedINR || 0) + (scoped.pendingINR || 0) > 0;

  return {
    lkr: hasLkr ? (fee.LKR || 0) * students : 0,
    inr: hasInr ? (fee.INR || 0) * students : 0,
  };
}

/**
 * @param {object} batchRow — row from aggregateBatchPaymentInsights
 * @param {object} catalog — PaymentHub catalog document
 * @param {string|null|undefined} manualDateIso — YYYY-MM-DD for old batches
 */
function computeCommencementForBatch(batchRow, catalog, manualDateIso) {
  const batchType = batchRow.batchType === 'old' ? 'old' : 'new';
  const dominantLevel = dominantLevelFromCounts(batchRow.levelCounts);
  const levelEndDay = totalJourneyDaysForLevel(dominantLevel);
  const currentDay = currentJourneyDayForBatchRow(batchRow);
  const nextLevel = nextLevelAfter(dominantLevel);

  let commenceDate = null;
  let daysUntil = null;

  if (batchType === 'new') {
    if (currentDay == null || !Number.isFinite(levelEndDay)) return null;
    daysUntil = levelEndDay - currentDay;
    commenceDate = new Date();
    commenceDate.setHours(0, 0, 0, 0);
    commenceDate.setDate(commenceDate.getDate() + daysUntil);
  } else {
    const iso = String(manualDateIso || '').trim();
    if (!iso) return null;
    commenceDate = new Date(iso);
    if (Number.isNaN(commenceDate.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dUtc = Date.UTC(
      commenceDate.getFullYear(),
      commenceDate.getMonth(),
      commenceDate.getDate(),
    );
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    daysUntil = Math.floor((dUtc - todayUtc) / 86400000);
  }

  const projected = projectedNextLevelAmount(batchRow, catalog, nextLevel);
  const isPast = daysUntil != null && daysUntil < 0;
  const isNear = daysUntil != null && !isPast && daysUntil < 5;

  return {
    dateStr: commenceDate.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
    dateIso: commenceDate.toISOString().slice(0, 10),
    daysUntil,
    isPast,
    isNear,
    nextLevel,
    amountLKR: projected.lkr,
    amountINR: projected.inr,
    batchType,
    currentLevel: dominantLevel,
  };
}

module.exports = {
  computeCommencementForBatch,
  dominantLevelFromCounts,
  totalJourneyDaysForLevel,
};
