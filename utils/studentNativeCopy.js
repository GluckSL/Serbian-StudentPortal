'use strict';

const { isSerbiaPortal } = require('./portalRegion');
const { translateText } = require('../services/dgConversationService');

const descriptionCache = new Map();

async function serbianDescription(text, fromLang = 'English') {
  const key = String(text || '').trim();
  if (!key || !isSerbiaPortal()) return key;
  if (descriptionCache.has(key)) return descriptionCache.get(key);
  const out = await translateText(key, fromLang, 'Serbian').catch(() => key);
  const resolved = (out || key).trim() || key;
  descriptionCache.set(key, resolved);
  return resolved;
}

async function attachSerbianExerciseDescriptions(exercises) {
  if (!isSerbiaPortal() || !Array.isArray(exercises)) return;
  await Promise.all(
    exercises.map(async (ex) => {
      if (!ex?.description) return;
      ex.descriptionDisplay = await serbianDescription(ex.description);
    }),
  );
}

async function attachSerbianExerciseDescription(exercise) {
  if (!exercise?.description || !isSerbiaPortal()) return;
  exercise.descriptionDisplay = await serbianDescription(exercise.description);
}

module.exports = {
  serbianDescription,
  attachSerbianExerciseDescriptions,
  attachSerbianExerciseDescription,
};
