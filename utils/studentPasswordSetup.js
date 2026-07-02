/**
 * utils/studentPasswordSetup.js
 *
 * Determines whether a student must complete the first-login password setup modal.
 */

function studentRequiresPasswordSetup(user) {
  if (!user || user.role !== 'STUDENT') return false;
  if (user.mustChangePassword === true) return true;
  // Public signup students already set their password during signup — never force setup
  if (user.signupSource === 'public_signup') return false;
  // Legacy ongoing students who have never set their own password
  if (
    String(user.studentStatus || '').toUpperCase() === 'ONGOING' &&
    !user.passwordChangedAt
  ) {
    return true;
  }
  return false;
}

module.exports = { studentRequiresPasswordSetup };
