/**
 * Infer the preferred currency from a student's phone number.
 *
 * Rules:
 *   +91 / 91-prefix + ≥12 digits total → INR (India)
 *   +94 / 94-prefix + ≥11 digits total → LKR (Sri Lanka)
 *   anything else (or blank)            → USD
 */
function inferCurrencyFromPhone(phone) {
  if (!phone || typeof phone !== 'string') return 'USD';
  // Strip everything except digits
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length >= 12) return 'INR';
  if (digits.startsWith('94') && digits.length >= 11) return 'LKR';
  return 'USD';
}

module.exports = { inferCurrencyFromPhone };
