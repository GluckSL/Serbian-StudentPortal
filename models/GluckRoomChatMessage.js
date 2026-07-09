const mongoose = require('mongoose');

const GluckRoomChatMessageSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GluckRoomSession',
    required: true,
    index: true,
  },
  userId: {
    type: String,
    required: true,
  },
  userName: {
    type: String,
    required: true,
  },
  userRole: {
    type: String,
    enum: ['student', 'teacher', 'admin', 'teacher_admin', 'sub_admin'],
    default: 'student',
  },
  message: {
    type: String,
    required: true,
    maxlength: 2000,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

GluckRoomChatMessageSchema.index({ sessionId: 1, createdAt: -1 });

module.exports = mongoose.model('GluckRoomChatMessage', GluckRoomChatMessageSchema);
