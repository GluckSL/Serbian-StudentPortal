/**
 * AI-assisted correction layer for Phase 2 parsing.
 *
 * Runs ONLY when the deterministic parser produced low-confidence output.
 * Uses GPT-4o-mini (fast + cheap) with temperature=0 for deterministic JSON.
 *
 * The AI is asked to:
 *   - Detect the correct exercise type
 *   - Extract clean structured data
 *   - Preserve German text exactly
 *   - NOT hallucinate
 *
 * If the API call fails for any reason the original parsed output is returned
 * unchanged — the corrector never blocks the pipeline.
 */

const OpenAI = require("openai");

// Lazy singleton — created only when a correction is actually needed
let _client = null;
function getClient() {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

// ── Confidence check ─────────────────────────────────────────────────────────

/**
 * Return true when the parser output is low-confidence and an AI correction
 * pass should be attempted.
 *
 * Rules (any one is enough to trigger):
 *   - parsed is empty
 *   - MCQ but every question has fewer than 2 options
 *   - fill_in_blank but no sentence contains a blank marker
 *
 * @param {{ id: string, content: string }} block
 * @param {any[]} parsed
 * @param {string} type
 * @returns {boolean}
 */
function needsAiCorrection(block, parsed, type) {
  if (!parsed || parsed.length === 0) return true;

  if (type === "mcq" && parsed.every((q) => !q.options || q.options.length < 2)) return true;

  if (
    type === "fill_in_blank" &&
    parsed.every((q) => !q.sentence || !/_{2,}|\.{3}|\[[^\]]*\]/.test(q.sentence))
  ) return true;

  return false;
}

// ── AI correction call ────────────────────────────────────────────────────────

/**
 * Send the block content to GPT-4o-mini and parse the response into a
 * { type, parsed } structure.
 *
 * Returns null on any failure — caller must handle the fallback.
 *
 * @param {{ id: string, content: string }} block
 * @returns {Promise<{ type: string, parsed: any[] } | null>}
 */
async function callAiCorrector(block) {
  const prompt = `You are a structured data extractor for German language exercise worksheets.

Convert the exercise text below into structured JSON.

RULES:
- Detect the correct type from: matching, fill_in_blank, mcq, short_answer, error_correction, singular_plural, open_writing
- Extract ONLY what is explicitly present in the text
- Preserve German text exactly — do NOT translate, paraphrase, or add content
- Do NOT hallucinate questions or answers that are not in the text
- Return ONLY valid JSON — no markdown fences, no explanation

TYPE SCHEMAS:
  matching       → { "type": "matching",      "parsed": [{ "left": "...", "right": "..." }] }
  fill_in_blank  → { "type": "fill_in_blank",  "parsed": [{ "sentence": "...", "answer": "" }] }
  mcq            → { "type": "mcq",            "parsed": [{ "question": "...", "options": ["..."], "answer": "" }] }
  short_answer   → { "type": "short_answer",   "parsed": [{ "question": "..." }] }
  error_correction→{ "type": "error_correction","parsed": [{ "sentence": "...", "corrected": "" }] }
  singular_plural → { "type": "singular_plural","parsed": [{ "singular": "...", "plural": "" }] }
  open_writing   → { "type": "open_writing",   "parsed": [] }

EXERCISE TEXT:
${block.content}`;

  const client = getClient();

  const completion = await client.chat.completions.create({
    model: process.env.AI_CORRECTOR_MODEL || "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 800,
    temperature: 0, // deterministic — no creativity needed here
  });

  const raw = (completion.choices[0]?.message?.content || "").trim();

  // Strip accidental markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const result = JSON.parse(cleaned);

  if (!result.type || !Array.isArray(result.parsed)) {
    throw new Error("AI response missing type or parsed array");
  }

  return result;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Attempt AI correction for a block.
 *
 * Always resolves — on any error it returns null so the caller can keep the
 * original parsed output.
 *
 * @param {{ id: string, content: string }} block
 * @returns {Promise<{ type: string, parsed: any[] } | null>}
 */
async function aiCorrectBlock(block) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[AI CORRECTOR] OPENAI_API_KEY not set — skipping correction for", block.id);
    return null;
  }

  try {
    const result = await callAiCorrector(block);
    console.log("[AI CORRECTOR] success", { id: block.id, type: result.type, count: result.parsed.length });
    return result;
  } catch (err) {
    console.error("[AI CORRECTOR] failed for", block.id, "—", err.message);
    return null;
  }
}

module.exports = { needsAiCorrection, aiCorrectBlock };
