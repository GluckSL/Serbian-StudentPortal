/**
 * @typedef {Object} ExerciseBlock
 * @property {string} id      - Exercise ID, e.g. "L1.1"
 * @property {string} content - Full raw text for this block
 * @property {number} index   - Zero-based position in the document
 */

/**
 * Safely detect and separate the answer key section from the main content.
 *
 * Uses `lastIndexOf` to avoid false positives from early mentions of the keyword.
 * Only accepts as answer key if:
 *   1. The keyword appears in the LAST 35% of the document.
 *   2. The candidate section actually looks like answers (digits, arrows, pipes).
 *
 * @param {string} text
 * @returns {{ mainContent: string, answerKeyText: string }}
 */
function splitAnswerKey(text) {
  const keywords = ["antwortschlüssel", "answer key"];
  const lower = text.toLowerCase();

  for (const key of keywords) {
    const idx = lower.lastIndexOf(key); // last occurrence avoids in-text mentions

    if (idx !== -1) {
      const ratio = idx / text.length;

      if (ratio > 0.65) {
        const answerCandidate = text.slice(idx);

        const looksLikeAnswers =
          /\d+\s*[-.)]\s*[a-zäöüß]/i.test(answerCandidate) ||
          /→/.test(answerCandidate) ||
          /\|/.test(answerCandidate);

        if (looksLikeAnswers) {
          return {
            mainContent: text.slice(0, idx),
            answerKeyText: answerCandidate,
          };
        }
      }
    }
  }

  return { mainContent: text, answerKeyText: "" };
}

/**
 * Split cleaned PDF text into exercise blocks.
 *
 * 1. Strips the answer key section (if any) from the end of the document.
 * 2. Splits the remaining main content on "Übung Lx.x" markers.
 *
 * @param {string} text - Output of cleanText()
 * @returns {{ blocks: ExerciseBlock[], answerKeyText: string }}
 */
function splitIntoBlocks(text) {
  const { mainContent, answerKeyText } = splitAnswerKey(text);

  console.log("[ANSWER KEY DETECTED SAFE]", {
    hasAnswerKey: !!answerKeyText,
    mainLength: mainContent.length,
    answerLength: answerKeyText.length,
  });

  const regex = /(?:Übung|Exercise|EXERCISE)\s+(L\d+\.\d+)/gi;

  const matches = [...mainContent.matchAll(regex)];
  const blocks = [];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];

    const start = current.index;
    const end = next ? next.index : mainContent.length;

    const id = current[1];
    const content = mainContent.slice(start, end).trim();

    blocks.push({ id, content, index: i });
  }

  console.log("[AI STAGE][MAIN BLOCKS]", blocks.length, "| answer key chars:", answerKeyText.length);
  return { blocks, answerKeyText };
}

module.exports = { splitIntoBlocks };
