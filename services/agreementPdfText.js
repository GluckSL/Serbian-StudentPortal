// Normalize text for pdf-lib StandardFonts (WinAnsi / Windows-1252 only).
const { Encodings } = require('@pdf-lib/standard-fonts/lib/Encoding');

const WIN_ANSI = Encodings.WinAnsi;

/** Word / Unicode punctuation that commonly breaks WinAnsi encoding. */
const PUNCTUATION_REPLACEMENTS = [
  [/\u2011/g, '-'], // non-breaking hyphen (common in Word)
  [/\u2010/g, '-'],
  [/\u2012/g, '-'],
  [/\u2013/g, '-'],
  [/\u2014/g, '-'],
  [/\u2015/g, '-'],
  [/\u2018|\u2019|\u201A|\u2032|\u2035/g, "'"],
  [/\u201C|\u201D|\u201E|\u2033|\u2036/g, '"'],
  [/\u00AB|\u00BB/g, '"'],
  [/\u2026/g, '...'],
  [/\u2022|\u2023|\u2043|\u2219/g, '*'],
  [/\u00B7/g, '.'],
  [/\u00AD/g, ''], // soft hyphen
  [/\u00A0|\u1680|\u180E|\u2000-\u200F|\u2028|\u2029|\u202F|\u205F|\u2060|\uFEFF/g, ' ']
];

/**
 * Strip or replace characters that pdf-lib Helvetica cannot encode.
 * @param {string} text
 * @returns {string}
 */
function sanitizeForWinAnsi(text) {
  if (text == null) return '';
  let s = String(text).normalize('NFKC');
  for (const [re, rep] of PUNCTUATION_REPLACEMENTS) {
    s = s.replace(re, rep);
  }

  const out = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (WIN_ANSI.canEncodeUnicodeCodePoint(cp)) {
      out.push(ch);
      continue;
    }
    const stripped = ch.normalize('NFD').replace(/\p{M}/gu, '');
    if (stripped) {
      const scp = stripped.codePointAt(0);
      if (WIN_ANSI.canEncodeUnicodeCodePoint(scp)) {
        out.push(stripped);
        continue;
      }
    }
    if (/\s/u.test(ch)) out.push(' ');
    else if (/[-\u2010-\u2015]/u.test(ch)) out.push('-');
  }
  return out.join('');
}

module.exports = { sanitizeForWinAnsi };
