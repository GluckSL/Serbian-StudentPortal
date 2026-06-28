/**
 * models/StudentSignupApplication.js
 *
 * Persists an in-progress or completed public student self-signup application
 * across the 3-step wizard (personal info → documents → payment).
 */

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const documentSchema = new mongoose.Schema({
  fileKey:      { type: String, required: true },
  originalName: { type: String, required: true },
  mimeType:     { type: String, default: '' },
  uploadedAt:   { type: Date, default: Date.now },
}, { _id: false });

const SignupApplicationSchema = new mongoose.Schema({
  // ── public resume key (sent in signup link or stored in sessionStorage) ──────
  applicationToken: {
    type: String,
    required: true,
    unique: true,
    default: () => uuidv4(),
    index: true,
  },
  // optional admin-issued invite token (pre-fills email / level / plan)
  inviteToken: { type: String, default: null, sparse: true, index: true },

  // ── step 1: personal info ────────────────────────────────────────────────────
  name:               { type: String, default: '' },
  email:              { type: String, default: '', lowercase: true, trim: true, index: true },
  phoneNumber:        { type: String, default: '' },
  whatsappNumber:     { type: String, default: '' },
  address:            { type: String, default: '' },
  age:                { type: Number, default: null },
  nationality:        { type: String, default: '' },
  medium:             { type: [String], default: [] },
  otherLanguageKnown: { type: String, default: '' },
  languageLevelOpted: { type: String, default: '' },
  qualifications:     { type: String, default: '' },
  leadSource:         { type: String, default: '' },
  passwordHash:         { type: String, default: null, select: false }, // bcrypt hash of chosen password
  passwordRecoverable:  { type: String, default: null, select: false }, // AES copy for welcome email (same as User)

  // OTP verification state
  emailVerifiedAt: { type: Date, default: null },

  // ── step 2: documents (optional) ────────────────────────────────────────────
  documents: { type: [documentSchema], default: [] },

  // ── step 3: payment ──────────────────────────────────────────────────────────
  level:        { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], default: null },
  subscription: {
    type: String,
    enum: ['SILVER', 'PLATINUM', 'DOCS_RECOGNITION', 'VISA_DOC', 'POST_LANDING', 'VISA_DOC_ONLY'],
    default: null,
  },
  currency:     { type: String, enum: ['INR', 'LKR', 'USD'], default: 'INR' },
  amount:       { type: Number, default: null },
  paymentMethod: {
    type: String,
    enum: ['razorpay', 'proof', null],
    default: null,
  },

  // Razorpay
  razorpayOrderId:   { type: String, default: null },
  razorpayPaymentId: { type: String, default: null },

  // Bank transfer proof (stored on application until admin approves — no User until then)
  proofScreenshotKey:          { type: String, default: null },
  proofScreenshotOriginalName: { type: String, default: null },
  proofScreenshotMimeType:     { type: String, default: null },
  proofScreenshotSize:         { type: Number, default: null },
  proofPaidAmount:             { type: Number, default: null },
  proofPaymentDateTime:        { type: Date, default: null },
  proofAccountHolderName:      { type: String, default: null },
  proofSubmittedAt:            { type: Date, default: null },

  // ── links to created resources ───────────────────────────────────────────────
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  paymentRequestId: { type: mongoose.Schema.Types.ObjectId, default: null },
  submissionId:     { type: mongoose.Schema.Types.ObjectId, default: null },

  // ── lifecycle status ─────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['draft', 'email_verified', 'documents_done', 'payment_pending', 'proof_submitted', 'approved', 'rejected'],
    default: 'draft',
    index: true,
  },
}, {
  timestamps: true,
});

// Auto-expire abandoned draft applications after 30 days
SignupApplicationSchema.index({ updatedAt: 1 }, {
  expireAfterSeconds: 30 * 24 * 60 * 60,
  partialFilterExpression: { status: 'draft' },
});

module.exports = mongoose.model('StudentSignupApplication', SignupApplicationSchema);
