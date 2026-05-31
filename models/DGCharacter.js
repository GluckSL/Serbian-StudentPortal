const mongoose = require('mongoose');

const DGCharacterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    avatarUrl: { type: String, default: '' },
    animations: {
      idle: { type: String, default: '' },
      happy: { type: String, default: '' },
      sad: { type: String, default: '' },
      thinking: { type: String, default: '' },
      speaking: { type: String, default: '' },
      listening: { type: String, default: '' },
      surprised: { type: String, default: '' },
      concerned: { type: String, default: '' },
      excited: { type: String, default: '' },
      confused: { type: String, default: '' },
    },
    voice: { type: String, default: 'alloy' },
    personality: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

DGCharacterSchema.index({ isActive: 1, name: 1 });
DGCharacterSchema.index(
  { isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

DGCharacterSchema.pre('save', async function ensureSingleDefault() {
  if (!this.isDefault) return;
  const Model = this.constructor;
  await Model.updateMany({ _id: { $ne: this._id }, isDefault: true }, { $set: { isDefault: false } });
});

module.exports = mongoose.model('DGCharacter', DGCharacterSchema);
