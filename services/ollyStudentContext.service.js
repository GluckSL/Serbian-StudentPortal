/**
 * Rich read-only student knowledge for Olly — batch, journey, recordings, classes.
 */

const User = require('../models/User');
const StudentPayment = require('../models/StudentPayment');
const SupportTicket = require('../models/SupportTicket');
const ClassRecording = require('../models/ClassRecording');
const ZoomRecording = require('../models/ZoomRecording');
const MeetingLink = require('../models/MeetingLink');
const RecordingAccessRequest = require('../models/RecordingAccessRequest');
const { getJourneyAccessForStudent } = require('../utils/studentJourneyAccess');
const { allStudentBatchStringsForContent, effectiveStudentBatch } = require('../utils/effectiveStudentBatch');
const { resolveSilverGoContentUnlock } = require('../utils/silverGoSequentialUnlock');
const { isSilverGoStudent, goBatchForStudent, SILVER_GO_STUDENT_SELECT } = require('../utils/goSilverTrack');
const {
  canUserAccessManualRecording,
  canUserAccessZoomRecording,
} = require('../utils/recordingContentAccess');

const JOURNEY_REASON_LABELS = {
  NO_BATCH: 'Batch not assigned — journey content and recordings are unavailable until a batch is assigned.',
  BATCH_NOT_ACTIVE: 'Batch is assigned but journey is not active for this batch yet.',
  GO_STUDENT: 'GO track student — journey content is enabled.',
  ACTIVE_BATCH: 'Batch is active — journey content is enabled.',
  OLD_BATCH_DG_BOT: 'Legacy batch — DG Bot only; live class recordings may be limited.',
  OLD_BATCH_LEARNING_DISABLED: 'Legacy batch — learning journey is disabled for this batch.',
  STUDENT_NOT_FOUND: 'Student record not found.',
};

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function batchRegex(batchKey) {
  const nk = String(batchKey || '').toLowerCase().trim().replace(/^batch\s+/, '').replace(/\s+/g, ' ');
  return new RegExp(`^${escapeRegExp(nk)}(\\s*[-:|]\\s|$)`, 'i');
}

function formatDate(d) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return String(d);
  }
}

function subscriptionStatus(user) {
  if (!user.subscriptionExpiry) return 'active (no expiry on file)';
  const exp = new Date(user.subscriptionExpiry);
  return exp >= new Date() ? `active until ${formatDate(exp)}` : `expired on ${formatDate(exp)}`;
}

function batchAssignmentSummary(user) {
  const direct = String(user.batch || '').trim();
  const effective = effectiveStudentBatch(user);
  const isGo = String(user.goStatus || '').toUpperCase() === 'GO';
  const goBatch = isGo ? goBatchForStudent(user) : '';

  if (!direct && !effective && !goBatch) {
    return { assigned: false, label: 'Not assigned', effectiveBatch: '', detail: 'No batch assigned yet.' };
  }

  const parts = [];
  if (direct) parts.push(`Portal batch: ${direct}`);
  if (goBatch && goBatch !== direct) parts.push(`GO journey track: ${goBatch}`);
  if (!direct && effective) parts.push(`Effective batch: ${effective}`);

  return {
    assigned: true,
    label: effective || direct || goBatch,
    effectiveBatch: effective || direct || goBatch,
    detail: parts.join('; ') || `Batch: ${effective}`,
  };
}

async function prepareStudentForAccessChecks(student, journeyAccess) {
  const enriched = { ...student, journeyAccessEnabled: !!journeyAccess?.enabled };
  if (isSilverGoStudent(enriched)) {
    const unlock = await resolveSilverGoContentUnlock(enriched);
    enriched._maxUnlockedContentDay = unlock.maxUnlockedContentDay;
    enriched.currentCourseDay = unlock.maxUnlockedContentDay;
  }
  return enriched;
}

async function countAccessibleRecordings(student) {
  const batchKeys = allStudentBatchStringsForContent(student);
  if (!batchKeys.length || student.journeyAccessEnabled === false) {
    return { manualCount: 0, zoomCount: 0, totalAccessible: 0, recentTitles: [] };
  }

  const studentLevel = String(student.level || 'A1').toUpperCase();
  const manualBatchFilter = { $or: batchKeys.map((bk) => ({ batches: { $regex: batchRegex(bk) } })) };

  const manualBase = await ClassRecording.find({
    active: true,
    isPublished: { $ne: false },
    level: studentLevel,
    ...manualBatchFilter,
  })
    .select('title batches courseDay level plan active isPublished')
    .limit(200)
    .lean();

  const manualAccessible = manualBase.filter((r) => canUserAccessManualRecording(r, student));

  const zoomBatchFilter = { $or: batchKeys.map((bk) => ({ accessBatches: { $regex: batchRegex(bk) } })) };
  const zoomRecordings = await ZoomRecording.find({
    status: 'ready',
    isPublished: { $ne: false },
    ...zoomBatchFilter,
  })
    .select('meetingLinkId accessBatches accessLevel accessPlan isPublished status')
    .limit(200)
    .lean();

  const meetingIds = zoomRecordings.map((z) => z.meetingLinkId).filter(Boolean);
  const meetings = meetingIds.length
    ? await MeetingLink.find({ _id: { $in: meetingIds } })
        .select('_id topic batch startTime courseDay status')
        .lean()
    : [];
  const meetingMap = Object.fromEntries(meetings.map((m) => [String(m._id), m]));

  const zoomAccessible = zoomRecordings.filter((z) => {
    const meeting = meetingMap[String(z.meetingLinkId)];
    return meeting && canUserAccessZoomRecording(z, meeting, student);
  });

  const recentTitles = [
    ...manualAccessible.slice(0, 3).map((r) => r.title || 'Manual recording'),
    ...zoomAccessible.slice(0, 3).map((z) => meetingMap[String(z.meetingLinkId)]?.topic || 'Class recording'),
  ].slice(0, 5);

  return {
    manualCount: manualAccessible.length,
    zoomCount: zoomAccessible.length,
    totalAccessible: manualAccessible.length + zoomAccessible.length,
    recentTitles,
  };
}

async function getUpcomingClassesSummary(student) {
  const batchKeys = allStudentBatchStringsForContent(student);
  if (!batchKeys.length) return { upcoming: 0, nextClass: null };

  const now = new Date();
  const batchOr = batchKeys.map((k) => ({ batch: { $regex: batchRegex(k) } }));
  const upcoming = await MeetingLink.find({
    $or: batchOr,
    status: { $ne: 'cancelled' },
    startTime: { $gte: now },
  })
    .select('topic startTime batch courseDay')
    .sort({ startTime: 1 })
    .limit(3)
    .lean();

  return {
    upcoming: upcoming.length,
    nextClass: upcoming[0]
      ? `"${upcoming[0].topic || 'Class'}" on ${formatDate(upcoming[0].startTime)} (Journey Day ${upcoming[0].courseDay ?? 'N/A'})`
      : null,
  };
}

async function buildStudentKnowledgeContext(userId) {
  if (!userId) return null;

  try {
    const [user, payment, tickets] = await Promise.all([
      User.findById(userId)
        .select(
          `${SILVER_GO_STUDENT_SELECT} name email regNo studentStatus subscriptionExpiry batchStartedOn ` +
          'teacherIncharge enrollmentDate languageExamStatus examScores servicesOpted lastLogin isActive blockedJourneyLevels'
        )
        .lean(),
      StudentPayment.findOne({ studentId: userId })
        .select('totalPackageAmount totalPaid totalInvoiced pendingPayment currency currentStatus serviceOpted payments notes')
        .lean(),
      SupportTicket.find({ userId })
        .select('ticketNumber subject status createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    if (!user) return null;

    const journeyAccess = await getJourneyAccessForStudent(user);
    const batchInfo = batchAssignmentSummary(user);
    const studentForAccess = await prepareStudentForAccessChecks(user, journeyAccess);
    const recordings = await countAccessibleRecordings(studentForAccess);
    const classes = await getUpcomingClassesSummary(user);

    const pendingRecordingRequests = await RecordingAccessRequest.countDocuments({
      studentId: userId,
      status: 'PENDING',
    });

    const firstName = String(user.name || '').trim().split(/\s+/)[0] || user.name;
    const lines = [];

    lines.push('=== Student Portal Profile (LIVE — answer using these facts, not guesses) ===');
    lines.push(`Name: ${user.name}`);
    lines.push(`First name (use in greeting): ${firstName}`);
    lines.push(`Registration No: ${user.regNo}`);
    lines.push(`Email: ${user.email}`);
    lines.push(`Account active: ${user.isActive !== false ? 'Yes' : 'No'}`);

    if (user.role === 'STUDENT') {
      lines.push(`Subscription: ${user.subscription || 'N/A'} (${subscriptionStatus(user)})`);
      lines.push(`Level: ${user.level || 'N/A'}`);
      lines.push(`Student status: ${user.studentStatus || 'N/A'}`);
      lines.push(`Medium: ${(user.medium || []).join(', ') || 'N/A'}`);
      lines.push(`Teacher-in-Charge: ${user.teacherIncharge || 'Not assigned'}`);
      lines.push(`Enrollment date: ${formatDate(user.enrollmentDate) || 'N/A'}`);

      lines.push('');
      lines.push('=== Batch & Class Start (definitive) ===');
      lines.push(`Batch assigned: ${batchInfo.assigned ? 'YES' : 'NO'}`);
      lines.push(`Batch details: ${batchInfo.detail}`);
      if (user.batchStartedOn) {
        lines.push(`Classes started on: ${formatDate(user.batchStartedOn)}`);
      } else {
        lines.push('Classes started on: Not yet recorded (batch may not have commenced)');
      }
      if (String(user.goStatus || '').toUpperCase() === 'GO') {
        lines.push(`GO student: Yes (${user.goLanguage || 'Tamil/Sinhala from medium'})`);
      }

      lines.push('');
      lines.push('=== Journey / My Course Access ===');
      lines.push(`Journey content enabled: ${journeyAccess.enabled ? 'YES' : 'NO'}`);
      lines.push(`Journey access reason: ${JOURNEY_REASON_LABELS[journeyAccess.reason] || journeyAccess.reason || 'N/A'}`);
      lines.push(`Current journey day: ${journeyAccess.courseDay ?? user.currentCourseDay ?? 1}`);
      lines.push(`Content unlock day: ${journeyAccess.contentUnlockDay ?? journeyAccess.courseDay ?? 1}`);
      if (journeyAccess.trialDayEnabled) lines.push('Trial day mode: enabled');

      lines.push('');
      lines.push('=== Class Recordings (My Course → My Class tab) ===');
      lines.push(`Accessible recordings right now: ${recordings.totalAccessible} (${recordings.manualCount} uploaded, ${recordings.zoomCount} from live classes)`);
      if (recordings.recentTitles.length) {
        lines.push(`Sample available recordings: ${recordings.recentTitles.join('; ')}`);
      }
      if (recordings.totalAccessible === 0) {
        if (!batchInfo.assigned) {
          lines.push('Why no recordings: Batch is not assigned — recordings appear after batch assignment and classes begin.');
        } else if (!journeyAccess.enabled) {
          lines.push(`Why no recordings: ${JOURNEY_REASON_LABELS[journeyAccess.reason] || 'Journey not active for this batch.'}`);
        } else if (!user.batchStartedOn) {
          lines.push('Why no recordings: Batch is assigned but classes have not started yet — recordings appear after live classes are held and processed.');
        } else {
          lines.push(`Why no recordings: No recordings uploaded yet for your unlocked journey days (currently day ${journeyAccess.contentUnlockDay ?? journeyAccess.courseDay ?? 1}). Check back after your next live class.`);
        }
      }
      if (pendingRecordingRequests > 0) {
        lines.push(`Pending recording access requests: ${pendingRecordingRequests} (student requested access to missed classes)`);
      }

      lines.push('');
      lines.push('=== Upcoming Classes ===');
      lines.push(`Upcoming scheduled classes: ${classes.upcoming}`);
      if (classes.nextClass) lines.push(`Next class: ${classes.nextClass}`);
      else if (batchInfo.assigned) lines.push('Next class: None scheduled in the system right now.');

      lines.push(`Exam status: ${user.languageExamStatus || 'N/A'}`);
      if (user.examScores && Object.values(user.examScores).some((v) => v != null)) {
        const s = user.examScores;
        lines.push(`Exam scores: Reading=${s.reading ?? '-'}, Listening=${s.listening ?? '-'}, Writing=${s.writing ?? '-'}, Speaking=${s.speaking ?? '-'}`);
      }
    }

    lines.push(`Last login: ${user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'N/A'}`);

    if (payment) {
      lines.push('');
      lines.push('=== Payment Summary ===');
      lines.push(`Currency: ${payment.currency}`);
      lines.push(`Total package: ${payment.totalPackageAmount}`);
      lines.push(`Total paid: ${payment.totalPaid}`);
      lines.push(`Pending: ${payment.pendingPayment}`);
      lines.push(`Payment status: ${payment.currentStatus || 'N/A'}`);
      lines.push(`Services opted: ${payment.serviceOpted || user.servicesOpted || 'N/A'}`);
    }

    if (tickets?.length) {
      lines.push('');
      lines.push('=== Recent Support Tickets ===');
      tickets.forEach((t) => {
        lines.push(`  ${t.ticketNumber}: "${t.subject}" — ${t.status} (${formatDate(t.createdAt)})`);
      });
    }

    return lines.join('\n');
  } catch (err) {
    console.error('[ollyStudentContext] build error:', err.message);
    return null;
  }
}

module.exports = {
  buildStudentKnowledgeContext,
  batchAssignmentSummary,
};
