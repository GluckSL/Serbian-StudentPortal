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

function slotExpectedTotals(slot) {
  if (!slot) return { lkr: 0, inr: 0 };
  const lkr = slot.expectedLKR || 0;
  const inr = slot.expectedINR || 0;
  return {
    lkr: lkr > 0 ? lkr : (slot.receivedLKR || 0) + (slot.pendingLKR || 0) + (slot.overdueLKR || 0),
    inr: inr > 0 ? inr : (slot.receivedINR || 0) + (slot.pendingINR || 0) + (slot.overdueINR || 0),
  };
}

function projectedNextLevelAmount(batchRow, catalog, nextLevel, currentLevel) {
  const students = batchRow.studentCount || 0;
  if (!nextLevel || students <= 0) {
    return { lkr: 0, inr: 0 };
  }

  const levelPriceMap = buildLevelPriceMap(catalog);
  const nextFee = levelPriceMap.get(String(nextLevel).toUpperCase()) || { LKR: 0, INR: 0 };
  const currentLevelKey = String(currentLevel || dominantLevelFromCounts(batchRow.levelCounts) || 'A1')
    .trim()
    .toUpperCase();
  const currentFee = levelPriceMap.get(currentLevelKey) || { LKR: 0, INR: 0 };
  const currentSlot = batchRow.levelSlots && batchRow.levelSlots[currentLevelKey];
  const { lkr: currentExpectedLkr, inr: currentExpectedInr } = slotExpectedTotals(currentSlot);

  let lkrStudents = 0;
  let inrStudents = 0;
  if (currentFee.LKR > 0 && currentExpectedLkr > 0) {
    lkrStudents = Math.round(currentExpectedLkr / currentFee.LKR);
  }
  if (currentFee.INR > 0 && currentExpectedInr > 0) {
    inrStudents = Math.round(currentExpectedInr / currentFee.INR);
  }

  let lkr = lkrStudents > 0 ? (nextFee.LKR || 0) * lkrStudents : 0;
  let inr = inrStudents > 0 ? (nextFee.INR || 0) * inrStudents : 0;
  if (lkr === 0 && inr === 0 && students > 0) {
    if (currentExpectedLkr > 0 && nextFee.LKR > 0) {
      lkr = nextFee.LKR * students;
    } else if (currentExpectedInr > 0 && nextFee.INR > 0) {
      inr = nextFee.INR * students;
    }
  }

  return { lkr, inr };
}

/**
 * @param {object} batchRow — row from aggregateBatchPaymentInsights
 * @param {object} catalog — PaymentHub catalog document
 * @param {string|null|undefined} manualDateIso — YYYY-MM-DD for old batches
 * @param {{ lkr?: number, inr?: number }|null|undefined} manualAmounts — admin override for projected collection
 */
function computeCommencementForBatch(batchRow, catalog, manualDateIso, manualAmounts) {
  const batchType = batchRow.batchType === 'old' ? 'old' : 'new';
  const dominantLevel = dominantLevelFromCounts(batchRow.levelCounts);
  const levelEndDay = totalJourneyDaysForLevel(dominantLevel);
  const currentDay = currentJourneyDayForBatchRow(batchRow);
  const nextLevel = nextLevelAfter(dominantLevel);

  let commenceDate = null;
  let daysUntil = null;
  const manualIso = String(manualDateIso || '').trim();

  if (manualIso) {
    commenceDate = new Date(manualIso);
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
  } else if (batchType === 'new') {
    if (currentDay == null || !Number.isFinite(levelEndDay)) return null;
    daysUntil = levelEndDay - currentDay;
    commenceDate = new Date();
    commenceDate.setHours(0, 0, 0, 0);
    commenceDate.setDate(commenceDate.getDate() + daysUntil);
  } else {
    return null;
  }

  const projected = projectedNextLevelAmount(batchRow, catalog, nextLevel, dominantLevel);
  const hasManualLkr = manualAmounts?.lkr != null && Number.isFinite(Number(manualAmounts.lkr));
  const hasManualInr = manualAmounts?.inr != null && Number.isFinite(Number(manualAmounts.inr));
  const amountLKR = hasManualLkr ? Math.round(Number(manualAmounts.lkr)) : projected.lkr;
  const amountINR = hasManualInr ? Math.round(Number(manualAmounts.inr)) : projected.inr;
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
    amountLKR,
    amountINR,
    isManualAmount: hasManualLkr || hasManualInr,
    batchType,
    currentLevel: dominantLevel,
  };
}

module.exports = {
  computeCommencementForBatch,
  dominantLevelFromCounts,
  totalJourneyDaysForLevel,
};
