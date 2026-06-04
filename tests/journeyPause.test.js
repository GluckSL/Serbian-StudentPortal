'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  applyJourneyPauseToggle,
  utcMidnightMs,
  MS_PER_DAY
} = require('../utils/journeyPause');

function makeCfg(overrides = {}) {
  return {
    batchType: 'new',
    journeyLength: 200,
    batchStartDate: new Date(utcMidnightMs(new Date('2026-04-08'))),
    batchCurrentDay: 1,
    journeyPaused: false,
    journeyPausedAt: null,
    journeyPausedFrozenDay: null,
    journeyPauseHistory: [],
    ...overrides
  };
}

describe('applyJourneyPauseToggle', () => {
  it('shifts batch start by calendar pause days (7-day pause → Apr 15, not Apr 16)', () => {
    const cfg = makeCfg();
    const pauseAt = new Date(utcMidnightMs(new Date('2026-04-08')));
    const resumeAt = new Date(utcMidnightMs(new Date('2026-04-15')));

    applyJourneyPauseToggle(cfg, true);
    assert.equal(cfg.journeyPaused, true);
    cfg.journeyPausedFrozenDay = 1;
    cfg.journeyPausedAt = pauseAt;
    applyJourneyPauseToggle(cfg, false, resumeAt);

    const startMs = utcMidnightMs(cfg.batchStartDate);
    const expectedMs = utcMidnightMs(new Date('2026-04-15'));
    assert.equal(startMs, expectedMs);
    assert.equal(cfg.journeyPauseHistory.length, 1);
    assert.equal(cfg.journeyPauseHistory[0].day, 1);
    assert.equal(cfg.journeyPauseHistory[0].pauseDays, 7);
  });

  it('does not shift start when pause and resume are the same calendar day', () => {
    const cfg = makeCfg();
    const sameDay = new Date(utcMidnightMs(new Date('2026-04-10')));

    applyJourneyPauseToggle(cfg, true);
    cfg.journeyPausedAt = sameDay;
    cfg.journeyPausedFrozenDay = 3;

    const before = utcMidnightMs(cfg.batchStartDate);
    applyJourneyPauseToggle(cfg, false, sameDay);
    assert.equal(utcMidnightMs(cfg.batchStartDate), before);
    assert.equal(cfg.journeyPauseHistory[0].pauseDays, 0);
  });

  it('records journey day in pause history (day 28 paused 3 days)', () => {
    const cfg = makeCfg({
      batchStartDate: new Date(utcMidnightMs(new Date('2026-01-01')))
    });
    const pauseAt = new Date(utcMidnightMs(new Date('2026-01-28')));
    const resumeAt = new Date(utcMidnightMs(new Date('2026-01-31')));

    applyJourneyPauseToggle(cfg, true);
    cfg.journeyPausedFrozenDay = 28;
    cfg.journeyPausedAt = pauseAt;
    applyJourneyPauseToggle(cfg, false, resumeAt);

    assert.equal(cfg.journeyPauseHistory[0].day, 28);
    assert.equal(cfg.journeyPauseHistory[0].pauseDays, 3);
    const startAfter = utcMidnightMs(cfg.batchStartDate);
    assert.equal(startAfter, utcMidnightMs(new Date('2026-01-01')) + 3 * MS_PER_DAY);
  });
});
