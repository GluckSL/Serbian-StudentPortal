const StudentLoginStreak = require('../models/StudentLoginStreak');

function computeRewardTierForDate(dateStr) {
  if (!dateStr) return null;
  const day = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  if (day === 0) return 'trophy';
  if (day <= 2) return 'bronze';
  if (day <= 4) return 'silver';
  return 'gold';
}

function getWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`;
}

function getMonSunDates() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function isYesterday(lastDateStr, todayStr) {
  if (!lastDateStr) return false;
  const last = new Date(lastDateStr + 'T00:00:00Z');
  const today = new Date(todayStr + 'T00:00:00Z');
  const diff = (today - last) / 86400000;
  return diff === 1;
}

async function checkAndRecordStreak(studentId) {
  const today = new Date().toISOString().slice(0, 10);
  const currentWeekKey = getWeekKey(new Date());
  const weekDates = getMonSunDates();

  let record = await StudentLoginStreak.findOne({ studentId });

  if (!record) {
    record = await StudentLoginStreak.create({
      studentId,
      currentStreak: 1,
      bestStreak: 1,
      lastLoginDate: today,
      weeklyDays: 1,
      weekKey: currentWeekKey,
      weeklyRewardTier: null,
      totalTrophies: 0,
      loggedDates: [today],
    });

    return formatResponse(record, weekDates, true);
  }

  if (record.lastLoginDate === today) {
    return formatResponse(record, weekDates, false);
  }

  if (isYesterday(record.lastLoginDate, today)) {
    record.currentStreak += 1;
  } else {
    record.currentStreak = 1;
    record.weeklyDays = 0;
    record.weeklyRewardTier = null;
    record.loggedDates = [];
  }

  record.bestStreak = Math.max(record.bestStreak, record.currentStreak);
  record.lastLoginDate = today;

  if (record.weekKey !== currentWeekKey) {
    record.weeklyDays = 1;
    record.weekKey = currentWeekKey;
    record.weeklyRewardTier = null;
    record.loggedDates = [today];
  } else {
    if (!record.loggedDates.includes(today)) {
      record.weeklyDays += 1;
      record.loggedDates.push(today);
    }
  }

  const newTier = computeRewardTierForDate(today);
  if (newTier === 'trophy' && record.weeklyRewardTier !== 'trophy') {
    record.totalTrophies = (record.totalTrophies || 0) + 1;
  }
  record.weeklyRewardTier = newTier;

  await record.save();

  return formatResponse(record, weekDates, true);
}

async function getStreakData(studentId) {
  const record = await StudentLoginStreak.findOne({ studentId });
  const weekDates = getMonSunDates();

  if (!record) {
    return {
      isFirstLoginToday: false,
      currentStreak: 0,
      bestStreak: 0,
      weeklyDays: 0,
      weekKey: null,
      totalTrophies: 0,
      weeklyRewardTier: null,
      loggedDates: [],
      weekDates,
    };
  }

  return formatResponse(record, weekDates, false);
}

function formatResponse(record, weekDates, isFirstLoginToday) {
  return {
    isFirstLoginToday,
    currentStreak: record.currentStreak,
    bestStreak: record.bestStreak,
    weeklyDays: record.weeklyDays,
    weekKey: record.weekKey,
    totalTrophies: record.totalTrophies,
    weeklyRewardTier: record.weeklyRewardTier,
    loggedDates: record.loggedDates,
    weekDates,
  };
}

module.exports = {
  checkAndRecordStreak,
  getStreakData,
};
