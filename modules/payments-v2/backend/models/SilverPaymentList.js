const mongoose = require('mongoose');

const silverPaymentListSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    source: {
      type: String,
      default: '',
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'silver_payment_list' },
);

module.exports = mongoose.model('SilverPaymentList', silverPaymentListSchema);
