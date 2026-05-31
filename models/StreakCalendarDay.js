// models/StreakCalendarDay.js — per-day streak state for calendar UI

const mongoose = require('mongoose');

const StreakCalendarDaySchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  dateKey: { type: String, required: true }, // YYYY-MM-DD UTC
  status: {
    type: String,
    enum: ['played', 'missed', 'frozen', 'repaired'],
    required: true,
  },
  xpEarned: { type: Number, default: 0 },
  gamesCompleted: { type: Number, default: 0 },
}, { timestamps: true });

StreakCalendarDaySchema.index({ studentId: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model('StreakCalendarDay', StreakCalendarDaySchema);
