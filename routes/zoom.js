// routes/zoom.js

const express = require('express');
const router = express.Router();
const zoomService = require('../services/zoomService');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');

/**
 * Enhanced participant matching algorithm
 * Matches registered students with Zoom participants using multiple strategies
 */
function findBestParticipantMatch(attendee, participants) {
  console.log(`🔍 Finding match for: ${attendee.name} (${attendee.email})`);
  
  if (!participants || participants.length === 0) {
    console.log('❌ No participants data available');
    return { match: null, confidence: 0, method: 'no_participants' };
  }

  console.log(`📊 Available participants: ${participants.length}`);
  participants.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name} (${p.email || 'no email'})`);
  });

  let bestMatch = null;
  let bestConfidence = 0;
  let bestMethod = 'no_match';

  for (const participant of participants) {
    // Skip if participant already matched (prevent double matching)
    if (participant._matched) continue;

    console.log(`🔍 Checking participant: ${participant.name} (${participant.email || 'no email'})`);

    // Strategy 1: Exact Email Match (Highest Priority - 100% confidence)
    if (participant.email && attendee.email && 
        participant.email.toLowerCase() === attendee.email.toLowerCase()) {
      console.log('✅ EXACT EMAIL MATCH found!');
      return { 
        match: { ...participant, _matched: true }, 
        confidence: 100, 
        method: 'email' 
      };
    }

    // Strategy 2: Exact Name Match (90% confidence)
    if (participant.name && attendee.name &&
        participant.name.toLowerCase().trim() === attendee.name.toLowerCase().trim()) {
      console.log('✅ EXACT NAME MATCH found!');
      if (90 > bestConfidence) {
        bestMatch = participant;
        bestConfidence = 90;
        bestMethod = 'exact_name';
      }
      continue;
    }

    // Strategy 3: Partial Name Match (60-80% confidence)
    if (participant.name && attendee.name) {
      const confidence = calculatePartialNameMatch(attendee.name, participant.name);
      console.log(`🔍 Partial name match confidence: ${confidence}%`);
      if (confidence > bestConfidence && confidence >= 60) {
        bestMatch = participant;
        bestConfidence = confidence;
        bestMethod = 'partial_name';
      }
    }

    // Strategy 4: Fuzzy Name Match (40-70% confidence)
    if (participant.name && attendee.name) {
      const similarity = calculateStringSimilarity(attendee.name, participant.name);
      const confidence = Math.round(similarity * 70);
      console.log(`🔍 Fuzzy name match confidence: ${confidence}%`);
      if (confidence > bestConfidence && confidence >= 40) {
        bestMatch = participant;
        bestConfidence = confidence;
        bestMethod = 'fuzzy_name';
      }
    }
  }

  // Mark the best match as used to prevent double matching
  if (bestMatch) {
    bestMatch._matched = true;
    console.log(`✅ Best match found: ${bestMatch.name} (${bestConfidence}% confidence, ${bestMethod})`);
  } else {
    console.log('❌ No match found');
  }

  return { 
    match: bestMatch, 
    confidence: bestConfidence, 
    method: bestMethod 
  };
}

/**
 * Calculate partial name matching confidence
 * Handles cases like "John Smith" vs "John" or "J. Smith"
 */
function calculatePartialNameMatch(registeredName, zoomName) {
  const registered = registeredName.toLowerCase().trim().split(/\s+/);
  const zoom = zoomName.toLowerCase().trim().split(/\s+/);
  
  let matchedParts = 0;
  let totalParts = registered.length;

  for (const regPart of registered) {
    for (const zoomPart of zoom) {
      // Exact part match
      if (regPart === zoomPart) {
        matchedParts++;
        break;
      }
      // Partial match (for initials like "J." matching "John")
      if (regPart.startsWith(zoomPart) || zoomPart.startsWith(regPart)) {
        if (Math.min(regPart.length, zoomPart.length) >= 2) {
          matchedParts += 0.8;
          break;
        }
      }
      // Initial match (like "J" matching "John")
      if ((regPart[0] === zoomPart[0]) && (regPart.length === 1 || zoomPart.length === 1)) {
        matchedParts += 0.5;
        break;
      }
    }
  }

  // Calculate confidence based on matched parts
  const baseConfidence = (matchedParts / totalParts) * 80;
  
  // Bonus for having same number of name parts
  const lengthBonus = registered.length === zoom.length ? 5 : 0;
  
  return Math.min(Math.round(baseConfidence + lengthBonus), 80);
}

/**
 * Calculate string similarity using Levenshtein distance
 * Returns similarity score between 0 and 1
 */
function calculateStringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 1;
  
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1;
  
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Create a Zoom meeting with selected students
 * POST /api/zoom/create-meeting
 */
router.post('/create-meeting', verifyToken, async (req, res) => {
  try {
    const {
      batch,
      plan,
      topic,
      startTime,
      duration,
      timezone,
      agenda,
      studentIds // Array of student IDs or names
    } = req.body;

    console.log('📝 Creating Zoom meeting for batch:', batch);
    console.log('👥 Selected students:', studentIds);

    // Validate required fields
    if (!batch || !plan || !topic || !startTime || !studentIds || studentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: batch, plan, topic, startTime, and studentIds are required'
      });
    }

    // Get teacher's email for alternative host
    const teacher = await User.findById(req.user.id).select('email name');
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    console.log('👨‍🏫 Teacher:', teacher.name, '(' + teacher.email + ')');

    const mediumDoc = await User.findOne({
      batch: batch,
      subscription: plan,
      role: 'STUDENT'
    }).select('medium');

    const medium = mediumDoc?.medium?.[0] || null;

    console.log('🌐 Medium for batch/plan:', medium?.medium || 'N/A');

    // Find students by IDs or names
    let students = [];
    
    if (studentIds[0] && typeof studentIds[0] === 'object' && studentIds[0]._id) {
      // If full student objects are passed
      students = studentIds;
    } else {
      // Find students by IDs
      students = await User.find({
        _id: { $in: studentIds },
        role: 'STUDENT'
      }).select('name email batch level subscription');
    }

    if (students.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No students found with the provided IDs'
      });
    }

    console.log(`✅ Found ${students.length} students`);

    // Prepare attendees for Zoom
    const attendees = students.map(student => ({
      email: student.email,
      name: student.name,
      firstName: student.name.split(' ')[0],
      lastName: student.name.split(' ').slice(1).join(' ') || ''
    }));

    // Create Zoom meeting
    const zoomResult = await zoomService.createMeeting({
      topic,
      startTime,
      duration: duration || 60,
      timezone: timezone || 'Asia/Colombo',
      agenda: agenda || `German Language Class - Batch ${batch}`,
      teacherEmail: teacher.email, // Add teacher as alternative host
      attendees,
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
        mute_upon_entry: true,
        waiting_room: false, // No waiting room for registered participants
        approval_type: 0, // Auto-approve registrants
        registration_type: 1 // Registration required for unique URLs
      }
    });

    if (!zoomResult.success) {
      throw new Error('Failed to create Zoom meeting');
    }

    const meeting = zoomResult.meeting;
    const registrants = zoomResult.registrants || [];

    console.log('✅ Zoom meeting created with registrants:', {
      meetingId: meeting.id,
      registrantCount: registrants.length,
      sampleRegistrant: registrants[0] ? {
        email: registrants[0].email,
        hasUniqueUrl: !!registrants[0].joinUrl
      } : null
    });

    // Create a map of email to unique join URL for easy lookup
    const registrantUrlMap = {};
    registrants.forEach(reg => {
      if (reg.email && reg.joinUrl) {
        registrantUrlMap[reg.email.toLowerCase()] = reg.joinUrl;
      }
    });

    // Save meeting to database with registrant URLs
    const meetingLink = new MeetingLink({
      batch,
      plan,
      platform: 'Zoom',
      link: meeting.joinUrl, // Generic meeting URL
      topic: meeting.topic,
      agenda: meeting.agenda,
      startTime: new Date(meeting.startTime),
      duration: meeting.duration,
      timezone: meeting.timezone,
      zoomMeetingId: meeting.id,
      zoomPassword: meeting.password,
      hostEmail: meeting.hostEmail,
      startUrl: meeting.startUrl,
      joinUrl: meeting.joinUrl, // Generic URL for fallback
      createdBy: req.user.id,
      attendees: students.map(student => ({
        studentId: student._id,
        name: student.name,
        email: student.email,
        // Store unique registrant URL for each student
        joinUrl: registrantUrlMap[student.email.toLowerCase()] || meeting.joinUrl,
        registrantId: registrants.find(r => r.email?.toLowerCase() === student.email.toLowerCase())?.registrantId
      })),
      status: 'scheduled'
    });

    await meetingLink.save();

    console.log('✅ Meeting saved to database');

    // ✅ SEND EMAIL INVITATIONS TO STUDENTS using your email system
    // Track email sending status
    const emailResults = {
      attempted: 0,
      successful: 0,
      failed: 0,
      errors: [],
      failedStudents: []
    };

    try {
      const transporter = require('../config/emailConfig');
      
      console.log(`📧 Sending meeting invitations to ${students.length} students...`);
      
      for (const student of students) {
        emailResults.attempted++;
        
        try {
          // Get unique registrant URL for this student
          const studentJoinUrl = registrantUrlMap[student.email.toLowerCase()] || meeting.joinUrl;
          
          console.log(`📧 Sending email to ${student.name} with URL: ${studentJoinUrl.substring(0, 50)}...`);
          
          const mailOptions = {
            from: process.env.EMAIL_USER,
            to: student.email,
            subject: '🎓 Zoom Meeting Invitation - Glück Global',
            html: `
              <div style="font-family: Arial, sans-serif; text-align:center; background:#f9f9f9; padding:20px;">
                <div style="max-width:600px; margin:auto; background:#fff; padding:20px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                  
                  <div style="background:#000e89; border-radius:8px; padding:20px;">
                    <h2 style="color:white; margin:0;">Glück Global - Meeting Invitation</h2>
                  </div>

                  <p style="margin-top:20px;">Hello <strong>${student.name}</strong>,</p>
                  
                  <p>You have been invited to join a Zoom meeting:</p>

                  <div style="background:#f5f5f5; padding:15px; border-radius:8px; margin:20px 0;">
                    <h3 style="color:#000e89; margin:0 0 10px 0;">${meeting.topic}</h3>
                    <p style="margin:5px 0;"><strong>📅 Date:</strong> ${new Date(meeting.startTime).toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric',
                      timeZone: 'Asia/Colombo'
                    })}</p>
                    <p style="margin:5px 0;"><strong>🕐 Time:</strong> ${new Date(meeting.startTime).toLocaleTimeString('en-US', { 
                      hour: '2-digit', 
                      minute: '2-digit',
                      timeZone: 'Asia/Colombo'
                    })}</p>
                    <p style="margin:5px 0;"><strong>⏱️ Duration:</strong> ${meeting.duration} minutes</p>
                    <p style="margin:5px 0;"><strong>👥 Batch:</strong> ${batch} - ${plan}</p>
                  </div>

                  ${agenda ? `<p style="color:#666; font-style:italic;">${agenda}</p>` : ''}

                  <div style="margin:30px 0;">
                    <a href="${studentJoinUrl}" target="_blank" 
                      style="display:inline-block; background-color:#000e89; color:#fff; 
                            text-decoration:none; padding:15px 30px; border-radius:6px; font-size:16px; font-weight:bold;">
                      🎥 Join Zoom Meeting
                    </a>
                  </div>

                  ${meeting.password ? `
                    <div style="background:#fff3cd; border:1px solid #ffc107; padding:10px; border-radius:6px; margin:20px 0;">
                      <p style="margin:0; color:#856404;">
                        <strong>🔒 Meeting Password:</strong> <code style="background:#fff; padding:5px 10px; border-radius:4px; font-size:16px;">${meeting.password}</code>
                      </p>
                    </div>
                  ` : ''}

                  <div style="background:#e7f3ff; padding:15px; border-radius:6px; margin:20px 0; text-align:left;">
                    <p style="margin:0 0 10px 0; font-weight:bold; color:#000e89;">📝 Meeting Details:</p>
                    <p style="margin:5px 0; font-size:14px;"><strong>Meeting ID:</strong> ${meeting.id}</p>
                    <p style="margin:5px 0; font-size:14px;"><strong>Your Personal Join URL:</strong> <a href="${studentJoinUrl}" style="color:#000e89; word-break:break-all;">${studentJoinUrl}</a></p>
                  </div>

                  <div style="background:#d4edda; border:1px solid #c3e6cb; padding:15px; border-radius:6px; margin:20px 0; text-align:left;">
                    <p style="margin:0 0 10px 0; font-weight:bold; color:#155724;">✅ Important - Personal Registration:</p>
                    <ul style="margin:0; padding-left:20px; text-align:left; font-size:14px; color:#155724;">
                      <li>This is your <strong>personal registration link</strong> - it's unique to you</li>
                      <li>Using this link helps us track your attendance accurately</li>
                      <li>Please don't share this link with other students</li>
                      <li>If you use the teacher's generic link, your attendance may not be recorded properly</li>
                    </ul>
                  </div>

                  <div style="background:#f8f9fa; padding:15px; border-radius:6px; margin:20px 0; text-align:left;">
                    <p style="margin:0 0 10px 0; font-weight:bold;">💡 Tips for joining:</p>
                    <ul style="margin:0; padding-left:20px; text-align:left; font-size:14px; color:#666;">
                      <li>Click the "Join Zoom Meeting" button above</li>
                      <li>You can join 10 minutes before the scheduled time</li>
                      <li>Make sure your camera and microphone are working</li>
                      <li>Join from a quiet place with good internet connection</li>
                      <li>Keep this email for future reference</li>
                    </ul>
                  </div>

                  <p style="margin-top:30px; color:#666; font-size:13px;">
                    If you have any questions, please contact your teacher.
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
          emailResults.successful++;
          console.log(`✅ Invitation email sent to ${student.name} (${student.email})`);
        } catch (emailError) {
          emailResults.failed++;
          emailResults.failedStudents.push({
            name: student.name,
            email: student.email,
            error: emailError.message
          });
          console.error(`❌ Failed to send email to ${student.email}:`, emailError.message);
          // Continue with other students even if one fails
        }
      }

      if (emailResults.successful > 0) {
        console.log(`✅ Meeting invitation emails sent to ${emailResults.successful}/${students.length} students`);
      }
      if (emailResults.failed > 0) {
        console.log(`⚠️ Failed to send ${emailResults.failed}/${students.length} emails`);
      }
    } catch (emailError) {
      console.error('⚠️ Error sending invitation emails (non-critical):', emailError.message);
      emailResults.errors.push(emailError.message);
      // Don't fail the meeting creation if email sending fails
    }

    // Save email status to database
    meetingLink.emailNotificationStatus = {
      attempted: emailResults.attempted,
      successful: emailResults.successful,
      failed: emailResults.failed,
      allSent: emailResults.failed === 0 && emailResults.successful === students.length,
      failedStudents: emailResults.failedStudents,
      lastAttempt: new Date()
    };
    await meetingLink.save();

    // ✅ AUTO-LINK TO TIMETABLE: Find or create timetable slot
    try {
      const TimeTable = require('../models/TimeTable');
      const meetingDate = new Date(meeting.startTime);
      
      // Get day of week (lowercase: monday, tuesday, etc.)
      const dayOfWeek = meetingDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        timeZone: 'Asia/Colombo' 
      }).toLowerCase();
      
      // Get time in HH:MM format
      const meetingTime = meetingDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Colombo'
      });

      // Calculate end time (meeting start + duration)
      const endDate = new Date(meetingDate.getTime() + meeting.duration * 60000);
      const endTime = endDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Colombo'
      });

      console.log('🔍 Looking for timetable slot:', {
        batch,
        plan,
        dayOfWeek,
        meetingTime,
        endTime,
        meetingDate: meetingDate.toISOString()
      });

      // Find timetable that covers this date
      let timetable = await TimeTable.findOne({
        batch: batch,
        plan: plan,
        weekStartDate: { $lte: meetingDate },
        weekEndDate: { $gte: meetingDate }
      });

      if (!timetable) {
        // ✅ NO TIMETABLE EXISTS - CREATE ONE AUTOMATICALLY
        console.log('📅 No timetable found - creating new timetable automatically...');
        
        // Calculate week start (Monday) and end (Sunday)
        const dayOfWeekNum = meetingDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const daysToMonday = dayOfWeekNum === 0 ? -6 : 1 - dayOfWeekNum;
        
        const weekStartDate = new Date(meetingDate);
        weekStartDate.setDate(meetingDate.getDate() + daysToMonday);
        weekStartDate.setHours(0, 0, 0, 0);
        
        const weekEndDate = new Date(weekStartDate);
        weekEndDate.setDate(weekStartDate.getDate() + 6);
        weekEndDate.setHours(23, 59, 59, 999);

        // Get teacher info for timetable
        const teacher = await User.findById(req.user.id);
        
        // Get student info to determine medium and plan
        const firstStudent = students[0];
        console.log('👨‍🎓 Using first student for medium/plan:', firstStudent.name, firstStudent.medium, firstStudent.subscription);
        
        timetable = new TimeTable({
          batch: batch,
          medium: medium,
          plan: plan,
          weekStartDate: weekStartDate,
          weekEndDate: weekEndDate,
          assignedTeacher: req.user.id,
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
        console.log('✅ New timetable created automatically:', timetable._id);
        console.log('   Week:', weekStartDate.toDateString(), 'to', weekEndDate.toDateString());
        console.log('   Slot:', dayOfWeek, meetingTime, '-', endTime);
        console.log('   Meeting linked automatically!');
      } else {
        // TIMETABLE EXISTS - FIND OR CREATE SLOT
        console.log('✅ Found existing timetable:', timetable._id);
        
        // Check if this day has time slots
        let daySlots = timetable[dayOfWeek];
        
        if (!daySlots || !Array.isArray(daySlots)) {
          daySlots = [];
          timetable[dayOfWeek] = daySlots;
        }

        // Find matching time slot
        const slotIndex = daySlots.findIndex(slot => {
          const slotTime = slot.start;
          return slotTime === meetingTime || 
                 Math.abs(new Date(`1970-01-01T${slotTime}`) - new Date(`1970-01-01T${meetingTime}`)) < 300000; // 5 min tolerance
        });

        if (slotIndex !== -1) {
          // SLOT EXISTS - UPDATE IT
          timetable[dayOfWeek][slotIndex].zoomMeetingId = meeting.id;
          timetable[dayOfWeek][slotIndex].zoomJoinUrl = meeting.joinUrl;
          timetable[dayOfWeek][slotIndex].zoomPassword = meeting.password;
          timetable[dayOfWeek][slotIndex].meetingLinked = true;
          
          await timetable.save();
          console.log('✅ Existing timetable slot updated with Zoom meeting info');
        } else {
          // NO MATCHING SLOT - CREATE NEW SLOT
          console.log('📅 No matching slot found - adding new slot to timetable...');
          
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
          console.log('✅ New slot added to timetable:', dayOfWeek, meetingTime, '-', endTime);
          console.log('   Meeting linked automatically!');
        }
      }
    } catch (linkError) {
      console.error('⚠️ Error linking to timetable (non-critical):', linkError.message);
      // Don't fail the meeting creation if timetable linking fails
    }

    res.status(201).json({
      success: true,
      message: `Zoom meeting created successfully with ${students.length} attendees`,
      data: {
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
      },
      emailStatus: {
        attempted: emailResults.attempted,
        successful: emailResults.successful,
        failed: emailResults.failed,
        allSent: emailResults.failed === 0 && emailResults.successful === students.length,
        partialFailure: emailResults.failed > 0 && emailResults.successful > 0,
        totalFailure: emailResults.failed === students.length,
        failedStudents: emailResults.failedStudents,
        errors: emailResults.errors
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
    const { status, batch } = req.query;
    
    // Get user to check role
    const user = await User.findById(req.user.id).select('role');
    
    const query = {};
    
    // If user is TEACHER or TEACHER_ADMIN, only show their meetings
    // If user is ADMIN, show all meetings
    if (user.role === 'TEACHER' || user.role === 'TEACHER_ADMIN') {
      query.createdBy = req.user.id;
    }
    // For ADMIN, no createdBy filter - show all meetings

    if (status) query.status = status;
    if (batch) query.batch = batch;
    if (req.query.plan) query.plan = req.query.plan;

    const meetings = await MeetingLink.find(query)
      .populate('createdBy', 'name email role')
      .populate('attendees.studentId', 'name email batch level subscription')
      .sort({ startTime: -1 });

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

    res.status(200).json({
      success: true,
      data: {
        ...meeting.toObject(),
        currentStatus,
        isOngoing: currentStatus === 'ongoing',
        hasEnded: currentStatus === 'ended',
        canJoin: now >= new Date(meetingStart.getTime() - 10 * 60000), // Can join 10 min before
        timeUntilStart: meetingStart - now,
        attendeesCount: meeting.attendees.length,
        attendedCount: meeting.attendance?.filter(a => a.attended).length || 0
      }
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
    .select('batch subscription');

    if(!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Find meetings for student's batch & plan
    const meetings = await MeetingLink.find({
      //'attendees.studentId': studentId,
      batch: student.batch,
      plan: student.subscription
    })
      .populate('createdBy', 'name email')
      //.populate('attendees.studentId', 'name email batch level subscription')
      .sort({ startTime: -1 });

    // Calculate meeting status for each meeting
    const now = new Date();
    const meetingsWithStatus = meetings.map(meeting => {
      const meetingStart = new Date(meeting.startTime);
      const meetingEnd = new Date(meetingStart.getTime() + meeting.duration * 60000);

      let currentStatus = meeting.status;
      let canJoin = false;
      let timeUntilStart = meetingStart - now;

      if (now >= meetingStart && now <= meetingEnd && meeting.status === 'scheduled') {
        currentStatus = 'ongoing';
        canJoin = true;
      } else if (now > meetingEnd) {
        currentStatus = 'ended';
      } else if (now >= new Date(meetingStart.getTime() - 10 * 60000)) {
        // Can join 10 minutes before
        canJoin = true;
      }

      // Find student's personal join URL
      const studentAttendee = meeting.attendees.find(
        a => a.studentId && a.studentId.toString() === studentId
      );

      // Use personal join URL if available, otherwise fall back to generic URL
      const personalJoinUrl = studentAttendee?.joinUrl || meeting.joinUrl;
      
      console.log(`🔗 Student ${studentId} join URL: ${personalJoinUrl ? 'Personal' : 'Generic'}`);

      return {
        _id: meeting._id,
        topic: meeting.topic,
        batch: meeting.batch,
        plan: meeting.plan,
        startTime: meeting.startTime,
        duration: meeting.duration,
        teacher: {
          name: meeting.createdBy?.name || 'Unknown',
          email: meeting.createdBy?.email || ''
        },
        joinUrl: personalJoinUrl, // Use personal URL
        password: meeting.zoomPassword,
        status: meeting.status,
        currentStatus: currentStatus,
        canJoin: canJoin,
        isOngoing: currentStatus === 'ongoing',
        hasEnded: currentStatus === 'ended',
        timeUntilStart: timeUntilStart,
        agenda: meeting.agenda,
        isPersonalUrl: !!studentAttendee?.joinUrl // Flag to indicate if using personal URL
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

      // Add to Zoom and capture unique registration URLs
      const registrantResults = await zoomService.addRegistrants(meeting.zoomMeetingId, attendees);

      // Create email-to-URL mapping
      const registrantUrlMap = {};
      registrantResults.forEach(reg => {
        if (reg.email && reg.joinUrl && reg.success) {
          registrantUrlMap[reg.email.toLowerCase()] = reg.joinUrl;
        }
      });

      // Add to database with unique URLs
      newStudents.forEach(student => {
        meeting.attendees.push({
          studentId: student._id,
          name: student.name,
          email: student.email,
          joinUrl: registrantUrlMap[student.email.toLowerCase()] || meeting.joinUrl,
          registrantId: registrantResults.find(r => r.email?.toLowerCase() === student.email.toLowerCase())?.registrantId
        });
      });

      // ✅ SEND EMAIL INVITATIONS TO NEW STUDENTS with unique URLs
      try {
        const transporter = require('../config/emailConfig');
        
        console.log(`📧 Sending meeting invitations to ${newStudents.length} new students...`);
        
        for (const student of newStudents) {
          try {
            // Get unique registrant URL for this student
            const studentJoinUrl = registrantUrlMap[student.email.toLowerCase()] || meeting.joinUrl;
            
            const mailOptions = {
              from: process.env.EMAIL_USER,
              to: student.email,
              subject: '🎓 Zoom Meeting Invitation - Glück Global',
              html: `
                <div style="font-family: Arial, sans-serif; text-align:center; background:#f9f9f9; padding:20px;">
                  <div style="max-width:600px; margin:auto; background:#fff; padding:20px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                    
                    <div style="background:#000e89; border-radius:8px; padding:20px;">
                      <h2 style="color:white; margin:0;">Glück Global - Meeting Invitation</h2>
                    </div>

                    <p style="margin-top:20px;">Hello <strong>${student.name}</strong>,</p>
                    
                    <p>You have been added to a Zoom meeting:</p>

                    <div style="background:#f5f5f5; padding:15px; border-radius:8px; margin:20px 0;">
                      <h3 style="color:#000e89; margin:0 0 10px 0;">${meeting.topic}</h3>
                      <p style="margin:5px 0;"><strong>📅 Date:</strong> ${new Date(meeting.startTime).toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        timeZone: 'Asia/Colombo'
                      })}</p>
                      <p style="margin:5px 0;"><strong>🕐 Time:</strong> ${new Date(meeting.startTime).toLocaleTimeString('en-US', { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        timeZone: 'Asia/Colombo'
                      })}</p>
                      <p style="margin:5px 0;"><strong>⏱️ Duration:</strong> ${meeting.duration} minutes</p>
                      <p style="margin:5px 0;"><strong>👥 Batch:</strong> ${meeting.batch}</p>
                    </div>

                    <div style="margin:30px 0;">
                      <a href="${studentJoinUrl}" target="_blank" 
                        style="display:inline-block; background-color:#000e89; color:#fff; 
                              text-decoration:none; padding:15px 30px; border-radius:6px; font-size:16px; font-weight:bold;">
                        🎥 Join Zoom Meeting
                      </a>
                    </div>

                    ${meeting.zoomPassword ? `
                      <div style="background:#fff3cd; border:1px solid #ffc107; padding:10px; border-radius:6px; margin:20px 0;">
                        <p style="margin:0; color:#856404;">
                          <strong>🔒 Meeting Password:</strong> <code style="background:#fff; padding:5px 10px; border-radius:4px; font-size:16px;">${meeting.zoomPassword}</code>
                        </p>
                      </div>
                    ` : ''}

                    <div style="background:#e7f3ff; padding:15px; border-radius:6px; margin:20px 0; text-align:left;">
                      <p style="margin:0 0 10px 0; font-weight:bold; color:#000e89;">📝 Meeting Details:</p>
                      <p style="margin:5px 0; font-size:14px;"><strong>Meeting ID:</strong> ${meeting.zoomMeetingId}</p>
                      <p style="margin:5px 0; font-size:14px;"><strong>Your Personal Join URL:</strong> <a href="${studentJoinUrl}" style="color:#000e89; word-break:break-all;">${studentJoinUrl}</a></p>
                    </div>

                    <div style="background:#d4edda; border:1px solid #c3e6cb; padding:15px; border-radius:6px; margin:20px 0; text-align:left;">
                      <p style="margin:0 0 10px 0; font-weight:bold; color:#155724;">✅ Important - Personal Registration:</p>
                      <ul style="margin:0; padding-left:20px; text-align:left; font-size:14px; color:#155724;">
                        <li>This is your <strong>personal registration link</strong> - it's unique to you</li>
                        <li>Using this link helps us track your attendance accurately</li>
                        <li>Please don't share this link with other students</li>
                      </ul>
                    </div>

                    <p style="margin-top:30px; color:#666; font-size:13px;">
                      If you have any questions, please contact your teacher.
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
            console.log(`✅ Invitation email sent to ${student.name} (${student.email})`);
          } catch (emailError) {
            console.error(`❌ Failed to send email to ${student.email}:`, emailError.message);
          }
        }

        console.log(`✅ Meeting invitation emails sent to ${newStudents.length} new students`);
      } catch (emailError) {
        console.error('⚠️ Error sending invitation emails (non-critical):', emailError.message);
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
      settings
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
    if ((user.role === 'TEACHER' || user.role === 'TEACHER_ADMIN') && meeting.createdBy.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit meetings you created'
      });
    }

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
    if (startTime) meeting.startTime = new Date(startTime);
    if (duration) meeting.duration = duration;
    if (timezone) meeting.timezone = timezone;
    if (agenda) meeting.agenda = agenda;

    await meeting.save();

    // ✅ UPDATE TIMETABLE if time changed
    if (startTime) {
      try {
        const TimeTable = require('../models/TimeTable');
        const newMeetingDate = new Date(startTime);
        
        // Get new day of week
        const newDayOfWeek = newMeetingDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          timeZone: 'Asia/Colombo' 
        }).toLowerCase();
        
        // Get new time
        const newMeetingTime = newMeetingDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Colombo'
        });

        // Calculate new end time
        const newEndDate = new Date(newMeetingDate.getTime() + (duration || meeting.duration) * 60000);
        const newEndTime = newEndDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Colombo'
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

    // ✅ SEND UPDATE NOTIFICATION EMAILS TO ATTENDEES
    if (topic || startTime || duration || agenda) {
      try {
        const transporter = require('../config/emailConfig');
        
        // Get attendees with populated student data
        const meetingWithStudents = await MeetingLink.findById(id)
          .populate('attendees.studentId', 'name email');
        
        const students = meetingWithStudents.attendees
          .filter(a => a.studentId)
          .map(a => ({
            name: a.studentId.name || a.name,
            email: a.studentId.email || a.email,
            joinUrl: a.joinUrl || meeting.joinUrl
          }));

        if (students.length > 0) {
          console.log(`📧 Sending meeting update notifications to ${students.length} students...`);
          
          for (const student of students) {
            try {
              const mailOptions = {
                from: process.env.EMAIL_USER,
                to: student.email,
                subject: '📝 Meeting Updated - Glück Global',
                html: `
                  <div style="font-family: Arial, sans-serif; text-align:center; background:#f9f9f9; padding:20px;">
                    <div style="max-width:600px; margin:auto; background:#fff; padding:20px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                      
                      <div style="background:#ffc107; border-radius:8px; padding:20px;">
                        <h2 style="color:#000; margin:0;">📝 Meeting Updated</h2>
                      </div>

                      <p style="margin-top:20px;">Hello <strong>${student.name}</strong>,</p>
                      
                      <p>The following Zoom meeting has been <strong>updated</strong>:</p>

                      <div style="background:#f5f5f5; padding:15px; border-radius:8px; margin:20px 0; border-left:4px solid #ffc107;">
                        <h3 style="color:#000e89; margin:0 0 10px 0;">${meeting.topic}</h3>
                        <p style="margin:5px 0;"><strong>📅 Date:</strong> ${new Date(meeting.startTime).toLocaleDateString('en-US', { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric',
                          timeZone: 'Asia/Colombo'
                        })}</p>
                        <p style="margin:5px 0;"><strong>🕐 Time:</strong> ${new Date(meeting.startTime).toLocaleTimeString('en-US', { 
                          hour: '2-digit', 
                          minute: '2-digit',
                          timeZone: 'Asia/Colombo'
                        })}</p>
                        <p style="margin:5px 0;"><strong>⏱️ Duration:</strong> ${meeting.duration} minutes</p>
                        <p style="margin:5px 0;"><strong>👥 Batch:</strong> ${meeting.batch}</p>
                      </div>

                      ${agenda ? `<p style="color:#666; font-style:italic; margin:20px 0;">${agenda}</p>` : ''}

                      <div style="margin:30px 0;">
                        <a href="${student.joinUrl}" target="_blank" 
                          style="display:inline-block; background-color:#000e89; color:#fff; 
                                text-decoration:none; padding:15px 30px; border-radius:6px; font-size:16px; font-weight:bold;">
                          🎥 Join Updated Meeting
                        </a>
                      </div>

                      <div style="background:#fff3cd; border:1px solid #ffc107; padding:15px; border-radius:6px; margin:20px 0;">
                        <p style="margin:0; color:#856404;">
                          <strong>📢 Important:</strong> Please note the updated meeting details above. 
                          Make sure to join at the new time if it has changed.
                        </p>
                      </div>

                      <p style="margin-top:30px; color:#666; font-size:13px;">
                        If you have any questions about the changes, please contact your teacher.
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
              console.log(`✅ Update notification sent to ${student.name} (${student.email})`);
            } catch (emailError) {
              console.error(`❌ Failed to send update notification to ${student.email}:`, emailError.message);
            }
          }

          console.log(`✅ Meeting update notifications sent to ${students.length} students`);
        }
      } catch (emailError) {
        console.error('⚠️ Error sending update notifications (non-critical):', emailError.message);
      }
    }

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
        timeZone: 'Asia/Colombo' 
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
                        timeZone: 'Asia/Colombo'
                      })}</p>
                      <p style="margin:5px 0;"><strong>🕐 Time:</strong> ${new Date(meeting.startTime).toLocaleTimeString('en-US', { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        timeZone: 'Asia/Colombo'
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

    const attendanceData = meeting.attendees.map(attendee => {
      const matchResult = findBestParticipantMatch(attendee, zoomReport.participants);
      
      console.log(`🎯 Matching ${attendee.name}:`, {
        confidence: matchResult.confidence,
        method: matchResult.method,
        matched: !!matchResult.match
      });
      
      return {
        studentId: attendee.studentId,
        name: attendee.name,
        email: attendee.email,
        attended: matchResult.match ? true : false,
        confidence: matchResult.confidence,
        matchMethod: matchResult.method,
        zoomName: matchResult.match?.name || null,
        zoomEmail: matchResult.match?.email || null,
        joinTime: matchResult.match?.joinTime || null,
        leaveTime: matchResult.match?.leaveTime || null,
        duration: matchResult.match?.duration || 0,
        durationMinutes: matchResult.match?.durationMinutes || 0,
        status: matchResult.match ? 'attended' : 'absent',
        needsReview: matchResult.confidence < 80 && matchResult.confidence > 0
      };
    });

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

    // Get meeting from database to identify registered students
    const meeting = await MeetingLink.findOne({ zoomMeetingId: meetingId });
    
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

    const engagementData = await zoomService.getParticipantEngagement(meetingId);

    // Get meeting from database to identify the teacher
    const meeting = await MeetingLink.findOne({ zoomMeetingId: meetingId })
      .populate('createdBy', 'name email');
    
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

module.exports = router;
