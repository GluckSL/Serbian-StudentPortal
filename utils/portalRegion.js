/**
 * Serbia deployment helpers (shared backend).
 */

function isSerbiaPortal() {
  return (process.env.PORTAL_REGION || '').toLowerCase() === 'serbia';
}

/** Default native language for hints/instructions on the Serbia portal. */
function defaultNativeLanguage() {
  return isSerbiaPortal() ? 'Serbian' : 'English';
}

/** Learning content language — always German for Serbia German courses. */
function defaultContentLanguage() {
  return 'German';
}

module.exports = {
  isSerbiaPortal,
  defaultNativeLanguage,
  defaultContentLanguage,
};
