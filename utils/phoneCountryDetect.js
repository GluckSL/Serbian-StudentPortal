const COUNTRY_INDIA = 'India';
const COUNTRY_SRI_LANKA = 'Sri Lanka';
const COUNTRY_RUSSIA = 'Russia';
const COUNTRY_OTHER = 'Other';
const COUNTRY_UNKNOWN = 'Unknown';

/** Sri Lanka mobile operator prefixes (national format, without leading 0). */
const SL_MOBILE_PREFIX = /^7[0-8]/;

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function isSriLankaPhone(compact, digits) {
  if (/^(\+?94|0094)/i.test(compact) || digits.startsWith('94')) {
    return true;
  }
  if (digits.length === 10 && digits.startsWith('07')) {
    return true;
  }
  if (digits.length === 9 && SL_MOBILE_PREFIX.test(digits)) {
    return true;
  }
  // 10-digit local entry without leading 0 (e.g. 7712345678) — must run before India 10-digit rule
  if (digits.length === 10 && SL_MOBILE_PREFIX.test(digits)) {
    return true;
  }
  return false;
}

function isIndiaPhone(compact, digits) {
  if (/^(\+?91|0091)/i.test(compact) || (digits.startsWith('91') && digits.length >= 12)) {
    return true;
  }
  if (digits.length === 10 && /^[6-9]/.test(digits) && !digits.startsWith('07') && !SL_MOBILE_PREFIX.test(digits)) {
    return true;
  }
  return false;
}

function isRussiaPhone(compact, digits) {
  if (/^(\+?7|007)/.test(compact)) {
    return true;
  }
  // Russian mobile: country code 7 + 10 digits (11 digits total)
  if (digits.startsWith('7') && digits.length === 11) {
    return true;
  }
  return false;
}

/** Infer country from phone / WhatsApp (India, Sri Lanka, Russia, Other, Unknown). */
function detectPhoneCountry(phoneNumber, whatsappNumber) {
  const sources = [phoneNumber, whatsappNumber]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  if (!sources.length) return COUNTRY_UNKNOWN;

  for (const raw of sources) {
    const compact = raw.replace(/\s/g, '');
    const digits = digitsOnly(raw);
    if (!digits) continue;

    if (isSriLankaPhone(compact, digits)) return COUNTRY_SRI_LANKA;
    if (isIndiaPhone(compact, digits)) return COUNTRY_INDIA;
    if (isRussiaPhone(compact, digits)) return COUNTRY_RUSSIA;
  }

  return COUNTRY_OTHER;
}

module.exports = {
  COUNTRY_INDIA,
  COUNTRY_SRI_LANKA,
  COUNTRY_RUSSIA,
  COUNTRY_OTHER,
  COUNTRY_UNKNOWN,
  detectPhoneCountry,
};
