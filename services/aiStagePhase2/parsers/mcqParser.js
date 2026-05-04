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
 * Parse MCQ content into structured questions.
 *
 * Supported patterns:
 *   1. Question text       ← numbered question line
 *      a) Option A         ← letter option  (a) or a.)
 *      b) Option B
 *
 * Returns:
 *   [{ question: string, options: string[], answer: string }]
 */
function parseMCQ(blockText) {
  const lines = normalizeLines(blockText);
  const questions = [];
  let current = null;

  for (const line of lines) {
    // New numbered question: "1." or "1)"
    if (/^\d+[.)]\s+\S/.test(line)) {
      if (current) questions.push(current);
      current = {
        question: line.replace(/^\d+[.)]\s*/, "").trim(),
        options: [],
        answer: "",
      };
      continue;
    }

    // Option line: "a)" or "a." — attach to current question
    if (/^[a-z][.)]\s+\S/i.test(line) && current) {
      current.options.push(line.replace(/^[a-z][.)]\s*/i, "").trim());
      continue;
    }

    // Continuation: if no current question yet, skip
  }

  if (current) questions.push(current);

  return questions;
}

module.exports = { parseMCQ };
