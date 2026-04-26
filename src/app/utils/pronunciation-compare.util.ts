export type PronCompareTokenKind = 'normal' | 'matched' | 'missing' | 'extra';

export interface PronCompareToken {
  text: string;
  kind: PronCompareTokenKind;
}

function normalizeToken(token: string): string {
  return String(token || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, '')
    .trim();
}

function tokenizeForDisplay(text: string): string[] {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function buildCountMap(words: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const raw of words || []) {
    const key = normalizeToken(raw);
    if (!key) continue;
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

export function buildExpectedHighlightTokens(
  expectedText: string,
  missingWords: string[] = [],
  matchedWords: string[] = []
): PronCompareToken[] {
  const missing = buildCountMap(missingWords);
  const matched = buildCountMap(matchedWords);
  const out: PronCompareToken[] = [];
  for (const word of tokenizeForDisplay(expectedText)) {
    const key = normalizeToken(word);
    if (!key) continue;
    if ((missing[key] || 0) > 0) {
      out.push({ text: word, kind: 'missing' });
      missing[key] -= 1;
      continue;
    }
    if ((matched[key] || 0) > 0) {
      out.push({ text: word, kind: 'matched' });
      matched[key] -= 1;
      continue;
    }
    out.push({ text: word, kind: 'normal' });
  }
  return out;
}

export function buildTranscriptHighlightTokens(
  transcriptText: string,
  extraWords: string[] = [],
  matchedWords: string[] = []
): PronCompareToken[] {
  const extra = buildCountMap(extraWords);
  const matched = buildCountMap(matchedWords);
  const out: PronCompareToken[] = [];
  for (const word of tokenizeForDisplay(transcriptText)) {
    const key = normalizeToken(word);
    if (!key) continue;
    if ((extra[key] || 0) > 0) {
      out.push({ text: word, kind: 'extra' });
      extra[key] -= 1;
      continue;
    }
    if ((matched[key] || 0) > 0) {
      out.push({ text: word, kind: 'matched' });
      matched[key] -= 1;
      continue;
    }
    out.push({ text: word, kind: 'normal' });
  }
  return out;
}
