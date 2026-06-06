const { parsePdfBuffer } = require("../pdfParseLoader");

/**
 * Extract raw text from a PDF buffer.
 * Returns raw text only — no cleaning, no processing.
 *
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function loadPdfText(buffer) {
  const data = await parsePdfBuffer(buffer);
  return data.text || "";
}

module.exports = { loadPdfText };
