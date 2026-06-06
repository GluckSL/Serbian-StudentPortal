'use strict';

// Safe pdf-parse loader for Node.js. pdf-parse v2 pulls in pdfjs-dist, which expects
// DOMMatrix/ImageData/Path2D at module load time — import the worker polyfill first.
let _loadError = null;
let _parseFn = null;
let _PDFParseClass = null;
let _workerReady = false;

function installCanvasPolyfills() {
  if (_workerReady) return;
  _workerReady = true;
  try {
    require('pdf-parse/worker');
    return;
  } catch (_) {
    /* fall through */
  }
  try {
    const { DOMMatrix, ImageData, Path2D } = require('@napi-rs/canvas');
    globalThis.DOMMatrix = DOMMatrix;
    globalThis.ImageData = ImageData;
    globalThis.Path2D = Path2D;
  } catch (_) {
    /* pdf-parse may still work for text-only extraction */
  }
}

function ensureLoaded() {
  if (_parseFn || _PDFParseClass || _loadError) return;
  try {
    installCanvasPolyfills();
    const lib = require('pdf-parse');
    _PDFParseClass =
      lib.PDFParse || (lib.default && lib.default.PDFParse) || null;

    if (typeof lib === 'function') {
      _parseFn = lib;
    } else if (lib && typeof lib.default === 'function') {
      _parseFn = lib.default;
    }

    if (!_parseFn && (!_PDFParseClass || typeof _PDFParseClass !== 'function')) {
      _loadError = new Error('pdf-parse loaded but no compatible parser export found');
    }
  } catch (err) {
    _loadError = err;
    console.warn('⚠️ pdf-parse failed to load:', err.message);
  }
}

function isAvailable() {
  ensureLoaded();
  return !(_loadError || (!_parseFn && !_PDFParseClass));
}

function getPDFParseClass() {
  ensureLoaded();
  if (_loadError) throw new Error('pdf-parse is not available: ' + _loadError.message);
  if (!_PDFParseClass) throw new Error('pdf-parse PDFParse class is not available');
  return _PDFParseClass;
}

/**
 * Parse a PDF buffer — supports pdf-parse v1 (function) and v2 (PDFParse class).
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<{ text: string, numpages: number }>}
 */
async function parsePdfBuffer(buffer) {
  ensureLoaded();
  if (_loadError) {
    throw new Error('pdf-parse is not available on this server: ' + _loadError.message);
  }

  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  if (typeof _parseFn === 'function') {
    const result = await _parseFn(buffer);
    return {
      text: result?.text || '',
      numpages: Number.isFinite(Number(result?.numpages))
        ? Number(result.numpages)
        : Number.isFinite(Number(result?.total))
          ? Number(result.total)
          : 1
    };
  }

  if (_PDFParseClass) {
    const parser = new _PDFParseClass(data);
    await parser.load();
    const result = await parser.getText();
    const pages =
      (result?.pages && result.pages.length) ||
      (Number.isFinite(Number(result?.total)) ? Number(result.total) : 1);
    return {
      text: result?.text || '',
      numpages: pages
    };
  }

  throw new Error('pdf-parse is not available on this server');
}

module.exports = { parsePdfBuffer, getPDFParseClass, isAvailable };
