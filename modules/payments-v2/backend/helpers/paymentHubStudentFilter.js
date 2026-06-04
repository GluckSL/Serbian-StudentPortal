/**
 * Shared student filters for Payment Hub table + dashboard stats.
 */
const mongoose = require('mongoose');
const { JOURNEY_DUE_FROM_DAY } = require('./languageFeeStatus');

function parseHubFilters(query = {}) {
  return {
    batch: query.batch ? String(query.batch).trim() : '',
    level: query.level ? String(query.level).trim() : '',
    languageFeeStatus: String(query.languageFeeStatus || '').trim().toUpperCase(),
    studentStatus: String(query.studentStatus || '').trim(),
    subscription: String(query.subscription || '').trim(),
    search: String(query.search || '').trim(),
    dateFrom: query.dateFrom || null,
    dateTo: query.dateTo || null,
    currency: query.currency ? String(query.currency).trim().toUpperCase() : '',
  };
}

/** Filters that narrow which students are included (not currency-only). */
function hasStudentFilters(filters) {
  return !!(
    filters.batch ||
    filters.level ||
    filters.languageFeeStatus ||
    filters.studentStatus ||
    filters.subscription ||
    filters.search ||
    filters.dateFrom ||
    filters.dateTo
  );
}

function hasActiveFilters(filters) {
  return hasStudentFilters(filters) || !!filters.currency;
}

function buildStudentFilterPipeline(filters) {
  const userMatch = { role: 'STUDENT' };
  if (filters.batch) userMatch.batch = filters.batch;
  if (filters.level) userMatch.level = filters.level;
  if (filters.studentStatus) userMatch.studentStatus = filters.studentStatus;
  if (filters.subscription) userMatch.subscription = filters.subscription;
  if (filters.search) {
    userMatch.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { email: { $regex: filters.search, $options: 'i' } },
    ];
  }
  if (filters.dateFrom || filters.dateTo) {
    userMatch.enrollmentDate = {};
    if (filters.dateFrom) userMatch.enrollmentDate.$gte = new Date(filters.dateFrom);
    if (filters.dateTo) userMatch.enrollmentDate.$lte = new Date(filters.dateTo);
  }

  const pipeline = [
    { $match: userMatch },
    {
      $lookup: {
        from: 'studentpaymentprofiles',
        localField: '_id',
        foreignField: 'studentId',
        as: 'profileArr',
      },
    },
    { $addFields: { profile: { $arrayElemAt: ['$profileArr', 0] } } },
    {
      $lookup: {
        from: 'paymentrequests',
        let: { studentId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$studentId', '$$studentId'] },
              paymentType: 'LANGUAGE_FEE',
              isArchived: false,
              amountRemaining: { $gt: 0 },
              status: { $nin: ['REJECTED', 'FULLY_PAID'] },
            },
          },
          { $group: { _id: null, balance: { $sum: '$amountRemaining' } } },
        ],
        as: 'langFeeAgg',
      },
    },
    {
      $addFields: {
        languageFeeBalance: {
          $ifNull: [{ $arrayElemAt: ['$langFeeAgg.balance', 0] }, 0],
        },
        journeyDay: {
          $min: [
            200,
            {
              $max: [
                1,
                {
                  $cond: [
                    {
                      $and: [
                        { $ne: ['$currentCourseDay', null] },
                        { $gte: ['$currentCourseDay', 1] },
                      ],
                    },
                    { $floor: '$currentCourseDay' },
                    1,
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        languageFeeStatus: {
          $cond: {
            if: { $lte: ['$languageFeeBalance', 0] },
            then: 'FULL_PAID',
            else: {
              $cond: {
                if: { $lt: ['$journeyDay', JOURNEY_DUE_FROM_DAY] },
                then: 'BALANCE',
                else: 'DUE',
              },
            },
          },
        },
      },
    },
  ];

  const feeStatus = filters.languageFeeStatus;
  if (feeStatus && ['FULL_PAID', 'BALANCE', 'DUE'].includes(feeStatus)) {
    pipeline.push({ $match: { languageFeeStatus: feeStatus } });
  }

  return pipeline;
}

/**
 * @returns {{ filters: object, studentIds: import('mongoose').Types.ObjectId[] | null }}
 *   studentIds null = no filter (all students); [] = no matches
 */
async function getFilteredStudentIds(query = {}) {
  const filters = parseHubFilters(query);
  if (!hasStudentFilters(filters)) {
    return { filters, studentIds: null };
  }

  const User = mongoose.model('User');
  const pipeline = buildStudentFilterPipeline(filters);
  pipeline.push({ $project: { _id: 1 } });
  const rows = await User.aggregate(pipeline);
  return { filters, studentIds: rows.map((r) => r._id) };
}

function filterSummaryLabel(filters) {
  const parts = [];
  if (filters.batch) parts.push(`Batch ${filters.batch}`);
  if (filters.level) parts.push(`Level ${filters.level}`);
  if (filters.subscription) parts.push(filters.subscription.replace(/_/g, ' '));
  if (filters.studentStatus) parts.push(filters.studentStatus);
  if (filters.languageFeeStatus) parts.push(`Lang fee: ${filters.languageFeeStatus}`);
  if (filters.currency) parts.push(filters.currency);
  if (filters.search) parts.push(`Search "${filters.search}"`);
  if (filters.dateFrom || filters.dateTo) parts.push('Date range');
  return parts.length ? parts.join(' · ') : 'All students';
}

module.exports = {
  parseHubFilters,
  hasStudentFilters,
  hasActiveFilters,
  buildStudentFilterPipeline,
  getFilteredStudentIds,
  filterSummaryLabel,
};
