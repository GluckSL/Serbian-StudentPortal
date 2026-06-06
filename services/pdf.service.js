// services/pdf.service.js

const fs = require("fs");
const { parsePdfBuffer } = require("./pdfParseLoader");

async function extractTextFromPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await parsePdfBuffer(buffer);
  return data.text;
}

module.exports = { extractTextFromPdf };

