/**
 * Fill-in-the-blank: each contiguous run of underscore characters is one blank.
 * Supports single `_` (e.g. "H _ l _ o") and legacy `___` (one gap).
 */
export function countFillBlankRuns(sentence: string): number {
  return (sentence.match(/_+/g) || []).length;
}

/** Split sentence into text segments around blank runs (for rendering inputs between parts). */
export function splitFillBlankSentence(sentence: string): string[] {
  if (sentence == null || sentence === '') return [''];
  return sentence.split(/_+/);
}

/** Split by underscores (only existing underscores become blanks). */
export function splitByWords(sentence: string): string[] {
  if (sentence == null || sentence === '') return [''];
  return sentence.split(/_+/);
}
