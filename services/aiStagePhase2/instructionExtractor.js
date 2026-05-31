/**
 * Extract the instruction from a block's lines.
 *
 * Strategy (KEYWORD-FIRST):
 *  1. Split and trim all non-empty lines.
 *  2. Strip "Übung Lx.x" and "STUFE" header lines.
 *  3. Find lines that contain exercise-type keywords — these ARE the instruction.
 *     Take the last 2 such lines (handles multi-sentence instructions like
 *     "Lesen Sie den Text. Dann ergänzen Sie die Lücken.").
 *  4. Fallback: if no keyword line found, return the line immediately before
 *     the first numbered/blank question line (preserves old safe behaviour).
 *
 * @param {string} blockText
 * @returns {string}
 */
function extractInstruction(blockText) {
  const lines = blockText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const cleaned = lines.filter(
    (l) => !/^Übung/i.test(l) && !/^STUFE/i.test(l)
  );

  // Primary: keyword-bearing lines are the instruction
  const keywordLines = cleaned.filter((line) =>
    /zuordnungs|matching|fill|lückentext|ergänzen|plural|singular|frage|formulier|bilden|schreiben|fehler|korrigieren|choose|wähle|write|question/i.test(line)
  );

  if (keywordLines.length > 0) {
    return keywordLines.slice(-2).join(" ").trim();
  }

  // Fallback: line before first question-like line
  const questionIndex = cleaned.findIndex(
    (l) =>
      /^\d+[.\)]/.test(l) ||
      /^[a-z]\)/i.test(l) ||
      /_{2,}/.test(l) ||
      /\.{3}/.test(l)
  );

  if (questionIndex === -1) return cleaned[0] || "";

  const start = Math.max(0, questionIndex - 2);
  return cleaned.slice(start, questionIndex).join(" ").trim();
}

module.exports = { extractInstruction };
