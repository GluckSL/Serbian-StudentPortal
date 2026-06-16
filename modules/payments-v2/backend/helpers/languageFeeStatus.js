/** Journey day below this → remaining language fee is "Balance"; from this day onward → "Due". */
const JOURNEY_DUE_FROM_DAY = 10;

function normalizeJourneyDay(day) {
  const n = parseInt(String(day), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(200, Math.max(1, n));
}

/**
 * @param {number} languageFeeBalance - Sum of open LANGUAGE_FEE amountRemaining
 * @param {number|null|undefined} journeyDay - Student currentCourseDay
 * @returns {'FULL_PAID'|'BALANCE'|'DUE'}
 */
function computeLanguageFeeStatus(languageFeeBalance, journeyDay) {
  const bal = Number(languageFeeBalance) || 0;
  if (bal <= 0) return 'FULL_PAID';
  const day = normalizeJourneyDay(journeyDay);
  return day < JOURNEY_DUE_FROM_DAY ? 'BALANCE' : 'DUE';
}

module.exports = {
  JOURNEY_DUE_FROM_DAY,
  normalizeJourneyDay,
  computeLanguageFeeStatus,
};
