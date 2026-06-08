/**
 * Olly — Glück Global 24/7 AI Assistant Service
 * Fox character | Supports English, Tamil, Sinhala
 * Read-only portal context for the logged-in student
 */

const OpenAI = require('openai');
const User = require('../models/User');
const StudentPayment = require('../models/StudentPayment');
const SupportTicket = require('../models/SupportTicket');

let _client = null;
function getClient() {
  const key = process.env.OPENAI_API_KEY || process.env.DG_OPENAI_API_KEY;
  if (!key) return null;
  if (!_client) _client = new OpenAI({ apiKey: key });
  return _client;
}

// ── System Prompts (one per language) ──────────────────────────────────────

const SYSTEM_PROMPTS = {
  en: `You are Olly, the friendly 24/7 support assistant for the Glück Global student portal.
You are a cheerful, helpful fox 🦊 who is always available to help students, teachers, and staff.

STRICT RULES:
1. ONLY answer questions related to the Glück Global portal, courses, payments, subscriptions, classes, technical issues, account settings, or documents.
2. If asked anything unrelated (news, weather, general knowledge, prices of goods, etc.), politely decline and redirect the user to portal topics.
3. Never reveal internal system details, other students' data, API keys, or admin credentials.
4. Keep responses concise — 2 to 5 sentences unless a step-by-step guide is needed.
5. Always be warm, encouraging, and professional.
6. If you cannot resolve an issue, suggest: "Raise a Support Ticket" or "Talk to a Real Agent".

PORTAL TOPICS YOU KNOW:
- Login, password reset, account access
- Subscription plans (Silver, Platinum, GO, Visa Doc, etc.)
- Payment records, pending amounts, payment methods
- Course levels (A1, A2, B1, B2, C1, C2) and course materials
- Class schedules, Zoom meetings, recordings
- Student documents, assignments, progress
- Technical issues (video, audio, browser, app)
- Job portal, announcements, timetable

When student portal data is provided in the context, use it to give personalised answers.

ACTIVITY-AWARE DIAGNOSIS (critical):
- When ACTIVITY CONTEXT is provided, read it carefully BEFORE answering.
- If watchOnlyMode is true on a vocab/video exercise: NO microphone button is shown — this is intentional. If the student says "mic not working" or "mic button missing", explain they are in Watch Only mode and should use Replay / Next Clip — do NOT tell them to enable mic permissions.
- If micRequired is true and micVisible is true but student has mic issues: give browser permission steps (Chrome, allow mic, refresh, try Test microphone button if available).
- Always reference the specific exercise title, question number, and activity type when relevant.
- Distinguish between a real technical bug vs expected portal behaviour based on the activity mode.`,

  ta: `நீங்கள் Olly, Glück Global மாணவர் போர்ட்டலின் 24/7 உதவி உதவியாளர்.
நீங்கள் ஒரு நட்பான, உதவிகரமான நரி 🦊 — எப்பொழுதும் மாணவர்கள், ஆசிரியர்கள் மற்றும் ஊழியர்களுக்கு உதவ தயாராக இருக்கிறீர்கள்.

கடுமையான விதிகள்:
1. Glück Global போர்ட்டல், படிப்புகள், கட்டணங்கள், வகுப்புகள், தொழில்நுட்ப சிக்கல்கள் அல்லது கணக்கு அமைப்புகள் தொடர்பான கேள்விகளுக்கு மட்டுமே பதிலளிக்கவும்.
2. தொடர்பற்ற கேள்விகளுக்கு (செய்திகள், விலைகள், பொது அறிவு) கடவும் மறுத்து போர்ட்டல் தலைப்புகளுக்கு திருப்பவும்.
3. உள் அமைப்பு தகவல்கள், பிற மாணவர் தரவு அல்லது நிர்வாக தகவல்களை வெளியிட வேண்டாம்.
4. பதில்களை சுருக்கமாக வைக்கவும் — 2 முதல் 5 வாக்கியங்கள் போதுமானது.
5. எப்பொழுதும் அன்பாகவும், ஊக்கமளிக்கும் விதத்திலும் இருக்கவும்.
6. சிக்கலை தீர்க்க முடியாவிட்டால்: "Support Ticket தாக்கல் செய்யுங்கள்" அல்லது "உண்மையான Agent-ஐ தொடர்பு கொள்ளுங்கள்" என்று பரிந்துரைக்கவும்.

மாணவர் போர்ட்டல் தரவு வழங்கப்பட்டால், தனிப்பட்ட பதில்களை வழங்க அதைப் பயன்படுத்தவும்.`,

  si: `ඔබ Olly, Glück Global ශිෂ්‍ය portal-ට 24/7 සහාය සහකාරය.
ඔබ හිතවත්, සහාය ලොව 🦊 — සිසුන්, ගුරුවරුන් සහ කාර්ය මණ්ඩලයට සෑම විටම සහාය වීමට සූදානම්.

දැඩි නීති:
1. Glück Global portal, පාඨමාලා, ගෙවීම්, පන්ති, තාක්ෂණික ගැටළු, හෝ ගිණුම් සැකසුම් සම්බන්ධ ප්‍රශ්නවලට පමණක් පිළිතුරු දෙන්න.
2. අදාළ නොවන ප්‍රශ්නවලට (ප්‍රවෘත්ති, මිල ගණන්, පොදු දැනුම) ආචාරශීලීව ප්‍රතික්ෂේප කර portal මාතෘකාවලට යොමු කරන්න.
3. අභ්‍යන්තර පද්ධති තොරතුරු, වෙනත් සිසු දත්ත, හෝ පරිපාලන තොරතුරු හෙළිදරව් නොකරන්න.
4. ප්‍රතිචාර කෙටි කරන්න — 2 සිට 5 වාක්‍ය ප්‍රමාණවත්.
5. සෑම විටම ආදරණීයව, දිරිගැන්වීමේ ලෙස ඉන්න.
6. ගැටළුව විසඳිය නොහැකි නම්: "Support Ticket ඉදිරිපත් කරන්න" හෝ "සැබෑ Agent සමඟ කතා කරන්න" යෝජනා කරන්න.

ශිෂ්‍ය portal දත්ත ලබා දී ඇත්නම්, පුද්ගලාරෝපිත පිළිතුරු ලබා දීමට එය භාවිත කරන්න.`
};

const GUARD_PHRASES = {
  en: "I'm Olly, your Glück Global portal assistant 🦊 I can only help with portal-related questions — courses, payments, classes, or account issues. For other topics, please use a general search. Is there anything about the portal I can help you with?",
  ta: "நான் Olly, உங்கள் Glück Global போர்ட்டல் உதவியாளர் 🦊 போர்ட்டல் தொடர்பான கேள்விகளுக்கு மட்டுமே உதவ முடியும் — படிப்புகள், கட்டணங்கள், வகுப்புகள் அல்லது கணக்கு சிக்கல்கள். வேறு தலைப்புகளுக்கு பொது தேடலை பயன்படுத்துங்கள். போர்ட்டல் பற்றி ஏதாவது உதவி தேவையா?",
  si: "මම Olly, ඔබේ Glück Global portal සහකාරය 🦊 portal සම්බන්ධ ප්‍රශ්නවලට පමණක් සහාය දිය හැකියි — පාඨමාලා, ගෙවීම්, පන්ති, ගිණුම් ගැටළු. අනෙකුත් මාතෘකා සඳහා සාමාන්‍ය සෙවුමක් භාවිත කරන්න. Portal ගැන කිසිවක් උදව් කළ හැකිද?"
};

const OFF_TOPIC_PATTERNS = [
  /what is the price of/i, /how much does .* cost/i, /recipe for/i, /weather in/i,
  /stock market/i, /cricket score/i, /football/i, /movie/i, /song/i, /joke/i,
  /who is the president/i, /capital of/i, /history of/i, /meaning of life/i,
  /write me a poem/i, /write a story/i, /write code/i, /debug my code/i,
  /car price/i, /phone price/i, /laptop/i, /bitcoin/i, /crypto/i
];

function isOffTopic(message) {
  return OFF_TOPIC_PATTERNS.some((p) => p.test(message));
}

// ── Portal Context Fetcher (read-only) ─────────────────────────────────────

async function fetchPortalContext(userId) {
  if (!userId) return null;
  try {
    const [user, payment, tickets] = await Promise.all([
      User.findById(userId)
        .select('name email regNo role subscription level batch medium studentStatus subscriptionExpiry batchStartedOn teacherIncharge currentCourseDay languageExamStatus examScores servicesOpted lastLogin')
        .lean(),
      StudentPayment.findOne({ studentId: userId })
        .select('totalPackageAmount totalPaid totalInvoiced pendingPayment currency currentStatus serviceOpted payments notes')
        .lean(),
      SupportTicket.find({ userId })
        .select('ticketNumber subject status createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
    ]);

    if (!user) return null;

    const ctx = [];
    ctx.push(`=== Student Portal Profile ===`);
    ctx.push(`Name: ${user.name}`);
    ctx.push(`Registration No: ${user.regNo}`);
    ctx.push(`Email: ${user.email}`);
    ctx.push(`Role: ${user.role}`);
    if (user.role === 'STUDENT') {
      ctx.push(`Subscription: ${user.subscription || 'N/A'}`);
      ctx.push(`Level: ${user.level || 'N/A'}`);
      ctx.push(`Batch: ${user.batch || 'N/A'}`);
      ctx.push(`Student Status: ${user.studentStatus || 'N/A'}`);
      ctx.push(`Medium: ${(user.medium || []).join(', ') || 'N/A'}`);
      ctx.push(`Teacher-in-Charge: ${user.teacherIncharge || 'N/A'}`);
      ctx.push(`Course Day: ${user.currentCourseDay || 1}`);
      ctx.push(`Subscription Expiry: ${user.subscriptionExpiry ? new Date(user.subscriptionExpiry).toLocaleDateString() : 'N/A'}`);
      ctx.push(`Exam Status: ${user.languageExamStatus || 'N/A'}`);
      if (user.examScores && Object.values(user.examScores).some(v => v !== null)) {
        const s = user.examScores;
        ctx.push(`Exam Scores: Reading=${s.reading ?? '-'}, Listening=${s.listening ?? '-'}, Writing=${s.writing ?? '-'}, Speaking=${s.speaking ?? '-'}`);
      }
    }
    ctx.push(`Last Login: ${user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'N/A'}`);

    if (payment) {
      ctx.push(`\n=== Payment Summary ===`);
      ctx.push(`Currency: ${payment.currency}`);
      ctx.push(`Total Package Amount: ${payment.totalPackageAmount}`);
      ctx.push(`Total Paid: ${payment.totalPaid}`);
      ctx.push(`Pending Payment: ${payment.pendingPayment}`);
      ctx.push(`Payment Status: ${payment.currentStatus || 'N/A'}`);
      ctx.push(`Services Opted: ${payment.serviceOpted || 'N/A'}`);
      if (payment.payments && payment.payments.length > 0) {
        const recent = payment.payments.slice(-3);
        ctx.push(`Recent Payments (last 3):`);
        recent.forEach((p) => {
          ctx.push(`  - ${payment.currency} ${p.amount} on ${new Date(p.date).toLocaleDateString()} via ${p.method || 'N/A'}${p.note ? ` (${p.note})` : ''}`);
        });
      }
    }

    if (tickets && tickets.length > 0) {
      ctx.push(`\n=== Recent Support Tickets ===`);
      tickets.forEach((t) => {
        ctx.push(`  Ticket ${t.ticketNumber}: "${t.subject}" — Status: ${t.status}, Raised: ${new Date(t.createdAt).toLocaleDateString()}`);
      });
    }

    return ctx.join('\n');
  } catch (err) {
    console.error('[olly] fetchPortalContext error:', err.message);
    return null;
  }
}

// ── Main chat function ─────────────────────────────────────────────────────

const ISSUE_TYPE_LABELS = {
  technical: 'Technical Issue',
  language: 'Language / Course Help',
  payment: 'Payment & Subscription',
  login: 'Login & Access',
  class: 'Class / Zoom / Meeting',
  course: 'Course Materials',
  account: 'Account & Profile',
  documents: 'Documents & Visa',
  other: 'Other'
};

function getIssueTypeLabel(issueType) {
  if (!issueType) return '';
  return ISSUE_TYPE_LABELS[issueType] || String(issueType);
}

function formatActivityContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const lines = [];
  if (ctx.pageLabel) lines.push(`Page: ${ctx.pageLabel}`);
  if (ctx.activityType) lines.push(`Activity type: ${ctx.activityType}`);
  if (ctx.exerciseTitle) lines.push(`Exercise: ${ctx.exerciseTitle}`);
  if (ctx.exerciseCategory) lines.push(`Category: ${ctx.exerciseCategory}`);
  if (ctx.exerciseLevel) lines.push(`Level: ${ctx.exerciseLevel}`);
  if (ctx.exerciseType) lines.push(`Question format: ${ctx.exerciseType}`);
  if (ctx.watchOnlyMode === true) {
    lines.push('Mode: WATCH ONLY — student watches video clips only. Microphone is NOT shown and NOT required.');
  } else if (ctx.micRequired === true) {
    lines.push('Mode: Interactive — microphone/speaking is required for this activity.');
  }
  if (ctx.micVisible === false) lines.push('Microphone button visible: No');
  if (ctx.micVisible === true) lines.push('Microphone button visible: Yes');
  if (ctx.currentQuestionIndex != null && ctx.totalQuestions) {
    lines.push(`Progress: clip/question ${Number(ctx.currentQuestionIndex) + 1} of ${ctx.totalQuestions}`);
  }
  if (ctx.currentQuestionType) lines.push(`Current question type: ${ctx.currentQuestionType}`);
  if (ctx.currentQuestionPrompt) lines.push(`Current prompt/phrase: ${ctx.currentQuestionPrompt}`);
  if (ctx.videoPlaybackEnded === true) lines.push('Video status: clip finished — action buttons should be visible');
  if (ctx.videoPlaybackEnded === false) lines.push('Video status: clip still playing');
  return lines.join('\n');
}

async function chat({ messages, language = 'en', userId = null, issueType = null, initialQuestion = null, activityContext = null }) {
  const lang = ['en', 'ta', 'si'].includes(language) ? language : 'en';
  const history = Array.isArray(messages) ? messages : [];

  const lastUserMsg = [...history].reverse().find((m) => m?.role === 'user' && String(m.content || '').trim());
  if (!lastUserMsg) throw new Error('At least one user message is required.');

  const userText = String(lastUserMsg.content || '').trim();

  // Off-topic guard
  if (isOffTopic(userText)) {
    return { reply: GUARD_PHRASES[lang], offTopic: true };
  }

  const client = getClient();
  if (!client) {
    return { reply: getFallbackReply(userText, lang, activityContext), fallback: true };
  }

  // Fetch portal context
  const portalCtx = userId ? await fetchPortalContext(userId) : null;

  const intakeBits = [];
  if (issueType) intakeBits.push(`Issue type: ${getIssueTypeLabel(issueType)}`);
  if (initialQuestion) intakeBits.push(`Student's opening question: ${initialQuestion}`);
  const intakeBlock = intakeBits.length
    ? `\n\nCHAT INTAKE (use throughout this conversation):\n${intakeBits.join('\n')}`
    : '';

  const activityBlock = formatActivityContext(activityContext);
  const activitySection = activityBlock
    ? `\n\nACTIVITY CONTEXT (what the student was doing when they asked — use for diagnosis):\n${activityBlock}`
    : '';

  const systemContent = portalCtx
    ? `${SYSTEM_PROMPTS[lang]}${intakeBlock}${activitySection}\n\nLIVE PORTAL DATA FOR THIS USER (use this to give personalised answers):\n${portalCtx}`
    : `${SYSTEM_PROMPTS[lang]}${intakeBlock}${activitySection}`;

  const trimmedHistory = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: String(m.content).trim().slice(0, 3000) }));

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemContent }, ...trimmedHistory],
    max_tokens: 500,
    temperature: 0.65
  });

  const reply = (completion.choices[0]?.message?.content || '').trim();
  return { reply: reply || getFallbackReply(userText, lang, activityContext), fallback: false };
}

// ── Fallback replies (no OpenAI) ──────────────────────────────────────────

function getFallbackReply(text, lang = 'en', activityContext = null) {
  const t = text.toLowerCase();
  const ctx = activityContext || {};
  const micIssue = /mic|microphone|speak|audio|record|voice/.test(t);

  if (micIssue && ctx.watchOnlyMode === true) {
    const watchReplies = {
      en: `You're in Watch Only mode for "${ctx.exerciseTitle || 'this vocab video'}" — no microphone is needed here. Watch each clip, then tap Replay or Next Clip when the video finishes. If a clip won't play, refresh the page or try Chrome.`,
      ta: `நீங்கள் "${ctx.exerciseTitle || 'இந்த vocab video'}" Watch Only mode-ல் உள்ளீர்கள் — இங்கே microphone தேவையில்லை. ஒவ்வொரு clip-ஐயும் பார்த்து, முடிந்ததும் Replay அல்லது Next Clip அழுத்துங்கள்.`,
      si: `ඔබ "${ctx.exerciseTitle || 'මෙම vocab video'}" Watch Only mode එකේ — මෙහි microphone අවශ්‍ය නැත. clip එක බලා, අවසන් වූ පසු Replay හෝ Next Clip ඔබන්න.`
    };
    return watchReplies[lang] || watchReplies.en;
  }

  if (micIssue && ctx.micRequired === true) {
    const micReplies = {
      en: 'For microphone issues: allow mic permission in your browser (click the lock icon in the address bar), use Chrome, refresh the page, and try the "Test microphone" button if available on the exercise.',
      ta: 'Microphone சிக்கல்களுக்கு: browser-ல் mic permission அனுமதிக்கவும், Chrome பயன்படுத்தவும், page refresh செய்யவும்.',
      si: 'Microphone ගැටළු සඳහා: browser-හි mic permission ලබා දෙන්න, Chrome භාවිත කරන්න, page refresh කරන්න.'
    };
    return micReplies[lang] || micReplies.en;
  }
  const msgs = {
    en: {
      login: 'For login issues, use "Forgot Password" on the login page or raise a support ticket.',
      payment: 'For payment questions, your payment summary shows total paid and pending amounts. Please raise a ticket for disputes.',
      class: 'For class or Zoom issues, refresh the page, try Chrome, and ensure camera/mic permissions are granted.',
      course: 'Your course materials are available in "My Course" section in the portal.',
      default: "Hi! I'm Olly 🦊 Please describe your portal issue and I'll do my best to help!"
    },
    ta: {
      login: 'உள்நுழைவு சிக்கல்களுக்கு, "Forgot Password" ஐ பயன்படுத்துங்கள் அல்லது support ticket தாக்கல் செய்யுங்கள்.',
      payment: 'கட்டண கேள்விகளுக்கு, உங்கள் payment summary-ல் தொகை தகவல்கள் உள்ளன. சிக்கல்களுக்கு ticket தாக்கல் செய்யுங்கள்.',
      class: 'வகுப்பு/Zoom சிக்கல்களுக்கு, பக்கத்தை புதுப்பித்து Chrome-ஐ முயற்சிக்கவும்.',
      course: 'படிப்பு பொருட்கள் போர்ட்டலில் "My Course" பகுதியில் உள்ளன.',
      default: "வணக்கம்! நான் Olly 🦊 உங்கள் போர்ட்டல் சிக்கலை விவரியுங்கள், உதவ முயற்சிக்கிறேன்!"
    },
    si: {
      login: 'ලොගින් ගැටළු සඳහා "Forgot Password" භාවිත කරන්න හෝ support ticket ඉදිරිපත් කරන්න.',
      payment: 'ගෙවීම් ප්‍රශ්නවලට, ඔබේ payment summary-ල් මුදල් තොරතුරු ඇත. ගැටළු සඳහා ticket ඉදිරිපත් කරන්න.',
      class: 'පන්ති/Zoom ගැටළු සඳහා, page refresh කර Chrome භාවිත කරන්න.',
      course: 'පාඨමාලා ද්‍රව්‍ය portal-ලේ "My Course" කොටසේ ඇත.',
      default: "ආයුබෝවන්! මම Olly 🦊 ඔබේ portal ගැටළුව විස්තර කරන්න, සහාය දීමට උත්සාහ කරන්නම්!"
    }
  };
  const set = msgs[lang] || msgs.en;
  if (/login|password|sign in|access/.test(t)) return set.login;
  if (/payment|invoice|pay|amount|pending/.test(t)) return set.payment;
  if (/class|zoom|meeting|video|audio/.test(t)) return set.class;
  if (/course|material|lesson|module/.test(t)) return set.course;
  return set.default;
}

module.exports = {
  chat,
  fetchPortalContext,
  isOffTopic,
  getFallbackReply,
  getIssueTypeLabel,
  ISSUE_TYPE_LABELS,
  formatActivityContext
};
