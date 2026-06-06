/**
 * utils/analyticsFilters.js
 *
 * Shared MongoDB query filter fragments used by all analytics routes to
 * exclude test/internal student accounts from progress percentages and
 * completion metrics.
 *
 * Usage in a find / aggregate match:
 *
 *   const { EXCLUDE_TEST } = require('../utils/analyticsFilters');
 *
 *   // Simple find:
 *   User.find({ role: 'STUDENT', batch: bn, ...EXCLUDE_TEST })
 *
 *   // Aggregate $match:
 *   { $match: { role: 'STUDENT', batch: bn, ...EXCLUDE_TEST } }
 *
 *   // After $lookup on 'users', filter out test accounts:
 *   { $match: { 'student.isTestAccount': { $ne: true } } }
 *   (use EXCLUDE_TEST_LOOKUP for the dotted path)
 */

/** Add to User.find() / $match on the User collection directly. */
const EXCLUDE_TEST = { isTestAccount: { $ne: true } };

/** Add to a $match stage AFTER a $lookup that produces a 'student' field. */
const EXCLUDE_TEST_LOOKUP = { 'student.isTestAccount': { $ne: true } };

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive exact batch match (allows optional surrounding whitespace in DB values).
 * Same semantics as batch journey routes.
 */
function batchMatchFilter(batchVal) {
  const bn = String(batchVal || '').trim();
  if (!bn) return null;
  return new RegExp(`^\\s*${escapeRegExp(bn)}\\s*$`, 'i');
}

/**
 * Normalise batch query input (string, comma-separated string, or repeated query values).
 */
function parseBatchList(batchInput) {
  if (batchInput == null || batchInput === '') return [];
  const raw = Array.isArray(batchInput) ? batchInput : [batchInput];
  const out = [];
  for (const item of raw) {
    for (const part of String(item || '').split(',')) {
      const bn = part.trim();
      if (bn) out.push(bn);
    }
  }
  return [...new Set(out)];
}

/**
 * Mongo filter for one or more batches. Returns a RegExp or { $in: RegExp[] }.
 */
function batchMatchFilters(batchInput) {
  const batches = parseBatchList(batchInput);
  if (!batches.length) return null;
  const patterns = batches.map((b) => batchMatchFilter(b)).filter(Boolean);
  if (!patterns.length) return null;
  if (patterns.length === 1) return patterns[0];
  return { $in: patterns };
}

module.exports = {
  EXCLUDE_TEST,
  EXCLUDE_TEST_LOOKUP,
  batchMatchFilter,
  parseBatchList,
  batchMatchFilters,
};
