/**
 * models/EmailChangeRequest.js
 *
 * Stores a student's request to change their email during first-login setup.
 * Admin must approve before the change takes effect.
 */

const mongoose = require('mongoose');

const EmailChangeRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  studentName: { type: String, required: true },
  regNo: { type: String, required: true },
  currentEmail: { type: String, required: true, lowercase: true, trim: true },
  newEmail: { type: String, required: true, lowercase: true, trim: true },
  /** AES-256-GCM ciphertext of the new password the student wants */
  newPasswordEncrypted: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  },
  processedAt: { type: Date, default: null },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rejectionReason: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('EmailChangeRequest', EmailChangeRequestSchema);
