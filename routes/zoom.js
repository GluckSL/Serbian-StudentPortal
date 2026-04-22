// routes/zoom.js

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const zoomService = require('../services/zoomService');
const MeetingLink = require('../models/MeetingLink');
const JoinLog = require('../models/JoinLog');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { findBestParticipantMatch } = require('../services/zoomParticipantMatch');
const { scheduleDispatchEvent, sanitizeMeetingLink } = require('../services/studentPortalCrmWebhook');
const { allStudentBatchStringsForContent } = require('../utils/effectiveStudentBatch');
const { buildJoinClassProxyUrl } = require('../utils/joinClassUrl');
const { getJoinLogDataForMeeting } = require('../services/joinLogHelpers');
const { buildAttendanceRowFromMatch, logAttendanceMatchSummary } = require('../services/attendanceMatchHelpers');
const { applyAttendanceStabilityPass } = require('../services/attendanceMatchingSafeguards');

/**
 * Create a Zoom meeting with selected students
 * POST /api/zoom/create-meeting
 */
router.post('/create-meeting', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const {
      batch,
      plan,
      topic,
      startTime,
      startTimes,
      scheduleMode,
      duration,
      timezone,
      agenda,
      studentIds, // Array of student IDs
      teacherId,  // Teacher assigned to the class
      zoomHostEmail, // Zoom host email from the Zoom API
      courseDay,   // Optional: day in the 200-day journey
      courseDaysByStart // Optional: map of slot -> courseDay
    } = req.body;

    const requestedStartTimes = (Array.isArray(startTimes) && startTimes.length > 0)
      ? startTimes
      : (startTime ? [startTime] : []);
    const normalizedStartTimes = [...new Set(requestedStartTimes)]
      .filter((t) => typeof t === 'string' && t.length >= 16)
      .sort();

    const parseCourseDayValue = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const n = parseInt(String(value), 10);
      if (!Number.isFinite(n)) return null;
      return Math.min(200, Math.max(1, n));
    };
    const fallbackCourseDay = parseCourseDayValue(courseDay);
    const normalizedCourseDaysByStart = {};
    if (courseDaysByStart && typeof courseDaysByStart === 'object' && !Array.isArray(courseDaysByStart)) {
      for (const [rawSlot, rawCourseDay] of Object.entries(courseDaysByStart)) {
        if (typeof rawSlot !== 'string' || rawSlot.length < 16) continue;
        const slotKey = rawSlot.substring(0, 16);
        normalizedCourseDaysByStart[slotKey] = parseCourseDayValue(rawCourseDay);
      }
    }

    console.log('📝 Creating Zoom meeting(s) for batch:', batch);
    console.log('📅 Schedule mode:', scheduleMode || 'single');
    console.log('🕒 Start slots:', normalizedStartTimes);
    console.log('👥 Selected students:', studentIds);

    // Validate required fields
    if (!batch || !plan || !topic || normalizedStartTimes.length === 0 || !studentIds || studentIds.length === 0 || !teacherId || !zoomHostEmail) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: batch, plan, topic, startTime/startTimes, studentIds, teacherId, and zoomHostEmail are required'
      });
    }

    // Get the assigned teacher
    const teacher = await User.findById(teacherId).select('email name role');
    if (!teacher || (teacher.role !== 'TEACHER' && teacher.role !== 'TEACHER_ADMIN')) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    console.log('👨‍🏫 Teacher:', teacher.name, '— Zoom Host:', zoomHostEmail);

    // Find students by IDs
    let students = [];
    if (studentIds[0] && typeof studentIds[0] === 'object' && studentIds[0]._id) {
      students = studentIds;
    } else {
      students = await User.find({
        _id: { $in: studentIds },
        role: 'STUDENT'
      }).select('name email batch level subscription');
    }

    if (students.length === 0) {
      return res.status(404).json({ success: false, message: 'No students found with the provided IDs' });
    }

    console.log(`✅ Found ${students.length} students`);
    const createdMeetings = [];
    const failedSchedules = [];

    for (const slotStartTime of normalizedStartTimes) {
      try {
        const slotCourseDay = Object.prototype.hasOwnProperty.call(normalizedCourseDaysByStart, slotStartTime)
          ? normalizedCourseDaysByStart[slotStartTime]
          : fallbackCourseDay;
        // Treat slotStartTime as local IST date-time string (YYYY-MM-DDTHH:mm)
        const meetingStart = new Date(`${slotStartTime}:00+05:30`);
        const meetingEnd = new Date(meetingStart.getTime() + (duration || 60) * 60000);

        const overlap = await MeetingLink.findOne({
          hostEmail: zoomHostEmail,
          status: { $ne: 'cancelled' },
          startTime: { $lt: meetingEnd },
          $expr: {
            $gt: [
              { $add: ['$startTime', { $multiply: ['$duration', 60000] }] },
              meetingStart
            ]
          }
        });

        if (overlap) {
          failedSchedules.push({
            startTime: slotStartTime,
            message: `Zoom account "${zoomHostEmail}" is already booked for "${overlap.topic}" at this time.`,
            conflicts: [{
              meetingId: overlap._id,
              topic: overlap.topic,
              startTime: overlap.startTime,
              duration: overlap.duration
            }]
          });
          continue;
        }

        const zoomResult = await zoomService.createMeeting({
          topic,
          startTime: slotStartTime,
          duration: duration || 60,
          timezone: timezone || 'Asia/Kolkata',
          agenda: agenda || `German Language Class - Batch ${batch}`
        }, zoomHostEmail);

        if (!zoomResult.success) {
          failedSchedules.push({
            startTime: slotStartTime,
            message: 'Failed to create Zoom meeting on Zoom API'
          });
          continue;
        }

        const meeting = zoomResult.meeting;

        const meetingLink = new MeetingLink({
          batch,
          plan,
          platform: 'Zoom',
          link: meeting.joinUrl,
          topic: meeting.topic,
          agenda: meeting.agenda,
          startTime: meetingStart,
          duration: meeting.duration,
          timezone: meeting.timezone,
          zoomMeetingId: String(meeting.id),
          zoomMeetingUuid: meeting.uuid ? String(meeting.uuid) : undefined,
          zoomPassword: meeting.password,
          hostEmail: meeting.hostEmail,
          startUrl: meeting.startUrl,
          joinUrl: meeting.joinUrl,
          createdBy: req.user.id,
          assignedTeacher: teacherId,
          courseDay: slotCourseDay,
          attendees: students.map(student => ({
            studentId: student._id,
            name: student.name,
            email: student.email,
            joinUrl: meeting.joinUrl
          })),
          status: 'scheduled',
          reminderEmailSent: false,
          emailNotificationStatus: {
            attempted: 0,
            successful: 0,
            failed: 0,
            allSent: false,
            failedStudents: [],
            lastAttempt: null
          }
        });

        await meetingLink.save();

        scheduleDispatchEvent({
          event: 'REMINDER_CREATED',
          entity: { ...sanitizeMeetingLink(meetingLink), type: 'MeetingLink' },
          metaOverrides: { syncMode: 'live' }
        });

        createdMeetings.push({
          meetingId: meetingLink._id,
          zoomMeetingId: meeting.id,
          topic: meeting.topic,
          startTime: meeting.startTime,
          duration: meeting.duration,
          joinUrl: meeting.joinUrl,
          startUrl: meeting.startUrl,
          password: meeting.password,
          attendeesCount: students.length,
          attendees: students.map(s => ({ name: s.name, email: s.email }))
        });

        // AUTO-LINK TO TIMETABLE
        try {
          const TimeTable = require('../models/TimeTable');
          const meetingDate = new Date(meeting.startTime);
          const dayOfWeek = meetingDate.toLocaleDateString('en-US', {
            weekday: 'long',
            timeZone: 'Asia/Kolkata'
          }).toLowerCase();
          const meetingTime = meetingDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Asia/Kolkata'
          });
          const endDate = new Date(meetingDate.getTime() + meeting.duration * 60000);
          const endTime = endDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Asia/Kolkata'
          });

          let timetable = await TimeTable.findOne({
            batch: batch,
            plan: plan,
            weekStartDate: { $lte: meetingDate },
            weekEndDate: { $gte: meetingDate }
          });

          if (!timetable) {
            const dayOfWeekNum = meetingDate.getDay();
            const daysToMonday = dayOfWeekNum === 0 ? -6 : 1 - dayOfWeekNum;

            const weekStartDate = new Date(meetingDate);
            weekStartDate.setDate(meetingDate.getDate() + daysToMonday);
            weekStartDate.setHours(0, 0, 0, 0);

            const weekEndDate = new Date(weekStartDate);
            weekEndDate.setDate(weekStartDate.getDate() + 6);
            weekEndDate.setHours(23, 59, 59, 999);

            const firstStudent = students[0];

            timetable = new TimeTable({
              batch: batch,
              medium: firstStudent.medium || 'English',
              plan: plan,
              weekStartDate: weekStartDate,
              weekEndDate: weekEndDate,
              assignedTeacher: teacherId,
              [dayOfWeek]: [{
                start: meetingTime,
                end: endTime,
                classStatus: 'Scheduled',
                zoomMeetingId: meeting.id,
                zoomJoinUrl: meeting.joinUrl,
                zoomPassword: meeting.password,
                meetingLinked: true
              }]
            });

            await timetable.save();
          } else {
            let daySlots = timetable[dayOfWeek];
            if (!daySlots || !Array.isArray(daySlots)) {
              daySlots = [];
              timetable[dayOfWeek] = daySlots;
            }

            const slotIndex = daySlots.findIndex(slot => {
              const slotTime = slot.start;
              return slotTime === meetingTime ||
                Math.abs(new Date(`1970-01-01T${slotTime}`) - new Date(`1970-01-01T${meetingTime}`)) < 300000;
            });

            if (slotIndex !== -1) {
              timetable[dayOfWeek][slotIndex].zoomMeetingId = meeting.id;
              timetable[dayOfWeek][slotIndex].zoomJoinUrl = meeting.joinUrl;
              timetable[dayOfWeek][slotIndex].zoomPassword = meeting.password;
              timetable[dayOfWeek][slotIndex].meetingLinked = true;
              await timetable.save();
            } else {
              timetable[dayOfWeek].push({
                start: meetingTime,
                end: endTime,
                classStatus: 'Scheduled',
                zoomMeetingId: meeting.id,
                zoomJoinUrl: meeting.joinUrl,
                zoomPassword: meeting.password,
                meetingLinked: true
              });
              await timetable.save();
            }
          }
        } catch (linkError) {
          console.error('⚠️ Error linking to timetable (non-critical):', linkError.message);
        }
      } catch (slotError) {
        failedSchedules.push({
          startTime: slotStartTime,
          message: slotError.message || 'Failed to create meeting for this slot'
        });
      }
    }

    if (createdMeetings.length === 0) {
      return res.status(409).json({
        success: false,
        message: 'Could not create any meetings for the selected schedule.',
        failedSchedules
      });
    }

    const primaryMeeting = createdMeetings[0];

    res.status(201).json({
      success: true,
      message: `Created ${createdMeetings.length} meeting(s) successfully` +
        (failedSchedules.length ? `, ${failedSchedules.length} failed.` : '.'),
      data: {
        ...primaryMeeting,
        meetings: createdMeetings
      },
      summary: {
        requestedCount: normalizedStartTimes.length,
        createdCount: createdMeetings.length,
        failedCount: failedSchedules.length,
        failedSchedules
      },
      emailStatus: {
        deferred: true,
        message: 'Invitation emails are sent about 10 minutes before each class starts.',
        attempted: 0,
        successful: 0,
        failed: 0,
        allSent: false,
        partialFailure: false,
        totalFailure: false,
        failedStudents: [],
        errors: []
      }
    });

  } catch (error) {
    console.error('❌ Error creating Zoom meeting:', error);
    const status = error.statusCode || 500;
    const response = {
      success: false,
      message: error.message || 'Failed to create Zoom meeting',
      error: error.toString()
    };
    if (error.conflicts) {
      response.conflicts = error.conflicts;
    }
    res.status(status).json(response);
  }
});

/**
 * Get all meetings for teacher or admin
 * GET /api/zoom/meetings
 * - Teachers see only their own meetings
 * - Admins see all meetings from all teachers
 */
router.get('/meetings', verifyToken, async (req, res) => {
  try {
    const { status, batch, date } = req.query;
    const userId = req.user.id || req.user.userId || req.user._id;

    // Get user to check role
    const user = await User.findById(userId).select('role');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    // Build with $and so batch / date clauses never break the teacher $or scope
    const andClauses = [];

    if (user.role === 'TEACHER' || user.role === 'TEACHER_ADMIN') {
      andClauses.push({
        $or: [
          { createdBy: userId },
          { assignedTeacher: userId }
        ]
      });
    }

    if (status) andClauses.push({ status });

    // Batch: match string or number (legacy / CRM data sometimes stores numeric batch)
    if (batch !== undefined && batch !== null && String(batch).trim() !== '') {
      const b = String(batch).trim();
      const asNum = Number(b);
      if (Number.isFinite(asNum) && String(asNum) === b) {
        andClauses.push({ $or: [{ batch: b }, { batch: asNum }] });
      } else {
        andClauses.push({ batch: b });
      }
    }

    if (req.query.plan) andClauses.push({ plan: req.query.plan });

    // Calendar day in India (IST) — [dayStart, nextDayStart) avoids end-of-day ms bugs
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) {
      const ymd = String(date).trim();
      const dayStartColombo = new Date(`${ymd}T00:00:00.000+05:30`);
      const nextDayStart = new Date(dayStartColombo.getTime() + 24 * 60 * 60 * 1000);
      andClauses.push({
        startTime: { $gte: dayStartColombo, $lt: nextDayStart }
      });
    }

    const query = andClauses.length ? { $and: andClauses } : {};

    const sortOrder = date ? 1 : -1;
    const meetings = await MeetingLink.find(query)
      .populate('createdBy', 'name email role')
      .populate('assignedTeacher', 'name email')
      .populate('attendees.studentId', 'name email batch level subscription')
      .sort({ startTime: sortOrder });

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.status(200).json({
      success: true,
      count: meetings.length,
      data: meetings,
      userRole: user.role // Include role in response for frontend
    });

  } catch (error) {
    console.error('❌ Error fetching meetings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meetings'
    });
  }
});

/**
 * Get single meeting details
 * GET /api/zoom/meeting/:id
 */
router.get('/meeting/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const meeting = await MeetingLink.findById(id)
      .populate('createdBy', 'name email')
      .populate('assignedTeacher', 'name email')
      .populate('attendees.studentId', 'name email batch level subscription studentStatus');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Calculate meeting status
    const now = new Date();
    const meetingStart = new Date(meeting.startTime);
    const meetingEnd = new Date(meetingStart.getTime() + meeting.duration * 60000);

    let currentStatus = meeting.status;
    if (now >= meetingStart && now <= meetingEnd && meeting.status === 'scheduled') {
      currentStatus = 'ongoing';
    } else if (now > meetingEnd && meeting.status !== 'ended') {
      currentStatus = 'ended';
    }

    const payload = {
      ...meeting.toObject(),
      currentStatus,
      isOngoing: currentStatus === 'ongoing',
      hasEnded: currentStatus === 'ended',
      canJoin: now >= new Date(meetingStart.getTime() - 10 * 60000), // Can join 10 min before
      timeUntilStart: meetingStart - now,
      attendeesCount: meeting.attendees.length,
      attendedCount: meeting.attendance?.filter(a => a.attended).length || 0
    };

    if (req.user.role === 'STUDENT') {
      payload.joinUrl = buildJoinClassProxyUrl(req, meeting._id);
    }

    res.status(200).json({
      success: true,
      data: payload
    });

  } catch (error) {
    console.error('❌ Error fetching meeting details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meeting details'
    });
  }
});

/**
 * Get meetings for a specific student
 * GET /api/zoom/student-meetings
 * Returns all meetings where the logged-in student is an attendee
 */
router.get('/student-meetings', verifyToken, async (req, res) => {
  try {
    const studentId = req.user.id;

    const student = await User.findById(studentId)
    .select('batch subscription currentCourseDay email goStatus');

    if(!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const studentDay = (student.currentCourseDay != null && Number.isFinite(Number(student.currentCourseDay)))
      ? Math.min(200, Math.max(1, Math.floor(Number(student.currentCourseDay))))
      : 1;

    const batchKeys = allStudentBatchStringsForContent(student);
    let meetings = [];
    if (batchKeys.length) {
      const batchOr = batchKeys.map((k) => ({
        batch: new RegExp(`^${String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      }));
      meetings = await MeetingLink.find({
        $and: [
          { plan: { $in: [student.subscription, 'ALL'] } },
          { $or: batchOr }
        ]
      })
        .populate('createdBy', 'name email')
        .populate('assignedTeacher', 'name email')
        .sort({ startTime: -1 });
    }

    /** Pull saved attendance row for this student (same data as teacher/admin attendance report). */
    function studentAttendanceFromMeeting(meetingDoc, sid, studentEmail) {
      const list = Array.isArray(meetingDoc.attendance) ? meetingDoc.attendance : [];
      const idStr = sid.toString();
      let row = list.find(
        (a) => a && a.studentId && a.studentId.toString() === idStr
      );
      if (!row && studentEmail) {
        const em = String(studentEmail).toLowerCase().trim();
        row = list.find(
          (a) => a && a.email && String(a.email).toLowerCase().trim() === em
        );
      }
      if (!row) {
        return {
          attended: false,
          durationMinutes: 0,
          attendanceRowStatus: null
        };
      }
      let mins = row.durationMinutes;
      if (mins == null && row.duration != null && Number.isFinite(Number(row.duration))) {
        mins = Math.round(Number(row.duration) / 60);
      }
      mins = Number.isFinite(Number(mins)) ? Math.max(0, Number(mins)) : 0;
      const attended =
        row.attended === true ||
        row.status === 'attended' ||
        row.status === 'late';
      return {
        attended,
        durationMinutes: mins,
        attendanceRowStatus: row.status || null
      };
    }

    // Keep future-locked meetings hidden from the student list.
    const gatedMeetings = meetings.filter((m) => {
      if (m.courseDay == null || m.courseDay === undefined) return true;
      const cd = Number(m.courseDay);
      if (!Number.isFinite(cd)) return true;
      return cd <= studentDay;
    });

    // Calculate meeting status for each meeting
    const now = new Date();
    const meetingsWithStatus = gatedMeetings.map(meeting => {
      const meetingStart = new Date(meeting.startTime);
      const meetingEnd = new Date(meetingStart.getTime() + meeting.duration * 60000);
      const rawCd = meeting.courseDay;
      const journeyLocked =
        rawCd != null &&
        Number.isFinite(Number(rawCd)) &&
        Number(rawCd) !== studentDay;

      let currentStatus = meeting.status;
      let canJoin = false;
      let timeUntilStart = meetingStart - now;

      if (now >= meetingStart && now <= meetingEnd && meeting.status === 'scheduled') {
        currentStatus = 'ongoing';
      } else if (now > meetingEnd) {
        currentStatus = 'ended';
      }

      if (!journeyLocked) {
        if (currentStatus === 'ongoing') {
          canJoin = true;
        } else if (currentStatus !== 'ended' && now >= new Date(meetingStart.getTime() - 10 * 60000)) {
          canJoin = true;
        }
      }

      // Authenticated join redirect (injects portal display name + JoinLog); do not expose raw Zoom joinUrl to students
      const joinUrl = buildJoinClassProxyUrl(req, meeting._id);

      const att = studentAttendanceFromMeeting(meeting, studentId, student.email);

      return {
        _id: meeting._id,
        topic: meeting.topic,
        batch: meeting.batch,
        plan: meeting.plan,
        startTime: meeting.startTime,
        duration: meeting.duration,
        courseDay: meeting.courseDay != null ? meeting.courseDay : null,
        journeyLocked,
        attended: att.attended,
        durationMinutes: att.durationMinutes,
        attendedDurationMinutes: att.durationMinutes,
        attendanceStatus: att.attendanceRowStatus,
        teacher: {
          name: meeting.assignedTeacher?.name || meeting.createdBy?.name || 'Unknown',
          email: meeting.assignedTeacher?.email || meeting.createdBy?.email || ''
        },
        joinUrl,
        password: meeting.zoomPassword,
        status: meeting.status,
        currentStatus: currentStatus,
        canJoin: canJoin,
        isOngoing: currentStatus === 'ongoing',
        hasEnded: currentStatus === 'ended',
        timeUntilStart: timeUntilStart,
        agenda: meeting.agenda,
        isPersonalUrl: false
      };
    });

    res.status(200).json({
      success: true,
      count: meetingsWithStatus.length,
      data: meetingsWithStatus
    });

  } catch (error) {
    console.error('❌ Error fetching student meetings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meetings'
    });
  }
});

/**
 * Get students by batch for selection
 * GET /api/zoom/students/:batch
 */
router.get('/students/:batch', verifyToken, async (req, res) => {
  try {
    const { batch } = req.params;

    const students = await User.find({
      role: 'STUDENT',
      batch: batch,
      isActive: true
    })
    .select('name email batch level subscription studentStatus')
    .sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: students.length,
      data: students
    });

  } catch (error) {
    console.error('❌ Error fetching students:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
});

/**
 * Get all students (for multi-batch selection)
 * GET /api/zoom/students
 */
router.get('/students', verifyToken, async (req, res) => {
  try {
    const { batch, level, subscription } = req.query;
    
    const query = {
      role: 'STUDENT',
      isActive: true
    };

    if (batch) query.batch = batch;
    if (level) query.level = level;
    if (subscription) query.subscription = subscription;

    const students = await User.find(query)
      .select('name email batch level subscription studentStatus')
      .sort({ batch: 1, name: 1 });

    res.status(200).json({
      success: true,
      count: students.length,
      data: students
    });

  } catch (error) {
    console.error('❌ Error fetching students:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
});

/**
 * Update meeting (add/remove attendees)
 * PUT /api/zoom/meeting/:id/attendees
 */
router.put('/meeting/:id/attendees', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { addStudentIds, removeStudentIds } = req.body;

    const meeting = await MeetingLink.findById(id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Add new students
    if (addStudentIds && addStudentIds.length > 0) {
      const newStudents = await User.find({
        _id: { $in: addStudentIds },
        role: 'STUDENT'
      }).select('name email');

      const attendees = newStudents.map(student => ({
        email: student.email,
        name: student.name
      }));

      // No registration needed — students use the shared join URL
      newStudents.forEach(student => {
        meeting.attendees.push({
          studentId: student._id,
          name: student.name,
          email: student.email,
          joinUrl: meeting.joinUrl
        });
      });

      // If the ~10 min reminder already went out, notify new students immediately; otherwise cron includes them
      if (meeting.reminderEmailSent) {
        try {
          const transporter = require('../config/emailConfig');
          const { sendInvitationEmailsToAttendees } = require('../services/zoomInvitationEmail');
          const onlyAttendees = newStudents.map((s) => ({
            name: s.name,
            email: s.email,
            joinUrl: meeting.joinUrl
          }));
          console.log(`📧 Sending join links to ${newStudents.length} newly added students (reminder already sent)...`);
          await sendInvitationEmailsToAttendees(meeting, transporter, {
            onlyAttendees,
            subject: '🎓 Zoom class — join link (Glück Global)',
            introParagraph:
              'You have been added to this class. It is starting soon — please join using the link below:'
          });
        } catch (emailError) {
          console.error('⚠️ Error sending emails to new attendees (non-critical):', emailError.message);
        }
      }
    }

    // Remove students
    if (removeStudentIds && removeStudentIds.length > 0) {
      meeting.attendees = meeting.attendees.filter(
        attendee => !removeStudentIds.includes(attendee.studentId.toString())
      );
    }

    await meeting.save();

    res.status(200).json({
      success: true,
      message: 'Attendees updated successfully',
      data: meeting
    });

  } catch (error) {
    console.error('❌ Error updating attendees:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update attendees'
    });
  }
});

/**
 * Update meeting details (topic, time, duration, agenda, etc.)
 * PUT /api/zoom/meeting/:id
 */
router.put('/meeting/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      topic,
      startTime,
      duration,
      timezone,
      agenda,
      settings,
      courseDay
    } = req.body;

    // Find meeting in database
    const meeting = await MeetingLink.findById(id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check if user has permission to edit this meeting
    const user = await User.findById(req.user.id).select('role');
    const isOwnerOrAssigned = meeting.createdBy.toString() === req.user.id ||
      (meeting.assignedTeacher && meeting.assignedTeacher.toString() === req.user.id);
    if ((user.role === 'TEACHER' || user.role === 'TEACHER_ADMIN') && !isOwnerOrAssigned) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit meetings assigned to you'
      });
    }

    const prevStartMs = meeting.startTime ? new Date(meeting.startTime).getTime() : null;

    // Prepare update data for Zoom
    const zoomUpdateData = {};
    
    if (topic) zoomUpdateData.topic = topic;
    if (startTime) zoomUpdateData.start_time = startTime;
    if (duration) zoomUpdateData.duration = duration;
    if (timezone) zoomUpdateData.timezone = timezone;
    if (agenda) zoomUpdateData.agenda = agenda;
    if (settings) zoomUpdateData.settings = {
      ...settings,
      // Ensure registration settings remain correct
      approval_type: 0,
      registration_type: 1,
      waiting_room: false,
      registrants_email_notification: false,
      registrants_confirmation_email: false
    };

    // Update meeting in Zoom
    if (Object.keys(zoomUpdateData).length > 0) {
      console.log('📝 Updating Zoom meeting:', meeting.zoomMeetingId);
      await zoomService.updateMeeting(meeting.zoomMeetingId, zoomUpdateData);
    }

    // Update meeting in database
    if (topic) meeting.topic = topic;
    if (startTime) {
      const nextStartMs = new Date(startTime).getTime();
      meeting.startTime = new Date(startTime);
      if (prevStartMs !== nextStartMs) {
        meeting.reminderEmailSent = false;
        meeting.reminderEmailSentAt = undefined;
      }
    }
    if (duration) meeting.duration = duration;
    if (timezone) meeting.timezone = timezone;
    if (agenda) meeting.agenda = agenda;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'courseDay')) {
      if (courseDay === null || courseDay === '') {
        meeting.courseDay = null;
      } else {
        const n = parseInt(String(courseDay), 10);
        meeting.courseDay = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : null;
      }
    }

    await meeting.save();

    // ✅ UPDATE TIMETABLE if time changed
    if (startTime) {
      try {
        const TimeTable = require('../models/TimeTable');
        const newMeetingDate = new Date(startTime);
        
        // Get new day of week
        const newDayOfWeek = newMeetingDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          timeZone: 'Asia/Kolkata' 
        }).toLowerCase();
        
        // Get new time
        const newMeetingTime = newMeetingDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Kolkata'
        });

        // Calculate new end time
        const newEndDate = new Date(newMeetingDate.getTime() + (duration || meeting.duration) * 60000);
        const newEndTime = newEndDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Kolkata'
        });

        console.log('🔄 Updating timetable for meeting time change:', {
          batch: meeting.batch,
          newDayOfWeek,
          newTime: `${newMeetingTime} - ${newEndTime}`
        });

        // Find timetable that covers the new date
        let timetable = await TimeTable.findOne({
          batch: meeting.batch,
          plan: meeting.plan,
          weekStartDate: { $lte: newMeetingDate },
          weekEndDate: { $gte: newMeetingDate }
        });

        if (timetable) {
          // Remove from old slot (find by zoomMeetingId)
          const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
          for (const day of days) {
            if (timetable[day] && Array.isArray(timetable[day])) {
              const slotIndex = timetable[day].findIndex(slot => 
                slot.zoomMeetingId === meeting.zoomMeetingId
              );
              if (slotIndex !== -1) {
                // Remove from old day
                timetable[day].splice(slotIndex, 1);
                break;
              }
            }
          }

          // Add to new day/time
          if (!timetable[newDayOfWeek]) {
            timetable[newDayOfWeek] = [];
          }

          timetable[newDayOfWeek].push({
            start: newMeetingTime,
            end: newEndTime,
            classStatus: 'Scheduled',
            zoomMeetingId: meeting.zoomMeetingId,
            zoomJoinUrl: meeting.joinUrl,
            zoomPassword: meeting.zoomPassword,
            meetingLinked: true
          });

          await timetable.save();
          console.log('✅ Timetable updated for meeting time change');
        }
      } catch (timetableError) {
        console.error('⚠️ Error updating timetable (non-critical):', timetableError.message);
      }
    }

    scheduleDispatchEvent({
      event: 'REMINDER_UPDATED',
      entity: { ...sanitizeMeetingLink(meeting), type: 'MeetingLink' },
      metaOverrides: { syncMode: 'live' }
    });

    res.status(200).json({
      success: true,
      message: 'Meeting updated successfully',
      data: meeting
    });

  } catch (error) {
    console.error('❌ Error updating meeting:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update meeting'
    });
  }
});

/**
 * Delete Zoom meeting
 * DELETE /api/zoom/meeting/:id
 */
router.delete('/meeting/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const meeting = await MeetingLink.findById(id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // ✅ UNLINK FROM TIMETABLE: Remove Zoom meeting info from timetable slot
    try {
      const TimeTable = require('../models/TimeTable');
      const meetingDate = new Date(meeting.startTime);
      
      // Get day of week
      const dayOfWeek = meetingDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        timeZone: 'Asia/Kolkata' 
      }).toLowerCase();

      console.log('🔍 Unlinking meeting from timetable:', {
        batch: meeting.batch,
        dayOfWeek,
        zoomMeetingId: meeting.zoomMeetingId
      });

      // Find timetable that covers this date
      const timetable = await TimeTable.findOne({
        batch: meeting.batch,
        weekStartDate: { $lte: meetingDate },
        weekEndDate: { $gte: meetingDate }
      });

      if (timetable) {
        const daySlots = timetable[dayOfWeek];
        
        if (daySlots && Array.isArray(daySlots)) {
          // Find slot with this Zoom meeting ID
          const slotIndex = daySlots.findIndex(slot => 
            slot.zoomMeetingId === meeting.zoomMeetingId
          );

          if (slotIndex !== -1) {
            // Remove Zoom meeting info from slot
            timetable[dayOfWeek][slotIndex].zoomMeetingId = undefined;
            timetable[dayOfWeek][slotIndex].zoomJoinUrl = undefined;
            timetable[dayOfWeek][slotIndex].zoomPassword = undefined;
            timetable[dayOfWeek][slotIndex].meetingLinked = false;
            
            await timetable.save();
            console.log('✅ Timetable slot unlinked from Zoom meeting');
          }
        }
      }
    } catch (unlinkError) {
      console.error('⚠️ Error unlinking from timetable (non-critical):', unlinkError.message);
      // Don't fail the meeting deletion if timetable unlinking fails
    }

    // ✅ SEND CANCELLATION EMAILS TO STUDENTS
    try {
      const transporter = require('../config/emailConfig');
      
      // Populate student details if not already populated
      const meetingWithStudents = await MeetingLink.findById(id)
        .populate('attendees.studentId', 'name email');
      
      const students = meetingWithStudents.attendees
        .filter(a => a.studentId) // Only students with valid IDs
        .map(a => ({
          name: a.studentId.name || a.name,
          email: a.studentId.email || a.email
        }));

      if (students.length > 0) {
        console.log(`📧 Sending cancellation emails to ${students.length} students...`);
        
        for (const student of students) {
          try {
            const mailOptions = {
              from: process.env.EMAIL_USER,
              to: student.email,
              subject: '❗ Meeting Cancelled - Glück Global',
              html: `
                <div style="font-family: Arial, sans-serif; text-align:center; background:#f9f9f9; padding:20px;">
                  <div style="max-width:600px; margin:auto; background:#fff; padding:20px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                    
                    <div style="background:#dc3545; border-radius:8px; padding:20px;">
                      <h2 style="color:white; margin:0;">⚠️ Meeting Cancelled</h2>
                    </div>

                    <p style="margin-top:20px;">Hello <strong>${student.name}</strong>,</p>
                    
                    <p>We regret to inform you that the following Zoom meeting has been <strong>cancelled</strong>:</p>

                    <div style="background:#f5f5f5; padding:15px; border-radius:8px; margin:20px 0; border-left:4px solid #dc3545;">
                      <h3 style="color:#dc3545; margin:0 0 10px 0;">${meeting.topic}</h3>
                      <p style="margin:5px 0;"><strong>📅 Date:</strong> ${new Date(meeting.startTime).toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        timeZone: 'Asia/Kolkata'
                      })}</p>
                      <p style="margin:5px 0;"><strong>🕐 Time:</strong> ${new Date(meeting.startTime).toLocaleTimeString('en-US', { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        timeZone: 'Asia/Kolkata'
                      })}</p>
                      <p style="margin:5px 0;"><strong>👥 Batch:</strong> ${meeting.batch}</p>
                    </div>

                    <div style="background:#fff3cd; border:1px solid #ffc107; padding:15px; border-radius:6px; margin:20px 0;">
                      <p style="margin:0; color:#856404;">
                        <strong>📢 Important:</strong> This meeting has been cancelled due to unforeseen circumstances. 
                        We apologize for any inconvenience this may cause.
                      </p>
                    </div>

                    <p style="margin-top:20px;">
                      Please check your timetable for the next scheduled class. 
                      If you have any questions, please contact your teacher.
                    </p>

                    <p style="margin-top:30px; color:#666; font-size:13px;">
                      Regular classes will continue as per the normal schedule.
                    </p>

                    <hr style="border:none; border-top:1px solid #ddd; margin:30px 0;">

                    <p style="font-size:13px; color:#888;">
                      Best regards,<br>
                      <strong>Glück Global Pvt Ltd</strong><br>
                      German Language Learning Platform
                    </p>
                  </div>
                </div>
              `
            };

            await transporter.sendMail(mailOptions);
            console.log(`✅ Cancellation email sent to ${student.name} (${student.email})`);
          } catch (emailError) {
            console.error(`❌ Failed to send cancellation email to ${student.email}:`, emailError.message);
          }
        }

        console.log(`✅ Cancellation emails sent to ${students.length} students`);
      }
    } catch (emailError) {
      console.error('⚠️ Error sending cancellation emails (non-critical):', emailError.message);
    }

    // Delete from Zoom
    if (meeting.zoomMeetingId) {
      await zoomService.deleteMeeting(meeting.zoomMeetingId);
    }

    scheduleDispatchEvent({
      event: 'REMINDER_DELETED',
      entity: { ...sanitizeMeetingLink(meeting), type: 'MeetingLink' },
      metaOverrides: { syncMode: 'live' }
    });

    // Delete from database
    await MeetingLink.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Meeting deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete meeting'
    });
  }
});

/**
 * Get meeting participants for attendance
 * GET /api/zoom/meeting/:meetingId/participants
 */
router.get('/meeting/:meetingId/participants', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.params;

    const participants = await zoomService.getMeetingParticipants(meetingId);

    res.status(200).json({
      success: true,
      count: participants.length,
      data: participants
    });

  } catch (error) {
    console.error('❌ Error fetching participants:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch participants'
    });
  }
});

/**
 * Get detailed meeting report with attendance
 * GET /api/zoom/meeting/:meetingId/report
 */
router.get('/meeting/:meetingId/report', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.params;

    const report = await zoomService.getMeetingReport(meetingId);

    res.status(200).json(report);

  } catch (error) {
    console.error('❌ Error fetching meeting report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch meeting report'
    });
  }
});

/**
 * Get attendance for a specific meeting from database
 * GET /api/zoom/meeting/:id/attendance
 */
router.get('/meeting/:id/attendance', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const meeting = await MeetingLink.findById(id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check if meeting has ended
    const now = new Date();
    const meetingEndTime = new Date(meeting.startTime.getTime() + meeting.duration * 60000);
    
    if (now < meetingEndTime) {
      return res.status(400).json({
        success: false,
        message: 'Meeting has not ended yet. Attendance data will be available after the meeting ends.'
      });
    }

    // Fetch attendance from Zoom
    let zoomReport;
    try {
      console.log('🔍 Fetching Zoom report for meeting:', meeting.zoomMeetingId);
      zoomReport = await zoomService.getMeetingReport(meeting.zoomMeetingId);
      console.log('✅ Zoom report received:', {
        success: zoomReport.success,
        participantCount: zoomReport.participants?.length || 0,
        meetingDuration: zoomReport.meeting?.duration || 'unknown'
      });
    } catch (error) {
      console.error('❌ Failed to get Zoom report:', error.message);
      return res.status(400).json({
        success: false,
        message: 'Attendance data not yet available. Please try again in a few minutes after the meeting ends.'
      });
    }

    // Enhanced matching with confidence scores
    console.log('🔍 Starting enhanced matching...');
    console.log('📊 Meeting attendees:', meeting.attendees.length);
    console.log('📊 Zoom participants:', zoomReport.participants?.length || 0);
    
    if (zoomReport.participants) {
      console.log('👥 Sample Zoom participant:', zoomReport.participants[0]);
    }
    if (meeting.attendees.length > 0) {
      console.log('👥 Sample meeting attendee:', meeting.attendees[0]);
    }

    const joinData = await getJoinLogDataForMeeting(meeting._id);
    const joinLogMap = joinData.firstJoinByStudent;
    const joinPresence = joinData.hasJoin;

    const zoomParts = zoomReport.participants || [];
    for (const p of zoomParts) {
      delete p._matched;
      delete p._reserved;
      delete p._priority;
      delete p._matchedByStudent;
    }
    delete zoomParts[Symbol.for('gluck.attendanceClaimMap')];
    delete zoomParts[Symbol.for('gluck.attendanceTraceId')];
    const traceId = new mongoose.Types.ObjectId();
    const claimedParticipants = new Map();

    // Preserve teacher/admin manual Zoom↔student links across reloads (GET used to overwrite these every time)
    const manualByStudentId = new Map();
    for (const row of meeting.attendance || []) {
      if (row && row.studentId && row.matchMethod === 'manual_map') {
        manualByStudentId.set(row.studentId.toString(), row);
      }
    }

    const attendanceData = meeting.attendees.map(attendee => {
      const sid = attendee.studentId && attendee.studentId.toString();
      const manualRow = sid ? manualByStudentId.get(sid) : null;
      if (manualRow) {
        const m = manualRow.toObject ? manualRow.toObject() : { ...manualRow };
        const clickedJoin = sid ? joinPresence.has(sid) : false;
        const fc = m.confidence != null ? m.confidence : 100;
        return {
          studentId: attendee.studentId,
          name: attendee.name,
          email: attendee.email,
          attended: m.attended !== undefined ? m.attended : false,
          confidence: fc,
          finalConfidence: fc,
          confidenceLevel: fc >= 85 ? 'high' : fc >= 65 ? 'medium' : 'low',
          matchMethod: 'manual_map',
          zoomName: m.zoomName || null,
          zoomEmail: m.zoomEmail || null,
          joinTime: m.joinTime || null,
          leaveTime: m.leaveTime || null,
          duration: m.duration != null ? m.duration : 0,
          durationMinutes: m.durationMinutes != null ? m.durationMinutes : 0,
          attendancePercent: m.attendancePercent != null ? m.attendancePercent : 0,
          status: m.status || 'absent',
          needsReview: !!m.needsReview,
          clickedJoin,
          appearedInZoom: !!(m.zoomName || m.joinTime || m.duration),
          mismatchReason: null,
          debugSummary: 'Manual map by admin',
          debug: {
            portalName: attendee.name,
            zoomName: m.zoomName || null,
            matchMethod: 'manual_map',
            traceId: String(traceId),
          },
        };
      }

      const joinLogJoinedAt = sid ? joinLogMap.get(sid) : undefined;
      const clickedJoin = sid ? joinPresence.has(sid) : false;
      const matchResult = findBestParticipantMatch(attendee, zoomReport.participants, {
        joinLogJoinedAt,
        logContext: { meetingId: meeting._id, studentId: sid },
        meetingDurationSec: (meeting.duration || 60) * 60,
        traceId,
        claimedParticipants,
      });
      const participantDuration = matchResult.match?.durationMinutes || 0;
      const meetingDuration = meeting.duration || 60;
      const attendancePercent = meetingDuration > 0 ? (participantDuration / meetingDuration) * 100 : 0;
      const meetsThreshold = !!matchResult.match && attendancePercent >= 70;

      console.log(`🎯 Matching ${attendee.name}:`, {
        confidence: matchResult.confidence,
        method: matchResult.method,
        matched: !!matchResult.match,
        durationMinutes: participantDuration,
        attendancePercent: Math.round(attendancePercent),
        meetsThreshold,
      });

      return buildAttendanceRowFromMatch(attendee, matchResult, {
        meetingDurationMinutes: meetingDuration,
        clickedJoin,
        traceId,
      });
    });

    applyAttendanceStabilityPass(attendanceData, traceId);

    // Calculate matching statistics
    const matchingStats = {
      emailMatches: attendanceData.filter(a => a.matchMethod === 'email').length,
      exactNameMatches: attendanceData.filter(a => a.matchMethod === 'exact_name').length,
      partialNameMatches: attendanceData.filter(a => a.matchMethod === 'partial_name').length,
      fuzzyMatches: attendanceData.filter(a => a.matchMethod === 'fuzzy_name').length,
      manualReviewRequired: attendanceData.filter(a => a.needsReview).length,
      highConfidenceMatches: attendanceData.filter(a => a.confidence >= 80).length
    };

    // Update meeting with attendance data
    meeting.attendance = attendanceData;
    meeting.attendanceRecorded = true;
    meeting.attendanceRecordedAt = new Date();
    await meeting.save();

    logAttendanceMatchSummary(attendanceData, meeting._id, traceId);

    try {
      const { syncPendingFlagsFromMeeting } = require('../services/journeyDayAdvance.service');
      await syncPendingFlagsFromMeeting(meeting);
    } catch (e) {
      console.warn('journey pending sync (manual attendance):', e.message);
    }

    const normAttendStr = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
    const allParticipants = (zoomReport.participants || []).map(p => ({
      name: p.name || '',
      email: p.email || '',
      joinTime: p.joinTime || null,
      leaveTime: p.leaveTime || null,
      duration: p.duration || 0,
      durationMinutes: p.durationMinutes || 0,
      sessionCount: p.sessionCount || 1,
      isMapped: attendanceData.some(a =>
        (a.zoomEmail && p.email && normAttendStr(a.zoomEmail) === normAttendStr(p.email)) ||
        (a.zoomName && p.name && normAttendStr(a.zoomName) === normAttendStr(p.name))
      ),
      mappedTo: (() => {
        const mapped = attendanceData.find(a =>
          (a.zoomEmail && p.email && normAttendStr(a.zoomEmail) === normAttendStr(p.email)) ||
          (a.zoomName && p.name && normAttendStr(a.zoomName) === normAttendStr(p.name))
        );
        return mapped ? { name: mapped.name, email: mapped.email } : null;
      })()
    }));

    res.status(200).json({
      success: true,
      data: {
        meetingId: meeting._id,
        zoomMeetingId: meeting.zoomMeetingId,
        topic: meeting.topic,
        startTime: meeting.startTime,
        duration: meeting.duration,
        totalStudents: meeting.attendees.length,
        attendedCount: attendanceData.filter(a => a.attended).length,
        absentCount: attendanceData.filter(a => !a.attended).length,
        attendance: attendanceData,
        allParticipants: allParticipants,
        matchingStats: matchingStats,
        summary: zoomReport.summary
      }
    });

  } catch (error) {
    console.error('❌ Error fetching attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance data'
    });
  }
});

/**
 * Manually map a Zoom participant to a batch student
 * POST /api/zoom/meeting/:id/attendance/map-participant
 */
router.post('/meeting/:id/attendance/map-participant', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { participantName, participantEmail, studentEmail } = req.body;

    if (!studentEmail) {
      return res.status(400).json({ success: false, message: 'Student email is required' });
    }

    const meeting = await MeetingLink.findById(id);
    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    const attendee = meeting.attendees.find(a => a.email.toLowerCase() === studentEmail.toLowerCase());
    if (!attendee) {
      return res.status(404).json({ success: false, message: 'Student not found in this batch/meeting. Check the email and try again.' });
    }

    let zoomReport;
    try {
      zoomReport = await zoomService.getMeetingReport(meeting.zoomMeetingId);
    } catch (error) {
      return res.status(400).json({ success: false, message: 'Could not fetch Zoom data' });
    }

    const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
    const participant = (zoomReport.participants || []).find(p =>
      (participantEmail && p.email && norm(p.email) === norm(participantEmail)) ||
      (participantName && p.name && norm(p.name) === norm(participantName))
    );

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: 'Zoom participant not found. Try again with the exact Zoom display name, or refresh the page in case the report updated.'
      });
    }

    const meetingDuration = meeting.duration || 60;
    const participantDuration = participant.durationMinutes || 0;
    const attendancePercent = meetingDuration > 0 ? (participantDuration / meetingDuration) * 100 : 0;
    const meetsThreshold = attendancePercent >= 70;

    const existingIdx = meeting.attendance.findIndex(
      a => a.studentId && a.studentId.toString() === attendee.studentId.toString()
    );

    const joinLogRow = await JoinLog.findOne({
      meetingId: meeting._id,
      studentId: attendee.studentId,
    })
      .select('_id')
      .lean();

    const mappedRecord = {
      studentId: attendee.studentId,
      name: attendee.name,
      email: attendee.email,
      attended: meetsThreshold,
      confidence: 100,
      finalConfidence: 100,
      confidenceLevel: 'high',
      matchMethod: 'manual_map',
      zoomName: participant.name,
      zoomEmail: participant.email || '',
      joinTime: participant.joinTime || null,
      leaveTime: participant.leaveTime || null,
      duration: participant.duration || 0,
      durationMinutes: participantDuration,
      attendancePercent: Math.round(attendancePercent),
      status: meetsThreshold ? 'attended' : 'late',
      needsReview: false,
      clickedJoin: !!joinLogRow,
      appearedInZoom: true,
      mismatchReason: null,
      debugSummary: 'Manual map by admin',
      debug: {
        portalName: attendee.name,
        zoomName: participant.name,
        matchMethod: 'manual_map',
      },
    };

    if (existingIdx >= 0) {
      meeting.attendance[existingIdx] = mappedRecord;
    } else {
      meeting.attendance.push(mappedRecord);
    }

    meeting.attendanceRecordedAt = new Date();
    await meeting.save();

    try {
      const { syncPendingFlagsFromMeeting } = require('../services/journeyDayAdvance.service');
      await syncPendingFlagsFromMeeting(meeting);
    } catch (e) {
      console.warn('journey pending sync (map-participant):', e.message);
    }

    res.status(200).json({
      success: true,
      message: `Successfully mapped "${participant.name}" to student "${attendee.name}" (${attendee.email})`,
      data: mappedRecord
    });

  } catch (error) {
    console.error('Error mapping participant:', error);
    res.status(500).json({ success: false, message: 'Failed to map participant' });
  }
});

/**
 * Get participant engagement metrics (camera/mic usage)
 * GET /api/zoom/meeting/:meetingId/engagement
 */
router.get('/meeting/:meetingId/engagement', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.params;

    console.log('📊 Fetching engagement data for meeting:', meetingId);

    const engagementData = await zoomService.getParticipantEngagement(meetingId);

    res.status(200).json({
      success: true,
      count: engagementData.length,
      data: engagementData,
      summary: {
        totalParticipants: engagementData.length,
        averageCameraOnTime: Math.round(
          engagementData.reduce((sum, p) => sum + (p.engagement?.cameraOnMinutes || 0), 0) / engagementData.length
        ),
        averageMicOnTime: Math.round(
          engagementData.reduce((sum, p) => sum + (p.engagement?.micOnMinutes || 0), 0) / engagementData.length
        ),
        averageCameraOnPercentage: Math.round(
          engagementData.reduce((sum, p) => sum + (p.engagement?.cameraOnPercentage || 0), 0) / engagementData.length
        )
      }
    });

  } catch (error) {
    console.error('❌ Error fetching engagement data:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch engagement data'
    });
  }
});

/**
 * Get STUDENT engagement metrics only (excludes teachers/hosts)
 * GET /api/zoom/meeting/:meetingId/engagement/students
 */
router.get('/meeting/:meetingId/engagement/students', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.params;

    console.log('📊 Fetching STUDENT engagement data for meeting:', meetingId);

    const engagementData = await zoomService.getParticipantEngagement(meetingId);

    // Identify registered students
    let studentData;
    
    if (meeting && meeting.attendees && meeting.attendees.length > 0) {
      // Filter by registered student emails
      const studentEmails = meeting.attendees.map(a => a.email.toLowerCase());
      studentData = engagementData.filter(p => 
        p.email && studentEmails.includes(p.email.toLowerCase())
      );
    } else {
      // Fallback: Exclude hosts and co-hosts
      studentData = engagementData.filter(p => {
        const email = p.email?.toLowerCase() || '';
        const name = p.name?.toLowerCase() || '';
        
        // Exclude if email contains teacher/admin/host keywords
        const isTeacher = email.includes('teacher') || 
                         email.includes('admin') || 
                         email.includes('gluckglobal.com') ||
                         name.includes('host') ||
                         name.includes('teacher');
        
        return !isTeacher;
      });
    }

    res.status(200).json({
      success: true,
      count: studentData.length,
      data: studentData,
      summary: {
        totalStudents: studentData.length,
        averageCameraOnTime: studentData.length > 0 ? Math.round(
          studentData.reduce((sum, p) => sum + (p.engagement?.cameraOnMinutes || 0), 0) / studentData.length
        ) : 0,
        averageMicOnTime: studentData.length > 0 ? Math.round(
          studentData.reduce((sum, p) => sum + (p.engagement?.micOnMinutes || 0), 0) / studentData.length
        ) : 0,
        averageCameraOnPercentage: studentData.length > 0 ? Math.round(
          studentData.reduce((sum, p) => sum + (p.engagement?.cameraOnPercentage || 0), 0) / studentData.length
        ) : 0
      }
    });

  } catch (error) {
    console.error('❌ Error fetching student engagement data:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch student engagement data'
    });
  }
});

/**
 * Get TEACHER/HOST engagement metrics only
 * GET /api/zoom/meeting/:meetingId/engagement/teacher
 */
router.get('/meeting/:meetingId/engagement/teacher', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.params;

    console.log('📊 Fetching TEACHER engagement data for meeting:', meetingId);

    // Get meeting from database to identify the teacher
    const meeting = await MeetingLink.findOne({ zoomMeetingId: meetingId })
      .populate('createdBy', 'name email');
    const engagementData = await zoomService.getParticipantEngagement(meetingId);
    
    let teacherData;
    
    if (meeting && meeting.hostEmail) {
      // Find by host email
      teacherData = engagementData.find(p => 
        p.email?.toLowerCase() === meeting.hostEmail.toLowerCase()
      );
    } else if (meeting && meeting.createdBy) {
      // Find by creator email
      teacherData = engagementData.find(p => 
        p.email?.toLowerCase() === meeting.createdBy.email.toLowerCase()
      );
    } else {
      // Fallback: Find hosts/co-hosts or teacher emails
      teacherData = engagementData.find(p => {
        const email = p.email?.toLowerCase() || '';
        const name = p.name?.toLowerCase() || '';
        
        return email.includes('teacher') || 
               email.includes('admin') || 
               email.includes('gluckglobal.com') ||
               name.includes('host') ||
               name.includes('teacher');
      });
    }

    if (!teacherData) {
      return res.status(404).json({
        success: false,
        message: 'Teacher/host data not found in meeting'
      });
    }

    res.status(200).json({
      success: true,
      data: teacherData,
      summary: {
        name: teacherData.name,
        email: teacherData.email,
        cameraOnTime: teacherData.engagement?.cameraOnMinutes || 0,
        cameraOnPercentage: teacherData.engagement?.cameraOnPercentage || 0,
        micOnTime: teacherData.engagement?.micOnMinutes || 0,
        micOnPercentage: teacherData.engagement?.micOnPercentage || 0,
        totalDuration: teacherData.durationMinutes || 0
      }
    });

  } catch (error) {
    console.error('❌ Error fetching teacher engagement data:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch teacher engagement data'
    });
  }
});

// ═══ EXTERNAL MEETING IMPORT ═══

/**
 * GET /api/zoom/available-hosts - Get Zoom hosts with busy status for a time slot
 */
router.get('/available-hosts', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { startTime, duration } = req.query;

    if (!startTime || !duration) {
      return res.status(400).json({ success: false, message: 'startTime and duration are required' });
    }

    const meetingStart = new Date(startTime);
    const meetingEnd = new Date(meetingStart.getTime() + Number(duration) * 60000);

    // Get all Zoom hosts from Zoom API
    const users = await zoomService.getZoomUsers();
    const hosts = users.map(u => ({ id: u.id, email: u.email, name: u.first_name + ' ' + u.last_name }));

    // Find meetings that overlap with the requested time
    const overlapping = await MeetingLink.find({
      status: { $ne: 'cancelled' },
      startTime: { $lt: meetingEnd },
      $expr: {
        $gt: [
          { $add: ['$startTime', { $multiply: ['$duration', 60000] }] },
          meetingStart
        ]
      }
    }).select('hostEmail startTime duration');

    const busyEmails = new Set(
      overlapping
        .filter(m => m.hostEmail)
        .map(m => m.hostEmail.toLowerCase())
    );

    const data = hosts.map(h => ({
      ...h,
      isBusy: busyEmails.has(h.email.toLowerCase())
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching available hosts:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch available hosts' });
  }
});

/**
 * GET /api/zoom/external/hosts - List all Zoom users on the master account
 */
router.get('/external/hosts', verifyToken, async (req, res) => {
  try {
    const users = await zoomService.getZoomUsers();
    res.json({ success: true, hosts: users.map(u => ({ id: u.id, email: u.email, name: u.first_name + ' ' + u.last_name })) });
  } catch (error) {
    console.error('Error fetching Zoom hosts:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch Zoom hosts' });
  }
});

/**
 * GET /api/zoom/external/meetings/:hostEmail - List past meetings for a host
 */
router.get('/external/meetings/:hostEmail', verifyToken, async (req, res) => {
  try {
    const { from, to } = req.query;
    const meetings = await zoomService.getUserPastMeetings(req.params.hostEmail, from, to);

    // Check which ones are already linked in our system
    const zoomIds = meetings.map(m => String(m.id));
    const linked = await MeetingLink.find({ zoomMeetingId: { $in: zoomIds } }).select('zoomMeetingId').lean();
    const linkedSet = new Set(linked.map(l => l.zoomMeetingId));

    const enriched = meetings.map(m => ({
      ...m,
      linkedInPortal: linkedSet.has(String(m.id))
    }));

    res.json({ success: true, meetings: enriched });
  } catch (error) {
    console.error('Error fetching past meetings:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch past meetings' });
  }
});

/**
 * POST /api/zoom/external/link - Link an external meeting to a batch and fetch attendance
 */
router.post('/external/link', verifyToken, async (req, res) => {
  try {
    const { zoomMeetingId, batch, plan, topic } = req.body;
    if (!zoomMeetingId || !batch) {
      return res.status(400).json({ success: false, message: 'zoomMeetingId and batch are required' });
    }

    // Check if already linked
    const existing = await MeetingLink.findOne({ zoomMeetingId: String(zoomMeetingId) });
    if (existing) {
      return res.status(400).json({ success: false, message: 'This meeting is already linked in the system' });
    }

    // Get meeting report from Zoom
    const report = await zoomService.getMeetingReport(String(zoomMeetingId));

    // Get students in the batch
    const studentFilter = { role: 'STUDENT', batch, studentStatus: { $in: ['ONGOING', 'UNCERTAIN'] } };
    if (plan) studentFilter.subscription = plan;
    const students = await User.find(studentFilter).select('name email').lean();

    const reportParts = report.participants || [];
    for (const p of reportParts) {
      delete p._matched;
      delete p._reserved;
      delete p._priority;
      delete p._matchedByStudent;
    }
    delete reportParts[Symbol.for('gluck.attendanceClaimMap')];
    delete reportParts[Symbol.for('gluck.attendanceTraceId')];
    const externalTraceId = new mongoose.Types.ObjectId();
    const externalClaimed = new Map();

    // Match participants to students
    const attendanceData = students.map((student) => {
      const attendee = { studentId: student._id, name: student.name, email: student.email };
      const matchResult = findBestParticipantMatch(attendee, report.participants, {
        meetingDurationSec: (report.meeting?.duration || 60) * 60,
        traceId: externalTraceId,
        claimedParticipants: externalClaimed,
        logContext: { studentId: student._id && student._id.toString() },
      });
      return buildAttendanceRowFromMatch(attendee, matchResult, {
        meetingDurationMinutes: report.meeting?.duration || 60,
        clickedJoin: false,
        traceId: externalTraceId,
      });
    });

    applyAttendanceStabilityPass(attendanceData, externalTraceId);

    // Save as a MeetingLink
    const meetingLink = new MeetingLink({
      batch,
      plan: plan || 'PLATINUM',
      platform: 'Zoom',
      link: '',
      topic: topic || report.meeting?.topic || 'External Meeting',
      startTime: report.meeting?.startTime ? new Date(report.meeting.startTime) : new Date(),
      duration: report.meeting?.duration || 60,
      zoomMeetingId: String(zoomMeetingId),
      zoomMeetingUuid: report.meeting?.uuid ? String(report.meeting.uuid) : undefined,
      hostEmail: report.meeting?.hostId || '',
      createdBy: req.user.id,
      attendees: students.map(s => ({ studentId: s._id, name: s.name, email: s.email, joinUrl: '' })),
      attendance: attendanceData,
      attendanceRecorded: true,
      attendanceRecordedAt: new Date(),
      status: 'ended'
    });

    await meetingLink.save();

    const attended = attendanceData.filter(a => a.attended).length;

    res.json({
      success: true,
      message: `Meeting linked. ${attended}/${students.length} students marked as attended.`,
      data: {
        meetingId: meetingLink._id,
        topic: meetingLink.topic,
        attended,
        total: students.length,
        attendance: attendanceData
      }
    });
  } catch (error) {
    console.error('Error linking external meeting:', error.message);
    res.status(500).json({ success: false, message: error.message || 'Failed to link meeting' });
  }
});

/**
 * GET /api/zoom/teachers - Get all teachers for admin meeting creation
 */
router.get('/teachers', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const teachers = await User.find({
      role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
      isActive: true
    }).select('name email assignedBatches medium').sort({ name: 1 });

    res.json({ success: true, data: teachers });
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch teachers' });
  }
});

module.exports = router;
