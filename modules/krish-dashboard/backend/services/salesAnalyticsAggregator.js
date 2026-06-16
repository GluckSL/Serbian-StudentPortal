/**
 * salesAnalyticsAggregator — single aggregation pipeline producing all
 * dashboard analytics: hero totals, package breakdowns, service breakdowns.
 */
const SalesStudent = require('../models/SalesStudent');
const SalesStudentService = require('../models/SalesStudentService');
const { SERVICE_OPTED_CATALOG } = require('../models/SalesStudentService');
const { canonicalDocPaymentFromStudent, repairDocumentPaymentStatuses, normalizeServiceKey, canonicalServiceName, pickBestServiceLabel, mergeCountFields } = require('./fieldNormalizers');

const PACKAGES = ['PLATINUM', 'SILVER', 'VISA_DOCS'];
/** Statuses shown in package card breakdown (Finance Dashboard style). */
const CARD_BREAKDOWN_STATUSES = ['NOT_STARTED', 'UNCERTAIN', 'COMPLETED', 'WITHDREW'];

/** Count legacy HOLD rows as WITHDREW for analytics. */
function withdrewCond() {
  return { $in: ['$status', ['WITHDREW', 'HOLD']] };
}

let cache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 120_000;
let backfillDone = false;
let docPaymentRepairDone = false;

function invalidateCache() {
  cache = null;
  cacheExpiry = 0;
  backfillDone = false;
  docPaymentRepairDone = false;
}

const UNSPECIFIED_PROFESSION = 'Unspecified';

/** Clear profession values from old Stream/specialization import (not Professional column). */
async function repairStaleProfessionData() {
  const result = await SalesStudent.updateMany(
    {
      $and: [
        { profession: { $nin: [null, ''] } },
        { notes: { $not: /Professional:/i } },
      ],
    },
    { $set: { profession: '' } },
  );
  if (result.modifiedCount) {
    console.log(`[KrishDash] cleared ${result.modifiedCount} stale profession values`);
  }
  return result.modifiedCount || 0;
}

/** Backfill profession from CRM "Professional:" notes (not Specialization). */
async function ensureProfessionBackfill() {
  if (backfillDone) return;
  backfillDone = true;

  await repairStaleProfessionData();
  const students = await SalesStudent.find({
    $and: [
      { $or: [{ profession: { $in: [null, ''] } }, { profession: { $exists: false } }] },
      { notes: /Professional:\s*[^|]+/i },
    ],
  })
    .select('_id notes')
    .lean();

  if (!students.length) return;

  const bulk = [];
  for (const doc of students) {
    const match = String(doc.notes || '').match(/Professional:\s*([^|]+)/i);
    if (!match) continue;
    bulk.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { profession: match[1].trim() } },
      },
    });
  }
  if (bulk.length) {
    await SalesStudent.bulkWrite(bulk, { ordered: false });
  }
}

async function ensureDocPaymentRepair() {
  if (docPaymentRepairDone) return;
  docPaymentRepairDone = true;
  const modified = await repairDocumentPaymentStatuses(SalesStudent);
  if (modified) invalidateCache();
}

function mapProfessionRows(rows) {
  const byCanonical = {};
  for (const row of rows) {
    const rawName = row._id?.serviceName;
    if (!rawName) continue;
    const svcKey = normalizeServiceKey(rawName);
    if (!byCanonical[svcKey]) {
      byCanonical[svcKey] = { labelVariants: {}, professions: {} };
    }
    byCanonical[svcKey].labelVariants[rawName] =
      (byCanonical[svcKey].labelVariants[rawName] || 0) + (row.total || 0);

    const profession = row._id.profession || UNSPECIFIED_PROFESSION;
    if (!byCanonical[svcKey].professions[profession]) {
      byCanonical[svcKey].professions[profession] = {
        profession,
        label: profession,
        total: 0,
        ongoing: 0,
        notStarted: 0,
        uncertain: 0,
        completed: 0,
        withdrew: 0,
        hold: 0,
      };
    }
    mergeCountFields(byCanonical[svcKey].professions[profession], row);
  }

  const byService = {};
  for (const [svcKey, bucket] of Object.entries(byCanonical)) {
    const variants = Object.entries(bucket.labelVariants).map(([name, total]) => ({ name, total }));
    const label = canonicalServiceName(pickBestServiceLabel(variants));
    byService[label] = Object.values(bucket.professions).map((prof) => ({
      profession: prof.profession,
      label: prof.label,
      total: prof.total || 0,
      ongoing: prof.ongoing || 0,
      notStarted: prof.notStarted || 0,
      uncertain: prof.uncertain || 0,
      completed: prof.completed || 0,
      withdrew: (prof.withdrew || 0) + (prof.hold || 0),
      statusBreakdown: buildStatusBreakdown(prof),
    }));
  }
  return byService;
}

async function aggregateProfessionBreakdowns() {
  const rows = await SalesStudentService.aggregate([
    {
      $lookup: {
        from: 'sales_students',
        localField: 'salesStudentId',
        foreignField: '_id',
        as: 'student',
        pipeline: [{ $project: { status: 1, profession: 1 } }],
      },
    },
    { $unwind: '$student' },
    {
      $addFields: {
        professionLabel: {
          $let: {
            vars: {
              trimmed: { $trim: { input: { $ifNull: ['$student.profession', ''] } } },
            },
            in: {
              $cond: [{ $ne: ['$$trimmed', ''] }, '$$trimmed', UNSPECIFIED_PROFESSION],
            },
          },
        },
      },
    },
    {
      $group: {
        _id: { serviceName: '$serviceName', profession: '$professionLabel' },
        total: { $sum: 1 },
        ongoing: { $sum: { $cond: [{ $eq: ['$student.status', 'ONGOING'] }, 1, 0] } },
        notStarted: { $sum: { $cond: [{ $eq: ['$student.status', 'NOT_STARTED'] }, 1, 0] } },
        uncertain: { $sum: { $cond: [{ $eq: ['$student.status', 'UNCERTAIN'] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$student.status', 'COMPLETED'] }, 1, 0] } },
        withdrew: {
          $sum: { $cond: [{ $in: ['$student.status', ['WITHDREW', 'HOLD']] }, 1, 0] },
        },
        hold: { $sum: { $cond: [{ $eq: ['$student.status', 'HOLD'] }, 1, 0] } },
      },
    },
    { $sort: { '_id.serviceName': 1, total: -1, '_id.profession': 1 } },
  ]);

  return mapProfessionRows(rows);
}

/** All students by profession field — matches Excel / sheet-wide counts (not per service). */
async function aggregateSheetProfessionBreakdown() {
  const rows = await SalesStudent.aggregate([
    {
      $addFields: {
        professionLabel: {
          $let: {
            vars: {
              trimmed: { $trim: { input: { $ifNull: ['$profession', ''] } } },
            },
            in: {
              $cond: [{ $ne: ['$$trimmed', ''] }, '$$trimmed', UNSPECIFIED_PROFESSION],
            },
          },
        },
      },
    },
    {
      $group: {
        _id: '$professionLabel',
        total: { $sum: 1 },
        ongoing: { $sum: { $cond: [{ $eq: ['$status', 'ONGOING'] }, 1, 0] } },
        notStarted: { $sum: { $cond: [{ $eq: ['$status', 'NOT_STARTED'] }, 1, 0] } },
        uncertain: { $sum: { $cond: [{ $eq: ['$status', 'UNCERTAIN'] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
        withdrew: {
          $sum: { $cond: [{ $in: ['$status', ['WITHDREW', 'HOLD']] }, 1, 0] },
        },
        hold: { $sum: { $cond: [{ $eq: ['$status', 'HOLD'] }, 1, 0] } },
      },
    },
    { $sort: { total: -1, _id: 1 } },
  ]);

  return rows.map((row) => ({
    profession: row._id,
    label: row._id,
    total: row.total || 0,
    ongoing: row.ongoing || 0,
    notStarted: row.notStarted || 0,
    uncertain: row.uncertain || 0,
    completed: row.completed || 0,
    withdrew: (row.withdrew || 0) + (row.hold || 0),
    statusBreakdown: buildStatusBreakdown(row),
  }));
}

function buildStatusBreakdown(row, statuses = CARD_BREAKDOWN_STATUSES) {
  return statuses.map((status) => {
    let count = 0;
    if (status === 'WITHDREW') {
      count = (row.withdrew || 0) + (row.hold || 0);
    } else if (status === 'NOT_STARTED') {
      count = row.notStarted || 0;
    } else if (status === 'UNCERTAIN') {
      count = row.uncertain || 0;
    } else if (status === 'COMPLETED') {
      count = row.completed || 0;
    }
    return { status, count };
  });
}

function mapFacetRows(rows) {
  return rows.map((row) => ({
    value: row._id,
    label: row._id,
    total: row.total || 0,
    ongoing: row.ongoing || 0,
    notStarted: row.notStarted || 0,
    uncertain: row.uncertain || 0,
    completed: row.completed || 0,
    withdrew: (row.withdrew || 0) + (row.hold || 0),
    statusBreakdown: buildStatusBreakdown(row),
  }));
}

async function aggregateFieldFacet(fieldName, emptyLabel = UNSPECIFIED_PROFESSION) {
  const rows = await SalesStudent.aggregate([
    {
      $addFields: {
        facetLabel: {
          $let: {
            vars: {
              trimmed: { $trim: { input: { $ifNull: [`$${fieldName}`, ''] } } },
            },
            in: {
              $cond: [{ $ne: ['$$trimmed', ''] }, '$$trimmed', emptyLabel],
            },
          },
        },
      },
    },
    {
      $group: {
        _id: '$facetLabel',
        total: { $sum: 1 },
        ongoing: { $sum: { $cond: [{ $eq: ['$status', 'ONGOING'] }, 1, 0] } },
        notStarted: { $sum: { $cond: [{ $eq: ['$status', 'NOT_STARTED'] }, 1, 0] } },
        uncertain: { $sum: { $cond: [{ $eq: ['$status', 'UNCERTAIN'] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
        withdrew: {
          $sum: { $cond: [{ $in: ['$status', ['WITHDREW', 'HOLD']] }, 1, 0] },
        },
        hold: { $sum: { $cond: [{ $eq: ['$status', 'HOLD'] }, 1, 0] } },
      },
    },
    { $sort: { total: -1, _id: 1 } },
  ]);
  return mapFacetRows(rows);
}

async function aggregateCanonicalDocumentPayment() {
  const students = await SalesStudent.find({})
    .select('status documentPaymentStatus documentationStatus notes')
    .lean();

  const bucketMap = new Map();
  let docPaid = 0;

  for (const row of students) {
    const canonical = canonicalDocPaymentFromStudent(row);
    const label = canonical || UNSPECIFIED_PROFESSION;
    if (!bucketMap.has(label)) {
      bucketMap.set(label, {
        value: label,
        label,
        total: 0,
        ongoing: 0,
        notStarted: 0,
        uncertain: 0,
        completed: 0,
        withdrew: 0,
        hold: 0,
      });
    }
    const bucket = bucketMap.get(label);
    bucket.total += 1;
    const status = row.status;
    if (status === 'ONGOING') bucket.ongoing += 1;
    else if (status === 'NOT_STARTED') bucket.notStarted += 1;
    else if (status === 'UNCERTAIN') bucket.uncertain += 1;
    else if (status === 'COMPLETED') bucket.completed += 1;
    else if (status === 'WITHDREW' || status === 'HOLD') bucket.withdrew += 1;
    if (status === 'HOLD') bucket.hold += 1;
    if (canonical === 'Paid') docPaid += 1;
  }

  const facets = [...bucketMap.values()]
    .map((bucket) => ({
      value: bucket.value,
      label: bucket.label,
      total: bucket.total,
      ongoing: bucket.ongoing,
      notStarted: bucket.notStarted,
      uncertain: bucket.uncertain,
      completed: bucket.completed,
      withdrew: bucket.withdrew + bucket.hold,
      statusBreakdown: buildStatusBreakdown(bucket),
    }))
    .sort((a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label)));

  return { docPaid, facets };
}

async function getAnalytics() {
  const now = Date.now();
  if (cache && now < cacheExpiry) return cache;

  void ensureProfessionBackfill().catch((err) => {
    console.error('[KrishDash] profession backfill failed', err);
  });
  void ensureDocPaymentRepair().catch((err) => {
    console.error('[KrishDash] doc payment repair failed', err);
  });

  const [studentFacet, serviceFacet, professionBreakdowns, sheetProfessions, languageLevels, docPaymentAnalytics, documentationStatuses, visaStatuses] = await Promise.all([
    SalesStudent.aggregate([
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                ongoing: { $sum: { $cond: [{ $eq: ['$status', 'ONGOING'] }, 1, 0] } },
                notStarted: { $sum: { $cond: [{ $eq: ['$status', 'NOT_STARTED'] }, 1, 0] } },
                uncertain: { $sum: { $cond: [{ $eq: ['$status', 'UNCERTAIN'] }, 1, 0] } },
                completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
                withdrew: { $sum: { $cond: [withdrewCond(), 1, 0] } },
              },
            },
          ],
          byPackage: [
            {
              $group: {
                _id: '$package',
                total: { $sum: 1 },
                ongoing: { $sum: { $cond: [{ $eq: ['$status', 'ONGOING'] }, 1, 0] } },
                notStarted: { $sum: { $cond: [{ $eq: ['$status', 'NOT_STARTED'] }, 1, 0] } },
                uncertain: { $sum: { $cond: [{ $eq: ['$status', 'UNCERTAIN'] }, 1, 0] } },
                completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
                withdrew: { $sum: { $cond: [withdrewCond(), 1, 0] } },
                hold: { $sum: { $cond: [{ $eq: ['$status', 'HOLD'] }, 1, 0] } },
              },
            },
          ],
          byCounselor: [
            {
              $group: {
                _id: '$counselor',
                total: { $sum: 1 },
                ongoing: { $sum: { $cond: [{ $eq: ['$status', 'ONGOING'] }, 1, 0] } },
              },
            },
            { $sort: { total: -1 } },
            { $limit: 10 },
          ],
        },
      },
    ]),

    SalesStudentService.aggregate([
      {
        $lookup: {
          from: 'sales_students',
          localField: 'salesStudentId',
          foreignField: '_id',
          as: 'student',
          pipeline: [{ $project: { status: 1 } }],
        },
      },
      { $unwind: '$student' },
      {
        $group: {
          _id: '$serviceName',
          total: { $sum: 1 },
          ongoing: { $sum: { $cond: [{ $eq: ['$student.status', 'ONGOING'] }, 1, 0] } },
          notStarted: { $sum: { $cond: [{ $eq: ['$student.status', 'NOT_STARTED'] }, 1, 0] } },
          uncertain: { $sum: { $cond: [{ $eq: ['$student.status', 'UNCERTAIN'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$student.status', 'COMPLETED'] }, 1, 0] } },
          withdrew: {
            $sum: {
              $cond: [{ $in: ['$student.status', ['WITHDREW', 'HOLD']] }, 1, 0],
            },
          },
          hold: { $sum: { $cond: [{ $eq: ['$student.status', 'HOLD'] }, 1, 0] } },
        },
      },
      { $sort: { total: -1 } },
    ]),

    aggregateProfessionBreakdowns(),
    aggregateSheetProfessionBreakdown(),
    aggregateFieldFacet('currentLanguageLevel'),
    aggregateCanonicalDocumentPayment(),
    aggregateFieldFacet('documentationStatus'),
    aggregateFieldFacet('visaStatus'),
  ]);

  const raw = studentFacet[0];
  const totals = raw.totals[0] || {
    total: 0, ongoing: 0, notStarted: 0, uncertain: 0, completed: 0, withdrew: 0,
  };
  const documentPaymentStatuses = docPaymentAnalytics.facets;

  const pkgMap = {};
  for (const row of raw.byPackage) {
    pkgMap[row._id] = row;
  }
  const packages = PACKAGES.map((pkg) => {
    const r = pkgMap[pkg] || {};
    return {
      package: pkg,
      total: r.total || 0,
      ongoing: r.ongoing || 0,
      notStarted: r.notStarted || 0,
      uncertain: r.uncertain || 0,
      completed: r.completed || 0,
      withdrew: (r.withdrew || 0) + (r.hold || 0),
      statusBreakdown: buildStatusBreakdown(r),
    };
  });

  const svcMap = {};
  const svcLabelVariants = {};
  for (const row of serviceFacet) {
    if (!row._id) continue;
    const key = normalizeServiceKey(row._id);
    if (!svcMap[key]) {
      svcMap[key] = {
        total: 0,
        ongoing: 0,
        notStarted: 0,
        uncertain: 0,
        completed: 0,
        withdrew: 0,
        hold: 0,
      };
      svcLabelVariants[key] = {};
    }
    mergeCountFields(svcMap[key], row);
    svcLabelVariants[key][row._id] = (svcLabelVariants[key][row._id] || 0) + (row.total || 0);
  }

  const catalogKeys = SERVICE_OPTED_CATALOG.map((name) => normalizeServiceKey(name));
  const allKeys = [...new Set([...catalogKeys, ...Object.keys(svcMap)])];

  const services = allKeys.map((key) => {
    const r = svcMap[key] || {};
    const variants = Object.entries(svcLabelVariants[key] || {}).map(([name, total]) => ({ name, total }));
    const catalogLabel = SERVICE_OPTED_CATALOG.find((name) => normalizeServiceKey(name) === key);
    const label = canonicalServiceName(
      variants.length ? pickBestServiceLabel(variants) : (catalogLabel || key),
    );
    return {
      serviceName: label,
      label,
      total: r.total || 0,
      ongoing: r.ongoing || 0,
      notStarted: r.notStarted || 0,
      uncertain: r.uncertain || 0,
      completed: r.completed || 0,
      withdrew: (r.withdrew || 0) + (r.hold || 0),
      statusBreakdown: buildStatusBreakdown(r),
    };
  }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  const result = {
    totals: {
      total: totals.total,
      ongoing: totals.ongoing,
      notStarted: totals.notStarted || 0,
      uncertain: totals.uncertain,
      completed: totals.completed,
      withdrew: totals.withdrew,
      docPaid: docPaymentAnalytics.docPaid || 0,
    },
    packages,
    services,
    professionBreakdowns,
    sheetProfessions,
    languageLevels,
    documentPaymentStatuses,
    documentationStatuses,
    visaStatuses,
    counselors: raw.byCounselor.map((row) => ({
      value: row._id || UNSPECIFIED_PROFESSION,
      label: row._id || UNSPECIFIED_PROFESSION,
      total: row.total || 0,
      ongoing: row.ongoing || 0,
    })),
  };

  cache = result;
  cacheExpiry = now + CACHE_TTL_MS;
  return result;
}

/**
 * Profession breakdown for one service — served from analytics cache when warm.
 */
async function getServiceProfessionBreakdown(serviceName) {
  if (!serviceName) return [];
  const analytics = await getAnalytics();
  if (analytics.professionBreakdowns?.[serviceName]) {
    return analytics.professionBreakdowns[serviceName];
  }
  const key = normalizeServiceKey(serviceName);
  for (const [label, rows] of Object.entries(analytics.professionBreakdowns || {})) {
    if (normalizeServiceKey(label) === key) return rows;
  }
  return [];
}

module.exports = {
  getAnalytics,
  getServiceProfessionBreakdown,
  invalidateCache,
  repairStaleProfessionData,
  CARD_BREAKDOWN_STATUSES,
  SERVICE_OPTED_CATALOG,
  UNSPECIFIED_PROFESSION,
};
