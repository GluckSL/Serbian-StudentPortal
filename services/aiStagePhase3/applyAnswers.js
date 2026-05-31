/**
 * Apply answer key blocks to parsed exercise data.
 *
 * This module ONLY maps known answers onto already-parsed structures.
 * It does NOT re-parse, re-classify, or guess answers.
 */

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function cleanAnswerValue(value) {
  return String(value || "")
    .trim()
    .replace(/[.,;]+$/, "")
    .trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply answers to a matching exercise.
 *
 * Expects answerBlock lines like:
 *   "1 – a  Komme"   or   "1 - a Komme"
 *
 * Builds a 1-based index map from the answer block, then
 * replaces each pair's `right` value with the mapped answer.
 * Falls back to the original `right` if no answer is found.
 *
 * @param {{ left: string, right: string }[]} pairs
 * @param {string} answerBlock
 * @returns {{ left: string, right: string }[]}
 */
function applyMatchingAnswers(pairs, answerBlock, blockId = undefined) {
  if (!answerBlock) return pairs;

  // Supports: "1. komme", "1) komme", "1 - komme",
  // "1 – komme", "1: komme", "1 - a komme", "1 - c ist gegangen".
  const regex = /(\d+)\s*[.)\-–:]\s*(?:[a-z][.)]?\s+)?([a-zäöüß ]+?)(?=$|\n)/gi;
  const map = {};
  let m;

  while ((m = regex.exec(answerBlock))) {
    const index = parseInt(m[1], 10);
    const value = cleanAnswerValue(m[2]);
    if (Number.isFinite(index) && value) {
      map[index] = value;
    }
  }

  console.log("[ANSWER MAP]", {
    blockId,
    answersCount: Object.keys(map).length,
  });

  return pairs.map((p, i) => ({
    left: p.left,
    right: map[i + 1] || p.right,
  }));
}

/**
 * Apply answers to fill-in-the-blank questions.
 *
 * Expects answerBlock entries like:
 *   "1. ist"  "2- hat"  "3– kommt"
 *
 * Answers are matched positionally to questions.
 * If the sentence already contains a blank marker, the answer is
 * simply attached. If not, the first occurrence of the answer word
 * in the sentence is replaced with "___" so the blank is visible.
 *
 * @param {{ sentence: string, answer: string }[]} questions
 * @param {string} answerBlock
 * @returns {{ sentence: string, answer: string }[]}
 */
function applyFillAnswers(questions, answerBlock, blockId = undefined) {
  if (!answerBlock) return questions;

  const regex = /\d+\s*[.)\-–:]\s*(.+?)(?=$|\n)/g;
  const answers = [];
  let m;

  while ((m = regex.exec(answerBlock))) {
    const value = cleanAnswerValue(m[1]);
    if (value) answers.push(value);
  }

  console.log("[ANSWER MAP]", {
    blockId,
    answersCount: answers.length,
  });

  return questions.map((q, i) => {
    const ans = answers[i] || "";
    let sentence = q.sentence;

    if (ans) {
      const hasBlank = /_{2,}|\.{3}|\[[^\]]*\]/.test(sentence);

      if (hasBlank) {
        // Sentence already has a blank — just attach the answer, no replacement needed
      } else {
        // No blank marker: try word-boundary replacement first, then plain first occurrence
        const normalizedSentence = normalizeText(sentence);
        const normalizedAnswer = normalizeText(ans);

        if (normalizedAnswer && normalizedSentence.includes(normalizedAnswer)) {
          const escaped = escapeRegExp(ans);
          const wordRegex = new RegExp(`\\b${escaped}\\b`, "i");
          sentence = sentence.replace(wordRegex, "___");
        } else if (ans && sentence.toLowerCase().includes(ans.toLowerCase())) {
          // Fallback: replace first plain occurrence (handles umlauts / partial forms)
          const escaped = escapeRegExp(ans);
          sentence = sentence.replace(new RegExp(escaped, "i"), "___");
        }
      }
    }

    return { sentence, answer: ans };
  });
}

module.exports = { applyMatchingAnswers, applyFillAnswers };
