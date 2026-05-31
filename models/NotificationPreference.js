// models/NotificationPreference.js — push / reminder preferences

const mongoose = require('mongoose');

const NotificationPreferenceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  enabled: { type: Boolean, default: true },
  streakReminders: { type: Boolean, default: true },
  leagueReminders: { type: Boolean, default: true },
  challengeReminders: { type: Boolean, default: true },
  classroomReminders: { type: Boolean, default: true },
  inactivityReminders: { type: Boolean, default: true },
  browserPushToken: { type: String, default: null },
  mobilePushToken: { type: String, default: null },
  preferredHourUtc: { type: Number, default: 18 },
}, { timestamps: true });

module.exports = mongoose.model('NotificationPreference', NotificationPreferenceSchema);
