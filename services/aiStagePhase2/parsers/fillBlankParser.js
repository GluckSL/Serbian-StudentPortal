function normalizeLines(blockText) {
  return blockText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^Übung/i.test(line) &&
        !/^STUFE/i.test(line) &&
        !/^Seite/i.test(line) &&
        !/^Hinweis/i.test(line) &&
        !/^[-–—_=*•·.,;:()[\]{}|/\\\s]+$/.test(line)
    );
}

/**
 * Parse fill-in-the-blank content.
 *
 * Accepts lines that:
 *   a) already contain a blank marker  (__ or ... or [ ])
 *   b) are numbered sentences even without an explicit blank
 *      (answer key application will inject the blank later)
 *
 * Returns:
 *   [{ sentence: string, answer: string }]
 */
function parseFillBlank(blockText) {
  const lines = normalizeLines(blockText);
  const questions = [];

  for (const line of lines) {
    const hasBlank     = /_{2,}|\.{3}|\[[^\]]*\]/.test(line);
    const isNumbered   = /^\d+[.)]\s+\S/.test(line);

    if (hasBlank || isNumbered) {
      questions.push({ sentence: line, answer: "" });
    }
  }

  return questions;
}

module.exports = { parseFillBlank };
