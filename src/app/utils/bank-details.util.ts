/** Bank transfer details (same as student invoice PDFs). */

export interface BankDetailRow {
  label: string;
  value: string;
}

export const BANK_DETAILS_INR: BankDetailRow[] = [
  { label: 'Account Name', value: 'GLUCK GLOBAL PRIVATE LIMITED' },
  { label: 'Account No', value: '0021001010654' },
  { label: 'Bank Name', value: 'Cosmos Co-operative Bank Ltd' },
  { label: 'IFSC', value: 'COSB0000002' },
  { label: 'Branch', value: 'Khadki' },
  { label: 'Currency', value: 'Indian Rupee (INR)' },
];

export const BANK_DETAILS_LKR: BankDetailRow[] = [
  { label: 'Beneficiary Name', value: 'Glück Global Pvt Ltd' },
  { label: 'Account Number', value: '115511485187' },
  { label: 'Bank Name', value: 'National Development Bank PLC' },
  { label: 'Bank Address', value: 'No 133, Kotugodella Street, Kandy' },
  { label: 'Bank Code', value: '7214' },
  { label: 'Branch Code', value: '002' },
  { label: 'SWIFT Code', value: 'NDBSLKLX' },
  { label: 'Currency', value: 'Sri Lankan Rupee (LKR)' },
];

/** Infer INR vs LKR from phone / WhatsApp (country code or local patterns). */
export function detectCurrencyFromPhone(phone?: string, whatsapp?: string): 'INR' | 'LKR' {
  const sources = [phone, whatsapp].filter((s) => !!String(s || '').trim());
  for (const raw of sources) {
    const t = String(raw).trim();
    const digits = t.replace(/\D/g, '');
    if (!digits) continue;

    if (/^(\+?94|0094)/.test(t.replace(/\s/g, '')) || digits.startsWith('94')) {
      return 'LKR';
    }
    if (/^(\+?91|0091)/.test(t.replace(/\s/g, '')) || digits.startsWith('91')) {
      return 'INR';
    }
    // Sri Lanka mobile: 07xxxxxxxx (10 digits) or 7xxxxxxxx (9 digits)
    if ((digits.length === 10 && digits.startsWith('07')) || (digits.length === 9 && digits.startsWith('7'))) {
      return 'LKR';
    }
    // India mobile without country code: 10 digits starting 6–9
    if (digits.length === 10 && /^[6-9]/.test(digits)) {
      return 'INR';
    }
  }
  return 'INR';
}

export function formatMoney(amount: number, currency: 'INR' | 'LKR'): string {
  const symbol = currency === 'LKR' ? 'LKR ' : '₹';
  return `${symbol}${amount.toLocaleString('sr-Latn-RS')}`;
}
