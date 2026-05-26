// models/SelfPaceConfig.js
// Singleton-style config: which student batches can use Self Pace content.

const mongoose = require('mongoose');

const selfPaceConfigSchema = new mongoose.Schema(
  {
    /** Fixed key so we always upsert the same document */
    key: { type: String, default: 'default', unique: true },

    /** Batch labels that participate in Self Pace (e.g. "36", "Batch 36") */
    activatedBatches: {
      type: [String],
      default: [],
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SelfPaceConfig', selfPaceConfigSchema);
