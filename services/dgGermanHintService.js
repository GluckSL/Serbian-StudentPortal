'use strict';

const OpenAI = require('openai');

/** German tokens that indicate the student is trying to speak German. */
const GERMAN_MARKERS =
  /\b(ich|ich|heiß|heisse|heiße|bin|mein|meine|dein|guten\s+tag|hallo|danke|bitte|auf\s+wiedersehen|tschüss|wir|ihr|sie|du|habe|haben|ist|sind|sehr|gern|möchte|moechte|können|koennen|telefon|handy|nummer|adresse|e-mail|email|buchstabieren|vorname|nachname|spreche|lerne|komme|wohne)\b/i;

/** English phrases that usually mean the student answered in English instead of German. */
const ENGLISH_MARKERS =
  /\b(my name is|my first name|my last name|first name is|last name is|surname|family name|given name|i am|i'm|i\s+am|the |hello|hi |thank you|thanks|good morning|good afternoon|nice to meet|from |please|sorry|yes\b|no\b|okay\b|sure|i think|maybe|i live|i come|i speak|mobile number|phone number|email address)\b/i;

/**
 * English country/city names that are common single-word answers to "Woher kommst du?"
 * These need a German hint even though they're only one word.
 */
const ENGLISH_LOCATIONS =
  /^(india|delhi|mumbai|bangalore|bengaluru|chennai|kolkata|hyderabad|pune|jaipur|ahmedabad|surat|lucknow|kanpur|nagpur|visakhapatnam|bhopal|patna|vadodara|ghaziabad|ludhiana|agra|nashik|faridabad|meerut|rajkot|kalyan|vasai|virar|varanasi|srinagar|aurangabad|dhanbad|amritsar|allahabad|ranchi|howrah|coimbatore|jabalpur|gwalior|vijayawada|jodhpur|madurai|raipur|kota|chandigarh|guwahati|solapur|hubballi|tiruchirappalli|thiruvananthapuram|mysore|kochi|indore|bhubaneswar|noida|gurgaon|gurugram|navi mumbai|thane|pimpri|chinchwad|pakistan|bangladesh|nepal|sri lanka|china|japan|france|germany|usa|america|united states|uk|england|canada|australia|russia|italy|spain|brazil|mexico|turkey|iran|egypt|nigeria|kenya|south africa|ghana|ethiopia|indonesia|philippines|vietnam|thailand|malaysia|singapore)$/i;

function _normLang(lang) {
  return String(lang || '').toLowerCase().replace(/\s+/g, '');
}

/** True when the last bot line was asking for a phone / mobile number. */
function _isPhoneNumberQuestion(lastAiText) {
  return /\b(handy|handynummer|telefon|telefonnummer|nummer|phone|mobile)\b/i.test(
    String(lastAiText || ''),
  );
}

/**
 * True when we should show a "say this in German" hint instead of advancing the AI turn.
 * German-only applies when the module target language is German.
 *
 * @param {string} userText
 * @param {string} moduleLanguage
 * @param {{ lastAiText?: string }} [context]
 */
function shouldRequestGermanHint(userText, moduleLanguage, context = {}) {
  const lang = _normLang(moduleLanguage);
  if (lang !== 'german' && lang !== 'deutsch' && lang !== 'de') return false;
  const t = String(userText || '').trim();
  if (!t) return false;
  const lastAi = String(context.lastAiText || '').trim();
  // Already contains clear German learner markers → allow through
  if (GERMAN_MARKERS.test(t)) return false;
  // Raw digits (e.g. phone number spoken in English) — require German phrasing
  if (/^[\d\s.\-+]+$/.test(t)) {
    return _isPhoneNumberQuestion(lastAi) || true;
  }
  // Letter-spelling without German context (e.g. "a-b-c") — still needs German
  if (/^[a-z](-[a-z])+$/i.test(t.replace(/\s+/g, ''))) return true;
  if (ENGLISH_MARKERS.test(t)) return true;
  // Single-word English location name (country/city) — needs German hint
  if (ENGLISH_LOCATIONS.test(t)) return true;
  // Long Latin sentence without umlauts / common German words — likely English
  if (t.length > 24 && !/[äöüßÄÖÜ]/.test(t) && !GERMAN_MARKERS.test(t)) {
    const words = t.split(/\s+/).length;
    if (words >= 4) return true;
  }
  return false;
}

function _openai() {
  return new OpenAI({ apiKey: process.env.DG_OPENAI_API_KEY });
}

function _timeout(ms, msg) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
}

/**
 * One short German line the student can repeat (A1), answering the last bot question.
 */
async function suggestGermanLine(lastAiText, studentEnglishText) {
  const lastAi = String(lastAiText || '').trim();
  const said = String(studentEnglishText || '').trim();

  if (!process.env.DG_OPENAI_API_KEY) {
    return _fallbackGermanLine(said, lastAi);
  }

  try {
    const openai = _openai();
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You help German A1 learners. Output exactly ONE short German sentence (max 14 words) they should say as a natural reply. German only. No quotes, labels, or English.',
          },
          {
            role: 'user',
            content: `Receptionist (German): "${lastAi}"\nStudent said (English): "${said}"\nWrite the German sentence the student should say instead.`,
          },
        ],
        max_tokens: 60,
        temperature: 0.35,
      }),
      _timeout(6000, 'German hint timeout'),
    ]);
    const line = (completion.choices[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
    return line || _fallbackGermanLine(said, lastAi);
  } catch (e) {
    console.warn('[dgGermanHintService]', e.message);
    return _fallbackGermanLine(said, lastAi);
  }
}

function _fallbackGermanLine(said, lastAi) {
  let name = '';
  const m1 = said.match(/\bmy name is\s+([a-z][a-z\s.'-]{0,40})/i);
  const m2 = said.match(/\bi am\s+([a-z][a-z\s.'-]{0,40})/i);
  const m3 = said.match(/\bi'm\s+([a-z][a-z\s.'-]{0,40})/i);
  const mLast = said.match(/\b(?:my\s+)?last name is\s+([a-z][a-z\s.'-]{0,40})/i);
  const mFirst = said.match(/\b(?:my\s+)?first name is\s+([a-z][a-z\s.'-]{0,40})/i);
  if (m1) name = m1[1].trim().split(/\s+/)[0] || '';
  else if (m2) name = m2[1].trim().split(/\s+/)[0] || '';
  else if (m3) name = m3[1].trim().split(/\s+/)[0] || '';
  else if (mLast) name = mLast[1].trim().split(/\s+/)[0] || '';
  else if (mFirst) name = mFirst[1].trim().split(/\s+/)[0] || '';
  if (name) {
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    if (/vorname|first name|given name/i.test(lastAi)) {
      return `Mein Vorname ist ${cap}.`;
    }
    if (/nachname|surname|family name|last name/i.test(lastAi)) {
      return `Mein Nachname ist ${cap}.`;
    }
    return `Guten Tag, mein Name ist ${cap}.`;
  }
  if (/wie heißen|wie heisst|ihr name|wie ist ihr name|nachname|vorname/i.test(lastAi)) {
    return 'Guten Tag, mein Name ist …';
  }
  if (_isPhoneNumberQuestion(lastAi)) {
    const digits = said.replace(/\D/g, '');
    if (digits) {
      return `Meine Handynummer ist ${digits.split('').join(' ')}.`;
    }
    return 'Meine Handynummer ist …';
  }
  // Location/origin answer
  if (ENGLISH_LOCATIONS.test(said.trim())) {
    const cityMap = {
      india: 'Indien', delhi: 'Delhi', mumbai: 'Mumbai', bangalore: 'Bangalore',
      bengaluru: 'Bangalore', chennai: 'Chennai', kolkata: 'Kolkata', hyderabad: 'Hyderabad',
      pune: 'Pune', pakistan: 'Pakistan', bangladesh: 'Bangladesch', nepal: 'Nepal',
      'sri lanka': 'Sri Lanka', china: 'China', japan: 'Japan', france: 'Frankreich',
      germany: 'Deutschland', usa: 'den USA', america: 'Amerika',
      'united states': 'den USA', uk: 'Großbritannien', england: 'England',
      canada: 'Kanada', australia: 'Australien', russia: 'Russland', italy: 'Italien',
      spain: 'Spanien', brazil: 'Brasilien', mexico: 'Mexiko', turkey: 'der Türkei',
    };
    const key = said.trim().toLowerCase();
    const dePlace = cityMap[key] || said.trim();
    const prep = dePlace.startsWith('den ') || dePlace.startsWith('der ') ? 'aus' : 'aus';
    return `Ich komme aus ${dePlace}.`;
  }
  return 'Bitte antworten Sie auf Deutsch.';
}

module.exports = {
  shouldRequestGermanHint,
  suggestGermanLine,
};
