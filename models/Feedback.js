// models/Feedback.js
const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  feedback: { type: String, required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  createdAt: { type: Date, default: Date.now }
});

feedbackSchema.index({ studentId: 1, timestamp: -1 });
feedbackSchema.index({ currentLevel: 1, timestamp: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
