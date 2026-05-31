const mongoose = require('mongoose');

const selfPaceBatchActivationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    activeBatches: {
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

module.exports = mongoose.model('SelfPaceBatchActivation', selfPaceBatchActivationSchema);
