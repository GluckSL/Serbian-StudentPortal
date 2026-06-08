'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  clampStandardJourneyDay,
  clampJourneyDayForBatch,
  computeJourneyDayFromStartDate,
  daysSinceJourneyStart,
  utcMidnightMs,
  formatJourneyDayLabel
} = require('../utils/journeyDay');

describe('journeyDay', () => {
  it('standard batches clamp to 1–200', () => {
    assert.equal(clampStandardJourneyDay(-3), 1);
    assert.equal(clampStandardJourneyDay(0), 1);
    assert.equal(clampStandardJourneyDay(200), 200);
  });

  it('trial batches allow day 0', () => {
    assert.equal(clampJourneyDayForBatch(0, 200, true), 0);
    assert.equal(clampJourneyDayForBatch(0, 200, false), 1);
    assert.equal(formatJourneyDayLabel(0, true), 'Trial');
    assert.equal(formatJourneyDayLabel(1, true), 'Day 1');
  });

  it('standard start date is Day 1', () => {
    const start = new Date(utcMidnightMs(new Date('2026-05-28')));
    const today = new Date(utcMidnightMs(new Date('2026-06-05')));
    assert.equal(computeJourneyDayFromStartDate(start, start, 200, false), 1);
    assert.equal(computeJourneyDayFromStartDate(start, today, 200, false), 9);
  });

  it('trial start date is Trial then Day 1', () => {
    const start = new Date(utcMidnightMs(new Date('2026-05-28')));
    const day2 = new Date(utcMidnightMs(new Date('2026-05-29')));
    const today = new Date(utcMidnightMs(new Date('2026-06-05')));
    assert.equal(computeJourneyDayFromStartDate(start, start, 200, true), 0);
    assert.equal(computeJourneyDayFromStartDate(start, day2, 200, true), 1);
    assert.equal(computeJourneyDayFromStartDate(start, today, 200, true), 8);
  });

  it('multi-day trial window before Day 1', () => {
    const trialStart = '2026-06-07';
    const dayOne = '2026-06-10';
    const june7 = new Date(utcMidnightMs(new Date('2026-06-07')));
    const june9 = new Date(utcMidnightMs(new Date('2026-06-09')));
    const june10 = new Date(utcMidnightMs(new Date('2026-06-10')));
    const june11 = new Date(utcMidnightMs(new Date('2026-06-11')));
    assert.equal(computeJourneyDayFromStartDate(dayOne, june7, 200, true, trialStart), 0);
    assert.equal(computeJourneyDayFromStartDate(dayOne, june9, 200, true, trialStart), 0);
    assert.equal(computeJourneyDayFromStartDate(dayOne, june10, 200, true, trialStart), 1);
    assert.equal(computeJourneyDayFromStartDate(dayOne, june11, 200, true, trialStart), 2);
  });

  it('content unlock during trial uses Day 1 gates', () => {
    const { contentUnlockDayForJourney } = require('../utils/journeyDay');
    assert.equal(contentUnlockDayForJourney(0, true), 1);
    assert.equal(contentUnlockDayForJourney(0, false), 0);
    assert.equal(contentUnlockDayForJourney(3, true), 3);
  });
});
