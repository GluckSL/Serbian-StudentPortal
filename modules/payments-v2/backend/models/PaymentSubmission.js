const mongoose = require('mongoose');

const MODEL_NAME = 'PaymentFlowSubmission';
const COLLECTION = 'payment_flow_submissions';

const paymentSubmissionSchema = new mongoose.Schema({
  paymentRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRequest', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  paidAmount: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: ['LKR', 'INR', 'USD'], required: true },
  transactionId: String,
  paymentMethod: { type: String, enum: ['Bank Transfer', 'UPI', 'Cash', 'Card', 'Other', 'Legacy'], default: 'Bank Transfer' },
  source: { type: String, default: null },
  isImported: { type: Boolean, default: false },
  legacyFingerprint: { type: String, default: null },
  screenshotKey: String,
  screenshotOriginalName: String,
  screenshotMimeType: String,
  screenshotSize: Number,
  installmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentInstallment' },
  installmentNumber: Number,
  status: {
    type: String,
    enum: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REUPLOAD_REQUIRED'],
    default: 'SUBMITTED',
    index: true,
  },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  rejectionReason: String,
  reuploadNote: String,
  adminRemarks: String,
  submittedAt: { type: Date, default: Date.now },
  receiptGenerated: { type: Boolean, default: false },
  receiptNumber: String,
  receiptKey: String,
  isArchived: { type: Boolean, default: false },
  archivedAt: Date,
  archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

paymentSubmissionSchema.index({ legacyFingerprint: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models[MODEL_NAME] || mongoose.model(MODEL_NAME, paymentSubmissionSchema, COLLECTION);
