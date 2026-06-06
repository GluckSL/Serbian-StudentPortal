'use strict';

/**
 * PDF authors can mark metadata with explicit brackets:
 *   {instruction text}  → instruction
 *   [example text]      → worked example
 */

function splitBilingualInstruction(text) {
  const raw = String(text || '').trim();
  if (!raw) return { instruction_de: '', instruction_en: '' };

  const slashParts = raw.split(/\s*\/\s*/);
  if (slashParts.length >= 2) {
    return {
      instruction_de: slashParts[0].trim(),
      instruction_en: slashParts.slice(1).join(' / ').trim()
    };
  }

  return { instruction_de: raw, instruction_en: '' };
}

/**
 * Parse {instruction} and [example] markers from worksheet text.
 * Returns cleaned content with markers removed.
 */
function extractBracketMarkers(text) {
  const raw = String(text || '');
  const instructionMatches = [...raw.matchAll(/\{([^{}]+)\}/g)];
  const exampleMatches = [...raw.matchAll(/\[([^\[\]]+)\]/g)];

  let instruction_de = '';
  let instruction_en = '';
  if (instructionMatches.length) {
    const blocks = instructionMatches.map((m) => m[1].trim()).filter(Boolean);
    if (blocks.length >= 2) {
      instruction_de = blocks[0];
      instruction_en = blocks.slice(1).join(' ').trim();
    } else {
      const split = splitBilingualInstruction(blocks[0] || '');
      instruction_de = split.instruction_de;
      instruction_en = split.instruction_en;
    }
  }

  const example = exampleMatches.map((m) => m[1].trim()).filter(Boolean).join('\n');

  const cleanedContent = raw
    .replace(/\{[^{}]+\}/g, '')
    .replace(/\[[^\[\]]+\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { instruction_de, instruction_en, example, cleanedContent };
}

/** Merge bracket markers into an exercise block (non-destructive for existing fields). */
function applyBracketMarkersToExercise(block) {
  if (!block || typeof block !== 'object') return block;

  const parsed = extractBracketMarkers(block.content || '');
  const hasMarkers = parsed.instruction_de || parsed.instruction_en || parsed.example;
  if (!hasMarkers) return block;

  return {
    ...block,
    instruction_de: parsed.instruction_de || String(block.instruction_de || '').trim(),
    instruction_en: parsed.instruction_en || String(block.instruction_en || '').trim(),
    example: parsed.example || String(block.example || '').trim(),
    content: parsed.cleanedContent || block.content
  };
}

module.exports = {
  extractBracketMarkers,
  applyBracketMarkersToExercise,
  splitBilingualInstruction
};
