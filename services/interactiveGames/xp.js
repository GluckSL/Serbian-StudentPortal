// services/interactiveGames/xp.js
// GlückArena: XP ledger + StudentGameStats updater

const mongoose = require('mongoose');
const XpTransaction = require('../../models/XpTransaction');
const StudentGameStats = require('../../models/StudentGameStats');

/**
 * Record an XP transaction in the immutable ledger.
 */
async function award(studentId, attemptId, gameSetId, source, amount, description = '') {
  if (!amount || amount <= 0) return;
  await XpTransaction.create({ studentId, attemptId, gameSetId, source, amount, description });
}

/**
 * Update (or create) the denormalised StudentGameStats document after a completed attempt.
 * Uses $inc / $max for atomicity.
 */
async function updateStudentStats(studentId, attempt, set) {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const existing = await StudentGameStats.findOne({ studentId });
    const lastDate = existing?.lastPlayedDate ? new Date(existing.lastPlayedDate) : null;
    lastDate?.setUTCHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    let streakInc = 0;
    let streakReset = false;

    if (!lastDate) {
      streakInc = 1;
    } else if (lastDate.getTime() === today.getTime()) {
      // Already played today — no streak change
    } else if (lastDate.getTime() === yesterday.getTime()) {
      streakInc = 1;  // consecutive day
    } else {
      streakReset = true;  // gap in days — reset
    }

    const gameTypeKey = attempt.gameType;
    const byTypeInc = {};
    if (['scramble_rush', 'sentence_builder'].includes(gameTypeKey)) {
      byTypeInc[`byGameType.${gameTypeKey}.gamesCompleted`] = 1;
      byTypeInc[`byGameType.${gameTypeKey}.totalXp`] = attempt.xpEarned || 0;
    }

    const incPayload = {
      totalXp: attempt.xpEarned || 0,
      gamesPlayed: 1,
      gamesCompleted: 1,
      totalCorrectAnswers: attempt.correctAnswers || 0,
      totalAnswers: attempt.totalQuestions || 0,
      ...byTypeInc,
    };

    if (streakInc) incPayload.currentStreak = streakInc;

    const setPayload = { lastPlayedDate: new Date() };
    if (streakReset) setPayload.currentStreak = 1;

    const maxPayload = { bestScore: attempt.score || 0 };
    if (['scramble_rush', 'sentence_builder'].includes(gameTypeKey)) {
      maxPayload[`byGameType.${gameTypeKey}.bestScore`] = attempt.score || 0;
    }

    // Use findOneAndUpdate with upsert
    const updated = await StudentGameStats.findOneAndUpdate(
      { studentId },
      {
        $inc: incPayload,
        $set: setPayload,
        $max: maxPayload,
      },
      { upsert: true, new: true }
    );

    // Keep bestStreak in sync
    if (updated.currentStreak > (updated.bestStreak || 0)) {
      await StudentGameStats.findOneAndUpdate({ studentId }, { $max: { bestStreak: updated.currentStreak } });
    }

    try {
      const streaksService = require('./streaks');
      const leaguesService = require('./leagues');
      const { xpToLevel } = require('./arenaProfile');
      await streaksService.onGameCompleted(studentId, attempt.xpEarned || 0);
      await leaguesService.addWeeklyXp(studentId, attempt.xpEarned || 0);
      const lvl = xpToLevel(updated.totalXp);
      if (lvl !== updated.arenaLevel) {
        await StudentGameStats.updateOne({ studentId }, { $set: { arenaLevel: lvl } });
      }
    } catch (hookErr) {
      console.warn('[glueck-arena] post-stats hooks:', hookErr.message);
    }
  } catch (e) {
    console.warn('[glueck-arena] updateStudentStats:', e.message);
  }
}

module.exports = { award, updateStudentStats };
