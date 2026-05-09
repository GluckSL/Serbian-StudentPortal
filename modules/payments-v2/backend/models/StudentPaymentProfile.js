const mongoose = require('mongoose');

const MODEL_NAME = 'StudentPaymentProfile';

const currencyBreakdownSchema = new mongoose.Schema({
  currency: String,
  totalPaid: { type: Number, default: 0 },
  pendingApprovalAmount: { type: Number, default: 0 },
  overdueAmount: { type: Number, default: 0 },
  expectedAmount: { type: Number, default: 0 },
}, { _id: false });

const studentPaymentProfileSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  totalPaid: { type: Number, default: 0 },
  pendingApprovalAmount: { type: Number, default: 0 },
  overdueAmount: { type: Number, default: 0 },
  expectedAmount: { type: Number, default: 0 },
  totalRequested: { type: Number, default: 0 },
  currencyBreakdown: [currencyBreakdownSchema],
  totalRequestCount: { type: Number, default: 0 },
  activeRequestCount: { type: Number, default: 0 },
  completedRequestCount: { type: Number, default: 0 },
  overdueCount: { type: Number, default: 0 },
  pendingApprovalCount: { type: Number, default: 0 },
  fullyPaidCount: { type: Number, default: 0 },
  rejectedCount: { type: Number, default: 0 },
  lastPaymentDate: Date,
  lastPaymentAmount: Number,
  lastPaymentCurrency: String,
  overallStatus: {
    type: String,
    enum: ['CLEAR', 'REQUESTED', 'PENDING_REVIEW', 'OVERDUE', 'NO_REQUESTS'],
    default: 'NO_REQUESTS',
  },
  paymentHealthScore: { type: Number, default: 100 },
  lastRebuiltAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.models[MODEL_NAME] || mongoose.model(MODEL_NAME, studentPaymentProfileSchema);
