// routes/invoiceManagement.js

const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const StudentPayment = require('../models/StudentPayment');
const User = require('../models/User');
const { verifyToken, checkRole } = require('../middleware/auth');

function escapeRegex(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// GET /api/invoices - List all invoices with filters
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.payment_status = status;

    let invoices = await Invoice.find(filter).sort({ created_at: -1 }).lean();

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
    const totalPaid = all.filter(i => i.payment_status === 'paid').reduce((s, i) => s + (i.total_payable || 0), 0);
    const totalUnpaid = all.filter(i => i.payment_status !== 'paid').reduce((s, i) => s + (i.total_payable || 0), 0);

    res.json({
      invoices,
      summary: {
        total: all.length,
        paid: all.filter(i => i.payment_status === 'paid').length,
        unpaid: all.filter(i => i.payment_status !== 'paid').length,
        totalInvoiced, totalPaid, totalUnpaid
      }
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ message: 'Error fetching invoices' });
  }
});

// POST /api/invoices/:id/mark-paid - Mark invoice as paid and update ledger
router.post('/:id/mark-paid', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { method, note } = req.body;
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    if (invoice.payment_status === 'paid') {
      return res.status(400).json({ message: 'Invoice is already marked as paid' });
    }

    invoice.payment_status = 'paid';
    invoice.payment_date = new Date().toISOString().split('T')[0];
    await invoice.save();

    // Update the student's ledger
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
          amount: invoice.total_payable || 0,
          date: new Date(),
          method: method || 'Invoice Payment',
          note: (note || '') + (note ? ' — ' : '') + 'Invoice ' + (invoice.invoice_number || ''),
          category: 'language',
          recordedBy: req.user.id
        });
        ledger.totalPaid = (ledger.totalPaid || 0) + (invoice.total_payable || 0);
        ledger.lastUpdatedBy = req.user.id;
        await ledger.save();
      } else if (user) {
        await StudentPayment.create({
          studentId: user._id,
          studentName: invoice.customer_name || '',
          email,
          currency: 'LKR',
          totalPackageAmount: invoice.total_payable || 0,
          totalPaid: invoice.total_payable || 0,
          pendingPayment: 0,
          payments: [{
            amount: invoice.total_payable || 0,
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

    res.json({ success: true, message: 'Invoice marked as paid and payment recorded in ledger' });
  } catch (error) {
    console.error('Error marking invoice as paid:', error);
    res.status(500).json({ message: 'Error processing payment' });
  }
});

// POST /api/invoices/:id/mark-unpaid - Revert invoice to unpaid
router.post('/:id/mark-unpaid', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    if (invoice.payment_status !== 'paid') {
      return res.status(400).json({ message: 'Invoice is not marked as paid' });
    }

    invoice.payment_status = 'unpaid';
    invoice.payment_date = '';
    await invoice.save();

    res.json({ success: true, message: 'Invoice reverted to unpaid' });
  } catch (error) {
    console.error('Error reverting invoice:', error);
    res.status(500).json({ message: 'Error reverting invoice' });
  }
});

module.exports = router;
