const express = require("express");
const multer = require("multer");

const { loadPdfText } = require("../services/aiStage/pdfLoader");
const { cleanText } = require("../services/aiStage/textCleaner");
const { splitIntoBlocks } = require("../services/aiStage/blockSplitter");

const router = express.Router();
const upload = multer();

/**
 * POST /api/ai-stage/phase-1
 *
 * Accepts a PDF file upload and returns the Phase 1 pipeline result:
 *   PDF → Raw Text → Cleaned Text → Exercise Blocks
 *
 * Body: multipart/form-data with field "file" (PDF)
 *
 * Response:
 * {
 *   success: true,
 *   meta: { totalBlocks: number },
 *   blocks: [{ id, index, content }]
 * }
 */
router.post("/phase-1", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const rawText = await loadPdfText(file.buffer);
    console.log("[AI STAGE][RAW LENGTH]", rawText.length);

    const cleaned = cleanText(rawText);

    const { blocks, answerKeyText } = splitIntoBlocks(cleaned);
    console.log("[AI STAGE][BLOCK COUNT]", blocks.length);

    return res.json({
      success: true,
      meta: {
        totalBlocks: blocks.length,
        hasAutoAnswerKey: answerKeyText.length > 0,
      },
      blocks,
      answerKeyText,
    });
  } catch (err) {
    console.error("PHASE 1 ERROR:", err);
    res.status(500).json({ error: "Phase 1 failed" });
  }
});

module.exports = router;
