/**
 * salesCrmFetchService — pull live enrollment-board data from the external CRM
 * and mirror it into sales_students (upsert + remove stale rows).
 */
const SalesStudent = require('../models/SalesStudent');
const SalesStudentService = require('../models/SalesStudentService');
const { fetchAllCrmRecords } = require('../../../../services/crmPortalCompare');
const { previewRows, commitImport } = require('./salesImportService');
const { invalidateCache } = require('./salesAnalyticsAggregator');

function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}

/** Stable placeholder when CRM has no email — keyed by CRM id so re-fetch updates the same row. */
function crmPlaceholderEmail(row) {
  const id = String(row.id || '').trim();
  if (id) return `crm-${id}@sales-import.local`;
  return '';
}

/** Collapse duplicate CRM rows (same email); keep the row with the latest enrollment date. */
function dedupeRawCrmRows(rows) {
  const byEmail = new Map();
  const noEmail = [];
  const seenNoEmailIds = new Set();

  for (const row of rows) {
    const emailNorm = normEmail(row.email);

    if (!emailNorm) {
      const dedupeKey = row.id != null ? `id:${row.id}` : null;
      if (dedupeKey) {
        if (seenNoEmailIds.has(dedupeKey)) continue;
        seenNoEmailIds.add(dedupeKey);
      }
      noEmail.push(row);
      continue;
    }

    const existing = byEmail.get(emailNorm);
    if (!existing) {
      byEmail.set(emailNorm, row);
      continue;
    }

    const dateA = String(existing.dateOfEnrollment || '');
    const dateB = String(row.dateOfEnrollment || '');
    if (dateB > dateA) {
      byEmail.set(emailNorm, row);
    } else if (dateB === dateA && String(row.id || '') > String(existing.id || '')) {
      byEmail.set(emailNorm, row);
    }
  }

  const unique = [...byEmail.values(), ...noEmail];
  return {
    unique,
    duplicatesSkipped: Math.max(0, rows.length - unique.length),
  };
}

/** Map a CRM enrollment-board record to spreadsheet column names understood by salesImportService. */
function crmRowToImportRow(row) {
  const age = row.age;
  const email = String(row.email || '').trim() || crmPlaceholderEmail(row);
  return {
    'Candidate Name': row.candidateName || row.name || '',
    'Email Address': email,
    'Phone Number': row.phoneNumber || '',
    'WhatsApp Number': row.whatsappNumber || '',
    Age: age && age > 0 ? age : '',
    'Package Opted': row.packageOpted || '',
    'Current Status': row.currentStatus || '',
    'Assigned Sales Representative': row.assignedSalesRepresentative || '',
    'Service Opted': row.serviceOpted || '',
    'Lead Source': row.leadSource || '',
    'Professional Categories': row.professional || '',
    Specialization: row.specialization || '',
    'Current language level': row.currentLevel || row.languageLevelOpted || '',
    'Document Payment Status': row.documentPaymentStatus || '',
    'Documentation status': row.documentationStatusAfterRemaining || '',
    'Documentation Remarks': row.documentationRemarks || '',
    'Visa status': row.visaStatusAfterRemaining || '',
    Qualification: row.qualification || '',
    'Client Address': row.clientAddress || '',
  };
}

/** Remove overview students that are no longer on the CRM enrollment board. */
async function pruneStaleStudents(syncedEmails) {
  if (!syncedEmails.size) {
    return { removed: 0 };
  }

  const emailList = [...syncedEmails];
  const stale = await SalesStudent.find({ email: { $nin: emailList } }).select('_id email').lean();
  if (!stale.length) {
    return { removed: 0 };
  }

  const ids = stale.map((s) => s._id);
  await SalesStudentService.deleteMany({ salesStudentId: { $in: ids } });
  const del = await SalesStudent.deleteMany({ _id: { $in: ids } });
  return { removed: del.deletedCount || 0, removedEmails: stale.map((s) => s.email) };
}

/**
 * Fetch all enrollment-board students from CRM and mirror into SalesStudent.
 * @param {string|null} staffUserId
 * @param {{ crmRows?: object[] }} [options] — pass pre-fetched rows to skip a second CRM pull
 */
async function fetchAndCommitFromCrm(staffUserId, options = {}) {
  const started = Date.now();
  const reusedFetch = Array.isArray(options.crmRows);
  console.log(`[KrishDash] CRM fetch started${reusedFetch ? ' (reusing pre-fetched rows)' : ''}`);

  const crmRowsRaw = reusedFetch
    ? options.crmRows
    : await fetchAllCrmRecords('enrollment', { simple: {}, advanced: null });

  if (!crmRowsRaw.length) {
    const pruned = await pruneStaleStudents(new Set());
    invalidateCache();
    return {
      imported: 0,
      updated: 0,
      merged: 0,
      failed: [],
      emailAdjusted: 0,
      duplicateNameCount: 0,
      removed: pruned.removed,
      crmRawTotal: 0,
      crmTotal: 0,
      crmDuplicatesSkipped: 0,
      overviewTotal: 0,
      crmRowsRaw,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    };
  }

  const { unique, duplicatesSkipped } = dedupeRawCrmRows(crmRowsRaw);
  const importRows = unique.map(crmRowToImportRow);
  const parsed = previewRows(importRows);

  const syncedEmails = new Set(
    parsed.rows
      .map((r) => normEmail(r.record.email))
      .filter(Boolean)
  );

  const result = await commitImport(parsed.rows, staffUserId, { skipRepairs: true });
  const pruned = await pruneStaleStudents(syncedEmails);
  invalidateCache();

  const overviewTotal = await SalesStudent.countDocuments();

  console.log(
    `[KrishDash] CRM fetch done in ${Date.now() - started}ms — CRM ${unique.length}, overview ${overviewTotal}, imported ${result.imported}, updated ${result.updated}, removed ${pruned.removed}, failed ${result.failed.length}`
  );

  return {
    ...result,
    removed: pruned.removed,
    crmRawTotal: crmRowsRaw.length,
    crmTotal: unique.length,
    crmDuplicatesSkipped: duplicatesSkipped,
    overviewTotal,
    professionCount: parsed.professionCount,
    crmRowsRaw,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}

module.exports = { fetchAndCommitFromCrm, crmRowToImportRow, dedupeRawCrmRows, pruneStaleStudents };
