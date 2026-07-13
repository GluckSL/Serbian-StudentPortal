const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant', 'agent'], required: true },
  content: { type: String, default: '' },
  mediaUrl: { type: String, default: null },
  mediaType: { type: String, default: null }, // image/png, image/jpeg, application/pdf, etc.
  mediaOriginalName: { type: String, default: null },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const ollySessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  userName: { type: String, default: 'Guest' },
  userEmail: { type: String, default: '' },
  userRole: { type: String, default: 'GUEST' },
  language: { type: String, enum: ['en', 'ta', 'si'], default: 'en' },
  issueType: { type: String, default: '' },
  initialQuestion: { type: String, default: '' },
  intakeComplete: { type: Boolean, default: false },
  activityContext: { type: mongoose.Schema.Types.Mixed, default: null },
  messages: [messageSchema],
  status: {
    type: String,
    enum: ['active', 'waiting_agent', 'with_agent', 'closed'],
    default: 'active',
    index: true
  },
  agentConnected: { type: Boolean, default: false },
  agentConnectedAt: { type: Date, default: null },
  agentNotifiedAt: { type: Date, default: null },
  lastActivity: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

ollySessionSchema.pre('save', function (next) {
  this.lastActivity = new Date();
  next();
});

module.exports = mongoose.model('OllySession', ollySessionSchema);
