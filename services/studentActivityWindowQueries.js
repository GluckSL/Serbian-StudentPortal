/**
 * Mongo queries so activity loaders match how each source sets `occurredAt`.
 * Fixes single-day detail views vs multi-day summaries (e.g. meetings filtered by startTime only).
 */

function boundedRange(from, to) {
    const r = {};
    if (from) r.$gte = from;
    if (to) r.$lte = to;
    return r;
}

/** Match if any of the date fields falls in [from, to] (inclusive). */
function orMatchAnyDateFieldInRange(from, to, fieldNames) {
    if (!from && !to) return {};
    const range = boundedRange(from, to);
    if (Object.keys(range).length === 0) return {};
    const parts = fieldNames.map((f) => ({ [f]: range }));
    if (parts.length === 1) return parts[0];
    return { $or: parts };
}

function meetingLinkQueryForActivityWindow(from, to) {
    return orMatchAnyDateFieldInRange(from, to, ['startTime', 'attendance.joinTime']);
}

function exerciseAttemptQueryForActivityWindow(from, to) {
    return orMatchAnyDateFieldInRange(from, to, ['createdAt', 'startedAt', 'completedAt']);
}

function sessionRecordQueryForActivityWindow(from, to) {
    return orMatchAnyDateFieldInRange(from, to, ['createdAt', 'startTime']);
}

function studentProgressQueryForActivityWindow(from, to) {
    return orMatchAnyDateFieldInRange(from, to, ['updatedAt', 'lastAccessedAt', 'createdAt']);
}

function assignmentSubmissionQueryForActivityWindow(from, to) {
    const base = { isDeleted: { $ne: true } };
    const windowQ = orMatchAnyDateFieldInRange(from, to, ['createdAt', 'submittedAt']);
    if (Object.keys(windowQ).length === 0) return base;
    return { $and: [base, windowQ] };
}

module.exports = {
    meetingLinkQueryForActivityWindow,
    exerciseAttemptQueryForActivityWindow,
    sessionRecordQueryForActivityWindow,
    studentProgressQueryForActivityWindow,
    assignmentSubmissionQueryForActivityWindow
};
