// utils/portalBatchPresets.js
// Canonical batch names available in the portal (BatchConfig + filter dropdowns).

const PORTAL_BATCH_PRESETS = [
  'withdrawl',
  'uncertain',
  'docs only',
  'visa only',
  'docs and visa'
];

function normalizeBatchKey(name) {
  return String(name || '').trim().toLowerCase();
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
  mergePortalBatchNames,
  normalizeBatchKey
};
