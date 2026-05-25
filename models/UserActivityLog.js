const mongoose = require('mongoose');

const userActivityLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, default: '' },
    type: {
      type: String,
      required: true,
      enum: ['LOGIN', 'LOGOUT']
    },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    country: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true }
  },
  { versionKey: false }
);

userActivityLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('UserActivityLog', userActivityLogSchema);

