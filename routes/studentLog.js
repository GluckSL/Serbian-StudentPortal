//  routes/studentLog.js

const express = require('express');
const router = express.Router();
const StudentLogs = require('../models/StudentLogs');
const User = require('../models/User');
const MeetingLink = require('../models/MeetingLink');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const StudentProgress = require('../models/StudentProgress');
const SessionRecord = require('../models/SessionRecord');
const AssignmentSubmission = require('../models/AssignmentSubmission');
const UserActivityLog = require('../models/UserActivityLog');
const mongoose = require('mongoose');
const { verifyToken, isAdmin, requireFullAdmin } = require('../middleware/auth');
const { buildDailySummaries, MAX_SUMMARY_RANGE_DAYS } = require('../services/studentLogDailySummaries.service');
const {
    meetingLinkQueryForActivityWindow,
    exerciseAttemptQueryForActivityWindow,
    sessionRecordQueryForActivityWindow,
    studentProgressQueryForActivityWindow,
    assignmentSubmissionQueryForActivityWindow
} = require('../services/studentActivityWindowQueries');
const { mergePortalBatchNames } = require('../utils/portalBatchPresets');

function canExposeActivityDeleteRefs(req) {
    const r = req.user?.role;
    return r === 'ADMIN' || r === 'TEACHER_ADMIN';
}

function stripActivityDeleteRefs(events) {
    return events.map((ev) => {
        if (!ev || typeof ev !== 'object') return ev;
        const { deleteRef, ...rest } = ev;
        return rest;
    });
}

/** Length of [from, to] in days (partial days allowed). */
function activityRangeSpanDays(from, to) {
    if (!from || !to) return 0;
    const t0 = from instanceof Date ? from.getTime() : new Date(from).getTime();
    const t1 = to instanceof Date ? to.getTime() : new Date(to).getTime();
    if (Number.isNaN(t0) || Number.isNaN(t1)) return 0;
    return Math.max((t1 - t0) / 86400000, 1 / 24);
}

/**
 * Max rows returned after merging streams (feed or single-student timeline).
 * Longer windows need a higher merge cap — otherwise only the newest N events survive and portal-time totals are wrong.
 */
function mergedActivityEventCap(requestedLimit, from, to) {
    const req = Math.max(50, Math.min(parseInt(String(requestedLimit), 10) || 800, 25000));
    const span = activityRangeSpanDays(from, to);
    if (span <= 0) return Math.min(req, 1200);
    return Math.min(20000, Math.max(1200, Math.ceil(req * Math.min(span, 90))));
}

/**
 * Per Mongo query .limit() when loading one activity type. Scales with the selected date range.
 */
function perSourceActivityCap(requestedLimit, from, to) {
    const req = Math.max(50, Math.min(parseInt(String(requestedLimit), 10) || 800, 25000));
    const span = activityRangeSpanDays(from, to);
    if (span <= 0) return Math.min(120, Math.ceil(req / 3));
    return Math.min(25000, Math.max(800, Math.ceil(req * Math.min(span, 90))));
}

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function deleteActivityItem(kind, id, meetingId) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error('Invalid id');
    }
    switch (kind) {
        case 'USER_ACTIVITY_LOG': {
            const r = await UserActivityLog.findByIdAndDelete(id);
            if (!r) throw new Error('Activity log not found');
            return;
        }
        case 'STUDENT_LOG': {
            const r = await StudentLogs.findByIdAndDelete(id);
            if (!r) throw new Error('Student log not found');
            return;
        }
        case 'EXERCISE_ATTEMPT': {
            const r = await ExerciseAttempt.findByIdAndDelete(id);
            if (!r) throw new Error('Exercise attempt not found');
            return;
        }
        case 'STUDENT_PROGRESS': {
            const r = await StudentProgress.findByIdAndDelete(id);
            if (!r) throw new Error('Module progress not found');
            return;
        }
        case 'SESSION_RECORD': {
            const r = await SessionRecord.findByIdAndDelete(id);
            if (!r) throw new Error('Session record not found');
            return;
        }
        case 'ASSIGNMENT_SUBMISSION': {
            const r = await AssignmentSubmission.findByIdAndUpdate(id, { $set: { isDeleted: true } }, { new: true });
            if (!r) throw new Error('Assignment submission not found');
            return;
        }
        case 'MEETING_ATTENDANCE': {
            if (!meetingId || !mongoose.Types.ObjectId.isValid(meetingId)) {
                throw new Error('Meeting ID required for attendance removal');
            }
            const attId = id;
            if (!mongoose.Types.ObjectId.isValid(attId)) {
                throw new Error('Invalid attendance entry id');
            }
            const result = await MeetingLink.updateOne(
                { _id: meetingId },
                { $pull: { attendance: { _id: attId } } }
            );
            if (result.matchedCount === 0) throw new Error('Meeting not found');
            return;
        }
        default:
            throw new Error('Unknown activity kind');
    }
}

// get all student logs
router.get('/', async (req, res) => {
    try {
        const logs = await StudentLogs.find()
        .populate('studentId', 'name email regNo')
        .populate('assignedTeacherAtUpdate', 'name regNo')
        .sort({ updatedAt: -1 }); // latest first

        res.status(200).json({ success: true, count: logs.length, data: logs });
    } catch (err) {
        console.error('Error fetching student logs:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch student logs', error: err.message });
    }   
});

// get deep analytics for a specific student
router.get('/analytics/:studentId', verifyToken, isAdmin, async (req, res) => {
    try {
        const { studentId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(studentId)) {
            return res.status(400).json({ success: false, message: 'Invalid student ID' });
        }

        const student = await User.findOne({ _id: studentId, role: 'STUDENT' })
            .select('name email regNo level batch subscription medium studentStatus currentCourseDay assignedTeacher')
            .populate('assignedTeacher', 'name regNo email')
            .lean();

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const logs = await StudentLogs.find({ studentId })
            .populate('assignedTeacherAtUpdate', 'name regNo')
            .sort({ updatedAt: -1 })
            .lean();

        const meetings = await MeetingLink.find({ 'attendance.studentId': studentId })
            .select('topic batch startTime duration attendance status')
            .sort({ startTime: -1 })
            .lean();

        const attendanceHistory = meetings.map((meeting) => {
            const entry = Array.isArray(meeting.attendance)
                ? meeting.attendance.find((att) => String(att.studentId) === String(studentId))
                : null;

            return {
                meetingId: meeting._id,
                topic: meeting.topic || 'Class Meeting',
                batch: meeting.batch || '',
                startTime: meeting.startTime,
                meetingDurationMinutes: meeting.duration || null,
                attended: Boolean(entry?.attended),
                attendanceStatus: entry?.status || 'absent',
                joinTime: entry?.joinTime || null,
                leaveTime: entry?.leaveTime || null,
                attendedMinutes: entry?.durationMinutes ?? (typeof entry?.duration === 'number' ? Math.round(entry.duration / 60) : null),
                attendanceRecorded: Boolean(entry)
            };
        });

        const exerciseAttempts = await ExerciseAttempt.find({ studentId })
            .populate('exerciseId', 'title level category estimatedDuration')
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();

        const digitalExerciseHistory = exerciseAttempts.map((attempt) => ({
            attemptId: attempt._id,
            exerciseId: attempt.exerciseId?._id || null,
            exerciseTitle: attempt.exerciseId?.title || 'Deleted Exercise',
            level: attempt.exerciseId?.level || null,
            category: attempt.exerciseId?.category || null,
            estimatedDuration: attempt.exerciseId?.estimatedDuration || null,
            status: attempt.status,
            attemptNumber: attempt.attemptNumber,
            startedAt: attempt.startedAt || attempt.createdAt,
            completedAt: attempt.completedAt || null,
            timeSpentSeconds: attempt.timeSpentSeconds ?? 0,
            earnedPoints: attempt.earnedPoints ?? 0,
            totalPoints: attempt.totalPoints ?? 0,
            scorePercentage: attempt.scorePercentage ?? 0
        }));

        const moduleProgress = await StudentProgress.find({ studentId })
            .populate('moduleId', 'title level category estimatedDuration')
            .sort({ updatedAt: -1 })
            .limit(200)
            .lean();

        const moduleHistory = moduleProgress.map((item) => ({
            progressId: item._id,
            moduleId: item.moduleId?._id || null,
            moduleTitle: item.moduleId?.title || 'Deleted Module',
            level: item.moduleId?.level || null,
            category: item.moduleId?.category || null,
            status: item.status || 'not-started',
            progressPercentage: item.progressPercentage ?? 0,
            totalScore: item.totalScore ?? 0,
            maxPossibleScore: item.maxPossibleScore ?? 0,
            sessionsCount: item.sessionsCount ?? 0,
            timeSpentMinutes: item.timeSpent ?? 0,
            startedAt: item.startedAt || null,
            completedAt: item.completedAt || null,
            updatedAt: item.updatedAt || item.lastAccessedAt || item.createdAt
        }));

        const sessions = await SessionRecord.find({ studentId })
            .select('sessionId moduleTitle moduleLevel sessionType sessionState startTime endTime durationMinutes summary createdAt')
            .sort({ createdAt: -1 })
            .limit(300)
            .lean();

        const sessionHistory = sessions.map((session) => ({
            sessionId: session.sessionId,
            moduleTitle: session.moduleTitle,
            moduleLevel: session.moduleLevel,
            sessionType: session.sessionType,
            sessionState: session.sessionState,
            startTime: session.startTime,
            endTime: session.endTime || null,
            durationMinutes: session.durationMinutes ?? 0,
            totalScore: session.summary?.totalScore ?? 0,
            accuracy: session.summary?.accuracy ?? 0,
            exerciseScore: session.summary?.exerciseScore ?? 0,
            conversationScore: session.summary?.conversationScore ?? 0
        }));

        const submissions = await AssignmentSubmission.find({
            studentId,
            isDeleted: { $ne: true }
        })
            .populate('moduleId', 'title level')
            .populate('assignmentTemplateId', 'title')
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();

        const markHistory = submissions.map((submission) => ({
            submissionId: submission._id,
            title: submission.title || submission.assignmentTemplateId?.title || 'Assignment',
            moduleTitle: submission.moduleId?.title || null,
            moduleLevel: submission.moduleId?.level || null,
            status: submission.status,
            submittedAt: submission.submittedAt || submission.createdAt,
            correctedAt: submission.correctedAt || null,
            marks: submission.marks,
            aiGradingTotalScore: submission.aiGradingTotalScore ?? null,
            teacherOverrideScore: submission.teacherOverrideScore ?? null,
            feedback: submission.feedback || '',
            teacherComments: submission.teacherComments || ''
        }));

        const attendedClasses = attendanceHistory.filter((row) => row.attended).length;
        const totalClasses = attendanceHistory.length;

        res.status(200).json({
            success: true,
            data: {
                student,
                summary: {
                    totalProfileUpdates: logs.length,
                    totalClasses,
                    attendedClasses,
                    attendanceRate: totalClasses ? Math.round((attendedClasses / totalClasses) * 100) : 0,
                    totalDigitalExerciseAttempts: digitalExerciseHistory.length,
                    completedDigitalExercises: digitalExerciseHistory.filter((row) => row.status === 'completed').length,
                    totalModulesTracked: moduleHistory.length,
                    completedModules: moduleHistory.filter((row) => row.status === 'completed').length,
                    totalSessions: sessionHistory.length,
                    totalAssignments: markHistory.length
                },
                lastProfileUpdate: logs[0] || null,
                profileUpdateHistory: logs,
                classAttendanceHistory: attendanceHistory,
                digitalExerciseHistory,
                moduleHistory,
                sessionHistory,
                marksHistory: markHistory
            }
        });
    } catch (err) {
        console.error('Error fetching student analytics:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch student analytics', error: err.message });
    }
});

// unified activity timeline for a specific student (filterable)
// GET /api/studentLog/activity/:studentId?types=LOGIN,MEETING_ATTENDANCE,EXERCISE_ATTEMPT,MODULE_PROGRESS,SESSION_RECORD,ASSIGNMENT_SUBMISSION,PROFILE_UPDATE&from=2026-01-01&to=2026-12-31&limit=200
router.get('/activity/:studentId', verifyToken, isAdmin, async (req, res) => {
    try {
        const { studentId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(studentId)) {
            return res.status(400).json({ success: false, message: 'Invalid student ID' });
        }

        const stu = await User.findOne({ _id: studentId, role: 'STUDENT' }).select('name regNo batch').lean();
        if (!stu) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const batchFilter = (req.query.batch || '').toString().trim();

        const from = req.query.from ? new Date(req.query.from) : null;
        const to = req.query.to ? new Date(req.query.to) : null;
        const requestedLimit = parseInt(req.query.limit, 10) || 200;
        const mergeCap = mergedActivityEventCap(requestedLimit, from, to);
        const perSourceLimit = perSourceActivityCap(requestedLimit, from, to);
        const typesParam = (req.query.types || '').toString().trim();
        const requestedTypes = new Set(
            typesParam
                ? typesParam.split(',').map((t) => t.trim()).filter(Boolean)
                : []
        );

        const wants = (t) => requestedTypes.size === 0 || requestedTypes.has(t);
        const inRange = (d) => {
            if (!d) return false;
            const dt = new Date(d);
            if (from && dt < from) return false;
            if (to && dt > to) return false;
            return true;
        };

        const events = [];

        // LOGIN/LOGOUT
        if (wants('LOGIN') || wants('LOGOUT')) {
            const logQuery = { userId: studentId };
            if (requestedTypes.size) {
                const allowed = [];
                if (wants('LOGIN')) allowed.push('LOGIN');
                if (wants('LOGOUT')) allowed.push('LOGOUT');
                if (allowed.length) logQuery.type = { $in: allowed };
            }
            if (from || to) {
                logQuery.createdAt = {};
                if (from) logQuery.createdAt.$gte = from;
                if (to) logQuery.createdAt.$lte = to;
            }

            const authLogs = await UserActivityLog.find(logQuery).sort({ createdAt: -1 }).limit(perSourceLimit).lean();
            for (const row of authLogs) {
                events.push({
                    type: row.type,
                    occurredAt: row.createdAt,
                    title: row.type === 'LOGIN' ? 'Logged in' : 'Logged out',
                    details: {
                        ip: row.ip || '',
                        userAgent: row.userAgent || ''
                    },
                    deleteRef: { kind: 'USER_ACTIVITY_LOG', id: String(row._id) }
                });
            }
        }

        // PROFILE_UPDATE (StudentLogs)
        if (wants('PROFILE_UPDATE')) {
            const q = { studentId };
            if (from || to) {
                q.updatedAt = {};
                if (from) q.updatedAt.$gte = from;
                if (to) q.updatedAt.$lte = to;
            }
            const updates = await StudentLogs.find(q)
                .populate('assignedTeacherAtUpdate', 'name regNo')
                .sort({ updatedAt: -1 })
                .limit(perSourceLimit)
                .lean();
            for (const row of updates) {
                events.push({
                    type: 'PROFILE_UPDATE',
                    occurredAt: row.updatedAt,
                    title: row.action === 'UPDATE' ? 'Profile updated' : `Profile action: ${row.action}`,
                    details: {
                        level: row.levelAtUpdate,
                        batch: row.batchAtUpdate,
                        subscription: row.subscriptionAtUpdate,
                        teacher: row.assignedTeacherAtUpdate?.name || ''
                    },
                    deleteRef: { kind: 'STUDENT_LOG', id: String(row._id) }
                });
            }
        }

        // MEETING_ATTENDANCE (join/leave) from MeetingLink.attendance
        if (wants('MEETING_ATTENDANCE')) {
            const meetings = await MeetingLink.find({ 'attendance.studentId': studentId })
                .select('topic batch startTime duration attendance status')
                .sort({ startTime: -1 })
                .limit(Math.min(perSourceLimit, 5000))
                .lean();

            for (const meeting of meetings) {
                const entry = Array.isArray(meeting.attendance)
                    ? meeting.attendance.find((att) => String(att.studentId) === String(studentId))
                    : null;
                if (!entry) continue;
                const occurredAt = entry.joinTime || meeting.startTime || null;
                if (!inRange(occurredAt)) continue;

                const attId = entry._id ? String(entry._id) : null;
                const ev = {
                    type: 'MEETING_ATTENDANCE',
                    occurredAt,
                    title: entry.attended ? 'Joined meeting' : 'Meeting (absent)',
                    details: {
                        topic: meeting.topic || 'Class Meeting',
                        batch: meeting.batch || '',
                        attendanceStatus: entry.status || 'absent',
                        joinTime: entry.joinTime || null,
                        leaveTime: entry.leaveTime || null,
                        attendedMinutes: entry.durationMinutes ?? (typeof entry.duration === 'number' ? Math.round(entry.duration / 60) : null)
                    }
                };
                if (attId && meeting._id) {
                    ev.deleteRef = { kind: 'MEETING_ATTENDANCE', id: attId, meetingId: String(meeting._id) };
                }
                events.push(ev);
            }
        }

        // EXERCISE_ATTEMPT
        if (wants('EXERCISE_ATTEMPT')) {
            const attemptQuery = { studentId };
            if (from || to) {
                attemptQuery.createdAt = {};
                if (from) attemptQuery.createdAt.$gte = from;
                if (to) attemptQuery.createdAt.$lte = to;
            }
            const attempts = await ExerciseAttempt.find(attemptQuery)
                .populate('exerciseId', 'title level category')
                .sort({ createdAt: -1 })
                .limit(perSourceLimit)
                .lean();
            for (const a of attempts) {
                const occurredAt = a.completedAt || a.startedAt || a.createdAt;
                events.push({
                    type: 'EXERCISE_ATTEMPT',
                    occurredAt,
                    title: a.status === 'completed' ? 'Completed digital exercise' : 'Digital exercise attempt',
                    details: {
                        exerciseTitle: a.exerciseId?.title || 'Deleted Exercise',
                        status: a.status,
                        scorePercentage: a.scorePercentage ?? 0,
                        timeSpentSeconds: a.timeSpentSeconds ?? 0
                    },
                    deleteRef: { kind: 'EXERCISE_ATTEMPT', id: String(a._id) }
                });
            }
        }

        // MODULE_PROGRESS
        if (wants('MODULE_PROGRESS')) {
            const progQuery = { studentId };
            if (from || to) {
                progQuery.updatedAt = {};
                if (from) progQuery.updatedAt.$gte = from;
                if (to) progQuery.updatedAt.$lte = to;
            }
            const progress = await StudentProgress.find(progQuery)
                .populate('moduleId', 'title level category')
                .sort({ updatedAt: -1 })
                .limit(perSourceLimit)
                .lean();
            for (const p of progress) {
                events.push({
                    type: 'MODULE_PROGRESS',
                    occurredAt: p.updatedAt || p.lastAccessedAt || p.createdAt,
                    title: p.status === 'completed' ? 'Completed module' : 'Module progress updated',
                    details: {
                        moduleTitle: p.moduleId?.title || 'Deleted Module',
                        status: p.status || 'not-started',
                        progressPercentage: p.progressPercentage ?? 0
                    },
                    deleteRef: { kind: 'STUDENT_PROGRESS', id: String(p._id) }
                });
            }
        }

        // SESSION_RECORD
        if (wants('SESSION_RECORD')) {
            const sessQuery = { studentId };
            if (from || to) {
                sessQuery.createdAt = {};
                if (from) sessQuery.createdAt.$gte = from;
                if (to) sessQuery.createdAt.$lte = to;
            }
            const sessions = await SessionRecord.find(sessQuery)
                .select('_id sessionId moduleTitle moduleLevel sessionType sessionState startTime endTime durationMinutes summary createdAt')
                .sort({ createdAt: -1 })
                .limit(perSourceLimit)
                .lean();
            for (const s of sessions) {
                events.push({
                    type: 'SESSION_RECORD',
                    occurredAt: s.startTime || s.createdAt,
                    title: 'AI session',
                    details: {
                        moduleTitle: s.moduleTitle,
                        sessionType: s.sessionType,
                        durationMinutes: s.durationMinutes ?? 0,
                        totalScore: s.summary?.totalScore ?? 0
                    },
                    deleteRef: { kind: 'SESSION_RECORD', id: String(s._id) }
                });
            }
        }

        // ASSIGNMENT_SUBMISSION
        if (wants('ASSIGNMENT_SUBMISSION')) {
            const subQuery = { studentId, isDeleted: { $ne: true } };
            if (from || to) {
                subQuery.createdAt = {};
                if (from) subQuery.createdAt.$gte = from;
                if (to) subQuery.createdAt.$lte = to;
            }
            const subs = await AssignmentSubmission.find(subQuery)
                .populate('moduleId', 'title level')
                .populate('assignmentTemplateId', 'title')
                .sort({ createdAt: -1 })
                .limit(perSourceLimit)
                .lean();
            for (const sub of subs) {
                events.push({
                    type: 'ASSIGNMENT_SUBMISSION',
                    occurredAt: sub.submittedAt || sub.createdAt,
                    title: 'Assignment submitted',
                    details: {
                        title: sub.title || sub.assignmentTemplateId?.title || 'Assignment',
                        moduleTitle: sub.moduleId?.title || null,
                        status: sub.status,
                        marks: sub.marks ?? null
                    },
                    deleteRef: { kind: 'ASSIGNMENT_SUBMISSION', id: String(sub._id) }
                });
            }
        }

        for (const e of events) {
            e.student = { _id: stu._id, regNo: stu.regNo, name: stu.name, batch: stu.batch || '' };
        }

        let out = events;
        if (batchFilter) {
            out = events.filter((e) => {
                const b = e.student?.batch || e.details?.batch || '';
                return String(b).trim() === batchFilter;
            });
        }

        // sort and trim
        out.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

        const payload = out.slice(0, mergeCap);
        res.status(200).json({
            success: true,
            data: canExposeActivityDeleteRefs(req) ? payload : stripActivityDeleteRefs(payload)
        });
    } catch (err) {
        console.error('Error fetching student activity timeline:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch student activity timeline', error: err.message });
    }
});

// Lightweight student list for Student Logs filters (admin)
router.get('/student-options', verifyToken, isAdmin, async (req, res) => {
    try {
        const students = await User.find({ role: 'STUDENT' })
            .select('name regNo')
            .sort({ regNo: 1 })
            .lean();
        res.status(200).json({ success: true, data: students });
    } catch (err) {
        console.error('Error fetching student options:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch students', error: err.message });
    }
});

router.get('/batch-options', verifyToken, isAdmin, async (req, res) => {
    try {
        const raw = await User.distinct('batch', { role: 'STUDENT' });
        const batches = mergePortalBatchNames(
          raw.map((b) => (b == null ? '' : String(b).trim())).filter(Boolean)
        );
        res.status(200).json({ success: true, data: batches });
    } catch (err) {
        console.error('Error fetching batch options:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch batches', error: err.message });
    }
});

router.get('/student-search', verifyToken, isAdmin, async (req, res) => {
    try {
        const q = (req.query.q || '').toString().trim();
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
        if (q.length < 1) {
            return res.status(200).json({ success: true, data: [] });
        }
        const rx = new RegExp(escapeRegex(q), 'i');
        const students = await User.find({
            role: 'STUDENT',
            $or: [{ name: rx }, { regNo: rx }, { email: rx }]
        })
            .select('name regNo batch email')
            .sort({ regNo: 1 })
            .limit(limit)
            .lean();
        res.status(200).json({ success: true, data: students });
    } catch (err) {
        console.error('Error searching students:', err);
        res.status(500).json({ success: false, message: 'Failed to search students', error: err.message });
    }
});

router.post('/bulk-delete-activity', verifyToken, requireFullAdmin, async (req, res) => {
    try {
        const items = req.body?.items;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array required' });
        }
        if (items.length > 100) {
            return res.status(400).json({ success: false, message: 'Maximum 100 items per request' });
        }
        const results = [];
        for (const raw of items) {
            const kind = raw?.kind;
            const id = raw?.id;
            const meetingId = raw?.meetingId;
            try {
                await deleteActivityItem(kind, id, meetingId);
                results.push({ kind, id, ok: true });
            } catch (e) {
                results.push({ kind, id, ok: false, error: e.message || String(e) });
            }
        }
        const failed = results.filter((r) => !r.ok);
        res.status(200).json({
            success: failed.length === 0,
            message: failed.length ? `Some deletes failed (${failed.length})` : 'Deleted successfully',
            results
        });
    } catch (err) {
        console.error('Error bulk-deleting activity:', err);
        res.status(500).json({ success: false, message: 'Bulk delete failed', error: err.message });
    }
});

// Compact per-day aggregates for "All logs" (no raw events — fast, small payload)
router.get('/activity-daily-summaries', verifyToken, isAdmin, async (req, res) => {
    try {
        const from = req.query.from ? new Date(req.query.from) : null;
        const to = req.query.to ? new Date(req.query.to) : null;
        if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
            return res.status(400).json({ success: false, message: 'Valid from and to query parameters are required' });
        }
        const batchFilter = (req.query.batch || '').toString().trim();
        const tz = (req.query.tz || '').toString().trim();
        const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());
        const data = await buildDailySummaries({ from, to, batchFilter, timeZone: tz || undefined, refresh });
        res.status(200).json({ success: true, data, meta: { maxRangeDays: MAX_SUMMARY_RANGE_DAYS } });
    } catch (err) {
        console.error('Error building activity daily summaries:', err);
        const msg = err.message || 'Failed to build daily summaries';
        const status = msg.includes('too large') || msg.includes('required') ? 400 : 500;
        res.status(status).json({ success: false, message: msg });
    }
});

// Recent activity across all students (for "All students" on Student Logs page)
router.get('/activity-feed', verifyToken, isAdmin, async (req, res) => {
    try {
        const batchFilter = (req.query.batch || '').toString().trim();
        const from = req.query.from ? new Date(req.query.from) : null;
        const to = req.query.to ? new Date(req.query.to) : null;
        const requestedLimit = parseInt(req.query.limit, 10) || 800;
        const limit = mergedActivityEventCap(requestedLimit, from, to);
        const cap = perSourceActivityCap(requestedLimit, from, to);
        const typesParam = (req.query.types || '').toString().trim();
        const requestedTypes = new Set(
            typesParam ? typesParam.split(',').map((t) => t.trim()).filter(Boolean) : []
        );
        const wants = (t) => requestedTypes.size === 0 || requestedTypes.has(t);
        const inRange = (d) => {
            if (!d) return false;
            const dt = new Date(d);
            if (from && dt < from) return false;
            if (to && dt > to) return false;
            return true;
        };

        const events = [];

        if (wants('LOGIN') || wants('LOGOUT')) {
            const logQuery = {};
            if (requestedTypes.size) {
                const allowed = [];
                if (wants('LOGIN')) allowed.push('LOGIN');
                if (wants('LOGOUT')) allowed.push('LOGOUT');
                if (allowed.length) logQuery.type = { $in: allowed };
            }
            if (from || to) {
                logQuery.createdAt = {};
                if (from) logQuery.createdAt.$gte = from;
                if (to) logQuery.createdAt.$lte = to;
            }
            const authLogs = await UserActivityLog.find(logQuery)
                .populate({ path: 'userId', select: 'name regNo role batch' })
                .sort({ createdAt: -1 })
                .limit(cap)
                .lean();
            for (const row of authLogs) {
                const u = row.userId;
                if (!u || u.role !== 'STUDENT') continue;
                if (!inRange(row.createdAt)) continue;
                events.push({
                    type: row.type,
                    occurredAt: row.createdAt,
                    title: row.type === 'LOGIN' ? 'Logged in' : 'Logged out',
                    student: { _id: u._id, regNo: u.regNo, name: u.name, batch: u.batch || '' },
                    details: { ip: row.ip || '', userAgent: row.userAgent || '' },
                    deleteRef: { kind: 'USER_ACTIVITY_LOG', id: String(row._id) }
                });
            }
        }

        if (wants('EXERCISE_ATTEMPT')) {
            const attemptQuery = exerciseAttemptQueryForActivityWindow(from, to);
            const attempts = await ExerciseAttempt.find(attemptQuery)
                .populate('studentId', 'name regNo role batch')
                .populate('exerciseId', 'title')
                .sort({ createdAt: -1 })
                .limit(cap)
                .lean();
            for (const a of attempts) {
                const st = a.studentId;
                if (!st || st.role !== 'STUDENT') continue;
                const occurredAt = a.completedAt || a.startedAt || a.createdAt;
                if (!inRange(occurredAt)) continue;
                events.push({
                    type: 'EXERCISE_ATTEMPT',
                    occurredAt,
                    title: a.status === 'completed' ? 'Completed digital exercise' : 'Digital exercise attempt',
                    student: { _id: st._id, regNo: st.regNo, name: st.name, batch: st.batch || '' },
                    details: {
                        exerciseTitle: a.exerciseId?.title || 'Exercise',
                        status: a.status,
                        scorePercentage: a.scorePercentage ?? 0,
                        timeSpentSeconds: a.timeSpentSeconds ?? 0
                    },
                    deleteRef: { kind: 'EXERCISE_ATTEMPT', id: String(a._id) }
                });
            }
        }

        if (wants('MEETING_ATTENDANCE')) {
            const meetingQuery = meetingLinkQueryForActivityWindow(from, to);
            const meetings = await MeetingLink.find(meetingQuery)
                .select('topic batch startTime attendance')
                .sort({ startTime: -1 })
                .limit(Math.min(cap, 5000))
                .populate('attendance.studentId', 'name regNo role batch')
                .lean();

            for (const meeting of meetings) {
                const list = Array.isArray(meeting.attendance) ? meeting.attendance : [];
                for (const entry of list) {
                    const st = entry.studentId;
                    if (!st || st.role !== 'STUDENT') continue;
                    const occurredAt = entry.joinTime || meeting.startTime;
                    if (!inRange(occurredAt)) continue;
                    const attId = entry._id ? String(entry._id) : null;
                    const ev = {
                        type: 'MEETING_ATTENDANCE',
                        occurredAt,
                        title: entry.attended ? 'Joined meeting' : 'Meeting (absent)',
                        student: {
                            _id: st._id,
                            regNo: st.regNo,
                            name: st.name,
                            batch: st.batch || meeting.batch || ''
                        },
                        details: {
                            topic: meeting.topic || 'Class Meeting',
                            batch: meeting.batch || '',
                            attendanceStatus: entry.status || 'absent',
                            joinTime: entry.joinTime || null,
                            attendedMinutes:
                                entry.durationMinutes ??
                                (typeof entry.duration === 'number' ? Math.round(entry.duration / 60) : null)
                        }
                    };
                    if (attId && meeting._id) {
                        ev.deleteRef = { kind: 'MEETING_ATTENDANCE', id: attId, meetingId: String(meeting._id) };
                    }
                    events.push(ev);
                }
            }
        }

        if (wants('PROFILE_UPDATE')) {
            const q = {};
            if (from || to) {
                q.updatedAt = {};
                if (from) q.updatedAt.$gte = from;
                if (to) q.updatedAt.$lte = to;
            }
            const updates = await StudentLogs.find(q)
                .populate('studentId', 'name regNo batch')
                .populate('assignedTeacherAtUpdate', 'name regNo')
                .sort({ updatedAt: -1 })
                .limit(cap)
                .lean();
            for (const row of updates) {
                const st = row.studentId;
                if (!st) continue;
                if (!inRange(row.updatedAt)) continue;
                events.push({
                    type: 'PROFILE_UPDATE',
                    occurredAt: row.updatedAt,
                    title: row.action === 'UPDATE' ? 'Profile updated' : `Profile: ${row.action}`,
                    student: { _id: st._id, regNo: st.regNo, name: st.name, batch: st.batch || row.batchAtUpdate || '' },
                    details: {
                        level: row.levelAtUpdate,
                        batch: row.batchAtUpdate,
                        teacher: row.assignedTeacherAtUpdate?.name || ''
                    },
                    deleteRef: { kind: 'STUDENT_LOG', id: String(row._id) }
                });
            }
        }

        if (wants('MODULE_PROGRESS')) {
            const progQuery = studentProgressQueryForActivityWindow(from, to);
            const progress = await StudentProgress.find(progQuery)
                .populate('studentId', 'name regNo role batch')
                .populate('moduleId', 'title')
                .sort({ updatedAt: -1 })
                .limit(cap)
                .lean();
            for (const p of progress) {
                const st = p.studentId;
                if (!st || st.role !== 'STUDENT') continue;
                const occurredAt = p.updatedAt || p.lastAccessedAt || p.createdAt;
                if (!inRange(occurredAt)) continue;
                events.push({
                    type: 'MODULE_PROGRESS',
                    occurredAt,
                    title: p.status === 'completed' ? 'Completed module' : 'Module progress updated',
                    student: { _id: st._id, regNo: st.regNo, name: st.name, batch: st.batch || '' },
                    details: {
                        moduleTitle: p.moduleId?.title || 'Module',
                        status: p.status || 'not-started',
                        progressPercentage: p.progressPercentage ?? 0
                    },
                    deleteRef: { kind: 'STUDENT_PROGRESS', id: String(p._id) }
                });
            }
        }

        if (wants('SESSION_RECORD')) {
            const sessQuery = sessionRecordQueryForActivityWindow(from, to);
            const sessions = await SessionRecord.find(sessQuery)
                .populate('studentId', 'name regNo role batch')
                .select('_id studentId moduleTitle sessionType startTime durationMinutes summary createdAt')
                .sort({ createdAt: -1 })
                .limit(cap)
                .lean();
            for (const s of sessions) {
                const st = s.studentId;
                if (!st || st.role !== 'STUDENT') continue;
                const occurredAt = s.startTime || s.createdAt;
                if (!inRange(occurredAt)) continue;
                events.push({
                    type: 'SESSION_RECORD',
                    occurredAt,
                    title: 'AI session',
                    student: { _id: st._id, regNo: st.regNo, name: st.name, batch: st.batch || '' },
                    details: {
                        moduleTitle: s.moduleTitle,
                        sessionType: s.sessionType,
                        durationMinutes: s.durationMinutes ?? 0,
                        totalScore: s.summary?.totalScore ?? 0
                    },
                    deleteRef: { kind: 'SESSION_RECORD', id: String(s._id) }
                });
            }
        }

        if (wants('ASSIGNMENT_SUBMISSION')) {
            const subQuery = assignmentSubmissionQueryForActivityWindow(from, to);
            const subs = await AssignmentSubmission.find(subQuery)
                .populate('studentId', 'name regNo role batch')
                .populate('moduleId', 'title')
                .populate('assignmentTemplateId', 'title')
                .sort({ createdAt: -1 })
                .limit(cap)
                .lean();
            for (const sub of subs) {
                const st = sub.studentId;
                if (!st || st.role !== 'STUDENT') continue;
                const occurredAt = sub.submittedAt || sub.createdAt;
                if (!inRange(occurredAt)) continue;
                events.push({
                    type: 'ASSIGNMENT_SUBMISSION',
                    occurredAt,
                    title: 'Assignment submitted',
                    student: { _id: st._id, regNo: st.regNo, name: st.name, batch: st.batch || '' },
                    details: {
                        title: sub.title || sub.assignmentTemplateId?.title || 'Assignment',
                        moduleTitle: sub.moduleId?.title || null,
                        status: sub.status,
                        marks: sub.marks ?? null
                    },
                    deleteRef: { kind: 'ASSIGNMENT_SUBMISSION', id: String(sub._id) }
                });
            }
        }

        let out = events;
        if (batchFilter) {
            out = events.filter((e) => {
                const b = e.student?.batch || e.details?.batch || '';
                return String(b).trim() === batchFilter;
            });
        }

        out.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
        const payload = out.slice(0, limit);
        res.status(200).json({
            success: true,
            data: canExposeActivityDeleteRefs(req) ? payload : stripActivityDeleteRefs(payload)
        });
    } catch (err) {
        console.error('Error fetching activity feed:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch activity feed', error: err.message });
    }
});

// delete one student log entry
router.delete('/:logId', async (req, res) => {
    try {
        const { logId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(logId)) {
            return res.status(400).json({ success: false, message: 'Invalid log ID' });
        }

        const deleted = await StudentLogs.findByIdAndDelete(logId);
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Log not found' });
        }

        res.status(200).json({ success: true, message: 'Log deleted successfully' });
    } catch (err) {
        console.error('Error deleting student log:', err);
        res.status(500).json({ success: false, message: 'Failed to delete log', error: err.message });
    }
});

// get logs for a specific student
router.get('/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        const logs = await StudentLogs.find({ studentId })
        .populate('studentId', 'name email regNo')
        .populate('assignedTeacherAtUpdate', 'name regNo')
        .sort({ updatedAt: -1 }); // latest first

        res.status(200).json({ success: true, data: logs });

    } catch (err) {
        console.error('Error fetching logs for student:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch logs for student', error: err.message });
    }       
});


module.exports = router;