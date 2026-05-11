// utils/studentDisplayName.js — sanitize a portal student name for use as a Zoom display name

const DISPLAY_NAME_MAX = 80;

// Matches emoji and most non-printing Unicode (Emoji_Presentation + Emoji_Modifier +
// joining chars + variation selectors + zero-width chars).
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F900}-\u{1F9FF}\u{200B}-\u{200D}\u{FEFF}\u{00AD}]/gu;

/**
 * Sanitize a raw portal name string so it is safe and consistent as a Zoom display name.
 *
 * Rules (in order):
 * 1. Coerce to string and trim leading/trailing whitespace.
 * 2. Strip emojis and zero-width/invisible Unicode characters.
 * 3. Remove characters that are not letters, digits, spaces, hyphens, apostrophes, or dots
 *    (keeps names like "O'Brien", "Al-Farsi", "Jr.", multi-script letters, etc.).
 * 4. Collapse consecutive whitespace to a single space.
 * 5. Trim again (sanitization may leave leading/trailing space).
 * 6. Fall back to 'Student' if the result is empty after sanitization.
 * 7. Enforce maximum length.
 *
 * @param {string} rawName - The student's name as stored in User.name (or concatenated first+last).
 * @param {number} [maxLen] - Maximum allowed display-name length (default 80).
 * @returns {string}
 */
function sanitizeDisplayName(rawName, maxLen = DISPLAY_NAME_MAX) {
  let name = String(rawName || '').trim();
  name = name.replace(EMOJI_RE, '');
  // Keep Unicode letters/numbers, spaces, hyphens, apostrophes, and dots.
  name = name.replace(/[^\p{L}\p{N}\s\-'.]/gu, '');
  name = name.replace(/\s+/g, ' ').trim();
  if (!name) name = 'Student';
  if (name.length > maxLen) name = name.slice(0, maxLen).trim();
  return name;
}

module.exports = { sanitizeDisplayName, DISPLAY_NAME_MAX };
