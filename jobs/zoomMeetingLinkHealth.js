/**
 * Proactive Zoom link health check.
 *
 * Runs every few minutes and, for every scheduled class that is about to start,
 * verifies the Zoom meeting still exists. If Zoom has expired/deleted it, the
 * meeting is regenerated in place (new id, join/start URLs, password) and the
 * timetable slot is re-linked — so students and teachers never open an
 * "Invalid meeting ID" link.
 *
 * The student join route (routes/joinClass.js) runs the same check on click as
 * a last-resort safety net; this cron makes sure links are healthy *before*
 * anyone tries to join.
 */
const cron = require('node-cron');
const MeetingLink = require('../models/MeetingLink');
const {
  notEndedScheduledMeetingFilter,
  ensureZoomMeetingLive,
} = require('../services/zoomMeetingLifecycle.service');

// How far ahead of start we begin health-checking a class.
const LOOKAHEAD_MINUTES = 45;
// Don't re-hit the Zoom API for the same meeting more often than this.
const CHECK_THROTTLE_MS = 9 * 60 * 1000;
// Safety cap per run.
const MAX_PER_RUN = 150;

async function processZoomLinkHealth() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60 * 1000);

  const staleBefore = new Date(now.getTime() - CHECK_THROTTLE_MS);

  const filter = {
    ...notEndedScheduledMeetingFilter(now),
    startTime: { $lte: windowEnd },
    hostEmail: { $exists: true, $nin: [null, ''] },
    $or: [
      { lastZoomCheckAt: { $exists: false } },
      { lastZoomCheckAt: null },
      { lastZoomCheckAt: { $lte: staleBefore } },
    ],
  };

  const candidates = await MeetingLink.find(filter)
    .sort({ startTime: 1 })
    .limit(MAX_PER_RUN);

  if (!candidates.length) return;

  let checked = 0;
  let regenerated = 0;

  for (const meeting of candidates) {
    try {
      // throttleMs 0 here: the query already filtered by lastZoomCheckAt.
      const result = await ensureZoomMeetingLive(meeting, { throttleMs: 0 });
      if (result.checked) checked += 1;
      if (result.regenerated) regenerated += 1;
    } catch (err) {
      console.error(
        `❌ Zoom link health check failed for meeting ${meeting._id}:`,
        err.message
      );
    }
  }

  if (checked || regenerated) {
    console.log(
      `🔎 Zoom link health: checked ${checked}/${candidates.length} upcoming classes, regenerated ${regenerated}.`
    );
  }
}

function scheduleZoomMeetingLinkHealth() {
  cron.schedule('*/5 * * * *', () => {
    processZoomLinkHealth().catch((err) =>
      console.error('zoomMeetingLinkHealth:', err.message)
    );
  });
  console.log(
    `📅 Scheduled: Zoom meeting link health check (every 5 min, up to ${LOOKAHEAD_MINUTES} min before start)`
  );
}

module.exports = { scheduleZoomMeetingLinkHealth, processZoomLinkHealth };
