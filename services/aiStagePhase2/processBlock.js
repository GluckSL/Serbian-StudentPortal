const { extractInstruction } = require("./instructionExtractor");
const { detectExerciseType, detectQuestionCount } = require("./typeClassifier");

const { parseMatching } = require("./parsers/matchingParser");
const { parseFillBlank } = require("./parsers/fillBlankParser");
const { parseMCQ } = require("./parsers/mcqParser");
const { parseShortAnswer } = require("./parsers/shortAnswerParser");
const { parseSingularPlural } = require("./parsers/singularPluralParser");
const { parseErrorCorrection } = require("./parsers/errorCorrectionParser");
const { needsAiCorrection, aiCorrectBlock } = require("./aiCorrector");

/**
 * Run the Phase 2 pipeline on a single exercise block.
 *
 * Pipeline:
 *   block.content
 *     → extractInstruction
 *     → detectExerciseType   (structure-first + keyword, uses full content)
 *     → detectQuestionCount  (type-specific structural count)
 *     → strict matching override
 *     → parse<Type>          (structured extraction per type)
 *     → [AI correction]      (only when parser confidence is LOW)
 *
 * @param {{ id: string, content: string, index: number }} block
 * @returns {Promise<{ id: string, instruction: string, type: string, questionCount: number, parsed: any[] } | null>}
 */
async function processBlock(block) {
  const { id, content } = block;

  const instruction = extractInstruction(content);

  let type = detectExerciseType(instruction, content);

  let questionCount = detectQuestionCount(type, content);

  // Strict override: matching should never report 1 item if numbered lines say otherwise
  if (type === "matching" && questionCount === 1) {
    const forced = (content.match(/^\d+\./gm) || []).length;
    if (forced > 1) questionCount = forced;
  }

  let parsed = [];

  switch (type) {
    case "matching":        parsed = parseMatching(content);       break;
    case "fill_in_blank":   parsed = parseFillBlank(content);      break;
    case "mcq":             parsed = parseMCQ(content);            break;
    case "short_answer":    parsed = parseShortAnswer(content);    break;
    case "singular_plural": parsed = parseSingularPlural(content); break;
    case "error_correction":parsed = parseErrorCorrection(content);break;
    default:                parsed = [];
  }

  // ── AI correction pass ─────────────────────────────────────────────────────
  if (needsAiCorrection(block, parsed, type)) {
    console.log("[AI CORRECTION TRIGGERED]", id, `(type=${type}, parsed=${parsed.length})`);

    const corrected = await aiCorrectBlock(block);

    if (corrected) {
      type     = corrected.type;
      parsed   = corrected.parsed;
      questionCount = detectQuestionCount(type, content);
      console.log("[AI CORRECTION APPLIED]", id, `→ type=${type}, count=${parsed.length}`);
    } else {
      console.warn("[AI CORRECTION FAILED]", id, "— keeping original parser output");
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  if (!parsed || parsed.length === 0) {
    console.warn("[AI STAGE][EMPTY PARSE]", id, type);

    // Skip blocks that have no parseable content at all — likely header remnants
    const hasNumberedLines = /^\d+[.)]/m.test(content);
    if (!hasNumberedLines) {
      console.warn("[AI STAGE][SKIP BLOCK]", id, "— no numbered lines and empty parse");
      return null;
    }
  }

  console.log("[PARSER RESULT]", { id, type, count: parsed.length });
  console.log("[AI STAGE FINAL]", { id, instruction, type, questionCount });

  return { id, instruction, type, questionCount, parsed };
}

module.exports = { processBlock };
