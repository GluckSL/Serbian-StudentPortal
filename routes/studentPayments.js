const express = require('express');
const router = express.Router();
const StudentPayment = require('../models/StudentPayment');
const User = require('../models/User');
const { verifyToken, checkRole } = require('../middleware/auth');

function parseCurrencyValue(str) {
  if (!str || typeof str !== 'string') return { amount: 0, currency: 'LKR' };
  const cleaned = str.trim();
  const currency = cleaned.includes('\u20B9') ? 'INR' : 'LKR';
  const isNegative = cleaned.includes('(') && cleaned.includes(')');
  const numStr = cleaned.replace(/[^0-9.]/g, '');
  let amount = parseFloat(numStr) || 0;
  if (isNegative) amount = -amount;
  return { amount, currency };
}

function escapeRegex(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$' + '&');
}

// POST /api/student-payments/import - Import CSV data (admin only)
router.post('/import', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { records } = req.body;
    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ message: 'records array is required' });
    }

    let created = 0, updated = 0, skipped = 0;

    for (const row of records) {
      const email = (row.email || '').trim().toLowerCase();
      if (!email) { skipped++; continue; }

      const totalInvoiced = parseCurrencyValue(row.totalInvoiced);
      const totalPaid = parseCurrencyValue(row.completePaid);
      const pending = parseCurrencyValue(row.pendingPayment);
      const totalAmount = parseCurrencyValue(row.totalAmount);

      const escaped = escapeRegex(email);
      const user = await User.findOne({
        email: { $regex: new RegExp('^' + escaped + '$', 'i') }
      }).select('_id').lean();

      const updateData = {
        studentName: (row.studentName || '').trim(),
        email,
        currentStatus: (row.currentStatus || '').trim(),
        serviceOpted: (row.serviceOpted || '').trim(),
        batchNumber: (row.batchNumber || '').toString().trim(),
        currency: totalInvoiced.currency,
        totalPackageAmount: totalAmount.amount,
        totalInvoiced: totalInvoiced.amount,
        totalPaid: totalPaid.amount,
        pendingPayment: pending.amount,
        lastUpdatedBy: req.user.id
      };
      if (user) updateData.studentId = user._id;

      const existing = await StudentPayment.findOne({ email });
      if (existing) {
        Object.assign(existing, updateData);
        await existing.save();
        updated++;
      } else {
        await StudentPayment.create(updateData);
        created++;
      }
    }

    res.json({ message: 'Import complete: ' + created + ' created, ' + updated + ' updated, ' + skipped + ' skipped', created, updated, skipped });
  } catch (error) {
    console.error('Error importing student payments:', error);
    res.status(500).json({ message: 'Import failed' });
  }
});

// GET /api/student-payments - Get all student payments (admin)
// Returns records linked to registered portal users, combining invoice payments
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const Invoice = require('../models/Invoice');

    const payments = await StudentPayment.find({ studentId: { $ne: null } })
      .populate('studentId', 'name email regNo batch servicesOpted studentStatus')
      .populate('lastUpdatedBy', 'name')
      .populate('payments.recordedBy', 'name')
      .sort({ studentName: 1 })
      .lean();

    // Filter out any where populate failed (user deleted)
    const valid = payments.filter(p => p.studentId);

    // Fetch all paid invoices in one query for efficiency
    const paidInvoices = await Invoice.find({ payment_status: 'paid' }).lean();

    // Build maps: email -> total paid, email -> invoice list
    const invoicePaidMap = {};
    const invoiceListMap = {};
    paidInvoices.forEach(inv => {
      const email = (inv.customer_email || '').toLowerCase().trim();
      if (!email) return;
      if (!invoicePaidMap[email]) invoicePaidMap[email] = 0;
      invoicePaidMap[email] += inv.total_payable || 0;
      if (!invoiceListMap[email]) invoiceListMap[email] = [];
      invoiceListMap[email].push({
        amount: inv.total_payable || 0,
        date: inv.payment_date || inv.invoice_date || inv.created_at,
        method: 'Invoice',
        note: inv.invoice_number || '',
        source: 'invoice'
      });
    });

    // Enrich with user profile data and combine invoice payments
    const enriched = valid.map(p => {
      const email = (p.studentId.email || p.email || '').toLowerCase().trim();
      const invoicePaid = invoicePaidMap[email] || 0;
      const livePaid = (p.totalPaid || 0) + invoicePaid;
      const liveBalance = (p.totalPackageAmount || 0) - livePaid;

      // Merge manual payments + invoice payments for history
      const manualPayments = (p.payments || []).map(mp => ({
        ...mp,
        source: 'manual'
      }));
      const invoicePayments = invoiceListMap[email] || [];
      const allPayments = [...manualPayments, ...invoicePayments].sort((a, b) => {
        return new Date(b.date) - new Date(a.date);
      });

      return {
        ...p,
        studentName: p.studentId.name || p.studentName,
        email: p.studentId.email || p.email,
        regNo: p.studentId.regNo || '',
        batch: p.studentId.batch || p.batchNumber || '',
        service: p.studentId.servicesOpted || p.serviceOpted || '',
        studentStatus: p.studentId.studentStatus || '',
        totalPaid: livePaid,
        pendingPayment: liveBalance > 0 ? liveBalance : 0,
        invoicePaidTotal: invoicePaid,
        payments: allPayments
      };
    });

    // Compute summary stats
    let totalPackage = 0, totalPaid = 0, totalPending = 0;
    enriched.forEach(p => {
      totalPackage += p.totalPackageAmount || 0;
      totalPaid += p.totalPaid || 0;
      totalPending += p.pendingPayment || 0;
    });

    res.json({
      payments: enriched,
      summary: { totalPackage, totalPaid, totalPending, count: enriched.length }
    });
  } catch (error) {
    console.error('Error fetching student payments:', error);
    res.status(500).json({ message: 'Error fetching payments' });
  }
});

// GET /api/student-payments/my - Get current student's payment data
router.get('/my', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('email name').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const Invoice = require('../models/Invoice');
    const email = user.email.toLowerCase();
    const escaped = escapeRegex(email);

    // Get ledger data (CSV-imported)
    const ledger = await StudentPayment.findOne({
      $or: [{ studentId: req.user.id }, { email: email }]
    }).populate('payments.recordedBy', 'name').lean();

    // Get invoices from Invoice collection
    const invoices = await Invoice.find({
      customer_email: { $regex: new RegExp('^' + escaped + '$', 'i') }
    }).sort({ created_at: -1 }).lean();

    // Compute live totals: ledger base + paid invoices
    const invoicePaidTotal = invoices
      .filter(i => i.payment_status === 'paid')
      .reduce((sum, inv) => sum + (inv.total_payable || 0), 0);

    // Total invoiced = sum of ALL invoices (paid + unpaid)
    const totalInvoicedAmount = invoices
      .reduce((sum, inv) => sum + (inv.total_payable || 0), 0);

    let liveTotals = null;
    if (ledger) {
      const livePaid = ledger.totalPaid + invoicePaidTotal;
      const liveBalance = ledger.totalPackageAmount - livePaid;
      liveTotals = {
        totalPackageAmount: ledger.totalPackageAmount,
        totalPaid: livePaid,
        pendingPayment: liveBalance > 0 ? liveBalance : 0,
        currency: ledger.currency,
        totalInvoiced: totalInvoicedAmount
      };
    }

    res.json({ ledger: ledger || null, invoices: invoices || [], liveTotals });
  } catch (error) {
    console.error('Error fetching student payment:', error);
    res.status(500).json({ message: 'Error fetching payment data' });
  }
});

// GET /api/student-payments/:id - Get single payment record (admin)
router.get('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const payment = await StudentPayment.findById(req.params.id)
      .populate('studentId', 'name email regNo')
      .populate('payments.recordedBy', 'name')
      .populate('lastUpdatedBy', 'name')
      .lean();
    if (!payment) return res.status(404).json({ message: 'Payment record not found' });
    res.json(payment);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching payment record' });
  }
});

// PUT /api/student-payments/:id - Update payment record (admin)
router.put('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { totalPackageAmount, totalInvoiced, totalPaid, notes } = req.body;
    const payment = await StudentPayment.findById(req.params.id);
    if (!payment) return res.status(404).json({ message: 'Payment record not found' });

    if (totalPackageAmount !== undefined) payment.totalPackageAmount = totalPackageAmount;
    if (totalInvoiced !== undefined) payment.totalInvoiced = totalInvoiced;
    if (totalPaid !== undefined) payment.totalPaid = totalPaid;
    if (notes !== undefined) payment.notes = notes;
    payment.lastUpdatedBy = req.user.id;
    await payment.save();

    res.json({ message: 'Payment record updated', payment });
  } catch (error) {
    res.status(500).json({ message: 'Error updating payment record' });
  }
});

// POST /api/student-payments/:id/record-payment - Record a new payment (admin)
router.post('/:id/record-payment', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { amount, method, note } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Valid amount is required' });

    const payment = await StudentPayment.findById(req.params.id);
    if (!payment) return res.status(404).json({ message: 'Payment record not found' });

    payment.payments.push({
      amount,
      date: new Date(),
      method: method || '',
      note: note || '',
      recordedBy: req.user.id
    });
    payment.totalPaid += amount;
    payment.lastUpdatedBy = req.user.id;
    await payment.save();

    res.json({ message: 'Payment recorded', payment });
  } catch (error) {
    res.status(500).json({ message: 'Error recording payment' });
  }
});

module.exports = router;
