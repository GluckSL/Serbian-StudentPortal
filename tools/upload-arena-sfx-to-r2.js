#!/usr/bin/env node
/**
 * One-time / deploy: upload GlückArena SFX from src/assets/audios/ to Cloudflare R2.
 * Requires R2 env vars (same as exercise media). Run: npm run upload:arena-sfx
 */
require('dotenv').config();
const { uploadArenaSfxFromAssets } = require('../services/interactiveGames/arenaMediaConfig');

uploadArenaSfxFromAssets()
  .then((results) => {
    console.log('[arena-sfx] Uploaded to R2:');
    for (const r of results) {
      console.log(`  ${r.logicalName}: ${r.publicUrl} (${r.bytes} bytes)`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('[arena-sfx] Upload failed:', err.message);
    process.exit(1);
  });
