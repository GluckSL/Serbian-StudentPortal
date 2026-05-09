const mongoose = require('mongoose');
const MODEL_NAME = 'BulkPaymentOperation';

const bulkPaymentOperationSchema = new mongoose.Schema({
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetType: { type: String, enum: ['BATCH', 'INDIVIDUAL', 'MULTIPLE', 'ALL'], default: 'INDIVIDUAL' },
  targetBatch: String,
  amount: { type: Number, required: true },
  currency: { type: String, enum: ['LKR', 'INR', 'USD'], required: true },
  paymentType: String,
  dueDate: Date,
  remarks: String,
  installmentAllowed: { type: Boolean, default: false },
  totalStudents: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  failedStudents: [{ studentId: mongoose.Schema.Types.ObjectId, reason: String }],
  requestIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRequest' }],
  status: { type: String, enum: ['PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL_FAILURE'], default: 'PROCESSING' },
  isDraft: { type: Boolean, default: false },
  notificationSent: { type: Boolean, default: false },
  completedAt: Date,
}, { timestamps: true });

module.exports = mongoose.models[MODEL_NAME] || mongoose.model(MODEL_NAME, bulkPaymentOperationSchema);
