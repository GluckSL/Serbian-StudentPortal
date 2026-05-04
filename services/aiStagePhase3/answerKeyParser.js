/**
 * Parse an answer key text into a map keyed by exercise ID.
 *
 * Supported formats:
 *   L1.1: 1-a komme  2-b war
 *   L1.2  1. ist  2. hat
 *   Übung L2.1   1-a  2-b
 *   L2.2
 *   1-a
 *   2-b
 *
 * Keys are ALWAYS normalised to "L<number>.<number>" format (e.g. "L1.1").
 * The map value is the raw answer block for that exercise.
 *
 * @param {string} [text=""]
 * @returns {Record<string, string>}  e.g. { "L1.1": "1-a komme  2-b war", ... }
 */
function parseAnswerKey(text = "") {
  const map = {};

  if (!text || !text.trim()) return map;

  // Match "L<digits>.<digits>" possibly preceded by "Übung" / "Ubung" and whitespace
  const regex = /(?:(?:Ü\s*b\s*u\s*n\s*g|Übung|Ubung)\s+)?L(\d+\.\d+)\s*:?\s*([\s\S]*?)(?=(?:(?:Ü\s*b\s*u\s*n\s*g|Übung|Ubung)\s+)?L\d+\.\d+|$)/gi;

  let m;
  while ((m = regex.exec(text))) {
    const key = "L" + m[1];           // always "L1.1" format
    const value = m[2].trim();
    if (value) map[key] = value;
  }

  console.log("[ANSWER KEY PARSED]", Object.keys(map));
  return map;
}

module.exports = { parseAnswerKey };
