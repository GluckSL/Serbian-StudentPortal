/**
 * Compare external CRM board records with portal students (by email).
 */
const axios = require('axios');
const User = require('../models/User');

const CRM_BASE =
  process.env.CRM_PORTAL_API_BASE ||
  'https://s3wpekt2qj.ap-south-1.awsapprunner.com/api/v1';
const CRM_TOKEN =
  process.env.WEB_FORM_API_KEY || process.env.CRM_PORTAL_API_TOKEN || 'GluckGlobalWeb2026';
const CRM_HEADERS = {
  Authorization: `Bearer ${CRM_TOKEN}`,
  'Content-Type': 'application/json',
};

const PAGE_LIMIT = 200;
const MAX_PAGES = 100;

function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function hasSimpleFilters(simple = {}) {
  return Object.entries(simple).some(([, v]) => String(v ?? '').trim() !== '');
}

function pickCrmRow(row, boardType) {
  const name =
    boardType === 'enrollment'
      ? row.candidateName || row.name || ''
      : row.name || row.candidateName || '';
  return {
    crmId: row.id || null,
    name: String(name).trim(),
    email: String(row.email || '').trim(),
    phone: String(row.phoneNumber || row.phone || '').trim(),
    whatsapp: String(row.whatsappNumber || '').trim(),
    status: String(row.currentStatus || row.status || '').trim(),
    package: String(row.packageOpted || '').trim(),
    batch: String(row.assignedBatch || row.batchNumber || '').trim(),
    enrolled:
      row.dateOfEnrollment || row.enrollmentDate || row.enrollment_date || '',
    counsellor: String(
      row.assignedSalesRepresentative || row.languageTeamAssignee || ''
    ).trim(),
  };
}

/** Prefer the row with the latest enrollment date when CRM has duplicate emails. */
function pickBetterCrmRow(a, b) {
  const dateA = String(a.enrolled || '');
  const dateB = String(b.enrolled || '');
  if (dateB > dateA) return b;
  if (dateA > dateB) return a;
  if ((b.crmId || 0) > (a.crmId || 0)) return b;
  return a;
}

/**
 * Collapse duplicate CRM rows (same email) so compare counts match unique students.
 */
function dedupeCrmRows(crmRows, boardType) {
  const byEmail = new Map();
  const noEmail = [];
  const seenNoEmailIds = new Set();

  for (const row of crmRows) {
    const picked = pickCrmRow(row, boardType);
    const emailNorm = normEmail(picked.email);

    if (!emailNorm) {
      const dedupeKey = picked.crmId != null ? `id:${picked.crmId}` : null;
      if (dedupeKey) {
        if (seenNoEmailIds.has(dedupeKey)) continue;
        seenNoEmailIds.add(dedupeKey);
      }
      noEmail.push(picked);
      continue;
    }

    const existing = byEmail.get(emailNorm);
    byEmail.set(emailNorm, existing ? pickBetterCrmRow(existing, picked) : picked);
  }

  const uniqueWithEmail = Array.from(byEmail.values());
  const unique = [...uniqueWithEmail, ...noEmail];
  const duplicatesSkipped = Math.max(0, crmRows.length - unique.length);

  return { unique, uniqueWithEmail, noEmail, duplicatesSkipped };
}

async function fetchAllCrmRecords(boardType, { simple = {}, advanced = null }) {
  const paths =
    boardType === 'enrollment'
      ? {
          list: '/sales-dashboard/enrollment-board',
          filter: '/sales-dashboard/enrollment-board/filter',
          advanced: '/sales-dashboard/enrollment-board/advanced/query',
        }
      : {
          list: '/students/language-team-board/filter',
          filter: '/students/language-team-board/filter',
          advanced: '/students/language-team-board/advanced/query',
        };

  const all = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    let response;

    if (advanced?.filters?.length) {
      response = await axios.post(
        `${CRM_BASE}${paths.advanced}`,
        {
          filters: advanced.filters,
          filterLogic: advanced.filterLogic || 'and',
          page,
          limit: PAGE_LIMIT,
        },
        { headers: CRM_HEADERS, timeout: 60000 }
      );
      const data = response.data || {};
      if (data.mode === 'grouped') {
        throw new Error('Compare is not available for grouped results. Clear group-by and try again.');
      }
      const items = data.data || data.items || [];
      all.push(...items);
      const pg = data.pagination || {};
      totalPages = pg.totalPages || data.totalPages || 1;
      if (!items.length) break;
    } else if (hasSimpleFilters(simple) || boardType === 'language') {
      response = await axios.get(`${CRM_BASE}${paths.filter}`, {
        headers: CRM_HEADERS,
        params: { ...simple, page, limit: PAGE_LIMIT },
        timeout: 60000,
      });
      const data = response.data || {};
      const items = data.data || [];
      all.push(...items);
      const pg = data.pagination || {};
      totalPages = pg.totalPages || 1;
      if (!items.length) break;
    } else {
      response = await axios.get(`${CRM_BASE}${paths.list}`, {
        headers: CRM_HEADERS,
        params: { page, limit: PAGE_LIMIT },
        timeout: 60000,
      });
      const data = response.data || {};
      const items = data.data || [];
      all.push(...items);
      const pg = data.pagination || {};
      totalPages = pg.totalPages || 1;
      if (!items.length) break;
    }

    page += 1;
  }

  return all;
}

async function loadPortalStudentEmails() {
  const students = await User.find({ role: 'STUDENT' })
    .select('email')
    .lean();
  const emails = new Set();
  for (const s of students) {
    const e = normEmail(s.email);
    if (e) emails.add(e);
  }
  return { portalTotal: students.length, portalEmailCount: emails.size, emails };
}

/**
 * @param {'enrollment'|'language'} boardType
 * @param {{ simple?: object, advanced?: { filters: object[], filterLogic?: string } | null }} query
 */
async function compareBoardWithPortal(boardType, query = {}) {
  const simple = query.simple || {};
  const advanced = query.advanced || null;

  const [crmRowsRaw, portal] = await Promise.all([
    fetchAllCrmRecords(boardType, { simple, advanced }),
    loadPortalStudentEmails(),
  ]);

  const { unique: crmRows, duplicatesSkipped } = dedupeCrmRows(crmRowsRaw, boardType);

  const missingFromPortal = [];
  const inPortal = [];
  const noEmailOnCrm = [];

  for (const picked of crmRows) {
    const emailNorm = normEmail(picked.email);

    if (!emailNorm) {
      noEmailOnCrm.push({ ...picked, reason: 'No email on CRM record' });
      missingFromPortal.push({ ...picked, reason: 'No email on CRM record' });
      continue;
    }

    if (portal.emails.has(emailNorm)) {
      inPortal.push(picked);
    } else {
      missingFromPortal.push({ ...picked, reason: 'Email not found in portal' });
    }
  }

  missingFromPortal.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return {
    boardType,
    crmTotal: crmRows.length,
    crmRawTotal: crmRowsRaw.length,
    crmDuplicatesSkipped: duplicatesSkipped,
    portalTotal: portal.portalTotal,
    portalWithEmail: portal.portalEmailCount,
    matchedInPortal: inPortal.length,
    missingFromPortal: missingFromPortal.length,
    missingNoEmail: noEmailOnCrm.length,
    missing: missingFromPortal,
    comparedAt: new Date().toISOString(),
  };
}

module.exports = { compareBoardWithPortal };
