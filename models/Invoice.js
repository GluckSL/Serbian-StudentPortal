const mongoose = require('mongoose');

const InvoiceSchema = new mongoose.Schema({
  invoice_number: { type: String },
  invoice_type: { type: String },
  invoice_date: { type: String },
  due_date: { type: String },
  customer_name: { type: String },
  customer_email: { type: String },
  customer_address: { type: String },
  customer_state: { type: String },
  customer_type: { type: String },
  items: [{
    service: { type: String },
    description: { type: String },
    amount: { type: String }
  }],
  subtotal: { type: Number, default: 0 },
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  total_tax: { type: Number, default: 0 },
  total_payable: { type: Number, default: 0 },
  pdf_filename: { type: String },
  email_sent: { type: Boolean, default: false },
  payment_status: { type: String, enum: ['paid', 'unpaid', 'partial'], default: 'unpaid' },
  payment_date: { type: String },
  amount_paid: { type: Number, default: 0 },
  payments: [{
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    method: { type: String, default: '' },
    note: { type: String, default: '' },
    proofFile: { type: String, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  created_at: { type: Date, default: Date.now }
});

InvoiceSchema.pre('save', function(next) {
  if (!this.total_payable && this.subtotal) {
    this.total_payable = (this.subtotal || 0) + (this.total_tax || 0);
  }
  // Auto-calculate amount_paid and status from payments
  if (this.payments && this.payments.length > 0) {
    this.amount_paid = this.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    if (this.amount_paid >= this.total_payable) {
      this.payment_status = 'paid';
      if (!this.payment_date) this.payment_date = new Date().toISOString().split('T')[0];
    } else if (this.amount_paid > 0) {
      this.payment_status = 'partial';
    }
  }
  next();
});

InvoiceSchema.index({ customer_email: 1, payment_status: 1, created_at: -1 });
InvoiceSchema.index({ payment_status: 1, created_at: -1 });

module.exports = mongoose.model('Invoice', InvoiceSchema);
