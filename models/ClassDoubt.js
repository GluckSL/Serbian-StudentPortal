const mongoose = require('mongoose');

const replySchema = new mongoose.Schema({
  repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  repliedAt: { type: Date, default: Date.now }
}, { _id: true });

const classDoubtSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'MeetingLink', required: true, index: true },
  askedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, maxlength: 200 },
  explanation: { type: String, default: '', maxlength: 2000 },
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  replies: [replySchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ClassDoubt', classDoubtSchema);
