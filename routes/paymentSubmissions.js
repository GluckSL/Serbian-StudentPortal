// routes/paymentSubmissions.js

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const Razorpay = require('razorpay');
const PaymentSubmission = require('../models/PaymentSubmission');
const Invoice = require('../models/Invoice');
const StudentPayment = require('../models/StudentPayment');
const User = require('../models/User');
const { verifyToken, checkRole } = require('../middleware/auth');
const s3Client = require('../config/s3');
const paymentTransporter = require('../config/paymentEmailConfig');

// Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Multer-S3 config for manual payment proof uploads
const uploadProof = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const prefix = process.env.S3_PREFIX || 'uploads';
      const key = `${prefix}/payment-proofs/${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
      cb(null, key);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf|webp/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  }
});

// ─── STUDENT ROUTES ──────────────────────────────────────────────────────────

// POST /api/payment-submissions/razorpay/create-order
// Student creates a Razorpay order for a given invoice
router.post('/razorpay/create-order', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    const { invoiceId } = req.body;
    if (!invoiceId) return res.status(400).json({ message: 'invoiceId is required' });

    const invoice = await Invoice.findById(invoiceId).lean();
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    if (invoice.payment_status === 'paid') {
      return res.status(400).json({ message: 'Invoice is already fully paid' });
    }

    const user = await User.findById(req.user.id).select('name email').lean();

    // Verify invoice belongs to this student
    const emailMatch = (invoice.customer_email || '').toLowerCase().trim() === (user.email || '').toLowerCase().trim();
    if (!emailMatch) return res.status(403).json({ message: 'You are not authorized to pay this invoice' });

    // Check for duplicate pending/processing submission for this invoice
    const existing = await PaymentSubmission.findOne({
      invoiceId,
      studentId: req.user.id,
      status: { $in: ['pending', 'processing'] }
    });
    if (existing) {
      return res.status(400).json({ message: 'A payment submission for this invoice is already awaiting approval' });
    }

    const amountPaise = Math.round((invoice.total_payable || 0) * 100); // Razorpay uses paise

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `inv_${invoice.invoice_number || invoiceId}`,
      notes: {
        invoice_id: invoiceId.toString(),
        student_email: user.email,
        invoice_number: invoice.invoice_number || ''
      }
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      invoiceNumber: invoice.invoice_number,
      studentName: user.name,
      studentEmail: user.email
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ message: 'Failed to create Razorpay order' });
  }
});

// POST /api/payment-submissions/razorpay/verify
// Verify Razorpay payment signature and set submission status to 'processing'
router.post('/razorpay/verify', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    const { invoiceId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    if (!invoiceId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ message: 'All Razorpay fields are required' });
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({ message: 'Payment verification failed: invalid signature' });
    }

    const invoice = await Invoice.findById(invoiceId).lean();
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    const user = await User.findById(req.user.id).select('name email').lean();

    const submission = await PaymentSubmission.create({
      invoiceId,
      studentId: req.user.id,
      studentName: user.name,
      studentEmail: user.email,
      invoiceNumber: invoice.invoice_number || '',
      amount: (invoice.total_payable || 0),
      paymentType: 'razorpay',
      status: 'processing',
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    });

    res.json({ success: true, message: 'Payment received! Awaiting admin confirmation.', submissionId: submission._id });
  } catch (error) {
    console.error('Error verifying Razorpay payment:', error);
    res.status(500).json({ message: 'Failed to verify payment' });
  }
});

// POST /api/payment-submissions/manual
// Student submits manual payment proof
router.post('/manual', verifyToken, checkRole(['STUDENT']), uploadProof.single('proof'), async (req, res) => {
  try {
    const { invoiceId, amount, timeOfPayment, note } = req.body;
    if (!invoiceId || !amount) return res.status(400).json({ message: 'invoiceId and amount are required' });

    const invoice = await Invoice.findById(invoiceId).lean();
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    if (invoice.payment_status === 'paid') {
      return res.status(400).json({ message: 'Invoice is already fully paid' });
    }

    const user = await User.findById(req.user.id).select('name email').lean();
    const emailMatch = (invoice.customer_email || '').toLowerCase().trim() === (user.email || '').toLowerCase().trim();
    if (!emailMatch) return res.status(403).json({ message: 'You are not authorized to submit for this invoice' });

    // Check for duplicate pending submission
    const existing = await PaymentSubmission.findOne({
      invoiceId,
      studentId: req.user.id,
      status: { $in: ['pending', 'processing'] }
    });
    if (existing) {
      return res.status(400).json({ message: 'A payment submission for this invoice is already awaiting approval' });
    }

    const proofUrl = req.file ? req.file.location : '';

    const submission = await PaymentSubmission.create({
      invoiceId,
      studentId: req.user.id,
      studentName: user.name,
      studentEmail: user.email,
      invoiceNumber: invoice.invoice_number || '',
      amount: parseFloat(amount),
      paymentType: 'manual',
      status: 'pending',
      proofUrl,
      timeOfPayment: timeOfPayment || '',
      note: note || ''
    });

    res.json({ success: true, message: 'Payment proof submitted! Awaiting admin confirmation.', submissionId: submission._id });
  } catch (error) {
    console.error('Error submitting manual payment:', error);
    res.status(500).json({ message: 'Failed to submit payment proof' });
  }
});

// GET /api/payment-submissions/my
// Student fetches their own submissions
router.get('/my', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    const submissions = await PaymentSubmission.find({ studentId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ submissions });
  } catch (error) {
    console.error('Error fetching student submissions:', error);
    res.status(500).json({ message: 'Failed to fetch submissions' });
  }
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

// GET /api/payment-submissions/pending
// Admin fetches all pending and processing submissions
router.get('/pending', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    } else {
      filter.status = { $in: ['pending', 'processing'] };
    }

    const submissions = await PaymentSubmission.find(filter)
      .populate('studentId', 'name email regNo')
      .populate('confirmedBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const allCount = await PaymentSubmission.countDocuments({ status: { $in: ['pending', 'processing'] } });
    const confirmedCount = await PaymentSubmission.countDocuments({ status: 'confirmed' });
    const rejectedCount = await PaymentSubmission.countDocuments({ status: 'rejected' });

    res.json({ submissions, counts: { pending: allCount, confirmed: confirmedCount, rejected: rejectedCount } });
  } catch (error) {
    console.error('Error fetching pending submissions:', error);
    res.status(500).json({ message: 'Failed to fetch submissions' });
  }
});

// GET /api/payment-submissions/all
// Admin fetches ALL submissions (with optional status filter)
router.get('/all', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status && status !== 'all' ? { status } : {};

    const submissions = await PaymentSubmission.find(filter)
      .populate('studentId', 'name email regNo')
      .populate('confirmedBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ submissions });
  } catch (error) {
    console.error('Error fetching all submissions:', error);
    res.status(500).json({ message: 'Failed to fetch submissions' });
  }
});

// POST /api/payment-submissions/:id/confirm
// Admin confirms a payment submission → updates invoice + sends congratulations email
router.post('/:id/confirm', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const submission = await PaymentSubmission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    if (submission.status === 'confirmed') {
      return res.status(400).json({ message: 'Submission is already confirmed' });
    }
    if (submission.status === 'rejected') {
      return res.status(400).json({ message: 'Cannot confirm a rejected submission' });
    }

    // Update submission
    submission.status = 'confirmed';
    submission.confirmedBy = req.user.id;
    submission.confirmedAt = new Date();
    await submission.save();

    // Update the invoice payment status
    const invoice = await Invoice.findById(submission.invoiceId);
    if (invoice) {
      invoice.payments.push({
        amount: submission.amount,
        date: new Date(),
        method: submission.paymentType === 'razorpay' ? 'Razorpay' : 'Manual Transfer',
        note: submission.paymentType === 'razorpay'
          ? `Razorpay Payment ID: ${submission.razorpayPaymentId}`
          : (submission.note || 'Manual payment submitted by student'),
        proofFile: submission.proofUrl || '',
        recordedBy: req.user.id
      });
      await invoice.save();
    }

    // Update StudentPayment ledger
    const emailLower = (submission.studentEmail || '').toLowerCase().trim();
    let ledger = await StudentPayment.findOne({
      $or: [{ studentId: submission.studentId }, { email: emailLower }]
    });
    if (ledger) {
      ledger.payments.push({
        amount: submission.amount,
        date: new Date(),
        method: submission.paymentType === 'razorpay' ? 'Razorpay' : 'Manual Transfer',
        note: `Invoice ${submission.invoiceNumber || ''} — confirmed by admin`,
        recordedBy: req.user.id
      });
      ledger.totalPaid = (ledger.totalPaid || 0) + submission.amount;
      ledger.lastUpdatedBy = req.user.id;
      await ledger.save();
    }

    // Send congratulations email to student
    try {
      await paymentTransporter.sendMail({
        from: `"Glück Global Finance" <${process.env.PAYMENT_EMAIL_USER}>`,
        to: submission.studentEmail,
        cc: 'coordination@gluckglobal.com',
        subject: `Payment Confirmed — Invoice ${submission.invoiceNumber || ''} — Glück Global`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
            <div style="background:#03396c;padding:20px 24px;">
              <h2 style="color:#fff;margin:0;font-size:20px;">Glück Global — Payment Confirmed!</h2>
            </div>
            <div style="padding:28px 24px;">
              <p style="margin:0 0 16px;font-size:15px;">Dear <strong>${submission.studentName}</strong>,</p>
              <p style="margin:0 0 20px;font-size:15px;">Congratulations! Your payment has been successfully confirmed. Here are the details:</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                <tr style="background:#f0f9ff;">
                  <td style="padding:12px 16px;font-size:13px;color:#64748b;width:45%;">Invoice Number</td>
                  <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#0f172a;">${submission.invoiceNumber || 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-size:13px;color:#64748b;">Amount Confirmed</td>
                  <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#16a34a;">₹ ${submission.amount.toLocaleString()}</td>
                </tr>
                <tr style="background:#f0f9ff;">
                  <td style="padding:12px 16px;font-size:13px;color:#64748b;">Payment Method</td>
                  <td style="padding:12px 16px;font-size:14px;">${submission.paymentType === 'razorpay' ? 'Razorpay (Online)' : 'Manual Transfer'}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-size:13px;color:#64748b;">Confirmation Date</td>
                  <td style="padding:12px 16px;font-size:14px;">${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</td>
                </tr>
                <tr style="background:#f0f9ff;">
                  <td style="padding:12px 16px;font-size:13px;color:#64748b;">Status</td>
                  <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#16a34a;">Confirmed</td>
                </tr>
              </table>
              <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin:20px 0;">
                <p style="margin:0;font-size:14px;color:#166534;">Thank you for your payment. Your account has been updated accordingly.</p>
              </div>
              <p style="margin:20px 0 0;font-size:13px;color:#64748b;">If you have any questions, feel free to reach out to our support team.</p>
              <p style="margin:8px 0 0;font-size:13px;">Best regards,<br><strong>Glück Global Pvt Ltd</strong><br><span style="color:#64748b;">Finance Team</span></p>
            </div>
          </div>
        `
      });
      console.log('📧 Congratulations email sent to', submission.studentEmail);
    } catch (emailErr) {
      console.error('⚠️ Failed to send confirmation email:', emailErr.message);
    }

    res.json({ success: true, message: 'Payment confirmed and student notified via email.' });
  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({ message: 'Failed to confirm payment' });
  }
});

// POST /api/payment-submissions/:id/reject
// Admin rejects a payment submission
router.post('/:id/reject', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { reason } = req.body;
    const submission = await PaymentSubmission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    if (submission.status === 'confirmed') {
      return res.status(400).json({ message: 'Cannot reject an already confirmed submission' });
    }

    submission.status = 'rejected';
    submission.rejectionReason = reason || '';
    submission.confirmedBy = req.user.id;
    submission.confirmedAt = new Date();
    await submission.save();

    // Notify student of rejection
    try {
      await paymentTransporter.sendMail({
        from: `"Glück Global Finance" <${process.env.PAYMENT_EMAIL_USER}>`,
        to: submission.studentEmail,
        subject: `Payment Submission Update — Invoice ${submission.invoiceNumber || ''} — Glück Global`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
            <div style="background:#b91c1c;padding:20px 24px;">
              <h2 style="color:#fff;margin:0;font-size:18px;">Payment Submission — Action Required</h2>
            </div>
            <div style="padding:24px;">
              <p style="margin:0 0 16px;">Dear <strong>${submission.studentName}</strong>,</p>
              <p style="margin:0 0 16px;">Your payment submission for invoice <strong>${submission.invoiceNumber || 'N/A'}</strong> could not be verified at this time.</p>
              ${reason ? `<p style="margin:0 0 16px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:12px;color:#7f1d1d;font-size:13px;"><strong>Reason:</strong> ${reason}</p>` : ''}
              <p style="margin:0 0 16px;font-size:13px;">Please contact our support team or resubmit your payment.</p>
              <p style="margin:8px 0 0;font-size:13px;">Best regards,<br><strong>Glück Global Finance Team</strong></p>
            </div>
          </div>
        `
      });
    } catch (emailErr) {
      console.error('⚠️ Failed to send rejection email:', emailErr.message);
    }

    res.json({ success: true, message: 'Submission rejected.' });
  } catch (error) {
    console.error('Error rejecting payment:', error);
    res.status(500).json({ message: 'Failed to reject submission' });
  }
});

module.exports = router;
