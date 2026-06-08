'use strict';

/** Lazy-load pdf-parse v1 so a broken install never crashes app startup. */
let cachedParser = undefined;

function getParser() {
  if (cachedParser !== undefined) return cachedParser;
  try {
    const lib = require('pdf-parse');
    if (typeof lib === 'function') {
      cachedParser = lib;
    } else if (lib && typeof lib.default === 'function') {
      cachedParser = lib.default;
    } else {
      console.warn('[pdf-parse] Incompatible export — PDF text extraction disabled.');
      cachedParser = null;
    }
  } catch (err) {
    console.warn('[pdf-parse] Failed to load:', err.message);
    cachedParser = null;
  }
  return cachedParser;
}

async function parsePdfBuffer(buffer) {
  const parser = getParser();
  if (!parser) {
    throw new Error('pdf-parse is not available on this server.');
  }
  const result = await parser(buffer);
  return {
    text: typeof result?.text === 'string' ? result.text : '',
    numpages: Number.isFinite(Number(result?.numpages)) ? Number(result.numpages) : 1,
  };
}

function isPdfParseAvailable() {
  return typeof getParser() === 'function';
}

module.exports = { parsePdfBuffer, isPdfParseAvailable };
