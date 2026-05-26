// models/JourneyCrossBatchRecordingRule.js
// Self pace journey configuration:
// - target batches that should unlock a self-pace day after attendance
// - mapped manual/zoom recordings that are unlocked for that day
//
// NOTE: Keep legacy fields (studentBatch/sourceBatch) for backward compatibility
// with previously created rows. New UI/API writes targetBatches + mapped* fields.

const mongoose = require('mongoose');

const journeyCrossBatchRecordingRuleSchema = new mongoose.Schema(
  {
    // LEGACY single batch field (kept for old records)
    studentBatch: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },

    // Journey day number (1–200) that the rule applies to
    courseDay: {
      type: Number,
      required: true,
      min: 1,
      max: 200,
    },

    // LEGACY source-batch field (kept for old records)
    sourceBatch: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },

    // New: all batches that this self-pace day applies to
    targetBatches: {
      type: [String],
      default: [],
    },

    // New: mapped manual class recordings for this journey day
    mappedManualRecordingIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRecording',
    }],

    // New: mapped zoom classes (MeetingLink IDs) for this journey day
    mappedZoomMeetingLinkIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MeetingLink',
    }],

    // Optional label shown in admin card (defaults to "Journey Day {courseDay}")
    journeyTitle: {
      type: String,
      default: '',
      trim: true,
    },

    // Set to false to suspend access without deleting the rule
    active: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Optional staff-facing note (e.g. "Day 13 was cancelled for B36; sharing B35 content")
    notes: {
      type: String,
      default: '',
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// Fast lookup for student-feed and playback checks
journeyCrossBatchRecordingRuleSchema.index({ targetBatches: 1, courseDay: 1, active: 1 });
journeyCrossBatchRecordingRuleSchema.index({ studentBatch: 1, courseDay: 1, active: 1 });

// Prevent duplicate active rules for the same legacy triple
journeyCrossBatchRecordingRuleSchema.index(
  { studentBatch: 1, courseDay: 1, sourceBatch: 1, active: 1 },
  {
    unique: true,
    partialFilterExpression: {
      active: true,
      studentBatch: { $type: 'string', $ne: '' },
      sourceBatch: { $type: 'string', $ne: '' },
    },
  }
);

module.exports = mongoose.model('JourneyCrossBatchRecordingRule', journeyCrossBatchRecordingRuleSchema);
