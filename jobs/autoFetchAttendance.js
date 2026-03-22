/**
 * Auto-fetch Zoom attendance 15 minutes after meeting ends.
 * Runs every 5 minutes via node-cron.
 */
const cron = require('node-cron');
const MeetingLink = require('../models/MeetingLink');
const zoomService = require('../services/zoomService');

// Full matching algorithm (same as routes/zoom.js)
function levenshteinDistance(str1, str2) {
  const matrix = [];
  for (let i = 0; i <= str2.length; i++) matrix[i] = [i];
  for (let j = 0; j <= str1.length; j++) matrix[0][j] = j;
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

function calculatePartialNameMatch(registeredName, zoomName) {
  const registered = registeredName.toLowerCase().trim().split(/\s+/);
  const zoom = zoomName.toLowerCase().trim().split(/\s+/);
  let matchedParts = 0;
  const totalParts = registered.length;

  for (const regPart of registered) {
    for (const zoomPart of zoom) {
      if (regPart === zoomPart) { matchedParts++; break; }
      if (regPart.startsWith(zoomPart) || zoomPart.startsWith(regPart)) {
        if (Math.min(regPart.length, zoomPart.length) >= 2) { matchedParts += 0.8; break; }
      }
      if ((regPart[0] === zoomPart[0]) && (regPart.length === 1 || zoomPart.length === 1)) {
        matchedParts += 0.5; break;
      }
    }
  }

  const baseConfidence = (matchedParts / totalParts) * 80;
  const lengthBonus = registered.length === zoom.length ? 5 : 0;
  return Math.min(Math.round(baseConfidence + lengthBonus), 80);
}

function findBestParticipantMatch(attendee, participants) {
  if (!participants || participants.length === 0) {
    return { match: null, confidence: 0, method: 'no_match' };
  }

  let bestMatch = null;
  let bestConfidence = 0;
  let bestMethod = 'no_match';

  for (const participant of participants) {
    if (participant._matched) continue;

    // Strategy 1: Exact email match (100%)
    if (participant.email && attendee.email &&
        participant.email.toLowerCase() === attendee.email.toLowerCase()) {
      return { match: { ...participant, _matched: true }, confidence: 100, method: 'email' };
    }

    // Strategy 2: Exact name match (90%)
    if (participant.name && attendee.name &&
        participant.name.toLowerCase().trim() === attendee.name.toLowerCase().trim()) {
      if (90 > bestConfidence) {
        bestMatch = participant; bestConfidence = 90; bestMethod = 'exact_name';
      }
      continue;
    }

    // Strategy 3: Partial name match (60-80%)
    if (participant.name && attendee.name) {
      const confidence = calculatePartialNameMatch(attendee.name, participant.name);
      if (confidence > bestConfidence && confidence >= 60) {
        bestMatch = participant; bestConfidence = confidence; bestMethod = 'partial_name';
      }
    }

    // Strategy 4: Fuzzy name match (40-70%)
    if (participant.name && attendee.name) {
      const similarity = calculateStringSimilarity(attendee.name, participant.name);
      const confidence = Math.round(similarity * 70);
      if (confidence > bestConfidence && confidence >= 40) {
        bestMatch = participant; bestConfidence = confidence; bestMethod = 'fuzzy_name';
      }
    }
  }

  if (bestMatch) bestMatch._matched = true;
  return { match: bestMatch, confidence: bestConfidence, method: bestMethod };
}

async function fetchAttendanceForMeeting(meeting) {
  try {
    const zoomReport = await zoomService.getMeetingReport(meeting.zoomMeetingId);

    const attendanceData = meeting.attendees.map(attendee => {
      const matchResult = findBestParticipantMatch(attendee, zoomReport.participants);
      return {
        studentId: attendee.studentId,
        name: attendee.name,
        email: attendee.email,
        attended: !!matchResult.match,
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

    meeting.attendance = attendanceData;
    meeting.attendanceRecorded = true;
    meeting.attendanceRecordedAt = new Date();
    await meeting.save();

    const attended = attendanceData.filter(a => a.attended).length;
    console.log(`  ✅ ${meeting.topic} — ${attended}/${attendanceData.length} attended`);
    return true;
  } catch (err) {
    // Track retry attempts — stop after 3 failures
    const retries = (meeting.attendanceRetries || 0) + 1;
    meeting.attendanceRetries = retries;

    if (retries >= 3) {
      meeting.attendanceRecorded = true; // Mark as done so we stop retrying
      meeting.attendanceError = err.message;
      console.error(`  ❌ ${meeting.topic} — Giving up after ${retries} attempts: ${err.message}`);
    } else {
      console.error(`  ❌ ${meeting.topic} — Attempt ${retries}/3 failed: ${err.message}`);
    }

    await meeting.save();
    return false;
  }
}

async function autoFetchAttendance() {
  const now = new Date();
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);

  // Find meetings that:
  // 1. Have a startTime set
  // 2. Their end time (startTime + duration) is before 15 min ago
  // 3. Attendance not yet recorded
  // 4. Have attendees
  const meetings = await MeetingLink.find({
    startTime: { $exists: true, $ne: null },
    attendanceRecorded: { $ne: true },
    'attendees.0': { $exists: true }
  }).lean();

  // Filter in JS: endTime <= fifteenMinAgo
  const eligible = meetings.filter(m => {
    const endTime = new Date(m.startTime.getTime() + (m.duration || 60) * 60000);
    return endTime <= fifteenMinAgo;
  });

  if (eligible.length === 0) return;

  console.log(`\n📋 [Auto-Attendance] Found ${eligible.length} meeting(s) to process...`);

  for (const meetingData of eligible) {
    // Re-fetch as a Mongoose document so we can save
    const meeting = await MeetingLink.findById(meetingData._id);
    if (!meeting || meeting.attendanceRecorded) continue;
    await fetchAttendanceForMeeting(meeting);
  }

  console.log('📋 [Auto-Attendance] Done.\n');
}

function scheduleAutoFetchAttendance() {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    autoFetchAttendance().catch(err => {
      console.error('❌ [Auto-Attendance] Job error:', err.message);
    });
  });
  console.log('⏰ Auto-attendance fetch scheduled (every 5 min, 15 min after meeting end)');
}

module.exports = { scheduleAutoFetchAttendance };
