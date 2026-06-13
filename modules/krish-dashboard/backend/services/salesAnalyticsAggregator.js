/**
 * salesAnalyticsAggregator — single aggregation pipeline producing all
 * dashboard analytics: hero totals, package breakdowns, service breakdowns.
 */
const SalesStudent = require('../models/SalesStudent');
const SalesStudentService = require('../models/SalesStudentService');
const { SERVICE_OPTED_CATALOG } = require('../models/SalesStudentService');

const PACKAGES = ['PLATINUM', 'SILVER', 'VISA_DOCS'];
/** Statuses shown in package card breakdown (Finance Dashboard style). */
const CARD_BREAKDOWN_STATUSES = ['UNCERTAIN', 'COMPLETED', 'WITHDREW'];

/** Count legacy HOLD rows as WITHDREW for analytics. */
function withdrewCond() {
  return { $in: ['$status', ['WITHDREW', 'HOLD']] };
}

let cache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 120_000;
let backfillDone = false;

function invalidateCache() {
  cache = null;
  cacheExpiry = 0;
  backfillDone = false;
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

function mapProfessionRows(rows) {
  const byService = {};
  for (const row of rows) {
    const serviceName = row._id?.serviceName;
    if (!serviceName) continue;
    if (!byService[serviceName]) byService[serviceName] = [];
    byService[serviceName].push({
      profession: row._id.profession || UNSPECIFIED_PROFESSION,
      label: row._id.profession || UNSPECIFIED_PROFESSION,
      total: row.total || 0,
      ongoing: row.ongoing || 0,
      uncertain: row.uncertain || 0,
      completed: row.completed || 0,
      withdrew: (row.withdrew || 0) + (row.hold || 0),
      statusBreakdown: buildStatusBreakdown(row),
    });
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

async function getAnalytics() {
  const now = Date.now();
  if (cache && now < cacheExpiry) return cache;

  await ensureProfessionBackfill();

  const [studentFacet, serviceFacet, professionBreakdowns, sheetProfessions, languageLevels, documentPaymentStatuses, documentationStatuses, visaStatuses] = await Promise.all([
    SalesStudent.aggregate([
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                ongoing: { $sum: { $cond: [{ $eq: ['$status', 'ONGOING'] }, 1, 0] } },
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
    aggregateFieldFacet('documentPaymentStatus'),
    aggregateFieldFacet('documentationStatus'),
    aggregateFieldFacet('visaStatus'),
  ]);

  const raw = studentFacet[0];
  const totals = raw.totals[0] || {
    total: 0, ongoing: 0, uncertain: 0, completed: 0, withdrew: 0,
  };

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
      uncertain: r.uncertain || 0,
      completed: r.completed || 0,
      withdrew: (r.withdrew || 0) + (r.hold || 0),
      statusBreakdown: buildStatusBreakdown(r),
    };
  });

  const svcMap = {};
  for (const row of serviceFacet) {
    if (row._id) svcMap[row._id] = row;
  }

  const allServiceNames = [
    ...SERVICE_OPTED_CATALOG,
    ...Object.keys(svcMap).filter((n) => !SERVICE_OPTED_CATALOG.includes(n)),
  ];
  const uniqueNames = [...new Set(allServiceNames)];

  const services = uniqueNames.map((name) => {
    const r = svcMap[name] || {};
    return {
      serviceName: name,
      label: name,
      total: r.total || 0,
      ongoing: r.ongoing || 0,
      uncertain: r.uncertain || 0,
      completed: r.completed || 0,
      withdrew: (r.withdrew || 0) + (r.hold || 0),
      statusBreakdown: buildStatusBreakdown(r),
    };
  });

  const result = {
    totals: {
      total: totals.total,
      ongoing: totals.ongoing,
      uncertain: totals.uncertain,
      completed: totals.completed,
      withdrew: totals.withdrew,
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
  return analytics.professionBreakdowns?.[serviceName] || [];
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
