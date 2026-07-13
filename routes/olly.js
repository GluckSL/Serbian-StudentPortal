/**
 * /api/olly  — Olly 24/7 AI Assistant routes
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const OllySession = require('../models/OllySession');
const User = require('../models/User');
const ollyService = require('../services/ollyService');
const { verifyToken, checkRole, extractBearerToken } = require('../middleware/auth');
const transporter = require('../config/emailConfig');
const mediaUpload = require('../config/ollyMediaUpload');
const { r2Client, R2_BUCKET } = require('../config/r2');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const JWT_SECRET = process.env.JWT_SECRET;
const SUPPORT_EMAIL = process.env.EMAIL_USER || 'languageschool@gluckglobal.com';

// ── Helper: resolve optional auth ──────────────────────────────────────────
function resolveUserFromToken(req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded || null;
  } catch {
    return null;
  }
}

function parseActivityContext(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function normalizeUserId(id) {
  return id ? String(id) : null;
}

/** Ensure a stored Olly session is only accessed by the account that owns it. */
function sessionBelongsToUser(session, decoded) {
  const sessionUserId = normalizeUserId(session?.userId);
  const requestUserId = normalizeUserId(decoded?.id);
  if (!sessionUserId && !requestUserId) return true;
  if (!sessionUserId || !requestUserId) return false;
  return sessionUserId === requestUserId;
}

function denySessionAccess(res) {
  return res.status(403).json({ success: false, message: 'Session does not belong to this account.' });
}

// ── Helper: generate a presigned R2 URL for Olly media ────────────────────
async function presignOllyUrl(key) {
  if (!key) return null;
  try {
    const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
    return await getSignedUrl(r2Client, command, { expiresIn: 86400 });
  } catch (err) {
    console.error('[olly] presign failed for key:', key, err.message);
    return null;
  }
}

// ── POST /api/olly/session  — create or return existing session ─────────────
router.post('/session', async (req, res) => {
  try {
    const decoded = resolveUserFromToken(req);
    let sessionId = req.body?.sessionId || null;
    const language = req.body?.language || 'en';

    // If client already has a sessionId, try to resume
    if (sessionId) {
      const existing = await OllySession.findOne({ sessionId }).lean();
      if (existing && existing.status !== 'closed' && sessionBelongsToUser(existing, decoded)) {
        return res.json({
          success: true,
          data: {
            sessionId: existing.sessionId,
            status: existing.status,
            language: existing.language,
            intakeComplete: !!existing.intakeComplete
          }
        });
      }
    }

    // Fetch user info if logged in
    let userName = 'Guest', userEmail = '', userRole = 'GUEST', userId = null;
    if (decoded?.id) {
      const user = await User.findById(decoded.id).select('name email role').lean();
      if (user) { userName = user.name; userEmail = user.email; userRole = user.role; userId = user._id; }
    }

    const newId = uuidv4();
    const session = new OllySession({
      sessionId: newId,
      userId,
      userName,
      userEmail,
      userRole,
      language,
      status: 'active'
    });
    await session.save();
    return res.json({ success: true, data: { sessionId: newId, status: 'active', language, intakeComplete: false } });
  } catch (err) {
    console.error('[olly/session]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to start session.' });
  }
});

// ── POST /api/olly/intake  — start chat with type, question, optional media ─
router.post('/intake', (req, res, next) => {
  mediaUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message || 'Upload failed.' });
    next();
  });
}, async (req, res) => {
  try {
    const issueType = String(req.body?.issueType || '').trim();
    const question = String(req.body?.question || '').trim();
    const language = req.body?.language || 'en';
    let sessionId = req.body?.sessionId || null;
    const activityContext = parseActivityContext(req.body?.activityContext);

    if (!issueType) {
      return res.status(400).json({ success: false, message: 'Issue type is required.' });
    }
    if (!question || question.length < 5) {
      return res.status(400).json({ success: false, message: 'Please describe your question (at least 5 characters).' });
    }

    const decoded = resolveUserFromToken(req);
    let userName = 'Guest';
    let userEmail = '';
    let userRole = 'GUEST';
    let userId = null;
    if (decoded?.id) {
      const user = await User.findById(decoded.id).select('name email role').lean();
      if (user) {
        userName = user.name;
        userEmail = user.email;
        userRole = user.role;
        userId = user._id;
      }
    }

    let session = sessionId ? await OllySession.findOne({ sessionId }) : null;
    if (session && !sessionBelongsToUser(session, decoded)) {
      return denySessionAccess(res);
    }
    if (session && session.intakeComplete) {
      return res.status(400).json({ success: false, message: 'Session already started. Continue in chat.' });
    }
    if (!session) {
      session = new OllySession({
        sessionId: uuidv4(),
        userId,
        userName,
        userEmail,
        userRole,
        language,
        status: 'active'
      });
    }

    const typeLabel = ollyService.getIssueTypeLabel(issueType);
    const isFirstIntake = !session.intakeComplete;
    session.issueType = issueType;
    session.initialQuestion = question;
    session.intakeComplete = true;
    session.language = language;
    session.activityContext = activityContext || null;
    if (isFirstIntake) {
      session.messages = [];
    }

    if (req.file) {
      const presigned = await presignOllyUrl(req.file.key);
      const mediaUrl = presigned || req.file.location || req.file.path;
      session.messages.push({
        role: 'user',
        content: `[Shared: ${req.file.originalname}]`,
        mediaUrl,
        mediaType: req.file.mimetype,
        mediaOriginalName: req.file.originalname,
        timestamp: new Date()
      });
    }

    const userContent = `[${typeLabel}] ${question}`;
    session.messages.push({
      role: 'user',
      content: userContent,
      timestamp: new Date()
    });

    const historyForAI = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const result = await ollyService.chat({
      messages: historyForAI,
      language,
      userId: session.userId,
      issueType,
      initialQuestion: question,
      activityContext: session.activityContext
    });

    session.messages.push({
      role: 'assistant',
      content: result.reply,
      timestamp: new Date()
    });
    await session.save();

    return res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        intakeComplete: true,
        issueType: session.issueType,
        reply: result.reply,
        messages: session.messages
      }
    });
  } catch (err) {
    console.error('[olly/intake]', err.message);
    return res.status(500).json({ success: false, message: 'Unable to start chat. Please try again.' });
  }
});

// ── POST /api/olly/chat  — send message, get Olly reply ────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { sessionId, message, language, activityContext: rawActivityContext } = req.body;
    if (!sessionId || !String(message || '').trim()) {
      return res.status(400).json({ success: false, message: 'sessionId and message are required.' });
    }

    const session = await OllySession.findOne({ sessionId });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    if (!sessionBelongsToUser(session, resolveUserFromToken(req))) {
      return denySessionAccess(res);
    }

    // If with live agent, don't call AI
    if (session.status === 'with_agent') {
      const userMsg = { role: 'user', content: String(message).trim(), timestamp: new Date() };
      session.messages.push(userMsg);
      await session.save();
      return res.json({ success: true, data: { reply: null, waitingForAgent: true } });
    }

    // Push user message
    const userMsg = { role: 'user', content: String(message).trim(), timestamp: new Date() };
    session.messages.push(userMsg);

    // Build history for AI
    const historyForAI = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const lang = language || session.language || 'en';
    const incomingCtx = parseActivityContext(rawActivityContext);
    if (incomingCtx) session.activityContext = incomingCtx;

    const result = await ollyService.chat({
      messages: historyForAI,
      language: lang,
      userId: session.userId,
      issueType: session.issueType || null,
      initialQuestion: session.initialQuestion || null,
      activityContext: session.activityContext || null
    });

    const assistantMsg = { role: 'assistant', content: result.reply, timestamp: new Date() };
    session.messages.push(assistantMsg);
    session.language = lang;
    await session.save();

    return res.json({
      success: true,
      data: {
        reply: result.reply,
        offTopic: !!result.offTopic,
        fallback: !!result.fallback
      }
    });
  } catch (err) {
    console.error('[olly/chat]', err.message);
    return res.status(500).json({ success: false, message: 'Unable to get response. Please try again.' });
  }
});

// ── POST /api/olly/upload  — upload media file ────────────────────────────
router.post('/upload', (req, res, next) => {
  mediaUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message || 'Upload failed.' });
    next();
  });
}, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    if (!sessionId) return res.status(400).json({ success: false, message: 'sessionId required.' });

    const session = await OllySession.findOne({ sessionId });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    if (!sessionBelongsToUser(session, resolveUserFromToken(req))) {
      return denySessionAccess(res);
    }

    const presigned = await presignOllyUrl(req.file.key);
    const mediaUrl = presigned || req.file.location || req.file.path;
    const mediaType = req.file.mimetype;
    const mediaOriginalName = req.file.originalname;

    const mediaMsg = {
      role: 'user',
      content: `[Shared a file: ${mediaOriginalName}]`,
      mediaUrl,
      mediaType,
      mediaOriginalName,
      timestamp: new Date()
    };
    session.messages.push(mediaMsg);
    await session.save();

    return res.json({ success: true, data: { mediaUrl, mediaType, mediaOriginalName } });
  } catch (err) {
    console.error('[olly/upload]', err.message);
    return res.status(500).json({ success: false, message: 'Upload error.' });
  }
});

// ── POST /api/olly/escalate  — request real human agent ───────────────────
router.post('/escalate', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, message: 'sessionId required.' });

    const session = await OllySession.findOne({ sessionId });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    if (!sessionBelongsToUser(session, resolveUserFromToken(req))) {
      return denySessionAccess(res);
    }

    if (session.status === 'waiting_agent' || session.status === 'with_agent') {
      return res.json({ success: true, data: { status: session.status, alreadyRequested: true } });
    }

    session.status = 'waiting_agent';
    session.agentNotifiedAt = new Date();
    const systemMsg = {
      role: 'assistant',
      content: `🔔 You've requested to speak with a real agent. Please wait 3–5 minutes — our team has been notified and will connect with you shortly.`,
      timestamp: new Date()
    };
    session.messages.push(systemMsg);
    await session.save();

    // Send email to support team
    const recentMsgs = session.messages.slice(-6).map((m) =>
      `[${m.role.toUpperCase()}]: ${m.content}`
    ).join('\n');

    try {
      await transporter.sendMail({
        from: SUPPORT_EMAIL,
        to: 'languageschool@gluckglobal.com',
        subject: `[Olly Live Chat] ${session.userName} (${session.userEmail}) wants to talk to an agent`,
        html: `
          <h3>🦊 Olly Live Chat — Agent Request</h3>
          <p><strong>Name:</strong> ${session.userName}</p>
          <p><strong>Email:</strong> ${session.userEmail}</p>
          <p><strong>Role:</strong> ${session.userRole}</p>
          <p><strong>Language:</strong> ${session.language}</p>
          <p><strong>Session ID:</strong> ${session.sessionId}</p>
          <p><strong>Requested At:</strong> ${new Date().toLocaleString()}</p>
          <hr/>
          <h4>Recent Chat:</h4>
          <pre style="background:#f5f5f5;padding:12px;border-radius:8px;font-size:12px">${recentMsgs}</pre>
          <p><a href="${process.env.PORTAL_URL || 'https://gluckstudentsportal.com'}/admin/olly-chat">→ Open Admin Chat Panel</a></p>
        `
      });
    } catch (mailErr) {
      console.error('[olly/escalate] email error:', mailErr.message);
    }

    return res.json({ success: true, data: { status: 'waiting_agent' } });
  } catch (err) {
    console.error('[olly/escalate]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to request agent.' });
  }
});

// ── GET /api/olly/session/:sessionId  — get session messages (student) ────
router.get('/session/:sessionId', async (req, res) => {
  try {
    const session = await OllySession.findOne({ sessionId: req.params.sessionId })
      .select('sessionId status language messages userName userEmail userRole lastActivity intakeComplete issueType initialQuestion')
      .lean();
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    if (!sessionBelongsToUser(session, resolveUserFromToken(req))) {
      return denySessionAccess(res);
    }

    // Presign any stored mediaUrl so the browser can load it
    if (session.messages?.length) {
      for (const msg of session.messages) {
        if (msg.mediaUrl && msg.mediaUrl.includes('r2.cloudflarestorage.com/olly-chat/')) {
          const parts = msg.mediaUrl.split('/olly-chat/');
          if (parts[1]) {
            const key = `olly-chat/${parts[1].split('?')[0]}`;
            const presigned = await presignOllyUrl(key);
            if (presigned) msg.mediaUrl = presigned;
          }
        }
      }
    }

    return res.json({ success: true, data: session });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error fetching session.' });
  }
});

// ── GET /api/olly/history  — student's own chat history (auth required) ───
router.get('/history', verifyToken, async (req, res) => {
  try {
    const sessions = await OllySession.find({ userId: req.user.userId })
      .select('sessionId status language createdAt lastActivity messages')
      .sort({ lastActivity: -1 })
      .limit(20)
      .lean();
    return res.json({ success: true, data: sessions });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error fetching history.' });
  }
});

// ── Admin routes ───────────────────────────────────────────────────────────

// GET /api/olly/admin/sessions  — list all sessions (admin)
router.get('/admin/sessions', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN']), async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const filter = status ? { status } : {};
    const sessions = await OllySession.find(filter)
      .select('sessionId userName userEmail userRole language status lastActivity createdAt agentConnected messages')
      .sort({ lastActivity: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    // Add last message preview and unread count
    const enriched = sessions.map((s) => ({
      ...s,
      lastMessage: s.messages?.slice(-1)[0] || null,
      messageCount: s.messages?.length || 0,
      messages: undefined // don't send all messages in list
    }));

    const total = await OllySession.countDocuments(filter);
    return res.json({ success: true, data: enriched, total });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error fetching sessions.' });
  }
});

// GET /api/olly/admin/session/:sessionId  — full session for admin
router.get('/admin/session/:sessionId', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN']), async (req, res) => {
  try {
    const session = await OllySession.findOne({ sessionId: req.params.sessionId }).lean();
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });

    if (session.messages?.length) {
      for (const msg of session.messages) {
        if (msg.mediaUrl && msg.mediaUrl.includes('r2.cloudflarestorage.com/olly-chat/')) {
          const parts = msg.mediaUrl.split('/olly-chat/');
          if (parts[1]) {
            const key = `olly-chat/${parts[1].split('?')[0]}`;
            const presigned = await presignOllyUrl(key);
            if (presigned) msg.mediaUrl = presigned;
          }
        }
      }
    }

    return res.json({ success: true, data: session });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error.' });
  }
});

// POST /api/olly/admin/:sessionId/reply  — admin sends message in live chat
router.post('/admin/:sessionId/reply', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN']), async (req, res) => {
  try {
    const { message } = req.body;
    if (!String(message || '').trim()) return res.status(400).json({ success: false, message: 'Message required.' });

    const session = await OllySession.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });

    if (!session.agentConnected) {
      session.agentConnected = true;
      session.agentConnectedAt = new Date();
      session.status = 'with_agent';
      // Push system notification
      session.messages.push({
        role: 'assistant',
        content: '✅ A support agent has joined the chat. How can we help you?',
        timestamp: new Date()
      });
    }

    session.messages.push({
      role: 'agent',
      content: String(message).trim(),
      timestamp: new Date()
    });
    await session.save();

    return res.json({ success: true, data: { status: session.status } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error sending reply.' });
  }
});

// PATCH /api/olly/admin/:sessionId/status  — admin updates session status
router.patch('/admin/:sessionId/status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN']), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['active', 'waiting_agent', 'with_agent', 'closed'];
    if (!validStatuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' });

    const session = await OllySession.findOneAndUpdate(
      { sessionId: req.params.sessionId },
      { status },
      { new: true }
    ).lean();
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    return res.json({ success: true, data: session });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error updating status.' });
  }
});

// GET /api/olly/admin/pending-count  — unread agent-request count badge
router.get('/admin/pending-count', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN']), async (req, res) => {
  try {
    const count = await OllySession.countDocuments({ status: 'waiting_agent' });
    return res.json({ success: true, data: { count } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error.' });
  }
});

module.exports = router;
