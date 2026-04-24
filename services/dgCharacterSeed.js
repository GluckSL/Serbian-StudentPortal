const DGCharacter = require('../models/DGCharacter');

const DEFAULT_LUMO = {
  name: 'Lumo',
  avatarUrl: '/assets/dg-bot/lumo.svg',
  voice: 'alloy',
  personality: 'friendly, encouraging',
  isDefault: true,
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
 * Ensure at least one DG character exists and one is marked default (Lumo).
 * Safe to call on every server start.
 */
async function ensureDefaultDgCharacter() {
  try {
    const any = await DGCharacter.exists({});
    if (!any) {
      await DGCharacter.create(DEFAULT_LUMO);
      console.log('[dg] Created default DG character Lumo');
      return;
    }

    const hasDefault = await DGCharacter.exists({ isDefault: true, isActive: true });
    if (hasDefault) return;

    const lumo = await DGCharacter.findOne({ name: /^lumo$/i, isActive: true });
    if (lumo) {
      lumo.isDefault = true;
      await lumo.save();
      console.log('[dg] Marked existing Lumo as default DG character');
      return;
    }

    await DGCharacter.create(DEFAULT_LUMO);
    console.log('[dg] Added default DG character Lumo (no prior default)');
  } catch (e) {
    console.warn('[dg] ensureDefaultDgCharacter:', e.message || e);
  }
}

module.exports = { ensureDefaultDgCharacter, DEFAULT_LUMO };
