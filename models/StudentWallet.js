// models/StudentWallet.js — coins, gems, inventory (streak freezes, boosters)

const mongoose = require('mongoose');

const InventoryItemSchema = new mongoose.Schema({
  itemKey: { type: String, required: true },
  quantity: { type: Number, default: 0 },
}, { _id: false });

const StudentWalletSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  coins: { type: Number, default: 0 },
  gems: { type: Number, default: 0 },
  inventory: { type: [InventoryItemSchema], default: [] },
  lastDailyWheelAt: { type: Date, default: null },
  lastDailyRewardAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('StudentWallet', StudentWalletSchema);
