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
    max: 220
  },
  batchCurrentDay: {
    type: Number,
    default: 1,
    min: 0,
    max: 220
  },
  /**
   * When set, the batch's current day is automatically computed from batchStartDate
   * (Day 1 on start date, or Trial/day 0 when trialDayEnabled without trialAccessStartDate).
   */
  batchStartDate: {
    type: Date,
    default: null
  },
  /**
   * Optional calendar overrides per CEFR level (display / admin corrections).
   * When set, dashboards use these instead of deriving from batchStartDate + journey day ranges.
   */
  levelCalendarDates: {
    A1: {
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null }
    },
    A2: {
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null }
    },
    B1: {
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null }
    },
    B2: {
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null }
    }
  },
  notes: {
    type: String,
    default: ''
  },
  /**
   * Batch type controls student learning-content visibility.
   * - new: modules + exercises + live/recordings are available (v1 content)
   * - new2: 2.0 modules + exercises + live/recordings (v2 content only)
   * - old: only live classes + recordings (default for new configs)
   */
  batchType: {
    type: String,
    enum: ['new', 'old', 'new2'],
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
   * Old batch type only: CEFR level manually assigned to every student in this batch.
   * Old batches do NOT derive level from journey day like new/new2 batches — an admin
   * picks the level here (Batch Settings) and it stays until changed.
   */
  oldBatchManualLevel: {
    type: String,
    enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    default: 'A1'
  },
  /**
   * When trialDayEnabled: first calendar date students enter Trial (journey day 0).
   * If set with batchStartDate, batchStartDate is Day 1 (not trial).
   */
  trialAccessStartDate: {
    type: Date,
    default: null
  },
  /**
   * When true (new batches only): batch start date is a one-day Trial/orientation
   * before Day 1. Tag trial recordings, exercises, etc. with courseDay 0.
   * Default off — existing batches unchanged.
   */
  trialDayEnabled: {
    type: Boolean,
    default: false,
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
   * When true, Zoom webhook recordings are automatically processed and saved for this batch.
   * When false, recordings must be backfilled manually via the backfill tool.
   */
  autoRecordingEnabled: {
    type: Boolean,
    default: true
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
    min: 0,
    max: 220
  },
  /**
   * Completed pause intervals (new batch type). Each entry: journey day frozen,
   * pause/resume timestamps, and calendar days the batch was paused.
   */
  journeyPauseHistory: {
    type: [
      {
        day: { type: Number, min: 0, max: 220 },
        pausedAt: { type: Date },
        resumedAt: { type: Date },
        pauseDays: { type: Number, min: 0 }
      }
    ],
    default: []
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
