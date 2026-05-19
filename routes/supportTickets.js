const express = require('express');
const router = express.Router();
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const upload = require('../config/supportTicketUpload');
const transporter = require('../config/emailConfig');
const { verifyToken, checkRole } = require('../middleware/auth');

function buildPublicUrl(req, fileName) {
  // app.js serves /uploads statically from /uploads
  return `${req.protocol}://${req.get('host')}/uploads/support-tickets/${fileName}`;
}

async function sendNewTicketAlert(ticket) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: 'Selvaganesh@gluckglobal.com',
    cc: [
      'sourav@gluckglobal.com',
      'Languageschool@gluckglobal.com',
      'faiqua@gluckglobal.com',
      'techintern1@gluckglobal.com',
      'aiswarya@gluckglobal.com'
    ],
    subject: `[Support Ticket] ${ticket.ticketNumber} - ${ticket.subject}`,
    html: `
      <h3>New Support Ticket Received</h3>
      <p><strong>Ticket Number:</strong> ${ticket.ticketNumber}</p>
      <p><strong>Name:</strong> ${ticket.name}</p>
      <p><strong>Email:</strong> ${ticket.email}</p>
      <p><strong>Category:</strong> ${ticket.category}</p>
      <p><strong>Priority:</strong> ${ticket.priority}</p>
      <p><strong>Subject:</strong> ${ticket.subject}</p>
      <p><strong>Description:</strong> ${ticket.description}</p>
      <p><strong>Screenshot:</strong> <a href="${ticket?.screenshot?.url || '#'}">View Attachment</a></p>
    `
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendAdminReplyToStudent(ticket, replyMessage) {
  const safeReply = escapeHtml(replyMessage).replace(/\r?\n/g, '<br/>');
  const portalUrl = process.env.PORTAL_URL || `${process.env.CLIENT_URL || ''}`.replace(/\/+$/, '');
  const openTicketLink = portalUrl ? `${portalUrl}/help` : null;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: ticket.email,
    subject: `Reply on your support ticket ${ticket.ticketNumber || ''}`.trim(),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h3 style="margin-bottom: 8px;">Support Team Reply</h3>
        <p style="margin: 0 0 10px;">Hello ${escapeHtml(ticket.name || 'Student')},</p>
        <p style="margin: 0 0 10px;">
          Our team has replied to your support request.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin: 12px 0;">
          <p style="margin: 0 0 6px;"><strong>Ticket:</strong> ${escapeHtml(ticket.ticketNumber || 'N/A')}</p>
          <p style="margin: 0 0 6px;"><strong>Subject:</strong> ${escapeHtml(ticket.subject || 'N/A')}</p>
          <p style="margin: 0;"><strong>Reply:</strong><br/>${safeReply}</p>
        </div>
        ${openTicketLink ? `<p style="margin: 0 0 8px;">You can view updates here: <a href="${openTicketLink}">${openTicketLink}</a></p>` : ''}
        <p style="margin: 0;">Regards,<br/>Gluck Global Support Team</p>
      </div>
    `
  });
}

// POST /api/support/tickets  (public; screenshot required)
router.post('/tickets', upload.single('screenshot'), async (req, res) => {
  try {
    const {
      userId = null,
      name,
      email,
      subject,
      category,
      priority = 'medium',
      description
    } = req.body;

    if (!name || !email || !subject || !category || !priority || !description) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Screenshot is required.' });
    }

    const ticket = new SupportTicket({
      userId: userId || null,
      name,
      email,
      subject,
      category,
      priority,
      description,
      screenshot: {
        fileName: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        url: buildPublicUrl(req, req.file.filename)
      }
    });

    const saved = await ticket.save();
    try {
      await sendNewTicketAlert(saved);
    } catch (mailErr) {
      console.error('Support ticket notification email error:', mailErr);
    }

    return res.status(201).json({ success: true, data: saved });
  } catch (err) {
    console.error('Support ticket create error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to create ticket.' });
  }
});

// GET /api/support/tickets/my (auth)
router.get('/tickets/my', verifyToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Authentication required.' });

    const tickets = await SupportTicket.find({ userId }).sort({ createdAt: -1 });
    return res.json({ success: true, data: tickets });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load tickets.' });
  }
});

// GET /api/support/tickets (admin)
router.get('/tickets', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN']), async (req, res) => {
  try {
    const tickets = await SupportTicket.find()
      .sort({ createdAt: -1 })
      .populate({ path: 'userId', select: 'batch email regNo' });

    const rows = tickets.map((doc) => {
      const o = doc.toObject();
      let batch = null;
      let regNo = null;
      let userId = o.userId;
      if (userId && typeof userId === 'object') {
        batch = userId.batch || null;
        regNo = userId.regNo || null;
        userId = userId._id;
      }
      return { ...o, userId, batch, regNo };
    });

    const emailsNeedingLookup = [
      ...new Set(
        rows
          .filter((r) => r.email && (!r.batch || !r.regNo))
          .map((r) => String(r.email).trim().toLowerCase())
      )
    ];

    if (emailsNeedingLookup.length) {
      const users = await User.find({
        $expr: { $in: [{ $toLower: '$email' }, emailsNeedingLookup] }
      })
        .select('email batch regNo')
        .lean();
      const emailToUser = new Map(
        users.map((u) => [
          String(u.email || '').trim().toLowerCase(),
          { batch: u.batch || '', regNo: u.regNo || '' }
        ])
      );
      for (const row of rows) {
        if (!row.email) continue;
        const key = String(row.email).trim().toLowerCase();
        const match = emailToUser.get(key);
        if (!match) continue;
        if (!row.batch && match.batch) row.batch = match.batch;
        if (!row.regNo && match.regNo) row.regNo = match.regNo;
      }
    }

    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load tickets.' });
  }
});

// PATCH /api/support/tickets/:id/status (admin)
router.patch('/tickets/:id/status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN']), async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['open', 'in-progress', 'resolved', 'closed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const updated = await SupportTicket.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!updated) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update ticket.' });
  }
});

// POST /api/support/tickets/:id/reply (admin)
router.post('/tickets/:id/reply', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN']), async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || String(message).trim().length < 1) {
      return res.status(400).json({ success: false, message: 'Reply message is required.' });
    }

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    ticket.replies = ticket.replies || [];
    ticket.replies.push({
      authorRole: req.user?.role || 'ADMIN',
      message: String(message).trim()
    });
    await ticket.save();

    try {
      await sendAdminReplyToStudent(ticket, String(message).trim());
    } catch (mailErr) {
      console.error('Support ticket reply email error:', mailErr);
    }

    return res.json({ success: true, data: ticket });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to add reply.' });
  }
});

module.exports = router;

