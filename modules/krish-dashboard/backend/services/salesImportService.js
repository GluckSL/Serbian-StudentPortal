/**
 * salesImportService — CSV/XLSX bulk import for Sales students.
 *
 * ISOLATION RULE: writes only to sales_students and sales_student_services.
 * Never reads or writes User (Language Team) records.
 */
const SalesStudent = require('../models/SalesStudent');
const SalesStudentService = require('../models/SalesStudentService');
const { invalidateCache, repairStaleProfessionData } = require('./salesAnalyticsAggregator');
const { normalizeDocumentPaymentStatus, repairDocumentPaymentStatuses, canonicalServiceName } = require('./fieldNormalizers');

const VALID_PACKAGES = ['PLATINUM', 'SILVER', 'VISA_DOCS'];
const VALID_STATUSES = ['NOT_STARTED', 'UNCERTAIN', 'ONGOING', 'COMPLETED', 'WITHDREW'];

/** Normalize a spreadsheet header for fuzzy matching. */
function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Build a lookup from normalized header → cell value. */
function buildRowLookup(raw) {
  const lookup = {};
  if (!raw || typeof raw !== 'object') return lookup;
  for (const [key, value] of Object.entries(raw)) {
    lookup[normalizeHeader(key)] = value;
  }
  return lookup;
}

/** Pick the first non-empty value matching any normalized alias. */
function pickField(lookup, aliases) {
  for (const alias of aliases) {
    const val = lookup[normalizeHeader(alias)];
    if (val != null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

function normalizeStr(v) {
  return String(v || '').trim();
}

/**
 * Pick a CRM column by alias list, then fuzzy header matching.
 * preferIncludes: when multiple keys match, rank headers containing these substrings first.
 */
function pickByHeaderHints(lookup, raw, {
  aliases = [],
  mustInclude = [],
  mustExclude = [],
  preferIncludes = [],
} = {}) {
  const direct = pickField(lookup, aliases);
  if (direct) return direct;

  const candidates = [];

  const consider = (key, value) => {
    if (mustExclude.some((ex) => key.includes(ex))) return;
    if (mustInclude.length && !mustInclude.every((inc) => key.includes(inc))) return;
    const v = normalizeStr(value);
    if (!v) return;
    const score = preferIncludes.reduce(
      (sum, inc) => sum + (key.includes(inc) ? 1 : 0),
      0,
    );
    candidates.push({ key, value: v, score });
  };

  for (const [key, value] of Object.entries(lookup)) {
    consider(key, value);
  }
  if (raw && typeof raw === 'object') {
    for (const [header, value] of Object.entries(raw)) {
      consider(normalizeHeader(header), value);
    }
  }

  if (!candidates.length) return '';
  candidates.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return candidates[0].value;
}

/** Canonical labels from CRM "Professional Categories" column. */
function normalizeProfessionValue(raw) {
  const v = normalizeStr(raw);
  if (!v) return '';

  const key = v
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*&\s*/g, ' & ')
    .trim();

  const canonical = {
    'it professional': 'IT Professional',
    'it proffessional': 'IT Professional',
    nurse: 'Nurse',
    nursing: 'Nurse',
    'registered nurse': 'Nurse',
    'staff nurse': 'Nurse',
    engineer: 'Engineer',
    'mechanical engineer': 'Engineer',
    'software engineer': 'Engineer',
    'software engg': 'IT Professional',
    'software engineering': 'IT Professional',
    'health professional': 'Health professional',
    'healthcare professional': 'Health professional',
    agriculture: 'Agriculture',
    'hotel management': 'Hotel Management',
    doctor: 'Doctor',
    'food technology': 'Food Technology',
    administration: 'Administration',
    others: 'Others',
    other: 'Others',
    'o/l': 'O/L',
    'a/l': 'A/L',
    'o l & a l': 'O L & A L',
    'o/l & a/l': 'O L & A L',
    'ol & al': 'O L & A L',
  };

  if (canonical[key]) return canonical[key];
  return v;
}

/** Pick CRM "Professional" / "Professional Categories" — never Specialization. */
function pickProfessional(lookup, raw) {
  const aliases = [
    'professional categories',
    'professional category',
    'professional_categories',
    'professional_category',
    'professional',
    'professionalism',
    'type of professional',
    'professional type',
    'type of profession',
  ];
  const direct = pickField(lookup, aliases);
  if (direct) return normalizeProfessionValue(direct);

  for (const [key, value] of Object.entries(lookup)) {
    if (!key.includes('professional')) continue;
    if (key.includes('special')) continue;
    const v = normalizeStr(value);
    if (v) return normalizeProfessionValue(v);
  }

  if (raw && typeof raw === 'object') {
    for (const [header, value] of Object.entries(raw)) {
      const h = String(header || '').toLowerCase();
      if (!h.includes('professional')) continue;
      if (h.includes('special')) continue;
      const v = normalizeStr(value);
      if (v) return normalizeProfessionValue(v);
    }
  }

  return '';
}

const PACKAGE_ALIASES = {
  PLATINUM: ['platinum', 'plat', 'package_platinum'],
  SILVER: ['silver', 'package_silver'],
  VISA_DOCS: [
    'visa_docs',
    'visa_and_docs',
    'visa_doc',
    'visa_documentation',
    'docs_recognition',
    'docs',
    'documentation',
    'visa',
    'visa_only',
    'visa_doc_only',
  ],
};

function normalizePackage(raw) {
  const s = normalizeStr(raw)
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!s) return '';

  if (s === 'PLATINUM' || s.includes('PLATINUM')) return 'PLATINUM';
  if (s === 'SILVER' || s.includes('SILVER')) return 'SILVER';
  if (
    s === 'VISA_DOCS' ||
    s.includes('VISA') ||
    s.includes('DOCS') ||
    s.includes('DOCUMENT')
  ) {
    return 'VISA_DOCS';
  }

  for (const [canonical, aliases] of Object.entries(PACKAGE_ALIASES)) {
    if (aliases.some((a) => s === a.toUpperCase() || s.includes(a.toUpperCase()))) {
      return canonical;
    }
  }

  return s;
}

const STATUS_ALIASES = {
  NOT_STARTED: ['not_started', 'not started'],
  UNCERTAIN: [
    'uncertain',
    'pending',
    'not_sure',
    'not sure',
    'no_updates_yet',
    'no updates yet',
    'new',
  ],
  ONGOING: ['ongoing', 'active', 'in_progress', 'current'],
  COMPLETED: [
    'completed',
    'complete',
    'finished',
    'done',
    'language_completed',
    'language completed',
    'language complete',
  ],
  WITHDREW: ['withdrew', 'withdrawn', 'withdrawal', 'hold', 'on_hold', 'paused', 'inactive'],
};

function normalizeStatus(raw) {
  const s = normalizeStr(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!s) return 'UNCERTAIN';

  for (const [canonical, aliases] of Object.entries(STATUS_ALIASES)) {
    if (s === canonical.toLowerCase() || aliases.includes(s)) {
      return canonical;
    }
  }

  if (
    (s.includes('language') && s.includes('completed')) ||
    (s.includes('completed') && !s.includes('not'))
  ) {
    return 'COMPLETED';
  }
  if (s.includes('withdrew') || s.includes('withdrawn') || s.includes('withdrawal')) {
    return 'WITHDREW';
  }
  if (s.includes('ongoing') || s.includes('in_progress')) {
    return 'ONGOING';
  }
  if (s.includes('not_started') || s === 'notstarted') {
    return 'NOT_STARTED';
  }
  if (
    s.includes('uncertain') ||
    s.includes('no_update') ||
    s === 'new' ||
    s.includes('pending')
  ) {
    return 'UNCERTAIN';
  }

  const upper = s.toUpperCase();
  if (VALID_STATUSES.includes(upper)) return upper;
  return 'UNCERTAIN';
}

/** Parse CRM "Service Opted" cell into service name(s). */
function parseServiceNames(rawServices) {
  if (!rawServices) return [];

  return [...new Set(
    String(rawServices)
      .split(/[,;|/]+/)
      .map((s) => canonicalServiceName(normalizeStr(s)))
      .filter(Boolean)
  )];
}

function parseAge(raw) {
  const n = parseInt(String(raw || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 && n < 150 ? n : null;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Sanitize email; generate a unique placeholder when missing/invalid. */
function resolveEmail(raw, rowIndex, name) {
  let email = normalizeStr(raw)
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');

  const warnings = [];

  if (!email) {
    const slug = slugify(name) || `row-${rowIndex}`;
    email = `${slug}-row-${rowIndex}@sales-import.local`;
    warnings.push('email missing — placeholder generated');
    return { email, warnings };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const match = email.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (match) {
      warnings.push(`email cleaned from "${raw}"`);
      return { email: match[0].toLowerCase(), warnings };
    }
    const slug = slugify(name) || slugify(email) || `row-${rowIndex}`;
    email = `${slug}-row-${rowIndex}@sales-import.local`;
    warnings.push(`invalid email "${raw}" — placeholder generated`);
    return { email, warnings };
  }

  return { email, warnings };
}

function rowHasData(raw) {
  if (!raw || typeof raw !== 'object') return false;
  return Object.values(raw).some((v) => normalizeStr(v) !== '');
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function makeUniqueEmail(email, suffix) {
  const at = email.indexOf('@');
  if (at > 0) {
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    return `${local}+${suffix}@${domain}`;
  }
  const slug = slugify(email) || `row-${suffix}`;
  return `${slug}-${suffix}@sales-import.local`;
}

/** Build a unique email using name and/or mobile so different people can share an address. */
function makeUniqueEmailForStudent(originalEmail, record, rowIndex) {
  const namePart = slugify(record.name) || 'student';
  const phonePart = normalizePhone(record.phone).slice(-6);
  const suffix = phonePart ? `${namePart}-${phonePart}` : `${namePart}-row${rowIndex}`;
  return makeUniqueEmail(originalEmail, suffix);
}

/** Count rows that share a candidate name (informational — each unique email is still imported). */
function countDuplicateNames(importRows) {
  const counts = new Map();
  for (const row of importRows) {
    const key = normalizeName(row.record.name);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let duplicateNameCount = 0;
  for (const count of counts.values()) {
    if (count > 1) duplicateNameCount += count - 1;
  }
  return duplicateNameCount;
}

async function batchSyncStudentServices(entries) {
  if (!entries.length) return;
  const ids = entries.map((e) => e.studentId);
  await SalesStudentService.deleteMany({ salesStudentId: { $in: ids } });
  const svcDocs = [];
  for (const entry of entries) {
    for (const serviceName of [...new Set((entry.serviceNames || []).filter(Boolean))]) {
      svcDocs.push({ salesStudentId: entry.studentId, serviceName });
    }
  }
  for (let i = 0; i < svcDocs.length; i += 500) {
    await SalesStudentService.insertMany(svcDocs.slice(i, i + 500), { ordered: false });
  }
}

function assignUniqueEmail(row, originalEmail, takenEmails, reason) {
  let email = makeUniqueEmailForStudent(originalEmail, row.record, row.rowIndex);
  let attempt = 0;
  while (takenEmails.has(email)) {
    attempt++;
    email = makeUniqueEmail(originalEmail, `${row.rowIndex}-${attempt}`);
  }
  row.record.email = email;
  takenEmails.add(email);
  row.warnings = row.warnings || [];
  row.warnings.push(reason);
  return email;
}

/**
 * Give duplicate emails within the same file a unique suffix when name/phone differ.
 * Same email + same name/phone in file is treated as a re-import row and kept as-is.
 */
function dedupeImportEmails(importRows) {
  const seenByEmail = new Map();
  let duplicateCount = 0;

  for (const row of importRows) {
    let email = String(row.record.email || '').toLowerCase().trim();
    if (!email) continue;

    const identity = `${normalizeName(row.record.name)}|${normalizePhone(row.record.phone)}`;
    const identities = seenByEmail.get(email) || new Set();

    if (identities.has(identity)) {
      continue;
    }

    if (identities.size > 0) {
      duplicateCount++;
      const original = email;
      const taken = new Set(
        importRows
          .map((r) => String(r.record.email || '').toLowerCase().trim())
          .filter(Boolean)
      );
      assignUniqueEmail(
        row,
        original,
        taken,
        `duplicate email in file ("${original}") — unique email generated using name/phone`
      );
      email = row.record.email;
      const newIdentities = seenByEmail.get(email) || new Set();
      newIdentities.add(identity);
      seenByEmail.set(email, newIdentities);
      continue;
    }

    identities.add(identity);
    seenByEmail.set(email, identities);
  }

  return duplicateCount;
}

/** Extract mapped fields from a spreadsheet row (supports CRM / Monday column names). */
function mapRowFields(raw) {
  const lookup = buildRowLookup(raw);

  const name = pickField(lookup, [
    'name',
    'candidate name',
    'student name',
    'full name',
    'candidate_name',
  ]);

  const email = pickField(lookup, [
    'email address',
    'email_address',
    'e-mail',
    'email',
    'mail',
  ]).toLowerCase();

  const phone =
    pickField(lookup, ['phone', 'phone number', 'phone_number', 'mobile', 'contact number']) ||
    pickField(lookup, ['whatsapp number', 'whatsapp', 'whatsapp_number']);

  const age = parseAge(
    pickField(lookup, ['age', 'student age', 'candidate age'])
  );

  const pkgRaw = pickField(lookup, [
    'package',
    'package opted',
    'package_opted',
    'plan',
    'subscription',
    'package type',
  ]);

  const statusRaw = pickField(lookup, [
    'current status',
    'current_status',
    'student status',
    'student_status',
    'status',
  ]);

  const counselor = pickField(lookup, [
    'counselor',
    'assigned sales representative',
    'sales representative',
    'sales rep',
    'assigned counselor',
    'sales assignee',
  ]);

  const rawServices = pickField(lookup, [
    'services',
    'service opted',
    'service_opted',
    'services opted',
    'service',
    'service key',
  ]);

  const leadSource = pickField(lookup, ['lead source', 'lead_source']);
  const qualification = pickField(lookup, [
    'qualification',
    'qualifications',
    'degree',
    'education',
  ]);
  /** Excel "Professional" / "Professional Categories" column. */
  const profession = pickProfessional(lookup, raw);
  /** Excel column "Specialization" — separate from Professional; not used for drill-down. */
  const specialization = pickField(lookup, [
    'specialization',
    'specialisation',
    'speciality',
    'specialty',
    'major',
    'subject',
  ]);
  const address = pickField(lookup, ['client address', 'address', 'client_address']);

  const currentLanguageLevel = pickByHeaderHints(lookup, raw, {
    aliases: [
      'current level',
      'current language level',
      'language level opted',
      'language level',
      'language_level_opted',
      'german level',
      'native language',
    ],
    mustInclude: ['level'],
    mustExclude: ['withdrawal', 'document', 'visa', 'payment', 'batch', 'remark', 'amount'],
  });

  const documentPaymentStatus = pickByHeaderHints(lookup, raw, {
    aliases: [
      'document payment status',
      'documentation payment status',
      'doc payment status',
    ],
    mustInclude: ['payment'],
    mustExclude: ['visa', 'remark', 'amount', 'balance'],
  });

  const documentationStatus = pickByHeaderHints(lookup, raw, {
    aliases: [
      'documentation status',
      'document status',
      'docs status',
    ],
    mustInclude: ['document', 'status'],
    mustExclude: ['payment', 'visa', 'remark', 'amount', 'balance', 'cv', 'passport', 'educational', 'other'],
    preferIncludes: ['documentation'],
  });

  const documentationRemarks = pickByHeaderHints(lookup, raw, {
    aliases: [
      'documentation remarks',
      'document remarks',
      'docs remarks',
    ],
    mustInclude: ['remark'],
    mustExclude: ['visa'],
    preferIncludes: ['documentation', 'document'],
  });

  const visaStatus = pickByHeaderHints(lookup, raw, {
    aliases: [
      'visa status',
      'visa_status',
      'current visa status',
    ],
    mustInclude: ['visa'],
    mustExclude: ['payment', 'remark', 'amount', 'balance', 'documentation'],
  });

  const noteParts = [];
  if (leadSource) noteParts.push(`Lead: ${leadSource}`);
  if (qualification) noteParts.push(`Qualification: ${qualification}`);
  if (profession) noteParts.push(`Professional: ${profession}`);
  if (specialization) noteParts.push(`Specialization: ${specialization}`);
  if (address) noteParts.push(`Address: ${address}`);
  if (documentPaymentStatus) noteParts.push(`DocPaymentRaw: ${documentPaymentStatus}`);
  const notes = noteParts.join(' | ');

  return {
    name,
    email,
    phone,
    age,
    package: normalizePackage(pkgRaw),
    status: normalizeStatus(statusRaw),
    counselor,
    profession,
    qualifications: qualification,
    specialization,
    currentLanguageLevel,
    documentPaymentStatus: normalizeDocumentPaymentStatus(documentPaymentStatus),
    documentationStatus,
    documentationRemarks,
    visaStatus,
    serviceNames: parseServiceNames(rawServices),
    notes,
    _rawPackage: pkgRaw,
    _rawStatus: statusRaw,
  };
}

/**
 * Resolve a spreadsheet row into an importable record.
 * Missing/invalid fields get sensible defaults — warnings are informational only.
 * Returns { record, warnings, rowIndex }.
 */
function resolveRow(raw, rowIndex) {
  const warnings = [];
  const mapped = mapRowFields(raw);

  let name = mapped.name;
  if (!name) {
    name = `Candidate Row ${rowIndex}`;
    warnings.push('name missing — default name used');
  }

  const { email, warnings: emailWarnings } = resolveEmail(mapped.email, rowIndex, name);
  warnings.push(...emailWarnings);

  let pkg = mapped.package;
  if (!pkg || !VALID_PACKAGES.includes(pkg)) {
    const hint = mapped._rawPackage ? ` (was "${mapped._rawPackage}")` : '';
    pkg = 'SILVER';
    warnings.push(`package missing or unrecognized${hint} — defaulted to SILVER`);
  }

  let status = mapped.status;
  if (!VALID_STATUSES.includes(status)) {
    status = 'UNCERTAIN';
    if (mapped._rawStatus) {
      warnings.push(`status "${mapped._rawStatus}" unrecognized — defaulted to Uncertain`);
    }
  }

  let notes = mapped.notes || '';
  if (warnings.length) {
    const warnNote = `[Import fixes] ${warnings.join('; ')}`;
    notes = notes ? `${notes} | ${warnNote}` : warnNote;
  }

  return {
    record: {
      name,
      email,
      phone: mapped.phone,
      age: mapped.age,
      package: pkg,
      status,
      counselor: mapped.counselor,
      profession: mapped.profession || '',
      qualifications: mapped.qualifications || '',
      specialization: mapped.specialization || '',
      currentLanguageLevel: mapped.currentLanguageLevel || '',
      documentPaymentStatus: mapped.documentPaymentStatus || '',
      documentationStatus: mapped.documentationStatus || '',
      documentationRemarks: mapped.documentationRemarks || '',
      visaStatus: mapped.visaStatus || '',
      notes,
      serviceNames: mapped.serviceNames,
    },
    warnings,
    rowIndex,
  };
}

/** @deprecated alias — use resolveRow */
function validateRow(raw, rowIndex) {
  const { record, warnings, rowIndex: idx } = resolveRow(raw, rowIndex);
  return { record, errors: warnings, warnings, rowIndex: idx };
}

/**
 * Preview import — every non-empty row is importable; warnings flag auto-fixes.
 */
function previewRows(rows) {
  const importRows = [];
  const warningsList = [];

  for (let i = 0; i < rows.length; i++) {
    if (!rowHasData(rows[i])) continue;

    const { record, warnings, rowIndex } = resolveRow(rows[i], i + 1);
    importRows.push({ rowIndex, record, warnings });

    if (warnings.length) {
      warningsList.push({ rowIndex, name: record.name, warnings });
    }
  }

  const duplicateEmailCount = dedupeImportEmails(importRows);
  const duplicateNameCount = countDuplicateNames(importRows);

  // Rebuild warnings list after duplicate-email adjustments
  const warningsListFinal = importRows
    .filter((r) => r.warnings?.length)
    .map((r) => ({ rowIndex: r.rowIndex, name: r.record.name, warnings: r.warnings }));

  return {
    rows: importRows,
    warnings: warningsListFinal,
    totalRows: rows.length,
    importCount: importRows.length,
    professionCount: importRows.filter((r) => normalizeStr(r.record.profession)).length,
    warningCount: warningsListFinal.length,
    duplicateEmailCount,
    duplicateNameCount,
    // Legacy shape for frontend compatibility
    valid: importRows,
    invalid: warningsListFinal.map((w) => ({
      rowIndex: w.rowIndex,
      name: w.name,
      warnings: w.warnings,
      errors: w.warnings,
    })),
    validCount: importRows.length,
    invalidCount: warningsListFinal.length,
  };
}

/**
 * Commit validated rows into sales_students + sales_student_services.
 * Upserts by email address — one student per unique email (626 rows = 626 students).
 */
async function commitImport(validatedRows, staffUserId) {
  const normalized = validatedRows.map((r) => ({
    rowIndex: r.rowIndex,
    record: { ...(r.record || r) },
    warnings: r.warnings || [],
  }));

  dedupeImportEmails(normalized);
  const duplicateNameCount = countDuplicateNames(normalized);

  const allExisting = await SalesStudent.find({}).select('_id email').lean();
  const existingByEmail = new Map(allExisting.map((e) => [e.email, e]));
  const takenEmails = new Set(allExisting.map((e) => e.email));

  const inserts = [];
  const updates = [];
  const failed = [];
  let emailAdjusted = 0;

  for (const row of normalized) {
    const { serviceNames, ...fields } = row.record;
    let email = String(fields.email || '').toLowerCase().trim();
    const payload = {
      name: fields.name,
      email,
      phone: fields.phone || '',
      age: fields.age,
      package: fields.package,
      status: fields.status,
      counselor: fields.counselor || '',
      profession: fields.profession || '',
      qualifications: fields.qualifications || '',
      specialization: fields.specialization || '',
      currentLanguageLevel: fields.currentLanguageLevel || '',
      documentPaymentStatus: fields.documentPaymentStatus || '',
      documentationStatus: fields.documentationStatus || '',
      documentationRemarks: fields.documentationRemarks || '',
      visaStatus: fields.visaStatus || '',
      notes: fields.notes || '',
      serviceNames: serviceNames || [],
      rowIndex: row.rowIndex,
    };

    try {
      const existing = existingByEmail.get(email);
      if (existing) {
        updates.push({ _id: existing._id, payload });
        continue;
      }

      if (takenEmails.has(email)) {
        emailAdjusted++;
        assignUniqueEmail(
          row,
          email,
          takenEmails,
          `email "${email}" already used — unique email generated`
        );
        email = row.record.email;
        payload.email = email;
      }
      takenEmails.add(email);
      inserts.push({ payload });
    } catch (err) {
      failed.push({ rowIndex: row.rowIndex, name: fields.name, email, reason: err.message });
    }
  }

  const serviceSync = [];
  let imported = 0;
  let updated = 0;
  const CHUNK = 100;

  for (let i = 0; i < inserts.length; i += CHUNK) {
    const chunk = inserts.slice(i, i + CHUNK);
    const docs = chunk.map(({ payload }) => ({
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      age: payload.age,
      package: payload.package,
      status: payload.status,
      counselor: payload.counselor,
      profession: payload.profession || '',
      qualifications: payload.qualifications || '',
      specialization: payload.specialization || '',
      currentLanguageLevel: payload.currentLanguageLevel || '',
      documentPaymentStatus: payload.documentPaymentStatus || '',
      documentationStatus: payload.documentationStatus || '',
      documentationRemarks: payload.documentationRemarks || '',
      visaStatus: payload.visaStatus || '',
      notes: payload.notes,
      createdBy: staffUserId,
      updatedBy: staffUserId,
    }));

    try {
      const created = await SalesStudent.insertMany(docs, { ordered: false });
      imported += created.length;
      created.forEach((doc, idx) => {
        serviceSync.push({
          studentId: doc._id,
          serviceNames: chunk[idx].payload.serviceNames,
        });
      });
    } catch (err) {
      if (err.insertedDocs?.length) {
        imported += err.insertedDocs.length;
        err.insertedDocs.forEach((doc, idx) => {
          serviceSync.push({
            studentId: doc._id,
            serviceNames: chunk[idx]?.payload.serviceNames || [],
          });
        });
      }
      if (err.writeErrors) {
        for (const we of err.writeErrors) {
          failed.push({
            rowIndex: chunk[we.index]?.payload.rowIndex,
            name: chunk[we.index]?.payload.name,
            reason: we.errmsg || 'Insert error',
          });
        }
      } else if (!err.insertedDocs?.length) {
        for (const item of chunk) {
          failed.push({
            rowIndex: item.payload.rowIndex,
            name: item.payload.name,
            reason: err.message,
          });
        }
      }
    }
  }

  if (updates.length) {
    const bulkOps = updates.map(({ _id, payload }) => ({
      updateOne: {
        filter: { _id },
        update: {
          $set: {
            name: payload.name,
            email: payload.email,
            phone: payload.phone,
            age: payload.age,
            package: payload.package,
            status: payload.status,
            counselor: payload.counselor,
            profession: payload.profession || '',
            qualifications: payload.qualifications || '',
            specialization: payload.specialization || '',
            currentLanguageLevel: payload.currentLanguageLevel || '',
            documentPaymentStatus: payload.documentPaymentStatus || '',
            documentationStatus: payload.documentationStatus || '',
            documentationRemarks: payload.documentationRemarks || '',
            visaStatus: payload.visaStatus || '',
            notes: payload.notes,
            updatedBy: staffUserId,
          },
        },
      },
    }));

    try {
      const bulkResult = await SalesStudent.bulkWrite(bulkOps, { ordered: false });
      updated = bulkResult.modifiedCount || 0;
      for (const item of updates) {
        serviceSync.push({
          studentId: item._id,
          serviceNames: item.payload.serviceNames,
        });
      }
    } catch (err) {
      for (const item of updates) {
        failed.push({
          rowIndex: item.payload.rowIndex,
          name: item.payload.name,
          reason: err.message,
        });
      }
    }
  }

  await batchSyncStudentServices(serviceSync);

  await repairStaleProfessionData();
  await repairDocumentPaymentStatuses(SalesStudent);
  invalidateCache();
  return {
    imported,
    updated,
    merged: 0,
    failed,
    emailAdjusted,
    duplicateNameCount,
    requested: normalized.length,
    processed: normalized.length,
    skipped: 0,
    skippedExisting: [],
  };
}

module.exports = {
  validateRow,
  resolveRow,
  previewRows,
  commitImport,
  mapRowFields,
  normalizeHeader,
  pickProfessional,
};
