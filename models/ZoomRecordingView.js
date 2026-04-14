const mongoose = require('mongoose');

const zoomRecordingViewSchema = new mongoose.Schema(
  {
    meetingLinkId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MeetingLink',
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    watchDuration: {
      type: Number,
      default: 0, // seconds
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

zoomRecordingViewSchema.index({ meetingLinkId: 1, student: 1, startedAt: -1 });

module.exports = mongoose.model('ZoomRecordingView', zoomRecordingViewSchema);
