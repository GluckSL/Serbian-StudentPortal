// models/BatchConfig.js

const mongoose = require('mongoose');

const BatchConfigSchema = new mongoose.Schema({
  batchName: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  journeyLength: {
    type: Number,
    default: 200,
    min: 1,
    max: 200
  },
  batchCurrentDay: {
    type: Number,
    default: 1,
    min: 1,
    max: 200
  },
  /**
   * When set, the batch's current day is automatically computed as:
   *   currentDay = daysSinceStart + 1   (capped to journeyLength)
   * batchCurrentDay is then ignored for display purposes.
   */
  batchStartDate: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    default: ''
  },
  /**
   * Batch type controls student learning-content visibility.
   * - new: modules + exercises + live/recordings are available
   * - old: only live classes + recordings (default for new configs)
   */
  batchType: {
    type: String,
    enum: ['new', 'old'],
    default: 'old',
    index: true
  },
  /**
   * When batchType is old: if true, students get DG Bot modules released in 7-day journey weeks
   * (days 1–7, then 8–14 after week 1 is fully completed, etc.).
   */
  oldBatchDgBotAccess: {
    type: Boolean,
    default: false
  },
  /**
   * When false (default), students move to the next journey day on the daily rollover
   * without needing to finish modules, exercises, or live classes.
   * When true, rollover (and admin "advance") require at least strictJourneyThresholdPercent
   * of that day's tasks (modules + exercises + live classes) to be completed.
   */
  strictJourneyRule: {
    type: Boolean,
    default: false
  },
  /** Required when strictJourneyRule is true (1–100). Ignored when strict is off. */
  strictJourneyThresholdPercent: {
    type: Number,
    default: 100,
    min: 1,
    max: 100
  },
  /**
   * When true, Zoom webhook recordings are automatically processed and saved for this batch.
   * When false (default), recordings must be backfilled manually via the backfill tool.
   */
  autoRecordingEnabled: {
    type: Boolean,
    default: false
  },
  /**
   * When true, this batch appears on Journey Management (active list) and follows journey tooling.
   * Inactive batches stay in "upcoming" until an admin starts the journey.
   */
  journeyActive: {
    type: Boolean,
    default: false,
    index: true
  },
  /**
   * New batches only: when true, batch day and midnight student rollover are frozen
   * until an admin resumes the journey (use for short breaks between journey days).
   */
  journeyPaused: {
    type: Boolean,
    default: false,
    index: true
  },
  journeyPausedAt: {
    type: Date,
    default: null
  },
  /** Batch journey day frozen while journeyPaused is true (new batch type only). */
  journeyPausedFrozenDay: {
    type: Number,
    default: null,
    min: 1,
    max: 200
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

BatchConfigSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  if (this.batchCurrentDay > this.journeyLength) {
    this.batchCurrentDay = this.journeyLength;
  }
  next();
});

module.exports = mongoose.model('BatchConfig', BatchConfigSchema);
