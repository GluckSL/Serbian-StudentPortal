// services/interactiveGames/economy.js — coins, gems, shop, daily wheel

const StudentWallet = require('../../models/StudentWallet');
const config = require('../../config/glueckArena');
const auditLog = require('./auditLog');

async function getWallet(studentId) {
  return StudentWallet.findOneAndUpdate(
    { studentId },
    { $setOnInsert: { studentId } },
    { upsert: true, new: true }
  ).lean();
}

async function addCoins(studentId, amount, reason = '') {
  if (!amount) return;
  await StudentWallet.updateOne({ studentId }, { $inc: { coins: amount } }, { upsert: true });
  await auditLog.log({ actorId: studentId, action: 'coins_added', metadata: { amount, reason } });
}

async function addGems(studentId, amount, reason = '') {
  if (!amount) return;
  await StudentWallet.updateOne({ studentId }, { $inc: { gems: amount } }, { upsert: true });
}

async function purchaseItem(studentId, itemKey, coinCost) {
  const wallet = await getWallet(studentId);
  if ((wallet.coins || 0) < coinCost) return { ok: false, message: 'Insufficient coins' };
  await StudentWallet.updateOne(
    { studentId },
    {
      $inc: { coins: -coinCost },
      $push: { inventory: { itemKey, quantity: 1 } },
    }
  );
  return { ok: true };
}

async function spinDailyWheel(studentId) {
  const wallet = await getWallet(studentId);
  const today = new Date().toISOString().slice(0, 10);
  if (wallet.lastDailyWheelAt && wallet.lastDailyWheelAt.toISOString().slice(0, 10) === today) {
    return { ok: false, message: 'Already spun today' };
  }
  const prizes = config.economy.dailyWheelCoins;
  const coins = prizes[Math.floor(Math.random() * prizes.length)];
  await StudentWallet.updateOne(
    { studentId },
    { $inc: { coins }, $set: { lastDailyWheelAt: new Date() } }
  );
  return { ok: true, coins };
}

async function buyStreakFreeze(studentId) {
  const cost = config.economy.streakFreezeCostCoins;
  const wallet = await getWallet(studentId);
  if ((wallet.coins || 0) < cost) return { ok: false, message: 'Insufficient coins' };
  await StudentWallet.updateOne(
    { studentId, 'inventory.itemKey': 'streak_freeze' },
    { $inc: { coins: -cost, 'inventory.$.quantity': 1 } }
  ).catch(async () => {
    await StudentWallet.updateOne(
      { studentId },
      { $inc: { coins: -cost }, $push: { inventory: { itemKey: 'streak_freeze', quantity: 1 } } }
    );
  });
  return { ok: true };
}

module.exports = { getWallet, addCoins, addGems, purchaseItem, spinDailyWheel, buyStreakFreeze };
