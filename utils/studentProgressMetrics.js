/**
 * Shared admin "overall progress" metrics (same weighting as Student Progress overview).
 */

const ALL_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * @param {object} student Lean user doc with level, languageLevelOpted, courseCompletionDates
 * @param {{ total: number, verified: number }} doc
 * @param {{ totalPackageAmount?: number, totalPaid?: number } | null} pay
 * @param {{ visaType?: string, stages?: { outcome?: string }[] } | null} visa
 */
function computeAdminProgressMetrics(student, doc, pay, visa) {
  const currentLevelIndex = ALL_LEVELS.indexOf(student.level);
  const opted = (student.languageLevelOpted || '').trim();
  let displayLevels;
  if (!opted) {
    displayLevels = ['A1', 'A2', 'B1', 'B2'];
  } else if (opted.includes('-')) {
    const [st, en] = opted.split('-');
    const si = ALL_LEVELS.indexOf(st);
    const ei = ALL_LEVELS.indexOf(en);
    displayLevels =
      si >= 0 && ei >= 0 && ei >= si ? ALL_LEVELS.slice(si, ei + 1) : ['A1', 'A2', 'B1', 'B2'];
  } else {
    const oi = ALL_LEVELS.indexOf(opted);
    displayLevels =
      oi >= 0 ? ALL_LEVELS.slice(0, Math.max(oi, currentLevelIndex) + 1) : ['A1', 'A2', 'B1', 'B2'];
  }

  const levelsCompleted = displayLevels.filter((lv) => {
    const li = ALL_LEVELS.indexOf(lv);
    return student.courseCompletionDates?.[`${lv}CompletionDate`] || li < currentLevelIndex;
  }).length;
  const learningPct = displayLevels.length
    ? Math.round((levelsCompleted / displayLevels.length) * 100)
    : 0;

  const safeDoc = doc || { total: 0, verified: 0 };
  const docsPct = safeDoc.total ? Math.round((safeDoc.verified / safeDoc.total) * 100) : 0;
  const payPct =
    pay && pay.totalPackageAmount ? Math.round((pay.totalPaid / pay.totalPackageAmount) * 100) : 0;

  let visaSteps = 0;
  let visaCurrent = 0;
  if (visa) {
    visaSteps = visa.visaType === 'au_pair' ? 5 : 6;
    if (visa.stages && visa.stages.length) {
      for (let i = 0; i < visa.stages.length; i++) {
        if (visa.stages[i].outcome !== 'completed') {
          visaCurrent = i;
          break;
        }
        if (i === visa.stages.length - 1) visaCurrent = i;
      }
    }
  }
  const visaPct = visaSteps > 1 ? Math.round((visaCurrent / (visaSteps - 1)) * 100) : 0;

  const overallPct = Math.round(learningPct * 0.4 + docsPct * 0.2 + payPct * 0.2 + visaPct * 0.2);

  return {
    learningPct,
    docsPct,
    payPct,
    visaPct,
    overallPct,
    levelsCompleted,
    totalLevels: displayLevels.length
  };
}

module.exports = { ALL_LEVELS, computeAdminProgressMetrics };
