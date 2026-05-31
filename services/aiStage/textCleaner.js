/**
 * Normalize raw PDF text for consistent parsing.
 *
 * Rules:
 *  - Convert multiple spaces/tabs → single space
 *  - Normalize line breaks (strip \r)
 *  - Collapse 3+ newlines → double newline (preserve paragraph breaks)
 *  - Remove trailing spaces before newlines
 *  - German characters are preserved (no stripping of non-ASCII)
 *  - Content is NEVER removed, only whitespace is normalized
 *
 * @param {string} raw
 * @returns {string}
 */
function cleanText(raw) {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n\n")
    .replace(/[ ]+\n/g, "\n")
    .trim();
}

module.exports = { cleanText };
