/** German-aware text helpers — JS toUpperCase() turns ß into SS */

export function germanUppercase(str: string): string {
  return String(str || '')
    .trim()
    .split('')
    .map((ch) => (ch === 'ß' ? 'ẞ' : ch.toLocaleUpperCase('de-DE')))
    .join('');
}

export function trimGermanWord(str: string): string {
  return String(str || '').trim();
}

export function normalizeGermanForCompare(str: string): string {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\u1e9e/g, 'ss')
    .replace(/\u00df/g, 'ss');
}
