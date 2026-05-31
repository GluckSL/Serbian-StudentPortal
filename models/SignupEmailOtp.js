/**
 * models/SignupEmailOtp.js
 *
 * Short-lived OTP for verifying an email address during the public signup wizard.
 * MongoDB TTL index removes expired documents automatically.
 */

const mongoose = require('mongoose');

const SignupEmailOtpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  applicationToken: {
    type: String,
    required: true,
    index: true,
  },
  otpHash: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 },
  },
  attempts: {
    type: Number,
    default: 0,
  },
  used: {
    type: Boolean,
    default: false,
  },
}, { timestamps: false });

module.exports = mongoose.model('SignupEmailOtp', SignupEmailOtpSchema);
