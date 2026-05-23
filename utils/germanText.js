// German-aware text helpers — avoid JS toUpperCase() turning ß into SS

/**
 * Uppercase for German game words while preserving Eszett (ß → ẞ, not SS).
 */
function germanUppercase(str) {
  return String(str || '')
    .trim()
    .split('')
    .map((ch) => (ch === 'ß' ? 'ẞ' : ch.toLocaleUpperCase('de-DE')))
    .join('');
}

/** Trim without altering ß/umlauts (image matching, sentences). */
function trimGermanWord(str) {
  return String(str || '').trim();
}

/**
 * Case-insensitive compare; treats ß and ss as equivalent (legacy data used SS).
 */
function normalizeGermanForCompare(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\u1e9e/g, 'ss')
    .replace(/\u00df/g, 'ss');
}

function germanWordsEqual(a, b) {
  return normalizeGermanForCompare(a) === normalizeGermanForCompare(b);
}

module.exports = {
  germanUppercase,
  trimGermanWord,
  normalizeGermanForCompare,
  germanWordsEqual,
};
