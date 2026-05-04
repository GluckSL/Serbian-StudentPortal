const express = require("express");
const { processBlock } = require("../services/aiStagePhase2/processBlock");

const router = express.Router();

/**
 * POST /api/ai-stage/phase-2
 *
 * Accepts the Phase 1 blocks array and runs Phase 2 processing on each block:
 *   Instruction extraction → Type classification → Type-specific parsing
 *
 * Body (JSON):
 * {
 *   blocks: [{ id, content, index }]
 * }
 *
 * Response:
 * {
 *   success: true,
 *   results: [{ id, instruction, type, parsed }]
 * }
 */
router.post("/phase-2", express.json(), async (req, res) => {
  try {
    const { blocks } = req.body;

    if (!Array.isArray(blocks) || blocks.length === 0) {
      return res.status(400).json({ error: "No blocks provided" });
    }

    const raw = await Promise.all(blocks.map((block) => processBlock(block)));

    // FIX 3: remove null results (blocks with no parseable content)
    const deduped = new Map();
    for (const r of raw) {
      if (r === null) continue;
      // FIX 9: keep first occurrence of each id
      if (!deduped.has(r.id)) deduped.set(r.id, r);
    }
    const results = [...deduped.values()];

    console.log("[FINAL BLOCK COUNT]", results.length);
    results.forEach((r) =>
      console.log(`[AI STAGE][PHASE 2] id=${r.id} type=${r.type} parsed=${r.parsed.length}`)
    );

    return res.json({ success: true, results });
  } catch (err) {
    console.error("PHASE 2 ERROR:", err);
    res.status(500).json({ error: "Phase 2 failed" });
  }
});

module.exports = router;
