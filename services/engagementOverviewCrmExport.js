// services/engagementOverviewCrmExport.js
// Aggregates all four Batch Engagement Overview tabs into a single payload
// for the CRM developer export API.
//
// Data sources:
//   Learning  — engagementOverviewService  (full per-student detail)
//   Classes   — classAttendanceOverviewService  (already includes students)
//   Payment   — paymentOverviewService  (already includes students)
//   Overall   — computed here, same logic as EngagementOverviewComponent

'use strict';

const {
  getEngagementOverview,
  getSingleBatchEngagement,
} = require('./engagementOverviewService');
const { getClassAttendanceOverview } = require('./classAttendanceOverviewService');
const { getPaymentOverview } = require('./paymentOverviewService');

// ── Band helpers (mirror of EngagementOverviewComponent) ─────────────────────

function dominantBatchColor(bands) {
  if (bands.red >= bands.yellow && bands.red >= bands.green) return 'red';
  if (bands.yellow >= bands.green) return 'yellow';
  return 'green';
}

function worstColor(colors) {
  if (!colors.length) return 'green';
  if (colors.includes('red')) return 'red';
  if (colors.includes('yellow')) return 'yellow';
  return 'green';
}

// ── Totals helpers ────────────────────────────────────────────────────────────

function learningTotals(batches) {
  let red = 0, yellow = 0, green = 0, fiveToSix = 0, students = 0;
  for (const b of batches) {
    red += b.bands.red;
    yellow += b.bands.yellow;
    green += b.bands.green;
    fiveToSix += b.bands.fiveToSix ?? 0;
    students += b.studentCount;
  }
  const pct = (n) => (students ? Math.round((n / students) * 100) : 0);
  return {
    batches: batches.length, students,
    red, yellow, green, fiveToSix,
    redPct: pct(red), yellowPct: pct(yellow), greenPct: pct(green),
  };
}

function attendanceTotals(batches) {
  let red = 0, yellow = 0, green = 0, students = 0;
  for (const b of batches) {
    red += b.bands.red;
    yellow += b.bands.yellow;
    green += b.bands.green;
    students += b.studentCount;
  }
  const pct = (n) => (students ? Math.round((n / students) * 100) : 0);
  return {
    batches: batches.length, students,
    red, yellow, green,
    redPct: pct(red), yellowPct: pct(yellow), greenPct: pct(green),
  };
}

function overallTotals(batches) {
  let green = 0, yellow = 0, red = 0;
  for (const b of batches) {
    if (b.overall === 'green') green++;
    else if (b.overall === 'yellow') yellow++;
    else red++;
  }
  return { total: batches.length, green, yellow, red };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Build the full engagement overview export payload.
 *
 * @param {object} opts
 * @param {boolean} [opts.lite=false]  When true, strip students[] from every
 *   batch — useful for lightweight polling jobs that only need band counts.
 */
async function buildEngagementExport({ lite = false } = {}) {
  // Fetch all three data sources in parallel.
  // Learning overview returns lite=true (bands only) — used for batch discovery.
  const [learningOverview, classOverview, paymentOverview] = await Promise.all([
    getEngagementOverview(),
    getClassAttendanceOverview(),
    getPaymentOverview(),
  ]);

  // Expand each learning batch to full per-student detail (unless lite mode).
  let learningBatches;
  if (lite) {
    learningBatches = learningOverview.batches;
  } else {
    learningBatches = await Promise.all(
      learningOverview.batches.map(async (b) => {
        const full = await getSingleBatchEngagement(b.batchName, b.selectedWeek ?? undefined);
        // Fall back to the lite summary if the full fetch fails for any reason.
        return full || b;
      })
    );
  }

  const classBatches = lite
    ? classOverview.batches.map(({ students: _s, ...rest }) => rest)
    : classOverview.batches;

  const paymentBatches = lite
    ? paymentOverview.batches.map(({ students: _s, ...rest }) => rest)
    : paymentOverview.batches;

  // Build Overall tab — same merge logic as the Angular component.
  const lMap = new Map(learningBatches.map((b) => [b.batchName, b]));
  const cMap = new Map(classBatches.map((b) => [b.batchName, b]));
  const pMap = new Map(paymentBatches.map((b) => [b.batchName, b]));
  const allNames = new Set([...lMap.keys(), ...cMap.keys(), ...pMap.keys()]);

  const batchNo = (name) => {
    const m = String(name || '').match(/\d+/);
    return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
  };

  const overallBatches = Array.from(allNames)
    .sort((a, b) => batchNo(a) - batchNo(b))
    .map((name) => {
      const lb = lMap.get(name);
      const cb = cMap.get(name);
      const pb = pMap.get(name);
      const lColor = lb ? dominantBatchColor(lb.bands) : null;
      const cColor = cb ? dominantBatchColor(cb.bands) : null;
      const pColor = pb ? dominantBatchColor(pb.bands) : null;
      const available = [lColor, cColor, pColor].filter(Boolean);
      return {
        batchName: name,
        batchType: lb?.batchType ?? cb?.batchType ?? pb?.batchType ?? 'new',
        studentCount: lb?.studentCount ?? cb?.studentCount ?? pb?.studentCount ?? 0,
        overall: worstColor(available),
        learning: lColor,
        classes: cColor,
        payment: pColor,
      };
    });

  return {
    generatedAt: new Date(),
    source: 'gluck-portal-engagement-overview',
    tabs: {
      learning: {
        targetHours: learningOverview.targetHours,
        totalWeeks: learningOverview.totalWeeks,
        totals: learningTotals(learningBatches),
        batches: learningBatches,
      },
      classes: {
        totals: attendanceTotals(classBatches),
        batches: classBatches,
      },
      payment: {
        totals: attendanceTotals(paymentBatches),
        batches: paymentBatches,
      },
      overall: {
        totals: overallTotals(overallBatches),
        batches: overallBatches,
      },
    },
  };
}

module.exports = { buildEngagementExport };
