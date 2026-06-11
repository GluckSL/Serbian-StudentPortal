'use strict';

const placeholderContent = require('../content/sprechen-a1-placeholder.json');
const { DEFAULT_A2_RUBRIC } = require('./sprechen-a2-rubric-defaults');

/** Default A1 rubric used when a module has no criteria configured. */
const DEFAULT_RUBRIC = placeholderContent.rubric || {
  teil1: { maxPoints: 3, criteria: [] },
  teil2: { maxPoints: 6, criteria: [] },
  teil3: { maxPoints: 6, criteria: [] },
};

/**
 * Merge module rubric with defaults so scoring always has criteria.
 * Picks the right defaults based on examFormat ('A1' or 'A2').
 */
function resolveModuleRubric(module) {
  const isA2 = module?.examFormat === 'A2';
  const mod = module?.rubric || {};
  const def = isA2 ? DEFAULT_A2_RUBRIC : DEFAULT_RUBRIC;

  function mergeTeil(key) {
    const m = mod[key] || {};
    const d = def[key] || {};
    const criteria = Array.isArray(m.criteria) && m.criteria.length ? m.criteria : d.criteria || [];
    return {
      maxPoints: m.maxPoints > 0 ? m.maxPoints : d.maxPoints || 0,
      criteria,
    };
  }

  return {
    teil1: mergeTeil('teil1'),
    teil2: mergeTeil('teil2'),
    teil3: mergeTeil('teil3'),
  };
}

module.exports = { DEFAULT_RUBRIC, resolveModuleRubric };
