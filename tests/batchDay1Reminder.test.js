'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLaunchDateStr, toDateStr } = require('../jobs/batchDay1Reminder');

describe('batchDay1Reminder', () => {
  it('prefers the first scheduled class date over journey dates', () => {
    const batch = {
      batchStartDate: new Date('2026-07-10T00:00:00.000Z'),
      levelCalendarDates: {
        A1: { startDate: new Date('2026-07-09T00:00:00.000Z') },
      },
    };
    const classStart = new Date('2026-07-09T14:30:00.000Z'); // 8:00 PM IST on 9 Jul

    assert.equal(resolveLaunchDateStr(batch, classStart), '2026-07-09');
  });

  it('falls back to A1 level date when no class is scheduled yet', () => {
    const batch = {
      batchStartDate: new Date('2026-07-10T00:00:00.000Z'),
      levelCalendarDates: {
        A1: { startDate: new Date('2026-07-09T00:00:00.000Z') },
      },
    };

    assert.equal(resolveLaunchDateStr(batch, null), '2026-07-09');
  });

  it('falls back to batchStartDate when no class or level schedule exists', () => {
    const batch = {
      batchStartDate: new Date('2026-07-10T00:00:00.000Z'),
      levelCalendarDates: {},
    };

    assert.equal(resolveLaunchDateStr(batch, null), '2026-07-10');
  });

  it('returns null when no launch date can be resolved', () => {
    assert.equal(resolveLaunchDateStr({ levelCalendarDates: {} }, null), null);
  });

  it('formats class instants in IST calendar days', () => {
    assert.equal(toDateStr(new Date('2026-07-09T14:30:00.000Z')), '2026-07-09');
  });
});
