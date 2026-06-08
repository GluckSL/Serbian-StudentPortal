// services/pdf.service.js

const fs = require("fs");
const pdf = require("pdf-parse");

async function extractTextFromPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);
  return data.text;
}

module.exports = { extractTextFromPdf };

