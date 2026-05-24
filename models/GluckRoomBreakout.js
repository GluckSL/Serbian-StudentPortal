const mongoose = require('mongoose');

const GluckRoomBreakoutSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GluckRoomSession',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  livekitRoomName: {
    type: String,
    required: true,
    unique: true,
  },
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  assignedParticipants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  status: {
    type: String,
    enum: ['active', 'ended'],
    default: 'active',
  },
  endedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('GluckRoomBreakout', GluckRoomBreakoutSchema);
