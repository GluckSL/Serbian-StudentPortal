const mongoose = require('mongoose');

const PaymentSubmissionSchema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String, required: true },
  studentEmail: { type: String, required: true },
  invoiceNumber: { type: String, default: '' },
  amount: { type: Number, required: true },

  paymentType: { type: String, enum: ['razorpay', 'manual'], required: true },

  // Status flow:
  //  razorpay: pending → (after razorpay success) processing → (admin confirms) confirmed
  //  manual:   pending → (admin confirms) confirmed
  status: {
    type: String,
    enum: ['pending', 'processing', 'confirmed', 'rejected'],
    default: 'pending'
  },

  // Razorpay-specific
  razorpayOrderId: { type: String, default: '' },
  razorpayPaymentId: { type: String, default: '' },
  razorpaySignature: { type: String, default: '' },

  // Manual proof
  proofUrl: { type: String, default: '' },
  timeOfPayment: { type: String, default: '' },
  note: { type: String, default: '' },

  // Admin action
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  confirmedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: '' },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PaymentSubmission', PaymentSubmissionSchema);
