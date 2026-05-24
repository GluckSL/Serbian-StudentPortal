/**
 * models/PasswordResetOtp.js
 *
 * Stores a short-lived, hashed OTP for self-service password reset.
 * MongoDB TTL index automatically removes expired documents.
 */

const mongoose = require('mongoose');

const PasswordResetOtpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  otpHash: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }, // Mongo TTL — removes doc when expiresAt passes
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

module.exports = mongoose.model('PasswordResetOtp', PasswordResetOtpSchema);
