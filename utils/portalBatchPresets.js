// utils/portalBatchPresets.js
// Canonical batch names available in the portal (BatchConfig + filter dropdowns).

const PORTAL_BATCH_PRESETS = [
  'withdrawl',
  'uncertain',
  'docs only',
  'visa only',
  'docs and visa',
  'completed'
];

function normalizeBatchKey(name) {
  return String(name || '').trim().toLowerCase();
}

/** Batches that require the uncertain/withdrawal login confirmation modal. */
const UNCERTAIN_WITHDRAWAL_BATCH_KEYS = new Set([
  'uncertain',
  'withdrawl',
  'withdrawal',
  'withdraw'
]);

/**
 * Student must see the login confirmation modal (batch uncertain/withdrawl OR status WITHDREW/UNCERTAIN).
 */
function studentRequiresWithdrawalConfirmation(user) {
  if (!user || user.role !== 'STUDENT') return false;
  const batchKey = normalizeBatchKey(user.batch);
  if (UNCERTAIN_WITHDRAWAL_BATCH_KEYS.has(batchKey)) return true;
  const status = String(user.studentStatus || '').trim().toUpperCase();
  return status === 'WITHDREW' || status === 'UNCERTAIN';
}

/** Merge preset batch names with an existing list (case-insensitive dedupe). */
function mergePortalBatchNames(existingNames = []) {
  const seen = new Set();
  const out = [];

  const add = (raw) => {
    const label = String(raw || '').trim();
    if (!label) return;
    const key = normalizeBatchKey(label);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };

  (existingNames || []).forEach(add);
  PORTAL_BATCH_PRESETS.forEach(add);

  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

module.exports = {
  PORTAL_BATCH_PRESETS,
  UNCERTAIN_WITHDRAWAL_BATCH_KEYS,
  mergePortalBatchNames,
  normalizeBatchKey,
  studentRequiresWithdrawalConfirmation
};
