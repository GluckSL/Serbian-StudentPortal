// models/SelfPaceJourney.js
// A Self Pace module (e.g. "Journey 1", "Journey 2") containing day slots with mapped recordings.

const mongoose = require('mongoose');

const selfPaceJourneySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
    },

    active: {
      type: Boolean,
      default: true,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

selfPaceJourneySchema.index({ sortOrder: 1, name: 1 });

module.exports = mongoose.model('SelfPaceJourney', selfPaceJourneySchema);
