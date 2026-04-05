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
const mongoose = require('mongoose');

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
router.get('/analytics/:studentId', async (req, res) => {
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