const { applyMatchingAnswers, applyFillAnswers } = require("./applyAnswers");

/**
 * Normalize a single Phase 2 result into its final exercise structure.
 *
 * Rules:
 *  - matching     → { id, type, instruction, pairs }
 *  - fill_in_blank → { id, type, instruction, questions }
 *  - all others   → { id, type, instruction, questions }  (questions = raw parsed array)
 *
 * No re-parsing, no type re-detection, no answer guessing.
 * If answerMap has no entry for this block, answers remain empty strings.
 *
 * @param {{ id: string }} block          - Original Phase 1 block (id used for answerMap lookup)
 * @param {{ id: string, type: string, instruction: string, parsed: any[] }} parsedResult - Phase 2 output
 * @param {Record<string, string>} answerMap  - Output of parseAnswerKey()
 * @returns {object}
 */
function normalize(block, parsedResult, answerMap) {
  const answerBlock = answerMap[block.id] || "";

  if (parsedResult.type === "matching") {
    return {
      id: block.id,
      type: "matching",
      instruction: parsedResult.instruction,
      pairs: applyMatchingAnswers(parsedResult.parsed, answerBlock, block.id),
    };
  }

  if (parsedResult.type === "fill_in_blank") {
    return {
      id: block.id,
      type: "fill_in_blank",
      instruction: parsedResult.instruction,
      questions: applyFillAnswers(parsedResult.parsed, answerBlock, block.id),
    };
  }

  return {
    id: block.id,
    type: parsedResult.type,
    instruction: parsedResult.instruction,
    questions: parsedResult.parsed,
  };
}

module.exports = { normalize };
