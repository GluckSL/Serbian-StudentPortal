/**
 * salesCrmFetchService — pull live enrollment-board data from the external CRM
 * and upsert into sales_students (same path as spreadsheet import).
 */
const { fetchAllCrmRecords } = require('../../../../services/crmPortalCompare');
const { previewRows, commitImport } = require('./salesImportService');

function normEmail(v) {
  return String(v || '').trim().toLowerCase();
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
  return {
    'Candidate Name': row.candidateName || row.name || '',
    'Email Address': row.email || '',
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

/**
 * Fetch all enrollment-board students from CRM and upsert into SalesStudent.
 * @param {string|null} staffUserId
 */
async function fetchAndCommitFromCrm(staffUserId) {
  console.log('[KrishDash] CRM fetch started');
  const crmRowsRaw = await fetchAllCrmRecords('enrollment', { simple: {}, advanced: null });

  if (!crmRowsRaw.length) {
    return {
      imported: 0,
      updated: 0,
      merged: 0,
      failed: [],
      emailAdjusted: 0,
      duplicateNameCount: 0,
      crmRawTotal: 0,
      crmTotal: 0,
      crmDuplicatesSkipped: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  const { unique, duplicatesSkipped } = dedupeRawCrmRows(crmRowsRaw);
  const importRows = unique.map(crmRowToImportRow);
  const parsed = previewRows(importRows);
  const result = await commitImport(parsed.rows, staffUserId);

  console.log(
    `[KrishDash] CRM fetch done — CRM ${crmRowsRaw.length} rows, unique ${unique.length}, imported ${result.imported}, updated ${result.updated}, failed ${result.failed.length}`
  );

  return {
    ...result,
    crmRawTotal: crmRowsRaw.length,
    crmTotal: unique.length,
    crmDuplicatesSkipped: duplicatesSkipped,
    professionCount: parsed.professionCount,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { fetchAndCommitFromCrm, crmRowToImportRow, dedupeRawCrmRows };
