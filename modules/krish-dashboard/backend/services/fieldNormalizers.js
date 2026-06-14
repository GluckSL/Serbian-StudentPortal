/**
 * Canonical normalizers for CRM text fields used in Enrollment Overview filters.
 */

function normalizeKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const DOCUMENT_PAYMENT_ALIASES = {
  Paid: ['paid'],
  'Half Paid': ['half_paid', 'part_paid', 'partly_paid'],
  Unpaid: ['no', 'unpaid', 'pending', 'not_paid', 'due', 'outstanding'],
};

/** Junk CRM values — treat as unspecified (shown as —), not valid payment status. */
const JUNK_DOCUMENT_PAYMENT_KEYS = new Set(['yes', 'y', 'yes_half', 'yeshalf']);

function normalizeDocumentPaymentStatus(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  const key = normalizeKey(trimmed);

  if (JUNK_DOCUMENT_PAYMENT_KEYS.has(key)) return '';
  if (key.includes('yes') && key.includes('half')) return '';

  for (const [canonical, aliases] of Object.entries(DOCUMENT_PAYMENT_ALIASES)) {
    if (aliases.includes(key)) return canonical;
  }

  // Already-canonical labels from CRM exports (preserve readable casing).
  for (const canonical of Object.keys(DOCUMENT_PAYMENT_ALIASES)) {
    if (normalizeKey(canonical) === key) return canonical;
  }

  return trimmed;
}

function extractDocPaymentRaw(notes) {
  const match = String(notes || '').match(/DocPaymentRaw:\s*([^|]+)/i);
  return match ? match[1].trim() : '';
}

function canonicalDocPaymentFromStudent({ documentPaymentStatus, notes, documentationStatus }) {
  const raw = extractDocPaymentRaw(notes);
  if (raw) return normalizeDocumentPaymentStatus(raw);

  const stored = normalizeDocumentPaymentStatus(documentPaymentStatus);
  // Legacy import mapped yes/Yes → Paid before DocPaymentRaw was stored.
  if (stored === 'Paid' && !String(documentationStatus || '').trim()) {
    return '';
  }
  return stored;
}

function isPaidDocumentPayment(value) {
  return normalizeDocumentPaymentStatus(value) === 'Paid';
}

/** Repair legacy free-text document payment values in sales_students. */
async function repairDocumentPaymentStatuses(SalesStudent) {
  const junkCleared = await SalesStudent.updateMany(
    {
      documentPaymentStatus: {
        $in: ['yes', 'Yes', 'YES', 'y', 'Y', 'yes half', 'Yes half', 'Yes Half', 'YES HALF', 'yes half', 'Yes Half'],
      },
    },
    { $set: { documentPaymentStatus: '' } },
  );

  const students = await SalesStudent.find({})
    .select('_id documentPaymentStatus documentationStatus notes')
    .lean();

  if (!students.length) {
    return junkCleared.modifiedCount || 0;
  }

  const bulk = [];
  for (const doc of students) {
    const current = String(doc.documentPaymentStatus || '').trim();
    const canonical = canonicalDocPaymentFromStudent(doc);
    if (canonical === current) continue;
    bulk.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { documentPaymentStatus: canonical } },
      },
    });
  }

  let modified = junkCleared.modifiedCount || 0;
  if (bulk.length) {
    const result = await SalesStudent.bulkWrite(bulk, { ordered: false });
    modified += result.modifiedCount || 0;
  }

  if (modified) {
    console.log(`[KrishDash] normalized document payment status on ${modified} students`);
  }
  return modified;
}

function mergeCountFields(into, row) {
  for (const field of ['total', 'ongoing', 'notStarted', 'uncertain', 'completed', 'withdrew', 'hold']) {
    into[field] = (into[field] || 0) + (row[field] || 0);
  }
}

/** Grouping key for service names that differ only by casing/spacing. */
function normalizeServiceKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Preferred display labels for known CRM variants (e.g. "Au pair" → "Au Pair"). */
const SERVICE_CANONICAL_BY_KEY = {
  au_pair: 'Au Pair',
};

function canonicalServiceName(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const key = normalizeServiceKey(trimmed);
  return SERVICE_CANONICAL_BY_KEY[key] || trimmed;
}

/** Pick the label from the variant with the highest student count. */
function pickBestServiceLabel(variants) {
  if (!variants?.length) return '';
  return [...variants]
    .sort((a, b) => (b.total || 0) - (a.total || 0) || String(a.name).localeCompare(String(b.name)))[0]
    .name;
}

module.exports = {
  normalizeDocumentPaymentStatus,
  canonicalDocPaymentFromStudent,
  isPaidDocumentPayment,
  repairDocumentPaymentStatuses,
  normalizeServiceKey,
  canonicalServiceName,
  pickBestServiceLabel,
  mergeCountFields,
};
