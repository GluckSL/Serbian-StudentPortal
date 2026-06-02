'use strict';

const placeholderContent = require('../content/sprechen-a1-placeholder.json');

/** Default A1 rubric used when a module has no criteria configured. */
const DEFAULT_RUBRIC = placeholderContent.rubric || {
  teil1: { maxPoints: 3, criteria: [] },
  teil2: { maxPoints: 6, criteria: [] },
  teil3: { maxPoints: 6, criteria: [] },
};

/**
 * Merge module rubric with defaults so scoring always has criteria.
 */
function resolveModuleRubric(module) {
  const mod = module?.rubric || {};
  const def = DEFAULT_RUBRIC;

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
