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
   * - old:     live classes & recordings only (default)
   * - general: no module/exercise content; live classes & recordings only
   * - new:     modules + exercises + live classes & recordings
   */
  batchType: {
    type: String,
    enum: ['general', 'new', 'old'],
    default: 'old',
    index: true
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
   * When true, this batch appears on Journey Management (active list) and follows journey tooling.
   * Inactive batches stay in "upcoming" until an admin starts the journey.
   */
  journeyActive: {
    type: Boolean,
    default: false,
    index: true
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
