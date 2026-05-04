const express = require("express");
const { parseAnswerKey } = require("../services/aiStagePhase3/answerKeyParser");
const { normalize } = require("../services/aiStagePhase3/normalizer");

const router = express.Router();

/**
 * POST /api/ai-stage/phase-3
 *
 * Finalizes exercise data by applying answers and normalizing structure.
 * Accepts Phase 1 blocks + Phase 2 parsed results + optional answer key text.
 *
 * Body (JSON):
 * {
 *   blocks:        [{ id, content, index }],       // Phase 1 output
 *   parsedResults: [{ id, type, instruction, parsed }],  // Phase 2 output
 *   answerKeyText: "L1.1: 1-a komme\nL1.2: 1. ist"  // optional
 * }
 *
 * Response:
 * {
 *   success: true,
 *   exercises: [
 *     { id, type, instruction, pairs | questions }
 *   ]
 * }
 */
router.post("/phase-3", express.json(), async (req, res) => {
  try {
    const { blocks, parsedResults, answerKeyText = "" } = req.body;

    if (!Array.isArray(blocks) || blocks.length === 0) {
      return res.status(400).json({ error: "No blocks provided" });
    }

    if (!Array.isArray(parsedResults) || parsedResults.length === 0) {
      return res.status(400).json({ error: "No parsedResults provided" });
    }

    const answerMap = parseAnswerKey(answerKeyText);
    console.log("[AI STAGE][PHASE 3][ANSWER MAP KEYS]", Object.keys(answerMap));

    const blockMap = Object.fromEntries(blocks.map((b) => [b.id, b]));

    const exercises = parsedResults.map((parsedResult) => {
      const block = blockMap[parsedResult.id];

      if (!block) {
        console.warn("[AI STAGE][PHASE 3][MISSING BLOCK]", parsedResult.id);
        return {
          id: parsedResult.id,
          type: parsedResult.type,
          instruction: parsedResult.instruction,
          questions: parsedResult.parsed,
        };
      }

      return normalize(block, parsedResult, answerMap);
    });

    console.log("[AI STAGE][PHASE 3][EXERCISE COUNT]", exercises.length);

    return res.json({ success: true, exercises });
  } catch (err) {
    console.error("PHASE 3 ERROR:", err);
    res.status(500).json({ error: "Phase 3 failed" });
  }
});

module.exports = router;
