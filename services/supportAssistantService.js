const OpenAI = require('openai');

const SYSTEM_PROMPT = `You are the Glück Global 24/7 Help Assistant for the Glück Global learning portal.
Your role is to help students, teachers, and staff with portal-related questions.

You can help with:
- Login and account access
- Payments and subscriptions
- Classes, meetings, and Zoom
- Video and audio issues
- Course materials and learning modules
- Technical errors on the portal
- Account settings and profile

Guidelines:
- Be warm, professional, and concise (2–4 short paragraphs max).
- Give clear step-by-step instructions when troubleshooting.
- If you cannot resolve an issue, suggest raising a support ticket (Help & Support → Raise Ticket) or emailing support@gluckglobal.com.
- Do not invent features that do not exist on the portal.
- Do not share passwords, API keys, or internal admin details.
- If the user asks about German language learning content, briefly help but note that the AI Tutor in their course is best for language practice.`;

let _client = null;

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.DG_OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!_client) _client = new OpenAI({ apiKey });
  return _client;
}

function isConfigured() {
  return !!getClient();
}

function buildFallbackReply(message) {
  const text = String(message || '').toLowerCase();
  if (/login|password|sign in|access/.test(text)) {
    return 'For login issues, try resetting your password from the login page. If that does not work, use Help & Support → Raise Ticket and include a screenshot of the error.';
  }
  if (/payment|invoice|pay|subscription/.test(text)) {
    return 'For payment questions, check Payment Hub in your dashboard or contact support@gluckglobal.com with your registered email. You can also raise a ticket under Help & Support.';
  }
  if (/class|zoom|meeting|video|audio/.test(text)) {
    return 'For class or meeting issues, ensure your browser allows camera/microphone, refresh the page, and try Chrome. If the problem continues, raise a ticket with a screenshot.';
  }
  return 'Thanks for reaching out! I am here 24/7 to help with the Glück Global portal. Please describe your issue in a bit more detail, or raise a support ticket for faster human follow-up.';
}

async function chat(messages, userContext = {}) {
  const history = Array.isArray(messages) ? messages : [];
  const trimmed = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: String(m.content).trim().slice(0, 2000) }));

  const lastUser = [...trimmed].reverse().find((m) => m.role === 'user');
  if (!lastUser) {
    throw new Error('Message is required.');
  }

  const client = getClient();
  if (!client) {
    return {
      reply: buildFallbackReply(lastUser.content),
      fallback: true
    };
  }

  const contextBits = [];
  if (userContext.name) contextBits.push(`User name: ${userContext.name}`);
  if (userContext.email) contextBits.push(`User email: ${userContext.email}`);
  if (userContext.role) contextBits.push(`User role: ${userContext.role}`);

  const systemContent =
    contextBits.length > 0
      ? `${SYSTEM_PROMPT}\n\nCurrent user context:\n${contextBits.join('\n')}`
      : SYSTEM_PROMPT;

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemContent }, ...trimmed],
    max_tokens: 450,
    temperature: 0.65
  });

  const reply = (completion.choices[0]?.message?.content || '').trim();
  return {
    reply: reply || buildFallbackReply(lastUser.content),
    fallback: false
  };
}

const CATEGORY_LABELS = {
  login: 'Login / Access Issue',
  payment: 'Payment Problem',
  class: 'Class / Meeting Issue',
  video: 'Video / Audio Issue',
  course: 'Course Material',
  technical: 'Technical Error',
  account: 'Account Settings',
  other: 'Other'
};

function buildFallbackTicketReply(ticket, draft = '') {
  const name = String(ticket?.name || 'there').split(' ')[0] || 'there';
  const draftTrimmed = String(draft || '').trim();
  if (draftTrimmed) {
    return `Hello ${name},\n\n${draftTrimmed}\n\nRegards,\nGlück Global Support Team`;
  }
  return `Hello ${name},\n\nThank you for contacting Glück Global Support regarding "${ticket?.subject || 'your request'}". We have reviewed your message and will help you with the next steps shortly. If you have any additional details, please reply on this ticket.\n\nRegards,\nGlück Global Support Team`;
}

/**
 * Generate or polish an admin reply for a support ticket.
 * @param {{ ticket: object, draft?: string, studentContext?: object }} opts
 */
async function generateAdminTicketReply({ ticket, draft = '', studentContext = {} }) {
  const draftTrimmed = String(draft || '').trim();
  const isPolish = draftTrimmed.length > 0;
  const categoryLabel = CATEGORY_LABELS[ticket?.category] || ticket?.category || 'General';
  const priorReplies = (ticket?.replies || [])
    .map((r, i) => `Reply ${i + 1} (${r.authorRole || 'ADMIN'}): ${r.message}`)
    .join('\n');

  const studentBits = [];
  if (studentContext.regNo) studentBits.push(`Student ID: ${studentContext.regNo}`);
  if (studentContext.batch) studentBits.push(`Batch: ${studentContext.batch}`);
  if (studentContext.level) studentBits.push(`Level: ${studentContext.level}`);
  if (studentContext.plan) studentBits.push(`Plan: ${studentContext.plan}`);
  if (studentContext.teacherName) studentBits.push(`Assigned teacher: ${studentContext.teacherName}`);

  const client = getClient();
  if (!client) {
    return { reply: buildFallbackTicketReply(ticket, draftTrimmed), fallback: true };
  }

  const systemPrompt = `You are a support specialist for Glück Global, a German language learning portal.
Write professional, warm replies to students on support tickets.
- Use plain text only (no markdown, no bullet symbols like •).
- Address the student by first name when natural.
- Be helpful and specific to their issue.
- Sign off with "Regards," then a new line, then "Glück Global Support Team" unless polishing a draft that already has a complete sign-off.
- Do not invent exact class schedules, Zoom links, or policies unless provided in context.
- Keep replies concise (2–5 short paragraphs).`;

  const contextBlock = [
    `Student: ${ticket.name} (${ticket.email})`,
    `Subject: ${ticket.subject}`,
    `Category: ${categoryLabel}`,
    `Priority: ${ticket.priority}`,
    `Student message: ${ticket.description}`,
    ...studentBits
  ].join('\n');

  const userPrompt = isPolish
    ? `Polish and improve this admin draft reply for a support ticket. Keep the same intent and facts; improve tone, clarity, and professionalism. Return only the improved reply text.

Ticket context:
${contextBlock}
${priorReplies ? `\nPrevious replies:\n${priorReplies}` : ''}

Admin draft to polish:
${draftTrimmed}`
    : `Write a formal, helpful support reply to this ticket. Return only the reply text.

Ticket context:
${contextBlock}
${priorReplies ? `\nPrevious replies (do not repeat unnecessarily):\n${priorReplies}` : ''}`;

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 600,
    temperature: 0.55
  });

  const reply = (completion.choices[0]?.message?.content || '').trim();
  return {
    reply: reply || buildFallbackTicketReply(ticket, draftTrimmed),
    fallback: false
  };
}

module.exports = {
  chat,
  isConfigured,
  buildFallbackReply,
  generateAdminTicketReply,
  buildFallbackTicketReply
};
