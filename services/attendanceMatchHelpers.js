// services/attendanceMatchHelpers.js — shared attendance row shape after Zoom matching

const matchLogger = require('../utils/matchLogger');

function confidenceLevelFromScore(score) {
  const s = Number(score) || 0;
  if (s >= 85) return 'high';
  if (s >= 65) return 'medium';
  return 'low';
}

/**
 * @param {object} attendee - MeetingLink.attendees element
 * @param {object} matchResult - return value of findBestParticipantMatch
 * @param {object} ctx
 * @param {number} ctx.meetingDurationMinutes
 * @param {boolean} ctx.clickedJoin
 * @param {string|import('mongoose').Types.ObjectId} [ctx.traceId] - one id for the whole attendance run
 */
function buildAttendanceRowFromMatch(attendee, matchResult, ctx) {
  const meetingDurationMinutes = ctx.meetingDurationMinutes || 60;
  const clickedJoin = !!ctx.clickedJoin;
  const traceId = ctx.traceId != null ? String(ctx.traceId) : null;

  const isAmbiguous = matchResult.ambiguous === true || matchResult.method === 'ambiguous';
  const finalConfidence =
    matchResult.finalConfidence != null ? matchResult.finalConfidence : matchResult.confidence ?? 0;
  const confidenceLevel = confidenceLevelFromScore(finalConfidence);

  const participantDuration = matchResult.match?.durationMinutes || 0;
  const attendancePercent =
    meetingDurationMinutes > 0 ? (participantDuration / meetingDurationMinutes) * 100 : 0;
  const meetsThreshold =
    !!matchResult.match && !isAmbiguous && attendancePercent >= 70;
  const appearedInZoom = !!(matchResult.match && Number(matchResult.match.duration) > 0);

  let mismatchReason = matchResult.mismatchReason || null;
  if (isAmbiguous) {
    if (!mismatchReason) {
      mismatchReason =
        matchResult.debug?.joinLogSkipReason === 'multiple_candidates'
          ? 'multiple_candidates'
          : 'low_confidence';
    }
  } else if (!matchResult.match) {
    if (matchResult.debug?.joinLogSkipReason === 'multiple_candidates') {
      mismatchReason = mismatchReason || 'multiple_join_log_candidates';
    } else if (matchResult.debug?.joinLogSkipReason === 'no_eligible_participant') {
      mismatchReason = mismatchReason || 'join_log_no_eligible_zoom_row';
    } else if (clickedJoin) {
      mismatchReason = mismatchReason || 'no_zoom_match';
    } else {
      mismatchReason = mismatchReason || 'no_match';
    }
  } else if (!meetsThreshold) {
    mismatchReason = mismatchReason || 'insufficient_time';
  }

  const debugSummary =
    matchResult.debugSummary ||
    (isAmbiguous
      ? 'Ambiguous match (not auto-assigned)'
      : !matchResult.match
        ? 'No Zoom participant matched'
        : 'Matched');

  let debug = matchResult.debug ? { ...matchResult.debug } : undefined;
  if (traceId) {
    debug = { ...(debug || {}), traceId };
  }
  if (debug && Object.keys(debug).length === 0) debug = undefined;

  return {
    studentId: attendee.studentId,
    name: attendee.name,
    email: attendee.email,
    attended: meetsThreshold,
    confidence: matchResult.confidence,
    finalConfidence,
    confidenceLevel,
    matchMethod: matchResult.method,
    zoomName: isAmbiguous ? null : matchResult.match?.name || null,
    zoomEmail: isAmbiguous ? null : matchResult.match?.email || null,
    joinTime: isAmbiguous ? null : matchResult.match?.joinTime || null,
    leaveTime: isAmbiguous ? null : matchResult.match?.leaveTime || null,
    duration: isAmbiguous ? 0 : matchResult.match?.duration || 0,
    durationMinutes: isAmbiguous ? 0 : participantDuration,
    attendancePercent: isAmbiguous ? 0 : Math.round(attendancePercent),
    status: meetsThreshold ? 'attended' : matchResult.match && !isAmbiguous ? 'late' : 'absent',
    needsReview:
      isAmbiguous ||
      matchResult.weakIdentityMatch ||
      (finalConfidence < 80 && finalConfidence > 0),
    debug,
    debugSummary,
    clickedJoin,
    appearedInZoom: isAmbiguous ? false : appearedInZoom,
    mismatchReason,
  };
}

function logAttendanceMatchSummary(attendanceRows, meetingId, traceId) {
  const totalStudents = attendanceRows.length;
  let matchedCount = 0;
  let unmatchedCount = 0;
  let ambiguousCount = 0;
  let highConfidenceCount = 0;
  let lowConfidenceCount = 0;

  for (const r of attendanceRows) {
    const fc = r.finalConfidence != null ? r.finalConfidence : r.confidence ?? 0;
    if (r.matchMethod === 'ambiguous') {
      ambiguousCount += 1;
    } else if (r.zoomName && r.matchMethod !== 'no_match') {
      matchedCount += 1;
    } else {
      unmatchedCount += 1;
    }
    if (fc >= 85) highConfidenceCount += 1;
    if (fc < 65) lowConfidenceCount += 1;
  }

  matchLogger.info('ATTENDANCE_MATCH_SUMMARY', {
    meetingId: meetingId != null ? String(meetingId) : null,
    traceId: traceId != null ? String(traceId) : null,
    totalStudents,
    matchedCount,
    unmatchedCount,
    ambiguousCount,
    highConfidenceCount,
    lowConfidenceCount,
  });
}

module.exports = { buildAttendanceRowFromMatch, logAttendanceMatchSummary, confidenceLevelFromScore };
