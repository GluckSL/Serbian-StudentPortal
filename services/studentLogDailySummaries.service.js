/**
 * Lightweight daily aggregates for Student Logs "All logs" page.
 * Avoids returning full activity-feed payloads; computes summaries on the server.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const ActivityDailySummary = require('../models/ActivityDailySummary');
const ActivityDailySummaryBounds = require('../models/ActivityDailySummaryBounds');
const UserActivityLog = require('../models/UserActivityLog');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const DigitalExercise = require('../models/DigitalExercise');
const MeetingLink = require('../models/MeetingLink');
const StudentLogs = require('../models/StudentLogs');
const StudentProgress = require('../models/StudentProgress');
const LearningModule = require('../models/LearningModule');
const SessionRecord = require('../models/SessionRecord');
const AssignmentSubmission = require('../models/AssignmentSubmission');
const AssignmentTemplate = require('../models/AssignmentTemplates');
const {
    meetingLinkQueryForActivityWindow,
    exerciseAttemptQueryForActivityWindow,
    sessionRecordQueryForActivityWindow,
    studentProgressQueryForActivityWindow,
    assignmentSubmissionQueryForActivityWindow
} = require('./studentActivityWindowQueries');

const PORTAL_IDLE_GAP_MS = 30 * 60 * 1000;
const PORTAL_MAX_SESSION_MS = 8 * 60 * 60 * 1000;

const MAX_SUMMARY_RANGE_DAYS = 120;

/** Bump when formula changes so stale cache rows are recomputed */
const CACHE_SCHEMA_VERSION = 3;

function pad2(n) {
    return String(n).padStart(2, '0');
}

/** Fallback when Intl / timeZone is invalid */
function resolveDayKeyLegacy(occurredAt) {
    const d = new Date(occurredAt);
    if (Number.isNaN(d.getTime())) return 'unknown';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Calendar YYYY-MM-DD in a specific IANA zone (matches browser when client sends its zone).
 */
function resolveDayKeyInTimeZone(occurredAt, timeZone) {
    const d = new Date(occurredAt);
    if (Number.isNaN(d.getTime())) return 'unknown';
    const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : 'UTC';
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(d);
        const y = parts.find((p) => p.type === 'year')?.value;
        const m = parts.find((p) => p.type === 'month')?.value;
        const day = parts.find((p) => p.type === 'day')?.value;
        if (!y || !m || !day) return 'unknown';
        return `${y}-${m}-${day}`;
    } catch {
        return resolveDayKeyLegacy(occurredAt);
    }
}

/**
 * First instant (ms) where resolveDayKeyInTimeZone(t, timeZone) === dayKey (YYYY-MM-DD).
 */
function zonedDayStartUtc(dayKey, timeZone) {
    const parts = dayKey.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return Date.now();
    const [y, mo, da] = parts;
    let lo = Date.UTC(y, mo - 1, da - 1, 0, 0, 0, 0) - 48 * 3600000;
    let hi = Date.UTC(y, mo - 1, da + 1, 0, 0, 0, 0) + 48 * 3600000;
    const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : 'UTC';
    while (lo < hi - 1) {
        const mid = Math.floor((lo + hi) / 2);
        const k = resolveDayKeyInTimeZone(new Date(mid), tz);
        if (k < dayKey) lo = mid;
        else hi = mid;
    }
    return hi;
}

/** First instant not in dayKey (exclusive end for range queries). */
function zonedDayEndUtcExclusive(dayKey, timeZone) {
    const start = zonedDayStartUtc(dayKey, timeZone);
    const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : 'UTC';
    let lo = start;
    let hi = start + 49 * 3600000;
    while (lo < hi - 1) {
        const mid = Math.floor((lo + hi) / 2);
        const k = resolveDayKeyInTimeZone(new Date(mid), tz);
        if (k === dayKey) lo = mid;
        else hi = mid;
    }
    return hi;
}

function inferMinutesFromEvent(ev) {
    const d = ev.details || {};
    switch (ev.type) {
        case 'SESSION_RECORD':
            return Math.max(0, Math.round(Number(d.durationMinutes) || 0));
        case 'MEETING_ATTENDANCE':
            return Math.max(0, Math.round(Number(d.attendedMinutes) || 0));
        case 'EXERCISE_ATTEMPT':
            return Math.max(0, Math.round((Number(d.timeSpentSeconds) || 0) / 60));
        default:
            return 0;
    }
}

function isAuthActivity(ev) {
    return ev.type === 'LOGIN' || ev.type === 'LOGOUT';
}

function resolveEventPage(ev) {
    const d = ev.details || {};
    switch (ev.type) {
        case 'LOGIN':
        case 'LOGOUT':
            return 'Auth';
        case 'MEETING_ATTENDANCE':
            return d.topic ? `Meeting · ${d.topic}` : 'Meeting';
        case 'EXERCISE_ATTEMPT':
            return d.exerciseTitle ? `Digital Exercise · ${d.exerciseTitle}` : 'Digital Exercise';
        case 'MODULE_PROGRESS':
            return d.moduleTitle ? `Learning Module · ${d.moduleTitle}` : 'Learning Modules';
        case 'SESSION_RECORD':
            return d.moduleTitle ? `AI Session · ${d.moduleTitle}` : 'AI Session';
        case 'ASSIGNMENT_SUBMISSION':
            return d.title ? `Assignments · ${d.title}` : 'Assignments';
        case 'PROFILE_UPDATE':
            return 'Student Profile';
        default:
            return ev.type;
    }
}

function resolveStudentLabel(ev, ctx) {
    if (ev.student) {
        return `${ev.student.name} (${ev.student.regNo})`;
    }
    return ctx.selectedStudentLabel || 'Selected student';
}

function sortEventsChrono(events) {
    return [...events].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
}

function portalSessionMinutesForStudent(events) {
    const sorted = sortEventsChrono(events);
    if (sorted.length === 0) return 0;
    let totalMs = 0;
    let sessionStart = new Date(sorted[0].occurredAt).getTime();
    let lastT = sessionStart;
    for (let i = 1; i < sorted.length; i++) {
        const t = new Date(sorted[i].occurredAt).getTime();
        if (t - lastT > PORTAL_IDLE_GAP_MS) {
            totalMs += Math.min(Math.max(0, lastT - sessionStart), PORTAL_MAX_SESSION_MS);
            sessionStart = t;
        }
        lastT = t;
    }
    totalMs += Math.min(Math.max(0, lastT - sessionStart), PORTAL_MAX_SESSION_MS);
    const spanMin = Math.max(0, Math.round(totalMs / 60000));

    let inferSum = 0;
    let hasNonAuth = false;
    for (const ev of sorted) {
        if (isAuthActivity(ev)) continue;
        hasNonAuth = true;
        inferSum += inferMinutesFromEvent(ev);
    }
    if (!hasNonAuth) return 0;
    const combined = Math.max(spanMin, inferSum);
    if (combined === 0) return 1;
    return combined;
}

function allocatePortalMinutesByPageAndDay(events, dayKeyFn) {
    const pageMinutes = new Map();
    const dayMinutes = new Map();
    const sorted = sortEventsChrono(events);
    if (sorted.length === 0) {
        return { pageMinutes, dayMinutes, totalMinutes: 0 };
    }

    let totalMinutes = 0;
    let lastT = new Date(sorted[0].occurredAt).getTime();
    let sessionStartIdx = 0;

    const flushSession = (endIdx) => {
        const slice = sorted.slice(sessionStartIdx, endIdx + 1);
        const rawMs = Math.max(
            0,
            new Date(slice[slice.length - 1].occurredAt).getTime() - new Date(slice[0].occurredAt).getTime()
        );
        const durMs = Math.min(rawMs, PORTAL_MAX_SESSION_MS);
        let durMin = Math.max(0, Math.round(durMs / 60000));
        let inferSlice = 0;
        for (const e of slice) {
            if (!isAuthActivity(e)) inferSlice += inferMinutesFromEvent(e);
        }
        durMin = Math.max(durMin, inferSlice);
        if (durMin === 0) {
            const hasNonAuth = slice.some((e) => !isAuthActivity(e));
            if (hasNonAuth) durMin = 1;
        }
        totalMinutes += durMin;
        if (durMin <= 0) return;

        const pages = new Set(slice.map((e) => resolveEventPage(e)).filter((p) => p !== 'Auth'));
        const n = Math.max(1, pages.size);
        const perPage = durMin / n;
        for (const p of pages) {
            pageMinutes.set(p, (pageMinutes.get(p) || 0) + perPage);
        }

        const dayKey = dayKeyFn(slice[0]);
        const dayLabel =
            dayKey === 'unknown' ? 'Unknown day' : new Date(`${dayKey}T12:00:00`).toLocaleDateString();
        const prev = dayMinutes.get(dayKey);
        dayMinutes.set(dayKey, {
            dayLabel,
            minutes: (prev?.minutes || 0) + durMin
        });
    };

    for (let i = 1; i < sorted.length; i++) {
        const t = new Date(sorted[i].occurredAt).getTime();
        if (t - lastT > PORTAL_IDLE_GAP_MS) {
            flushSession(i - 1);
            sessionStartIdx = i;
        }
        lastT = t;
    }
    flushSession(sorted.length - 1);

    return { pageMinutes, dayMinutes, totalMinutes };
}

function computeAggregatedAnalytics(filteredEvents, ctx, dayKeyFn) {
    const studentMap = new Map();
    const pageMap = new Map();
    const dayMap = new Map();
    const byStudentEvents = new Map();

    for (const ev of filteredEvents) {
        const student = resolveStudentLabel(ev, ctx);
        const studentId = ev.student?._id || ctx.selectedStudentId || student;
        const page = resolveEventPage(ev);
        const day = dayKeyFn(ev);
        const skipForAggregates = isAuthActivity(ev);

        const stuRow =
            studentMap.get(studentId) || { studentId, student, minutes: 0, visits: 0, pages: new Set() };
        if (!skipForAggregates) {
            stuRow.visits += 1;
            stuRow.pages.add(page);
        }
        studentMap.set(studentId, stuRow);

        if (!skipForAggregates) {
            const pageRow = pageMap.get(page) || { page, minutes: 0, visits: 0, students: new Set() };
            pageRow.visits += 1;
            pageRow.students.add(studentId);
            pageMap.set(page, pageRow);

            const dayLabel = day === 'unknown' ? 'Unknown day' : new Date(`${day}T12:00:00`).toLocaleDateString();
            const dayRow = dayMap.get(day) || { day, dayLabel, minutes: 0, visits: 0, students: new Set() };
            dayRow.visits += 1;
            dayRow.students.add(studentId);
            dayMap.set(day, dayRow);
        }

        const arr = byStudentEvents.get(studentId) || [];
        arr.push(ev);
        byStudentEvents.set(studentId, arr);
    }

    let totalMinutes = 0;
    for (const [studentId, evs] of byStudentEvents) {
        const portalMin = portalSessionMinutesForStudent(evs);
        totalMinutes += portalMin;
        const row = studentMap.get(studentId);
        if (row) row.minutes = portalMin;

        const { pageMinutes, dayMinutes } = allocatePortalMinutesByPageAndDay(evs, dayKeyFn);
        for (const [p, mins] of pageMinutes) {
            if (p === 'Auth') continue;
            let pr = pageMap.get(p);
            if (!pr) {
                pr = { page: p, minutes: 0, visits: 0, students: new Set() };
                pr.students.add(studentId);
                pageMap.set(p, pr);
            }
            pr.minutes += mins;
        }
        for (const [dk, { minutes: dm, dayLabel: dl }] of dayMinutes) {
            let dr = dayMap.get(dk);
            if (!dr) {
                const dayLabel =
                    dl || (dk === 'unknown' ? 'Unknown day' : new Date(`${dk}T12:00:00`).toLocaleDateString());
                dr = { day: dk, dayLabel, minutes: 0, visits: 0, students: new Set() };
                dr.students.add(studentId);
                dayMap.set(dk, dr);
            }
            dr.minutes += dm;
        }
    }

    const students = Array.from(studentMap.values())
        .map((row) => ({
            studentId: row.studentId,
            student: row.student,
            minutes: row.minutes,
            visits: row.visits,
            pages: row.pages.size
        }))
        .sort((a, b) => b.minutes - a.minutes || b.visits - a.visits);
    const pages = Array.from(pageMap.values())
        .filter((row) => row.page !== 'Auth')
        .map((row) => ({
            page: row.page,
            minutes: Math.round(row.minutes),
            visits: row.visits,
            students: row.students.size
        }))
        .sort((a, b) => b.minutes - a.minutes || b.visits - a.visits);

    return {
        timeSummary: {
            totalMinutes,
            activeStudents: students.length,
            avgMinutesPerStudent: students.length ? Math.round(totalMinutes / students.length) : 0,
            topPage: pages[0]?.page || '—',
            topStudent: students[0]?.student || '—'
        }
    };
}

function inRange(dt, from, to) {
    if (!dt) return false;
    const t = new Date(dt);
    if (from && t < from) return false;
    if (to && t > to) return false;
    return true;
}

async function loadMinimalActivityEvents(from, to, batchFilter) {
    const createdAt = {};
    if (from) createdAt.$gte = from;
    if (to) createdAt.$lte = to;
    const updatedAt = { ...createdAt };

    const [
        authLogs,
        attempts,
        meetings,
        profileRows,
        progressRows,
        sessions,
        subs
    ] = await Promise.all([
        UserActivityLog.find({ createdAt }).select('userId type createdAt').lean(),
        ExerciseAttempt.find(exerciseAttemptQueryForActivityWindow(from, to))
            .select('studentId exerciseId completedAt startedAt createdAt status timeSpentSeconds')
            .lean(),
        MeetingLink.find(meetingLinkQueryForActivityWindow(from, to)).select('topic batch startTime attendance').lean(),
        StudentLogs.find({ updatedAt }).select('studentId updatedAt action levelAtUpdate batchAtUpdate').lean(),
        StudentProgress.find(studentProgressQueryForActivityWindow(from, to))
            .select('studentId moduleId updatedAt lastAccessedAt createdAt status progressPercentage')
            .lean(),
        SessionRecord.find(sessionRecordQueryForActivityWindow(from, to))
            .select('studentId moduleTitle sessionType startTime durationMinutes createdAt')
            .lean(),
        AssignmentSubmission.find(assignmentSubmissionQueryForActivityWindow(from, to))
            .select('studentId moduleId assignmentTemplateId title submittedAt createdAt status marks')
            .lean()
    ]);

    const studentIdSet = new Set();
    for (const r of authLogs) {
        if (r.userId) studentIdSet.add(String(r.userId));
    }
    for (const a of attempts) {
        if (a.studentId) studentIdSet.add(String(a.studentId));
    }
    for (const m of meetings) {
        for (const e of m.attendance || []) {
            if (e.studentId) studentIdSet.add(String(e.studentId));
        }
    }
    for (const r of profileRows) {
        if (r.studentId) studentIdSet.add(String(r.studentId));
    }
    for (const p of progressRows) {
        if (p.studentId) studentIdSet.add(String(p.studentId));
    }
    for (const s of sessions) {
        if (s.studentId) studentIdSet.add(String(s.studentId));
    }
    for (const sub of subs) {
        if (sub.studentId) studentIdSet.add(String(sub.studentId));
    }

    const sidArr = [...studentIdSet].filter((id) => mongoose.Types.ObjectId.isValid(id));
    const users = await User.find({ _id: { $in: sidArr }, role: 'STUDENT' })
        .select('name regNo batch')
        .lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const exIds = [...new Set(attempts.map((a) => a.exerciseId).filter(Boolean).map(String))].filter((id) =>
        mongoose.Types.ObjectId.isValid(id)
    );
    const exercises =
        exIds.length > 0
            ? await DigitalExercise.find({ _id: { $in: exIds } }).select('title').lean()
            : [];
    const exMap = new Map(exercises.map((x) => [String(x._id), x]));

    const modIds = [
        ...new Set([
            ...progressRows.map((p) => p.moduleId).filter(Boolean),
            ...subs.map((s) => s.moduleId).filter(Boolean)
        ])
    ]
        .map(String)
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    const modules =
        modIds.length > 0 ? await LearningModule.find({ _id: { $in: modIds } }).select('title').lean() : [];
    const modMap = new Map(modules.map((m) => [String(m._id), m]));

    const tmplIds = [...new Set(subs.map((s) => s.assignmentTemplateId).filter(Boolean).map(String))].filter((id) =>
        mongoose.Types.ObjectId.isValid(id)
    );
    const templates =
        tmplIds.length > 0
            ? await AssignmentTemplate.find({ _id: { $in: tmplIds } }).select('title').lean()
            : [];
    const tmplMap = new Map(templates.map((t) => [String(t._id), t]));

    const events = [];

    for (const row of authLogs) {
        const u = userMap.get(String(row.userId));
        if (!u) continue;
        if (!inRange(row.createdAt, from, to)) continue;
        const stu = { _id: row.userId, regNo: u.regNo, name: u.name, batch: u.batch || '' };
        if (batchFilter && String(stu.batch).trim() !== batchFilter) continue;
        events.push({
            type: row.type,
            occurredAt: row.createdAt,
            student: stu,
            details: {}
        });
    }

    for (const a of attempts) {
        const st = userMap.get(String(a.studentId));
        if (!st) continue;
        const occurredAt = a.completedAt || a.startedAt || a.createdAt;
        if (!inRange(occurredAt, from, to)) continue;
        const ex = exMap.get(String(a.exerciseId));
        const stu = { _id: a.studentId, regNo: st.regNo, name: st.name, batch: st.batch || '' };
        if (batchFilter && String(stu.batch).trim() !== batchFilter) continue;
        events.push({
            type: 'EXERCISE_ATTEMPT',
            occurredAt,
            student: stu,
            details: {
                exerciseTitle: ex?.title || 'Exercise',
                status: a.status,
                timeSpentSeconds: a.timeSpentSeconds ?? 0
            }
        });
    }

    for (const meeting of meetings) {
        for (const entry of meeting.attendance || []) {
            const st = userMap.get(String(entry.studentId));
            if (!st) continue;
            const occurredAt = entry.joinTime || meeting.startTime;
            if (!inRange(occurredAt, from, to)) continue;
            const batch = meeting.batch || '';
            const stu = { _id: entry.studentId, regNo: st.regNo, name: st.name, batch: st.batch || batch };
            if (batchFilter && String(stu.batch).trim() !== batchFilter) continue;
            events.push({
                type: 'MEETING_ATTENDANCE',
                occurredAt,
                student: stu,
                details: {
                    topic: meeting.topic || 'Class Meeting',
                    batch,
                    attendanceStatus: entry.status || 'absent',
                    attendedMinutes:
                        entry.durationMinutes ??
                        (typeof entry.duration === 'number' ? Math.round(entry.duration / 60) : null)
                }
            });
        }
    }

    for (const row of profileRows) {
        const st = userMap.get(String(row.studentId));
        if (!st) continue;
        if (!inRange(row.updatedAt, from, to)) continue;
        const stu = { _id: row.studentId, regNo: st.regNo, name: st.name, batch: st.batch || row.batchAtUpdate || '' };
        if (batchFilter && String(stu.batch).trim() !== batchFilter) continue;
        events.push({
            type: 'PROFILE_UPDATE',
            occurredAt: row.updatedAt,
            student: stu,
            details: {
                level: row.levelAtUpdate,
                batch: row.batchAtUpdate
            }
        });
    }

    for (const p of progressRows) {
        const st = userMap.get(String(p.studentId));
        if (!st) continue;
        const occurredAt = p.updatedAt || p.lastAccessedAt || p.createdAt;
        if (!inRange(occurredAt, from, to)) continue;
        const mod = modMap.get(String(p.moduleId));
        const stu = { _id: p.studentId, regNo: st.regNo, name: st.name, batch: st.batch || '' };
        if (batchFilter && String(stu.batch).trim() !== batchFilter) continue;
        events.push({
            type: 'MODULE_PROGRESS',
            occurredAt,
            student: stu,
            details: {
                moduleTitle: mod?.title || 'Module',
                status: p.status || 'not-started',
                progressPercentage: p.progressPercentage ?? 0
            }
        });
    }

    for (const s of sessions) {
        const st = userMap.get(String(s.studentId));
        if (!st) continue;
        const occurredAt = s.startTime || s.createdAt;
        if (!inRange(occurredAt, from, to)) continue;
        const stu = { _id: s.studentId, regNo: st.regNo, name: st.name, batch: st.batch || '' };
        if (batchFilter && String(stu.batch).trim() !== batchFilter) continue;
        events.push({
            type: 'SESSION_RECORD',
            occurredAt,
            student: stu,
            details: {
                moduleTitle: s.moduleTitle,
                sessionType: s.sessionType,
                durationMinutes: s.durationMinutes ?? 0,
                totalScore: 0
            }
        });
    }

    for (const sub of subs) {
        const st = userMap.get(String(sub.studentId));
        if (!st) continue;
        const occurredAt = sub.submittedAt || sub.createdAt;
        if (!inRange(occurredAt, from, to)) continue;
        const mod = sub.moduleId ? modMap.get(String(sub.moduleId)) : null;
        const tmpl = sub.assignmentTemplateId ? tmplMap.get(String(sub.assignmentTemplateId)) : null;
        const stu = { _id: sub.studentId, regNo: st.regNo, name: st.name, batch: st.batch || '' };
        if (batchFilter && String(stu.batch).trim() !== batchFilter) continue;
        events.push({
            type: 'ASSIGNMENT_SUBMISSION',
            occurredAt,
            student: stu,
            details: {
                title: sub.title || tmpl?.title || 'Assignment',
                moduleTitle: mod?.title || null,
                status: sub.status,
                marks: sub.marks ?? null
            }
        });
    }

    return events;
}

function summaryRowFromDayEvents(dayKey, evs, tz) {
    const dayKeyFn = (ev) => resolveDayKeyInTimeZone(ev.occurredAt, tz);
    const ctx = {};
    const agg = computeAggregatedAnalytics(evs, ctx, dayKeyFn);
    const timelineEventCount = evs.filter((e) => !isAuthActivity(e)).length;
    return {
        dayKey,
        estPortalMinutes: agg.timeSummary.totalMinutes,
        mostUsedPage: agg.timeSummary.topPage,
        mostActiveStudent: agg.timeSummary.topStudent,
        avgPortalPerStudent: agg.timeSummary.avgMinutesPerStudent,
        eventCount: evs.length,
        timelineEventCount
    };
}

function rowToCacheUpdate(row, tz, batchKey) {
    return {
        ...row,
        timeZone: tz,
        batchKey,
        schemaVersion: CACHE_SCHEMA_VERSION,
        computedAt: new Date()
    };
}

async function upsertSummaryRows(rows, tz, batchKey) {
    if (!rows.length) return;
    const ops = rows.map((row) => ({
        updateOne: {
            filter: { dayKey: row.dayKey, timeZone: tz, batchKey },
            update: { $set: rowToCacheUpdate(row, tz, batchKey) },
            upsert: true
        }
    }));
    await ActivityDailySummary.bulkWrite(ops);
}

async function computeOneDayAndUpsert(dayKey, tz, batchFilter, batchKey) {
    const start = zonedDayStartUtc(dayKey, tz);
    const endExcl = zonedDayEndUtcExclusive(dayKey, tz);
    const evs = await loadMinimalActivityEvents(new Date(start), new Date(endExcl - 1), batchFilter);
    let row;
    if (!evs.length) {
        row = {
            dayKey,
            estPortalMinutes: 0,
            mostUsedPage: '—',
            mostActiveStudent: '—',
            avgPortalPerStudent: 0,
            eventCount: 0,
            timelineEventCount: 0
        };
    } else {
        row = summaryRowFromDayEvents(dayKey, evs, tz);
    }
    await ActivityDailySummary.findOneAndUpdate(
        { dayKey, timeZone: tz, batchKey },
        { $set: rowToCacheUpdate(row, tz, batchKey) },
        { upsert: true }
    );
    return row;
}

function minDayKey(a, b) {
    return a <= b ? a : b;
}

function maxDayKey(a, b) {
    return a >= b ? a : b;
}

async function getWarmBounds(tz, batchKey) {
    return ActivityDailySummaryBounds.findOne({
        timeZone: tz,
        batchKey,
        schemaVersion: CACHE_SCHEMA_VERSION
    }).lean();
}

async function expandWarmBounds(tz, batchKey, startKey, endKey) {
    const prev = await ActivityDailySummaryBounds.findOne({ timeZone: tz, batchKey }).lean();
    let minK = startKey;
    let maxK = endKey;
    if (prev && prev.schemaVersion === CACHE_SCHEMA_VERSION) {
        minK = minDayKey(prev.minDayKey, startKey);
        maxK = maxDayKey(prev.maxDayKey, endKey);
    }
    await ActivityDailySummaryBounds.findOneAndUpdate(
        { timeZone: tz, batchKey },
        {
            $set: {
                minDayKey: minK,
                maxDayKey: maxK,
                schemaVersion: CACHE_SCHEMA_VERSION,
                updatedAt: new Date()
            }
        },
        { upsert: true }
    );
}

/**
 * @param {{ from: Date, to: Date, batchFilter?: string, timeZone?: string, refresh?: boolean }} opts
 * @returns {Promise<Array<{ dayKey: string, estPortalMinutes: number, mostUsedPage: string, mostActiveStudent: string, avgPortalPerStudent: number, eventCount: number, timelineEventCount: number }>>}
 */
async function buildDailySummaries(opts) {
    const { from, to, batchFilter = '', timeZone, refresh = false } = opts;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new Error('from and to are required');
    }
    const spanDays = Math.max((to - from) / 86400000, 1 / 24);
    if (spanDays > MAX_SUMMARY_RANGE_DAYS) {
        throw new Error(`Date range too large (max ${MAX_SUMMARY_RANGE_DAYS} days)`);
    }

    const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : 'UTC';
    const batchKey = batchFilter.trim() || '__all__';
    const startKey = resolveDayKeyInTimeZone(from, tz);
    const endKey = resolveDayKeyInTimeZone(to, tz);
    const todayKey = resolveDayKeyInTimeZone(new Date(), tz);

    if (refresh) {
        await ActivityDailySummaryBounds.deleteOne({ timeZone: tz, batchKey });
    }

    const warm = await getWarmBounds(tz, batchKey);
    const boundsCoverRequest = warm && startKey >= warm.minDayKey && endKey <= warm.maxDayKey;

    if (!refresh && boundsCoverRequest) {
        let cachedRows = await ActivityDailySummary.find({
            dayKey: { $gte: startKey, $lte: endKey },
            timeZone: tz,
            batchKey,
            schemaVersion: CACHE_SCHEMA_VERSION
        })
            .sort({ dayKey: -1 })
            .lean();

        if (cachedRows.length > 0) {
            if (todayKey >= startKey && todayKey <= endKey) {
                const liveToday = await computeOneDayAndUpsert(todayKey, tz, batchFilter.trim() || '', batchKey);
                cachedRows = cachedRows.filter((d) => d.dayKey !== todayKey);
                cachedRows.push(liveToday);
                cachedRows.sort((a, b) => String(b.dayKey).localeCompare(String(a.dayKey)));
            }

            return cachedRows.map((d) => ({
                dayKey: d.dayKey,
                estPortalMinutes: d.estPortalMinutes,
                mostUsedPage: d.mostUsedPage,
                mostActiveStudent: d.mostActiveStudent,
                avgPortalPerStudent: d.avgPortalPerStudent,
                eventCount: d.eventCount,
                timelineEventCount: d.timelineEventCount
            }));
        }
    }

    const events = await loadMinimalActivityEvents(from, to, batchFilter.trim() || '');
    const dayKeyFn = (ev) => resolveDayKeyInTimeZone(ev.occurredAt, tz);

    const byDay = new Map();
    for (const ev of events) {
        const k = dayKeyFn(ev);
        if (k === 'unknown') continue;
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(ev);
    }

    const sortedKeys = Array.from(byDay.keys()).sort((a, b) => b.localeCompare(a));
    const rows = [];
    for (const dayKey of sortedKeys) {
        const evs = byDay.get(dayKey);
        if (!evs || evs.length === 0) continue;
        rows.push(summaryRowFromDayEvents(dayKey, evs, tz));
    }

    await upsertSummaryRows(rows, tz, batchKey);
    await expandWarmBounds(tz, batchKey, startKey, endKey);
    return rows;
}

module.exports = {
    buildDailySummaries,
    MAX_SUMMARY_RANGE_DAYS,
    CACHE_SCHEMA_VERSION
};
