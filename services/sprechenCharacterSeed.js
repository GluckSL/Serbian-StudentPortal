'use strict';

const DGCharacter = require('../models/DGCharacter');

const OLLY_TUTOR = {
  name: 'Olly Tutor',
  avatarUrl: '/assets/dg-bot/lumo.svg',
  voice: 'alloy',
  personality: 'calm, professional exam moderator',
  isDefault: false,
  isActive: true,
  animations: {
    idle: 'idle',
    speaking: 'speaking',
    listening: 'listening',
    thinking: 'thinking',
    happy: 'happy',
    sad: 'sad',
    confused: 'confused',
  },
};

/**
 * Find or create the Olly Tutor character used for Sprechen exam modules.
 */
async function resolveOllyTutorCharacterId() {
  let doc = await DGCharacter.findOne({ name: /^olly tutor$/i, isActive: true });
  if (!doc) {
    doc = await DGCharacter.create(OLLY_TUTOR);
    console.log('[sprechen] Created Olly Tutor character');
  }
  return doc._id;
}

module.exports = { resolveOllyTutorCharacterId, OLLY_TUTOR };
