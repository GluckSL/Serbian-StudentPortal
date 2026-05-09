const mongoose = require('mongoose');

const MODEL_NAME = 'PaymentInstallment';

const paymentInstallmentSchema = new mongoose.Schema({
  paymentRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRequest', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  installmentNumber: { type: Number, required: true },
  requestedAmount: { type: Number, required: true },
  paidAmount: { type: Number, default: 0 },
  remainingAmount: { type: Number, default: 0 },
  dueDate: Date,
  currency: { type: String, enum: ['LKR', 'INR', 'USD'], required: true },
  status: {
    type: String,
    enum: ['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'OVERDUE'],
    default: 'PENDING',
  },
  submissionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PaymentFlowSubmission' }],
}, { timestamps: true });

paymentInstallmentSchema.pre('save', function (next) {
  this.remainingAmount = this.requestedAmount - this.paidAmount;
  next();
});

module.exports = mongoose.models[MODEL_NAME] || mongoose.model(MODEL_NAME, paymentInstallmentSchema);
