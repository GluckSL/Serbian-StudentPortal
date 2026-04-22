const express = require('express');
const router = express.Router();
const SupportTicket = require('../models/SupportTicket');
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
    cc: ['sourav@gluckglobal.com', 'Languageschool@gluckglobal.com'],
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
router.get('/tickets', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const tickets = await SupportTicket.find().sort({ createdAt: -1 });
    return res.json({ success: true, data: tickets });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load tickets.' });
  }
});

// PATCH /api/support/tickets/:id/status (admin)
router.patch('/tickets/:id/status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
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
router.post('/tickets/:id/reply', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
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

    return res.json({ success: true, data: ticket });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to add reply.' });
  }
});

module.exports = router;

