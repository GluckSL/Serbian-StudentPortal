const mongoose = require('mongoose');

const announcementCommentSchema = new mongoose.Schema({
  announcementId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Announcement',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  parentCommentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AnnouncementComment',
    default: null
  },
  isEdited: { type: Boolean, default: false }
}, { timestamps: true });

announcementCommentSchema.index({ announcementId: 1, createdAt: -1 });
announcementCommentSchema.index({ parentCommentId: 1 });

module.exports = mongoose.model('AnnouncementComment', announcementCommentSchema);
