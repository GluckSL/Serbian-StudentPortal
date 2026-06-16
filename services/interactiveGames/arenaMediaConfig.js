// Public GlückArena media URLs (SFX on R2). Question audio/images use mediaUpload.js.

const path = require('path');
const fs = require('fs');
const { isExerciseR2Configured, publicUrlForKey, putExerciseMediaBuffer } = require('../exerciseMediaR2');

const R2_SFX_PREFIX = 'glueck-arena/sfx';

/** Stable R2 keys — run `npm run upload:arena-sfx` after changing local files. */
const ARENA_SFX_FILES = {
  correct: 'correct.mp3',
  incorrect: 'incorrect.mp3',
  lost: 'lost.mp3',
  xpGain: 'xp-gain.mp3',
};

function sfxKey(filename) {
  return `${R2_SFX_PREFIX}/${filename}`;
}

function getArenaMediaConfig() {
  const r2Configured = isExerciseR2Configured();
  const sfx = {};
  if (r2Configured) {
    sfx.correct = publicUrlForKey(sfxKey(ARENA_SFX_FILES.correct));
    sfx.wrong = publicUrlForKey(sfxKey(ARENA_SFX_FILES.incorrect));
    sfx.lost = publicUrlForKey(sfxKey(ARENA_SFX_FILES.lost));
    sfx.xpGain = publicUrlForKey(sfxKey(ARENA_SFX_FILES.xpGain));
  }
  return {
    r2Configured,
    sfx: r2Configured ? sfx : null,
  };
}

/** Upload bundled SFX from src/assets/audios/ to fixed R2 keys (deploy / one-time setup). */
async function uploadArenaSfxFromAssets() {
  if (!isExerciseR2Configured()) {
    throw new Error(
      'R2 is not configured. Set CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_PUBLIC_BASE_URL.'
    );
  }
  const assetsDir = path.join(__dirname, '../../src/assets/audios');
  const results = [];
  for (const [logicalName, filename] of Object.entries(ARENA_SFX_FILES)) {
    const localPath = path.join(assetsDir, filename);
    if (!fs.existsSync(localPath)) {
      throw new Error(`Missing local SFX file: ${localPath}`);
    }
    const buffer = fs.readFileSync(localPath);
    const key = sfxKey(filename);
    const publicUrl = await putExerciseMediaBuffer(buffer, key, 'audio/mpeg');
    results.push({ logicalName, key, publicUrl, bytes: buffer.length });
  }
  return results;
}

module.exports = {
  ARENA_SFX_FILES,
  R2_SFX_PREFIX,
  getArenaMediaConfig,
  uploadArenaSfxFromAssets,
};
