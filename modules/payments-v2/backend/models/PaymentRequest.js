const mongoose = require('mongoose');

const MODEL_NAME = 'PaymentRequest';

const internalNoteSchema = new mongoose.Schema({
  note: { type: String, required: true },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  addedAt: { type: Date, default: Date.now },
  followUpDate: Date,
  taggedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: false });

const paymentRequestSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  bulkOperationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BulkPaymentOperation' },
  batchId: String,
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: ['LKR', 'INR', 'USD'], required: true },
  paymentType: { type: String, enum: ['Monthly Fee', 'Registration', 'Custom', 'Exam Fee', 'Other'], required: true },
  customType: String,
  dueDate: { type: Date, required: true },
  remarks: String,
  installmentAllowed: { type: Boolean, default: false },
  totalInstallments: { type: Number, default: 1 },
  amountRemaining: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['REQUESTED', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'FULLY_PAID', 'REJECTED', 'OVERDUE', 'REUPLOAD_REQUIRED'],
    default: 'REQUESTED',
    index: true,
  },
  isDraft: { type: Boolean, default: false },
  isArchived: { type: Boolean, default: false },
  archivedAt: Date,
  archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  archiveReason: String,
  internalNotes: [internalNoteSchema],
}, { timestamps: true });

paymentRequestSchema.index({ studentId: 1, status: 1 });
paymentRequestSchema.index({ dueDate: 1, status: 1 });

module.exports = mongoose.models[MODEL_NAME] || mongoose.model(MODEL_NAME, paymentRequestSchema);
