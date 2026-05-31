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

    // R2 object key for raw/legacy MP4: {meetingLinkId}/{timestamp}.mp4
    // Null for HLS-only recordings (hlsKey is set instead).
    r2Key: {
      type: String,
      default: null,
    },

    // R2 object key for the HLS master playlist: {meetingLinkId}/hls/playlist.m3u8
    // When set, the recording is served as HLS (fast streaming, <1s startup).
    // Segments live alongside the playlist: {meetingLinkId}/hls/seg000.ts, etc.
    hlsKey: {
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

    // Visibility control: students can only access published recordings
    isPublished: {
      type: Boolean,
      default: false,
    },

    publishedAt: {
      type: Date,
      default: null,
    },

    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // Original Zoom download URL (stored for retry capability)
    zoomDownloadUrl: {
      type: String,
      default: null,
    },

    // Access filters for student visibility (same concept as manual recordings)
    accessBatches: {
      type: [String],
      default: [],
    },
    accessLevel: {
      type: String,
      enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', null],
      default: null,
    },
    accessPlan: {
      type: String,
      enum: ['SILVER', 'PLATINUM', 'VISA_DOC_ONLY', 'ALL'],
      default: 'ALL',
    },
  },
  { timestamps: true }
);

zoomRecordingSchema.index({ meetingLinkId: 1 });
zoomRecordingSchema.index({ zoomMeetingId: 1 });
zoomRecordingSchema.index({ status: 1 });
zoomRecordingSchema.index({ isPublished: 1, status: 1 });

module.exports = mongoose.model('ZoomRecording', zoomRecordingSchema);
