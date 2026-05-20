/**
 * Detect portal student records that may explain CRM vs portal count gaps.
 */
const axios = require('axios');
const User = require('../models/User');

const MONDAY_COLUMN_VALUES_GQL =
  'id type text value ... on StatusValue { label } ... on DropdownValue { values { label } } ... on MirrorValue { display_value }';

function normEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  const match = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return match ? match[0] : '';
}

function mondayColumnDisplay(col) {
  if (!col) return '';
  if (col.text) return String(col.text).trim();
  if (col.value && col.type !== 'mirror') return String(col.value).trim();
  if (col.label) return String(col.label).trim();
  if (col.display_value) return String(col.display_value).trim();
  return '';
}

function mondayGet(columnValues, id) {
  const col = columnValues.find((c) => c.id === id);
  return mondayColumnDisplay(col);
}

async function fetchMondayBoardEmails() {
  const token = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;
  if (!token || !boardId) {
    return { emails: new Set(), error: 'Monday API not configured (MONDAY_API_TOKEN / MONDAY_BOARD_ID)' };
  }

  let allItems = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const query = cursor
      ? `query ($boardId: [ID!], $cursor: String!) { boards(ids: $boardId) { items_page(limit: 500, cursor: $cursor) { cursor items { id column_values { ${MONDAY_COLUMN_VALUES_GQL} } } } } } }`
      : `query ($boardId: [ID!]) { boards(ids: $boardId) { items_page(limit: 500) { cursor items { id column_values { ${MONDAY_COLUMN_VALUES_GQL} } } } } } }`;
    const variables = cursor ? { boardId: [boardId], cursor } : { boardId: [boardId] };
    const response = await axios.post(
      'https://api.monday.com/v2',
      { query, variables },
      { headers: { Authorization: token, 'Content-Type': 'application/json' } }
    );
    const page = response.data?.data?.boards?.[0]?.items_page;
    if (!page) break;
    allItems = allItems.concat(page.items || []);
    cursor = page.cursor;
    hasMore = !!cursor;
  }

  const emails = new Set();
  for (const item of allItems) {
    const email = normEmail(mondayGet(item.column_values, 'text_mkw3spks'));
    if (email) emails.add(email);
  }
  return { emails, mondayRowCount: allItems.length };
}

function studentRow(u, issueTypes, issueDetail, severity) {
  return {
    _id: String(u._id),
    regNo: u.regNo || '',
    name: u.name || '',
    email: u.email || '',
    batch: u.batch || '',
    level: u.level || '',
    subscription: u.subscription || '',
    studentStatus: u.studentStatus || '',
    crmExternalId: u.crmExternalId || '',
    issueTypes,
    issueDetail,
    severity
  };
}

/**
 * @returns {Promise<{ students: object[], summary: object, reconciliation: object|null, mondayError: string|null }>}
 */
async function computeStudentDataIssues() {
  const students = await User.find({ role: 'STUDENT' })
    .select('name email regNo batch level subscription studentStatus crmExternalId')
    .lean();

  const issues = [];
  const seenIds = new Set();

  const addIssue = (row) => {
    if (seenIds.has(row._id)) {
      const existing = issues.find((r) => r._id === row._id);
      if (existing) {
        for (const t of row.issueTypes) {
          if (!existing.issueTypes.includes(t)) existing.issueTypes.push(t);
        }
        if (row.severity === 'danger' && existing.severity !== 'danger') {
          existing.severity = 'danger';
        }
        existing.issueDetail = `${existing.issueDetail}; ${row.issueDetail}`;
      }
      return;
    }
    seenIds.add(row._id);
    issues.push(row);
  };

  // Duplicate emails
  const byEmail = new Map();
  for (const s of students) {
    const e = normEmail(s.email);
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e).push(s);
  }
  for (const [, group] of byEmail) {
    if (group.length <= 1) continue;
    for (const s of group) {
      const others = group.filter((x) => String(x._id) !== String(s._id));
      addIssue(
        studentRow(
          s,
          ['duplicate_email'],
          `Duplicate email — ${group.length} portal accounts (${others.map((o) => o.regNo || o.email).join(', ')})`,
          'danger'
        )
      );
    }
  }

  // Duplicate CRM ids
  const byCrm = new Map();
  for (const s of students) {
    const id = String(s.crmExternalId || '').trim();
    if (!id) continue;
    if (!byCrm.has(id)) byCrm.set(id, []);
    byCrm.get(id).push(s);
  }
  for (const [, group] of byCrm) {
    if (group.length <= 1) continue;
    for (const s of group) {
      addIssue(
        studentRow(
          s,
          ['duplicate_crm_id'],
          `Same Monday CRM id on ${group.length} portal accounts`,
          'danger'
        )
      );
    }
  }

  for (const s of students) {
    const email = String(s.email || '').trim();
    const normalized = normEmail(email);

    if (!normalized) {
      addIssue(
        studentRow(s, ['missing_email'], 'No valid email address', 'danger')
      );
      continue;
    }

    if (normalized.includes('@sync.gluckportal.local')) {
      addIssue(
        studentRow(s, ['placeholder_email'], 'Auto-generated CRM sync email (not a real inbox)', 'warning')
      );
    }

    if (!s.crmExternalId || !String(s.crmExternalId).trim()) {
      addIssue(
        studentRow(s, ['no_crm_link'], 'Not linked to a Monday CRM row (no CRM id)', 'warning')
      );
    }
  }

  let mondayError = null;
  let reconciliation = null;
  let mondayEmails = null;

  try {
    const monday = await fetchMondayBoardEmails();
    if (monday.error) {
      mondayError = monday.error;
    } else {
      mondayEmails = monday.emails;
      const portalTotal = students.length;
      let portalMatched = 0;
      for (const s of students) {
        const e = normEmail(s.email);
        if (e && mondayEmails.has(e)) portalMatched += 1;
      }
      const crmTarget = mondayEmails.size;
      const portalExtra = Math.max(0, portalTotal - portalMatched);

      reconciliation = {
        portalTotal,
        crmUniqueEmails: crmTarget,
        portalMatchedCrm: portalMatched,
        portalExtraNotOnCrm: portalExtra,
        mondayBoardRows: monday.mondayRowCount
      };

      for (const s of students) {
        const e = normEmail(s.email);
        if (!e || mondayEmails.has(e)) continue;
        addIssue(
          studentRow(
            s,
            ['portal_only'],
            'In portal but email not on Monday CRM board (~ extra vs CRM count)',
            'warning'
          )
        );
      }
    }
  } catch (err) {
    mondayError = err.message || 'Failed to load Monday board';
  }

  const byType = {
    duplicate_email: 0,
    duplicate_crm_id: 0,
    missing_email: 0,
    placeholder_email: 0,
    no_crm_link: 0,
    portal_only: 0
  };
  for (const row of issues) {
    for (const t of row.issueTypes) {
      if (byType[t] != null) byType[t] += 1;
    }
  }

  issues.sort((a, b) => {
    if (a.severity === 'danger' && b.severity !== 'danger') return -1;
    if (b.severity === 'danger' && a.severity !== 'danger') return 1;
    return (a.regNo || '').localeCompare(b.regNo || '', undefined, { numeric: true });
  });

  return {
    students: issues,
    summary: {
      totalIssueRows: issues.length,
      dangerCount: issues.filter((r) => r.severity === 'danger').length,
      warningCount: issues.filter((r) => r.severity === 'warning').length,
      byType
    },
    reconciliation,
    mondayError
  };
}

module.exports = { computeStudentDataIssues, normEmail };
