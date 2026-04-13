// models/ZoomRecording.js
// Stores metadata for recordings auto-ingested from Zoom via webhook

const mongoose = require('mongoose');

const zoomRecordingSchema = new mongoose.Schema(
  {
    // Reference to the internal MeetingLink document
    meetingLinkId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MeetingLink',
      required: true,
    },

    // Raw Zoom numeric meeting ID (used for webhook matching)
    zoomMeetingId: {
      type: String,
      required: true,
    },

    // R2 object key: {meetingLinkId}/{timestamp}.mp4
    // e.g. "64f1a2b3c4d5e6f7a8b9c0d1/2026-04-13T09-00-00.mp4"
    r2Key: {
      type: String,
      default: null,
    },

    // Video duration in seconds (extracted during processing)
    duration: {
      type: Number,
      default: null,
    },

    // Processing state
    status: {
      type: String,
      enum: ['processing', 'ready', 'failed'],
      default: 'processing',
    },

    // Populated when status === 'failed'
    errorMessage: {
      type: String,
      default: null,
    },

    // Original Zoom download URL (stored for retry capability)
    zoomDownloadUrl: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

zoomRecordingSchema.index({ meetingLinkId: 1 });
zoomRecordingSchema.index({ zoomMeetingId: 1 });
zoomRecordingSchema.index({ status: 1 });

module.exports = mongoose.model('ZoomRecording', zoomRecordingSchema);
