/**
 * STRUCTURE-FIRST type classifier — v2.
 *
 * Key changes from v1:
 *  - MCQ is checked BEFORE matching to prevent a)/b)/c) options in MCQ
 *    exercises from being mis-classified as "matching".
 *  - Matching now requires STRICT structural evidence:
 *      • letter options  (a) b) c))  combined with a matching keyword, OR
 *      • arrow connector (→ or ->)   even without a keyword.
 *
 * Priority order is intentional — do not reorder without a reason.
 */

/**
 * @param {string} [instruction=""]
 * @param {string} [content=""]
 * @returns {"matching"|"mcq"|"fill_in_blank"|"singular_plural"|"error_correction"|"open_writing"|"short_answer"|"unknown"}
 */
function detectExerciseType(instruction = "", content = "") {
  const text = (instruction + " " + content).toLowerCase();

  // 1. MCQ — check FIRST to prevent a)/b)/c) from triggering matching
  //    Keyword-based: explicit choice instruction
  if (/wähle|choose|richtige antwort|kreuz.*an|markier/i.test(text)) return "mcq";

  // 2. MATCHING — keyword + structural evidence
  //    Structural evidence = arrow connector OR letter options (a/b/c on their own lines)
  const hasArrow = /→|->/.test(content);
  const hasLetterOptions = /\b[a-z]\)/i.test(content);
  const hasMatchingKeyword = /zuordnen|zuordnungs|matching|verbinden|connect|pair/i.test(text);

  if (hasArrow) return "matching";                         // arrow alone is enough
  if (hasMatchingKeyword && hasLetterOptions) return "matching";

  // 3. MCQ (structural fallback) — numbered question followed by a)/b)/c) options
  //    This catches MCQ blocks whose instructions don't use wähle/choose
  if (hasLetterOptions && /^\d+[.)]/m.test(content)) return "mcq";

  // 4. FILL IN BLANK — keyword OR blank marker in content
  if (
    /lückentext|ergänzen|fill/i.test(text) ||
    /_{2,}|\.{3}/.test(content)
  ) return "fill_in_blank";

  // 5. SINGULAR / PLURAL
  if (/plural|singular|mehrzahl|einzahl|form.*tabelle|tabelle.*form/i.test(text)) return "singular_plural";

  // 6. ERROR CORRECTION — must come before open_writing
  if (/fehler|korrigieren|find.*error|correct.*error/i.test(text)) return "error_correction";

  // 7. OPEN WRITING — comes after error so "korrigieren" doesn't fall here
  if (/schreiben|write\b/i.test(text)) return "open_writing";

  // 8. SHORT ANSWER
  if (/frage|formulier|bilden|question/i.test(text)) return "short_answer";

  return "unknown";
}

/**
 * Count the number of exercise items using type-specific structural rules.
 *
 * @param {string} type
 * @param {string} [content=""]
 * @returns {number}
 */
function detectQuestionCount(type, content = "") {
  if (type === "matching") {
    const arrows  = (content.match(/→|->/g) || []).length;
    const left    = (content.match(/^\d+\./gm) || []).length;
    const right   = (content.match(/\b[a-z]\)/gi) || []).length;
    return Math.max(arrows, left, right, 1);
  }

  if (type === "fill_in_blank") {
    const blanks   = (content.match(/_{2,}|\.{3}/g) || []).length;
    const numbered = (content.match(/^\d+\./gm) || []).length;
    return Math.max(blanks, numbered, 1);
  }

  if (type === "mcq") {
    return (content.match(/^\d+[.)]/gm) || []).length || 1;
  }

  if (type === "singular_plural") {
    return (content.match(/^\d+\./gm) || []).length || 1;
  }

  if (type === "error_correction") {
    return (content.match(/^\d+\./gm) || []).length || 1;
  }

  if (type === "short_answer") {
    return (content.match(/^\d+\./gm) || []).length || 1;
  }

  if (type === "open_writing") return 1;

  return 1;
}

// Legacy alias
function detectType(instruction, content = "") {
  return detectExerciseType(instruction, content);
}

module.exports = { detectExerciseType, detectQuestionCount, detectType };
