const mongoose = require('mongoose');

const StudentPaymentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  studentName: { type: String, required: true },
  email: { type: String, required: true },
  currentStatus: { type: String, default: '' },
  serviceOpted: { type: String, default: '' },
  batchNumber: { type: String, default: '' },
  currency: { type: String, default: 'LKR' },
  totalPackageAmount: { type: Number, default: 0 },
  totalInvoiced: { type: Number, default: 0 },
  totalPaid: { type: Number, default: 0 },
  pendingPayment: { type: Number, default: 0 },
  payments: [{
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    method: { type: String, default: '' },
    note: { type: String, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  notes: { type: String, default: '' },
  lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

StudentPaymentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  this.pendingPayment = this.totalPackageAmount - this.totalPaid;
  next();
});

module.exports = mongoose.model('StudentPayment', StudentPaymentSchema);
