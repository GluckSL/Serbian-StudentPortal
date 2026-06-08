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

module.exports = {
  chat,
  isConfigured,
  buildFallbackReply
};
