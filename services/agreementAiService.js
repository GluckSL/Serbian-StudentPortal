// AI service for analysing agreement PDF text and suggesting dynamic fields.
// Reuses EXERCISES_OPENAI_API_KEY (same key used by pdf-exercise generator).
const OpenAI = require('openai');

function getOpenAIClient() {
  const apiKey = process.env.EXERCISES_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('No OpenAI API key configured (EXERCISES_OPENAI_API_KEY)');
  return new OpenAI({ apiKey });
}

/**
 * Suggest dynamic fields from per-page text extracted from an agreement PDF.
 * pagesText: [{ page, text }]
 * Returns [{ id, label, page, sampleText, confidence }] — up to 7 fields.
 */
async function suggestDynamicFields(pagesText) {
  const client = getOpenAIClient();
  const model = process.env.AI_CORRECTOR_MODEL || 'gpt-4o-mini';

  const allText = pagesText
    .map(p => `--- Page ${p.page} ---\n${p.text}`)
    .join('\n\n')
    .slice(0, 8000); // keep well within token budget

  const systemPrompt = `You are an assistant that analyses legal agreement PDFs.
Your job is to identify the 5–7 most important placeholders that should be personalised per student.
Typical fields: student full name, student date of birth, enrollment date, course start date, course fee amount, programme name, student nationality.
Return ONLY a valid JSON array with no additional text.`;

  const userPrompt = `Below is the text from a multi-page agreement. Identify 5–7 dynamic fields that vary per student.
For each field return: id (camelCase), label (human readable), page (1-based page number where it appears), sampleText (the exact word or short phrase from the PDF that this field replaces).

Agreement text:
${allText}

Return format (JSON array only):
[{"id":"studentName","label":"Student Full Name","page":1,"sampleText":"John Doe","confidence":"high"}]`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 800,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  });

  const raw = (completion.choices[0]?.message?.content || '').trim();
  // Strip markdown code fences if present
  const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
  const suggestions = JSON.parse(jsonStr);
  return Array.isArray(suggestions) ? suggestions.slice(0, 7) : [];
}

module.exports = { suggestDynamicFields };
