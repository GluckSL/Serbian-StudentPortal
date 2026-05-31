// services/attendanceMatchingSafeguards.js — post-pass validation for attendance rows

const matchLogger = require('../utils/matchLogger');

function downgradeRowToConflict(row, traceId) {
  row.matchMethod = 'ambiguous';
  row.mismatchReason = 'conflict_detected';
  row.attended = false;
  row.zoomName = null;
  row.zoomEmail = null;
  row.joinTime = null;
  row.leaveTime = null;
  row.duration = 0;
  row.durationMinutes = 0;
  row.attendancePercent = 0;
  row.status = 'absent';
  row.needsReview = true;
  row.debugSummary = 'Conflict: duplicate participant assignment';
  row.debug = {
    ...(row.debug && typeof row.debug === 'object' ? row.debug : {}),
    traceId: traceId != null ? String(traceId) : undefined,
    conflictDetected: true,
  };
}

/**
 * Ensure at most one student per Zoom participant key and at most one participant per student.
 * @param {object[]} rows - attendance rows (mutated in place)
 * @param {string|import('mongoose').Types.ObjectId} [traceId]
 */
function applyAttendanceStabilityPass(rows, traceId) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const byPart = new Map();
  for (const row of rows) {
    if (row.matchMethod === 'ambiguous' || row.matchMethod === 'no_match') continue;
    const k = row.debug?.participantKey;
    if (!k) continue;
    if (!byPart.has(k)) byPart.set(k, []);
    byPart.get(k).push(row);
  }

  for (const [k, list] of byPart) {
    if (list.length <= 1) continue;
    const sids = new Set(list.map((r) => String(r.studentId)));
    if (sids.size <= 1) continue;
    matchLogger.info('ATTENDANCE_CONFLICT_DETECTED', {
      traceId: traceId != null ? String(traceId) : null,
      participantKey: k,
      studentIds: [...sids],
    });
    for (const row of list) {
      downgradeRowToConflict(row, traceId);
    }
  }

  const byStudent = new Map();
  for (const row of rows) {
    if (row.matchMethod === 'ambiguous' || !row.debug?.participantKey) continue;
    const sid = String(row.studentId);
    if (!byStudent.has(sid)) byStudent.set(sid, []);
    byStudent.get(sid).push(row.debug.participantKey);
  }

  for (const [sid, keys] of byStudent) {
    const uniq = new Set(keys);
    if (uniq.size <= 1) continue;
    matchLogger.info('ATTENDANCE_CONFLICT_DETECTED', {
      traceId: traceId != null ? String(traceId) : null,
      reason: 'multiple_participants_per_student',
      studentId: sid,
      participantKeys: [...uniq],
    });
    for (const row of rows) {
      if (String(row.studentId) === sid && row.debug?.participantKey) {
        downgradeRowToConflict(row, traceId);
      }
    }
  }
}

module.exports = { applyAttendanceStabilityPass, downgradeRowToConflict };
