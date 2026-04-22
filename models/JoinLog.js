// models/JoinLog.js — portal join clicks (attendance correlation + anti-cheat signals)

const mongoose = require('mongoose');

const joinLogSchema = new mongoose.Schema(
  {
    meetingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MeetingLink',
      required: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    /** First successful portal join (set on insert only via $setOnInsert) */
    joinedAt: { type: Date, required: true },
    lastJoinedAt: { type: Date },
    joinCount: { type: Number, default: 0 },
  },
  { timestamps: false }
);

joinLogSchema.index({ meetingId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model('JoinLog', joinLogSchema);
