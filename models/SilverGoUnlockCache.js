const mongoose = require('mongoose');

const SilverGoUnlockCacheSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  maxUnlockedContentDay: { type: Number, required: true, min: 0, max: 200 },
}, { timestamps: true });

module.exports = mongoose.model('SilverGoUnlockCache', SilverGoUnlockCacheSchema);
