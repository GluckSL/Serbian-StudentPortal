/**
 * models/EmailChangeOtp.js
 *
 * OTP for verifying email change during first-login password setup.
 */

const mongoose = require('mongoose');

const EmailChangeOtpSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  pendingNewEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  otpHash: { type: String, required: true },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 },
  },
  attempts: { type: Number, default: 0 },
  used: { type: Boolean, default: false },
}, { timestamps: false });

module.exports = mongoose.model('EmailChangeOtp', EmailChangeOtpSchema);
