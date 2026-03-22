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
  created_at: { type: Date, default: Date.now }
});

InvoiceSchema.pre('save', function(next) {
  if (!this.total_payable && this.subtotal) {
    this.total_payable = (this.subtotal || 0) + (this.total_tax || 0);
  }
  next();
});

module.exports = mongoose.model('Invoice', InvoiceSchema);
