// routes/invoiceManagement.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const Invoice = require('../models/Invoice');
const StudentPayment = require('../models/StudentPayment');
const User = require('../models/User');
const { verifyToken, checkRole } = require('../middleware/auth');

// Multer config for payment proofs
const proofStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/payment-proofs'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const uploadProof = multer({ storage: proofStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  const allowed = /jpeg|jpg|png|pdf|webp/;
  cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
}});

function escapeRegex(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// GET /api/invoices - List all invoices with filters
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.payment_status = status;

    let invoices = await Invoice.find(filter)
      .populate('payments.recordedBy', 'name')
      .sort({ created_at: -1 }).lean();

    if (search) {
      const term = search.toLowerCase();
      invoices = invoices.filter(inv =>
        (inv.customer_name || '').toLowerCase().includes(term) ||
        (inv.customer_email || '').toLowerCase().includes(term) ||
        (inv.invoice_number || '').toLowerCase().includes(term)
      );
    }

    const all = await Invoice.find({}).lean();
    const totalInvoiced = all.reduce((s, i) => s + (i.total_payable || 0), 0);
    const totalReceived = all.reduce((s, i) => s + (i.amount_paid || 0), 0);
    const totalPending = totalInvoiced - totalReceived;

    res.json({
      invoices,
      summary: {
        total: all.length,
        paid: all.filter(i => i.payment_status === 'paid').length,
        partial: all.filter(i => i.payment_status === 'partial').length,
        unpaid: all.filter(i => i.payment_status === 'unpaid').length,
        totalInvoiced, totalReceived, totalPending
      }
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ message: 'Error fetching invoices' });
  }
});

// POST /api/invoices/:id/record-payment - Record a partial or full payment
router.post('/:id/record-payment', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), uploadProof.single('proof'), async (req, res) => {
  try {
    const { amount, method, note } = req.body;
    const payAmount = parseFloat(amount);
    if (!payAmount || payAmount <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than 0' });
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    if (invoice.payment_status === 'paid') {
      return res.status(400).json({ message: 'Invoice is already fully paid' });
    }

    const remaining = (invoice.total_payable || 0) - (invoice.amount_paid || 0);
    if (payAmount > remaining) {
      return res.status(400).json({ message: `Amount exceeds remaining balance of ${remaining}` });
    }

    const proofPath = req.file ? '/uploads/payment-proofs/' + req.file.filename : '';

    // Add payment to invoice
    invoice.payments.push({
      amount: payAmount,
      date: new Date(),
      method: method || '',
      note: note || '',
      proofFile: proofPath,
      recordedBy: req.user.id
    });
    await invoice.save();

    // Also record in student's ledger
    const email = (invoice.customer_email || '').trim().toLowerCase();
    if (email) {
      const escaped = escapeRegex(email);
      const user = await User.findOne({
        email: { $regex: new RegExp('^' + escaped + '$', 'i') }
      }).select('_id').lean();

      let ledger = await StudentPayment.findOne({
        $or: [
          ...(user ? [{ studentId: user._id }] : []),
          { email: { $regex: new RegExp('^' + escaped + '$', 'i') } }
        ]
      });

      if (ledger) {
        ledger.payments.push({
          amount: payAmount,
          date: new Date(),
          method: method || 'Invoice Payment',
          note: (note ? note + ' — ' : '') + 'Invoice ' + (invoice.invoice_number || ''),
          category: 'language',
          recordedBy: req.user.id
        });
        ledger.totalPaid = (ledger.totalPaid || 0) + payAmount;
        ledger.lastUpdatedBy = req.user.id;
        await ledger.save();
      } else if (user) {
        await StudentPayment.create({
          studentId: user._id,
          studentName: invoice.customer_name || '',
          email,
          currency: 'LKR',
          totalPackageAmount: invoice.total_payable || 0,
          totalPaid: payAmount,
          payments: [{
            amount: payAmount,
            date: new Date(),
            method: method || 'Invoice Payment',
            note: 'Invoice ' + (invoice.invoice_number || ''),
            category: 'language',
            recordedBy: req.user.id
          }],
          lastUpdatedBy: req.user.id
        });
      }
    }

    res.json({
      success: true,
      message: invoice.payment_status === 'paid'
        ? 'Invoice fully paid and recorded in ledger'
        : `Payment of ${amount} recorded. Remaining: ${(invoice.total_payable || 0) - (invoice.amount_paid || 0)}`,
      invoice: { payment_status: invoice.payment_status, amount_paid: invoice.amount_paid }
    });
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ message: 'Error processing payment' });
  }
});

module.exports = router;
