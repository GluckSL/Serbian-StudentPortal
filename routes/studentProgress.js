// routes/studentProgress.js

const express = require('express');
const router = express.Router();
const StudentProgress = require('../models/StudentProgress');
const LearningModule = require('../models/LearningModule');
const AiTutorSession = require('../models/AiTutorSession');
const mongoose = require('mongoose');
const { verifyToken, checkRole } = require('../middleware/auth');
const { EXCLUDE_TEST } = require('../utils/analyticsFilters');
const { computeAdminProgressMetrics } = require('../utils/studentProgressMetrics');
const DocumentRequirement = require('../models/DocumentRequirement');
const StudentDocument = require('../models/StudentDocument');
const DigitalExercise = require('../models/DigitalExercise');
const DGModule = require('../models/DGModule');
const DGSession = require('../models/DGSession');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const MeetingLink = require('../models/MeetingLink');
const BatchConfig = require('../models/BatchConfig');
const { getJourneyAccessForStudent } = require('../utils/studentJourneyAccess');
const { allStudentBatchStringsForContent } = require('../utils/effectiveStudentBatch');
const { BATCH_TYPE_NEW, normalizeBatchType } = require('../utils/batchType');
const {
  normalizeBlockedJourneyLevels,
  levelForJourneyDay,
  isCourseDayAdminBlocked,
  isLevelAdminBlocked,
  isContentBlockedForStudent,
  levelMetaForAdmin,
  filterOutBlockedLevels,
  appendNotBlockedToAndClauses,
  countExerciseAttemptsForStudent
} = require('../utils/journeyContentBlock');
const ClassRecording = require('../models/ClassRecording');
const User = require('../models/User');
const SessionRecord = require('../models/SessionRecord');
const { resolveJourneyPayments } = require('../modules/payments-v2/backend/utils/journeyPaymentsHelper');

const escapeRegexEmail = (str) => String(str || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

async function buildLegacyJourneyPayments(studentId, email, { includeTotalInvoiced = false } = {}) {
  const StudentPayment = require('../models/StudentPayment');
  const Invoice = require('../models/Invoice');
  const normalizedEmail = String(email || '').toLowerCase();
  const sp = await StudentPayment.findOne({
    $or: [{ studentId }, { email: normalizedEmail }],
  }).populate('payments.recordedBy', 'name').lean();
  if (sp) {
    const paidInvoices = await Invoice.find({
      customer_email: { $regex: new RegExp('^' + escapeRegexEmail(normalizedEmail) + '$', 'i') },
      payment_status: 'paid',
    }).lean();
    const invoicePaidTotal = paidInvoices.reduce((sum, inv) => sum + (inv.total_payable || 0), 0);
    const livePaid = (sp.totalPaid || 0) + invoicePaidTotal;
    const liveBalance = (sp.totalPackageAmount || 0) - livePaid;
    const base = {
      source: 'ledger',
      currency: sp.currency || 'LKR',
      totalPackageAmount: sp.totalPackageAmount || 0,
      totalAmount: sp.totalPackageAmount || 0,
      paidAmount: livePaid,
      pendingAmount: liveBalance > 0 ? liveBalance : 0,
      payments: (sp.payments || []).map((p) => ({
        amount: p.amount,
        date: p.date,
        method: p.method || '',
        note: p.note || '',
        recordedBy: p.recordedBy?.name || '',
      })),
      invoices: [],
    };
    if (includeTotalInvoiced) base.totalInvoiced = sp.totalInvoiced || 0;
    return base;
  }
  const invoices = await Invoice.find({ customer_email: email }).sort({ created_at: 1 }).lean();
  const totalAmount = invoices.reduce((sum, inv) => sum + (inv.total_payable || 0), 0);
  const paidAmount = invoices
    .filter((i) => i.payment_status === 'paid')
    .reduce((sum, inv) => sum + (inv.total_payable || 0), 0);
  const base = {
    source: 'invoices',
    currency: 'LKR',
    totalPackageAmount: totalAmount,
    totalAmount,
    paidAmount,
    pendingAmount: totalAmount - paidAmount,
    payments: [],
    invoices: invoices.map((inv) => ({
      invoiceNumber: inv.invoice_number,
      description: inv.items?.map((i) => i.description).join(', ') || '',
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date,
      subtotal: inv.subtotal || 0,
      tax: inv.total_tax || 0,
      totalPayable: inv.total_payable || 0,
      paymentStatus: inv.payment_status || 'unpaid',
      paymentDate: inv.payment_date || '',
    })),
  };
  if (includeTotalInvoiced) base.totalInvoiced = totalAmount;
  return base;
}
const StudentPayment = require('../models/StudentPayment');
const VisaTracking = require('../models/VisaTracking');

function documentRequirementAppliesToService(requirement, service = '') {
  const scopedServices = [
    ...(Array.isArray(requirement.applicableServices) ? requirement.applicableServices : []),
    ...(Array.isArray(requirement.programKeys) ? requirement.programKeys : [])
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  if (scopedServices.length === 0) return true;

  const trimmedService = String(service || '').trim();
  if (!trimmedService) return false;

  const normalized = trimmedService.replace(/[\s\-]+/g, '[\\s\\-]*');
  const serviceRegex = new RegExp('^' + normalized + '$', 'i');
  return scopedServices.some((s) => serviceRegex.test(String(s).trim()));
}

// Helper: build documents list cross-referencing requirements with uploads
async function buildDocumentsList(studentId, servicesOpted) {
  const uploadedDocs = await StudentDocument.find({ studentId }).lean();
  const studentService = servicesOpted || '';
  let docRequirements = [];
  if (studentService && studentService !== 'German Language Only') {
    const allRequirements = await DocumentRequirement.find({ active: true }).sort({ order: 1 }).lean();
    docRequirements = allRequirements.map((r) => {
      const applies = documentRequirementAppliesToService(r, studentService);
      const baseRequired = typeof r.isRequired === 'boolean' ? r.isRequired : !!r.required;
      return { ...r, required: applies && baseRequired };
    });
  }
  const documents = docRequirements.map(r => {
    const uploaded = uploadedDocs.find(d => d.documentType === r.type);
    let status = 'not_uploaded';
    if (uploaded) status = uploaded.status === 'VERIFIED' ? 'verified' : uploaded.status === 'REJECTED' ? 'rejected' : 'pending';
    return { name: r.label || r.type, type: r.type, category: r.category, required: r.required, status, verified: status === 'verified', uploadedAt: uploaded?.uploadedAt || null };
  });
  uploadedDocs.forEach(d => {
    if (!docRequirements.find(r => r.type === d.documentType)) {
      documents.push({ name: d.documentName || d.documentType, type: d.documentType, category: 'OTHER', required: false, status: d.status === 'VERIFIED' ? 'verified' : d.status === 'REJECTED' ? 'rejected' : 'pending', verified: d.status === 'VERIFIED', uploadedAt: d.uploadedAt });
    }
  });
  const summary = { total: documents.length, verified: documents.filter(d => d.status === 'verified').length, pending: documents.filter(d => d.status === 'pending').length, rejected: documents.filter(d => d.status === 'rejected').length, notUploaded: documents.filter(d => d.status === 'not_uploaded').length };
  return { documents, docsSummary: summary, uploadedDocs };
}

// GET /api/student-progress - Get student's progress across all modules
// ✅ Allow both STUDENT and TEACHER (for testing modules)
router.get('/', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const studentId = req.user.id;
    const { status, level, category } = req.query;
    
    // Build aggregation pipeline
    const pipeline = [
      { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
      {
        $lookup: {
          from: 'learningmodules',
          localField: 'moduleId',
          foreignField: '_id',
          as: 'module'
        }
      },
      { $unwind: '$module' },
      { $match: { 'module.isActive': true } }
    ];
    
    // Add filters
    if (status) pipeline.push({ $match: { status } });
    if (level) pipeline.push({ $match: { 'module.level': level } });
    if (category) pipeline.push({ $match: { 'module.category': category } });
    
    // Sort by last accessed
    pipeline.push({ $sort: { lastAccessedAt: -1 } });
    
    let progress = await StudentProgress.aggregate(pipeline);

    if (req.user.role === 'STUDENT') {
      const User = require('../models/User');
      const studentDoc = await User.findById(studentId).select('blockedJourneyLevels').lean();
      progress = progress.filter((p) => {
        const mod = p.module || {};
        return !isContentBlockedForStudent(studentDoc, {
          courseDay: mod.courseDay,
          level: mod.level
        });
      });
    }

    // Calculate overall statistics
    const stats = {
      totalModules: progress.length,
      completedModules: progress.filter(p => p.status === 'completed').length,
      inProgressModules: progress.filter(p => p.status === 'in-progress').length,
      totalTimeSpent: progress.reduce((sum, p) => sum + (p.timeSpent || 0), 0),
      averageScore: progress.length > 0 
        ? Math.round(progress.reduce((sum, p) => sum + p.progressPercentage, 0) / progress.length)
        : 0,
      totalSessions: progress.reduce((sum, p) => sum + (p.sessionsCount || 0), 0)
    };
    
    res.json({ progress, stats });
  } catch (error) {
    console.error('Error fetching student progress:', error);
    res.status(500).json({ message: 'Error fetching progress data' });
  }
});

// GET /api/student-progress/level-progression - Get student's level progression
router.get('/level-progression', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const User = require('../models/User');
    const studentId = req.user.id;
    
    const student = await User.findById(studentId).select('level languageLevelOpted courseStartDates courseCompletionDates').lean();
    
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    
    const allLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const currentLevelIndex = allLevels.indexOf(student.level);
    
    // Determine which levels to show based on languageLevelOpted
    let displayLevels;
    const opted = (student.languageLevelOpted || '').trim();
    
    if (!opted) {
      // Default: A1 to B2
      displayLevels = ['A1', 'A2', 'B1', 'B2'];
    } else if (opted.includes('-')) {
      // Range like "A1-B2", "A2-B2", "A1-A2"
      const [startLevel, endLevel] = opted.split('-');
      const startIdx = allLevels.indexOf(startLevel);
      const endIdx = allLevels.indexOf(endLevel);
      if (startIdx >= 0 && endIdx >= 0 && endIdx >= startIdx) {
        displayLevels = allLevels.slice(startIdx, endIdx + 1);
      } else {
        displayLevels = ['A1', 'A2', 'B1', 'B2'];
      }
    } else {
      // Single level like "A1" or "B2"
      const optedIdx = allLevels.indexOf(opted);
      if (optedIdx >= 0) {
        // If current level is higher than opted level, show up to current level
        if (currentLevelIndex > optedIdx) {
          displayLevels = allLevels.slice(0, currentLevelIndex + 1);
        } else {
          // Show from A1 to opted level
          displayLevels = allLevels.slice(0, optedIdx + 1);
        }
      } else {
        displayLevels = ['A1', 'A2', 'B1', 'B2'];
      }
    }
    
    // Ensure current level is always included
    if (!displayLevels.includes(student.level)) {
      const currentIdx = allLevels.indexOf(student.level);
      if (currentIdx >= 0) {
        // Extend display levels to include current level
        const lastDisplayIdx = allLevels.indexOf(displayLevels[displayLevels.length - 1]);
        if (currentIdx > lastDisplayIdx) {
          displayLevels = allLevels.slice(allLevels.indexOf(displayLevels[0]), currentIdx + 1);
        }
      }
    }
    
    // Determine target level (last level in the display range)
    const targetLevel = displayLevels[displayLevels.length - 1];
    
    const levelProgression = displayLevels.map((level, index) => {
      const startDateKey = `${level}StartDate`;
      const completionDateKey = `${level}CompletionDate`;
      
      const startDate = student.courseStartDates?.[startDateKey];
      const completedDate = student.courseCompletionDates?.[completionDateKey];
      const levelIndex = allLevels.indexOf(level);
      
      let status = 'not-started';
      let duration = null;
      
      if (completedDate) {
        status = 'completed';
        if (startDate) {
          const diffTime = Math.abs(new Date(completedDate).getTime() - new Date(startDate).getTime());
          duration = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30));
        }
      } else if (startDate) {
        status = 'in-progress';
      } else if (levelIndex < currentLevelIndex) {
        status = 'completed';
      } else if (levelIndex === currentLevelIndex) {
        status = 'in-progress';
      }
      
      return {
        level,
        status,
        startDate,
        completedDate,
        duration
      };
    });
    
    res.json({
      currentLevel: student.level,
      targetLevel,
      levelProgression
    });
  } catch (error) {
    console.error('Error fetching level progression:', error);
    res.status(500).json({ message: 'Error fetching level progression' });
  }
});

// GET /api/student-progress/journey - Full student journey data for progress page
router.get('/journey', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  // blockedJourneyLevels: admin-hidden CEFR segments (see utils/journeyContentBlock.js)
  try {
    const User = require('../models/User');
    const SessionRecord = require('../models/SessionRecord');
    const StudentDocument = require('../models/StudentDocument');
    const DocumentRequirement = require('../models/DocumentRequirement');
    const Invoice = require('../models/Invoice');
    const StudentPayment = require('../models/StudentPayment');
    const VisaTracking = require('../models/VisaTracking');
    const studentId = req.user.id;

    let student = await User.findById(studentId).select('-password').populate('assignedTeacher', 'name').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    if (student.role === 'STUDENT') {
      try {
        const {
          recomputePendingForStudent,
          checkAndInstantlyAdvanceSilverGoStudent
        } = require('../services/journeyDayAdvance.service');
        const { reconcileSilverGoCourseDay } = require('../utils/silverGoSequentialUnlock');
        const { ensureStudentLevelMatchesJourneyDay } = require('../services/journeyLevelSync.service');
        await reconcileSilverGoCourseDay(studentId);
        await recomputePendingForStudent(studentId);
        await checkAndInstantlyAdvanceSilverGoStudent(studentId);
        await ensureStudentLevelMatchesJourneyDay(studentId);
        student = await User.findById(studentId).select('-password').populate('assignedTeacher', 'name').lean();
        if (!student) return res.status(404).json({ message: 'Student not found' });
      } catch (e) {
        console.warn('recomputePendingForStudent:', e.message);
      }
    }
    const journeyAccess = student.role === 'STUDENT'
      ? await getJourneyAccessForStudent({ ...student, role: 'STUDENT' })
      : { enabled: true, learningEnabled: true, batchType: BATCH_TYPE_NEW };

    // Level progression
    const allLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const currentLevelIndex = allLevels.indexOf(student.level);
    const opted = (student.languageLevelOpted || '').trim();
    let displayLevels;
    if (!opted) {
      displayLevels = ['A1', 'A2', 'B1', 'B2'];
    } else if (opted.includes('-')) {
      const [s, e] = opted.split('-');
      const si = allLevels.indexOf(s), ei = allLevels.indexOf(e);
      displayLevels = (si >= 0 && ei >= 0 && ei >= si) ? allLevels.slice(si, ei + 1) : ['A1', 'A2', 'B1', 'B2'];
    } else {
      const oi = allLevels.indexOf(opted);
      displayLevels = oi >= 0 ? allLevels.slice(0, Math.max(oi, currentLevelIndex) + 1) : ['A1', 'A2', 'B1', 'B2'];
    }
    if (!displayLevels.includes(student.level)) {
      displayLevels = allLevels.slice(allLevels.indexOf(displayLevels[0]), currentLevelIndex + 1);
    }
    displayLevels = filterOutBlockedLevels(displayLevels, student.blockedJourneyLevels);

    const levelProgression = displayLevels.map(level => {
      const startDate = student.courseStartDates?.[level + 'StartDate'];
      const completedDate = student.courseCompletionDates?.[level + 'CompletionDate'];
      const li = allLevels.indexOf(level);
      let status = 'not-started';
      if (completedDate) status = 'completed';
      else if (startDate || li < currentLevelIndex) status = li === currentLevelIndex ? 'in-progress' : 'completed';
      else if (li === currentLevelIndex) status = 'in-progress';
      return { level, status, startDate, completedDate };
    });

    // Module progress per level
    const moduleProgress = await StudentProgress.aggregate([
      { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
      { $lookup: { from: 'learningmodules', localField: 'moduleId', foreignField: '_id', as: 'module' } },
      { $unwind: '$module' },
      { $group: { _id: '$module.level', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, totalTime: { $sum: '$timeSpent' } } }
    ]);
    const lessonsByLevel = {};
    let totalStudyMinutes = 0;
    moduleProgress.forEach((mp) => {
      if (isLevelAdminBlocked(student.blockedJourneyLevels, mp._id)) return;
      lessonsByLevel[mp._id] = { total: mp.total, completed: mp.completed };
      totalStudyMinutes += mp.totalTime || 0;
    });

    // AI Bot usage this week
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const botSessions = await AiTutorSession.find({ studentId: new mongoose.Types.ObjectId(studentId), startTime: { $gte: weekStart } }).select('totalDuration startTime').lean();
    let botWeekMinutes = 0, botTodayMinutes = 0;
    botSessions.forEach(s => { const dur = s.totalDuration || 0; botWeekMinutes += dur; if (s.startTime >= todayStart) botTodayMinutes += dur; });

    // Attendance (exclude admin-blocked levels / journey days)
    const sessionRecordsRaw = await SessionRecord.find({ studentId: new mongoose.Types.ObjectId(studentId) })
      .select('sessionState startTime moduleLevel moduleId')
      .populate('moduleId', 'level courseDay')
      .sort({ startTime: -1 })
      .lean();
    const sessionRecords = sessionRecordsRaw.filter(
      (s) =>
        !isContentBlockedForStudent(student, {
          level: s.moduleLevel || s.moduleId?.level,
          courseDay: s.moduleId?.courseDay
        })
    );
    const totalSessionCount = sessionRecords.length;
    const completedSessions = sessionRecords.filter(s => s.sessionState === 'completed' || s.sessionState === 'manually_ended').length;
    const lastSession = sessionRecords[0];

    // Documents
    const { documents, docsSummary, uploadedDocs } = await buildDocumentsList(studentId, student.servicesOpted);

    // Teacher feedback latest per level
    const feedbackByLevel = {};
    const allProg = await StudentProgress.find({ studentId: new mongoose.Types.ObjectId(studentId) }).populate('moduleId', 'level').lean();
    allProg.forEach((p) => {
      if (p.teacherFeedback?.length > 0 && p.moduleId?.level) {
        if (isLevelAdminBlocked(student.blockedJourneyLevels, p.moduleId.level)) return;
        const latest = p.teacherFeedback.sort((a, b) => new Date(b.providedAt) - new Date(a.providedAt))[0];
        if (!feedbackByLevel[p.moduleId.level] || new Date(latest.providedAt) > new Date(feedbackByLevel[p.moduleId.level].providedAt)) {
          feedbackByLevel[p.moduleId.level] = latest;
        }
      }
    });

    // History timeline
    const history = [];
    displayLevels.forEach(level => {
      const sd = student.courseStartDates?.[level + 'StartDate'];
      const cd = student.courseCompletionDates?.[level + 'CompletionDate'];
      if (sd) history.push({ date: sd, title: level + ' course started', desc: 'Student began ' + level + ' level.' });
      if (cd) history.push({ date: cd, title: level + ' completed', desc: 'All ' + level + ' lessons completed.' });
    });
    uploadedDocs.forEach(doc => { if (doc.uploadedAt) history.push({ date: doc.uploadedAt, title: doc.documentType + ' submitted', desc: (doc.documentName || doc.documentType) + ' provided.' }); });
    if (student.createdAt) history.push({ date: student.createdAt, title: 'Student profile created', desc: 'Profile created for student ' + student.regNo + '.' });
    if (student.enrollmentDate) history.push({ date: student.enrollmentDate, title: 'Enrollment confirmed', desc: 'Student enrolled in ' + (student.servicesOpted || 'program') + '.' });
    history.sort((a, b) => new Date(b.date) - new Date(a.date));

    const levelOrder = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const curIdx = levelOrder.indexOf(student.level);
    let accessibleLevelsForEx = curIdx === -1 ? ['A1'] : levelOrder.slice(0, curIdx + 1);
    accessibleLevelsForEx = filterOutBlockedLevels(accessibleLevelsForEx, student.blockedJourneyLevels);
    const rawCourseDay = student.currentCourseDay;
    const trialDayEnabled = !!journeyAccess.trialDayEnabled;
    const studentCourseDay = (rawCourseDay != null && Number.isFinite(Number(rawCourseDay)))
      ? (Number(rawCourseDay) === 0 && trialDayEnabled
        ? 0
        : Math.min(200, Math.max(trialDayEnabled ? 0 : 1, Math.floor(Number(rawCourseDay)))))
      : (trialDayEnabled ? 0 : 1);

    let nextLockedDigitalExercise = null;
    if (student.role === 'STUDENT' && journeyAccess.learningEnabled !== false) {
      try {
        const nextLockAnd = [
          { isActive: true },
          { isDeleted: { $ne: true } },
          { visibleToStudents: true },
          { level: { $in: accessibleLevelsForEx } },
          { courseDay: { $gt: studentCourseDay, $lte: 200 } }
        ];
        appendNotBlockedToAndClauses(nextLockAnd, student.blockedJourneyLevels);
        const nex = await DigitalExercise.findOne({ $and: nextLockAnd }).sort({ courseDay: 1 }).select('title courseDay').lean();
        if (nex && nex.courseDay != null) {
          nextLockedDigitalExercise = {
            title: nex.title,
            courseDay: nex.courseDay,
            daysUntilUnlock: nex.courseDay - studentCourseDay
          };
        }
      } catch (e) {
        console.warn('nextLockedDigitalExercise:', e.message);
      }
    }

    res.json({
      profile: {
        regNo: student.regNo, name: student.name, batch: student.batch,
        teacher: student.assignedTeacher?.name || student.teacherIncharge || 'Not assigned',
        servicesOpted: student.servicesOpted || '', languageLevelOpted: student.languageLevelOpted || '',
        currentLevel: student.level, studentStatus: student.studentStatus,
        enrollmentDate: student.enrollmentDate || student.createdAt,
        examScores: student.examScores || {}, languageExamStatus: student.languageExamStatus || '',
        profilePic: student.profilePic || '',
        currentCourseDay: studentCourseDay,
        subscription: student.subscription || '',
        journeyAccessEnabled: journeyAccess.enabled !== false,
        learningContentEnabled: journeyAccess.learningEnabled !== false,
        dgBotEnabled: journeyAccess.dgBotEnabled !== false,
        dgUnlockMode: journeyAccess.dgUnlockMode || 'none',
        batchType: normalizeBatchType(journeyAccess.batchType),
        trialDayEnabled: !!journeyAccess.trialDayEnabled,
        pendingJourneyDayAdvance: !!student.pendingJourneyDayAdvance,
        pendingJourneyDayAdvanceForDay:
          student.pendingJourneyDayAdvanceForDay != null
            ? Math.min(200, Math.max(journeyAccess.trialDayEnabled ? 0 : 1, Math.floor(Number(student.pendingJourneyDayAdvanceForDay))))
            : null,
        blockedJourneyLevels: normalizeBlockedJourneyLevels(student.blockedJourneyLevels)
      },
      nextLockedDigitalExercise,
      levelProgression, lessonsByLevel,
      totalStudyHours: Math.round(totalStudyMinutes / 60),
      botUsage: { todayMinutes: botTodayMinutes, weekMinutes: botWeekMinutes, targetMinutesPerWeek: 180 },
      exercisesThisWeek: await countExerciseAttemptsForStudent(studentId, student, {
        status: 'completed',
        completedAt: { $gte: weekStart }
      }),
      exercisesToday: await countExerciseAttemptsForStudent(studentId, student, {
        status: 'completed',
        completedAt: { $gte: todayStart }
      }),
      exercisesTotal: await countExerciseAttemptsForStudent(studentId, student, { status: 'completed' }),
      attendance: { attended: completedSessions, total: totalSessionCount, lastSessionDate: lastSession?.startTime || null },
      documents, docsSummary,
      feedbackByLevel, history: history.slice(0, 20),
      payments: await resolveJourneyPayments(
        studentId,
        student.email,
        student.level,
        (id, em) => buildLegacyJourneyPayments(id, em, { includeTotalInvoiced: true }),
      ),
      visa: await (async () => {
        const PORTAL_STEP_NAMES = [
          'Application Filed', 'Preliminary Review', 'Embassy Review',
          'Embassy Feedback', 'Changes / Appointment', 'Final Submission & Decision'
        ];
        const AU_PAIR_STEP_NAMES = [
          'Appointment Booking', 'Document Preparation', 'Interview Preparation',
          'Embassy Visit', 'Result & Next Steps'
        ];
        const vt = await VisaTracking.findOne({ studentId }).populate('history.updatedBy', 'name').lean();
        if (!vt) {
          return { route: 'Not set', currentStep: 0, totalSteps: 0, steps: [], stages: [], finalOutcome: '', finalOutcomeNote: '', history: [], dates: {} };
        }
        const steps = vt.visaType === 'AU_PAIR' ? AU_PAIR_STEP_NAMES : PORTAL_STEP_NAMES;
        // Compute current step from stages
        let currentStep = 0;
        if (vt.stages && vt.stages.length) {
          for (let i = 0; i < vt.stages.length; i++) {
            if (vt.stages[i].outcome !== 'completed') { currentStep = i; break; }
            if (i === vt.stages.length - 1) currentStep = i;
          }
        }
        // Build dates from stage-level stageDate fields
        const dates = {};
        (vt.stages || []).forEach(s => {
          if (s.stageDate && s.stageDateLabel) {
            const key = s.stageDateLabel.replace(/\s+/g, '').replace('Date', '');
            dates[key] = s.stageDate;
          }
        });
        return {
          route: vt.visaType === 'AU_PAIR' ? 'Au Pair' : 'Portal Visa',
          currentStep,
          totalSteps: steps.length,
          steps,
          stages: (vt.stages || []).map(s => ({
            stage: s.stage,
            status: s.status || '',
            message: s.message || '',
            actionRequired: s.actionRequired || false,
            actionNote: s.actionNote || '',
            handledBy: s.handledBy || '',
            outcome: s.outcome || '',
            outcomeDate: s.outcomeDate || null,
            stageDate: s.stageDate || null,
            stageDateLabel: s.stageDateLabel || ''
          })),
          finalOutcome: vt.finalOutcome || '',
          finalOutcomeNote: vt.finalOutcomeNote || '',
          history: (vt.history || []).map(h => ({
            date: h.date,
            stage: h.stage,
            note: h.note,
            updatedBy: h.updatedBy?.name || 'Unknown user'
          })).reverse(),
          dates
        };
      })()
    });
  } catch (error) {
    console.error('Error fetching student journey:', error);
    res.status(500).json({ message: 'Error fetching journey data' });
  }
});

// ─── GET /api/student-progress/performance-summary ─────────────────────
// Student-facing aggregated data for the new performance-history page
router.get('/performance-summary', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const studentId = req.user.id;

    const student = await User.findById(studentId)
      .select('name email regNo level batch currentCourseDay')
      .lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });
    const currentDay = student.currentCourseDay || 1;

    const batchConfig = student.batch
      ? await BatchConfig.findOne({ batchName: student.batch }).select('journeyLength').lean()
      : null;
    const journeyLength = batchConfig?.journeyLength || 200;

    const range = req.query.range === 'weekly' ? 'weekly' : 'overall';
    const minDay = range === 'weekly' ? Math.max(1, currentDay - 6) : 1;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);

    const attempts = await ExerciseAttempt.find({ studentId, status: 'completed' })
      .populate('exerciseId', 'title courseDay category level')
      .sort({ completedAt: 1 })
      .lean();
    const exercisesWithData = attempts.filter(a => {
      if (!a.exerciseId) return false;
      if (!a.exerciseId?.courseDay) return range === 'overall';
      return a.exerciseId.courseDay >= minDay;
    });
    const completedExerciseIds = new Set(exercisesWithData.map(a => String(a.exerciseId._id)));

    const journeyKeys = allStudentBatchStringsForContent(student);
    const meetings = journeyKeys.length
      ? await MeetingLink.find({
          $or: journeyKeys.map(k => ({ batch: new RegExp(`^${escapeRegExp(k)}$`, 'i') })),
          status: { $ne: 'cancelled' }
        }).select('topic startTime duration courseDay attendance status').lean()
      : [];
    const filteredMeetings = meetings.filter(m => {
      if (!m.courseDay) return range === 'overall';
      return m.courseDay >= minDay;
    });

    const sessions = await SessionRecord.find({ studentId })
      .populate('moduleId', 'title level category courseDay')
      .sort({ createdAt: -1 })
      .lean();
    const filteredSessions = range === 'overall'
      ? sessions
      : sessions.filter(s => new Date(s.createdAt).getTime() >= weekAgo.getTime());

    const studentOid = new mongoose.Types.ObjectId(studentId);
    const completedDgModuleIds = await DGSession.distinct('moduleId', {
      studentId: studentOid, completed: true
    });
    const dgBotTotal = await DGModule.countDocuments({
      isActive: true, visibleToStudents: true,
      courseDay: { $gte: 1 }
    });
    const dgModulesList = await DGModule.find({
      isActive: true, visibleToStudents: true,
      courseDay: { $gte: 1 }
    }).select('title level courseDay').lean();
    const activeDgModuleIds = new Set(dgModulesList.map(m => String(m._id)));
    const dgBotCompleted = completedDgModuleIds.filter(id => activeDgModuleIds.has(String(id))).length;
    const completedSet = new Set(completedDgModuleIds.map(id => String(id)));
    const dgBotModules = dgModulesList.map(m => ({
      moduleId: m._id, title: m.title, level: m.level,
      courseDay: m.courseDay,
      completed: completedSet.has(String(m._id))
    }));

    const exerciseTotal = await DigitalExercise.countDocuments({
      level: student.level, isActive: true, visibleToStudents: true,
      isDeleted: { $ne: true },
      courseDay: { $gte: 1 }
    });

    const exerciseCompleted = completedExerciseIds.size;
    const exercisePct = exerciseTotal
      ? Math.min(100, Math.round((exerciseCompleted / exerciseTotal) * 100))
      : (exerciseCompleted ? 100 : 0);

    const now = new Date();
    const endedMeetings = filteredMeetings.filter(m => {
      if (m.status === 'ended') return true;
      if (m.status === 'cancelled') return false;
      const meetingEnd = new Date(m.startTime).getTime() + (m.duration || 0) * 60000;
      return meetingEnd < now.getTime();
    });
    const classTotal = endedMeetings.length;
    const classAttended = endedMeetings.filter(m =>
      (m.attendance || []).some(a => String(a.studentId || a.userId) === String(studentId) && a.attended)
    ).length;
    const classPct = classTotal ? Math.round((classAttended / classTotal) * 100) : 0;

    const dgBotPct = dgBotTotal ? Math.min(100, Math.round((dgBotCompleted / dgBotTotal) * 100)) : 0;

    const sessionCount = filteredSessions.length;
    const allScores = [
      ...exercisesWithData.map(a => a.scorePercentage || 0).filter(n => n > 0),
      ...filteredSessions.map(s => Number(s.summary?.totalScore || 0)).filter(n => n > 0)
    ];
    const avgScore = allScores.length
      ? Math.min(100, Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length))
      : 0;

    const sessionMinutes = filteredSessions.reduce((s, r) => s + (r.durationMinutes || 0), 0);
    const exerciseMinutes = exercisesWithData.reduce((s, a) => s + Math.round((a.timeSpentSeconds || 0) / 60), 0);
    const classMinutes = endedMeetings.reduce((s, m) => s + Number(m.duration || 0), 0);
    const totalStudyMinutes = sessionMinutes + exerciseMinutes + classMinutes;

    const allVocab = new Set();
    filteredSessions.forEach(s => { if (s.summary?.vocabularyUsed) s.summary.vocabularyUsed.forEach(w => allVocab.add(w)); });

    const overallDone = currentDay;
    const overallTotal = journeyLength;
    const overallCompletionPct = overallTotal
      ? Math.min(100, Math.round((overallDone / overallTotal) * 100))
      : 0;

    const kpis = {
      overallCompletionPct, overallDone, overallTotal,
      exerciseCompleted, exerciseTotal, exercisePct,
      classAttended, classTotal, classPct,
      dgBotCompleted, dgBotTotal, dgBotPct,
      sessionCount, avgScore, totalStudyMinutes,
      totalVocabulary: allVocab.size
    };

    const dayMap = {};
    for (let d = minDay; d <= currentDay; d++) {
      dayMap[d] = { day: d, exercisesDone: 0, classesAttended: 0, classesTotal: 0, totalScore: 0, scoreCount: 0, sessions: 0, studyMinutes: 0, _exIds: new Set() };
    }
    exercisesWithData.forEach(a => {
      const d = a.exerciseId?.courseDay;
      if (d && dayMap[d]) {
        dayMap[d]._exIds.add(String(a.exerciseId._id));
        dayMap[d].totalScore += a.scorePercentage || 0;
        dayMap[d].scoreCount += 1;
        dayMap[d].studyMinutes += Math.round((a.timeSpentSeconds || 0) / 60);
      }
    });
    Object.values(dayMap).forEach(d => { d.exercisesDone = d._exIds.size; delete d._exIds; });
    filteredMeetings.forEach(m => {
      const d = m.courseDay;
      if (d && dayMap[d]) {
        dayMap[d].classesTotal += 1;
        if ((m.attendance || []).some(a => String(a.studentId || a.userId) === String(studentId) && a.attended)) {
          dayMap[d].classesAttended += 1;
        }
        if (m.status === 'ended') dayMap[d].studyMinutes += Number(m.duration || 0);
      }
    });
    filteredSessions.forEach(s => {
      const d = s.moduleId?.courseDay;
      if (d && dayMap[d]) {
        dayMap[d].sessions += 1;
        dayMap[d].studyMinutes += s.durationMinutes || 0;
      }
    });
    const dayBreakdown = Object.values(dayMap).map(d => ({
      day: d.day, exercisesDone: d.exercisesDone, classesAttended: d.classesAttended,
      classesTotal: d.classesTotal, avgScore: d.scoreCount ? Math.round(d.totalScore / d.scoreCount) : 0,
      sessions: d.sessions, studyMinutes: d.studyMinutes
    }));

    const CATEGORIES = ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'];
    const catMap = {};
    CATEGORIES.forEach(c => { catMap[c] = { totalScore: 0, count: 0 }; });
    exercisesWithData.forEach(a => {
      const cat = a.exerciseId?.category;
      if (cat && catMap[cat]) {
        catMap[cat].totalScore += a.scorePercentage || 0;
        catMap[cat].count += 1;
      }
    });
    const categoryPerformance = CATEGORIES.map(cat => ({
      category: cat, attempts: catMap[cat].count,
      avgScore: catMap[cat].count ? Math.round(catMap[cat].totalScore / catMap[cat].count) : 0
    }));

    const day6Tests = [];
    exercisesWithData.forEach(a => {
      const d = a.exerciseId?.courseDay;
      if (d && d % 6 === 0) {
        day6Tests.push({
          day: d, type: 'exercise', id: a._id,
          title: a.exerciseId?.title || 'Untitled',
          category: a.exerciseId?.category || null,
          score: a.scorePercentage || 0,
          timeSpentMinutes: Math.round((a.timeSpentSeconds || 0) / 60),
          status: 'completed'
        });
      }
    });
    filteredSessions.filter(s => s.sessionType === 'test').forEach(s => {
      const d = s.moduleId?.courseDay;
      if (d && d % 6 === 0) {
        day6Tests.push({
          day: d, type: 'session', id: s._id,
          title: `${s.moduleTitle || 'AI'} Test`,
          category: s.moduleId?.category || null,
          score: s.summary?.totalScore || 0,
          timeSpentMinutes: s.durationMinutes || 0,
          status: s.sessionState
        });
      }
    });
    day6Tests.sort((a, b) => a.day - b.day);

    const liveClasses = filteredMeetings.map(m => {
      const attended = (m.attendance || []).some(
        a => String(a.studentId || a.userId) === String(studentId) && a.attended
      );
      const meetingEnd = new Date(m.startTime).getTime() + (m.duration || 0) * 60000;
      const hasEnded = m.status === 'ended' || (m.status !== 'cancelled' && meetingEnd < now.getTime());
      return {
        meetingId: m._id, topic: m.topic, startTime: m.startTime,
        duration: m.duration, courseDay: m.courseDay, attended,
        status: m.status, hasEnded
      };
    });

    const exerciseRows = exercisesWithData.map(a => ({
      attemptId: a._id, exerciseId: a.exerciseId?._id,
      title: a.exerciseId?.title || 'Untitled',
      courseDay: a.exerciseId?.courseDay, category: a.exerciseId?.category,
      scorePercent: a.scorePercentage || 0, timeSpentSeconds: a.timeSpentSeconds || 0,
      completedAt: a.completedAt
    }));

    const sessionRows = filteredSessions.map(s => ({
      id: s._id, sessionId: s.sessionId, sessionType: s.sessionType,
      sessionState: s.sessionState, module: s.moduleId ? {
        id: s.moduleId._id, title: s.moduleTitle, level: s.moduleLevel,
        category: s.moduleId.category, courseDay: s.moduleId.courseDay
      } : null,
      summary: s.summary, durationMinutes: s.durationMinutes,
      startTime: s.startTime, createdAt: s.createdAt
    }));

    res.json({
      student: {
        _id: student._id, name: student.name, email: student.email,
        regNo: student.regNo, level: student.level, batch: student.batch,
        currentCourseDay: currentDay, journeyLength
      },
      kpis, dayBreakdown, categoryPerformance, day6Tests,
      exercises: exerciseRows, liveClasses, sessions: sessionRows, dgBotModules
    });
  } catch (err) {
    console.error('performance-summary error:', err);
    res.status(500).json({ message: 'Failed to fetch performance summary', error: err.message });
  }
});

// GET /api/student-progress/:moduleId - Get progress for specific module
// ✅ Allow both STUDENT and TEACHER (for testing modules)
router.get('/:moduleId', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const studentId = req.user.id;
    
    const progress = await StudentProgress.findOne({ studentId, moduleId })
      .populate('moduleId')
      .populate('teacherFeedback.providedBy', 'name email')
      .lean();
    
    if (!progress) {
      return res.status(404).json({ message: 'Progress not found for this module' });
    }
    
    // Get recent AI sessions for this module
    const recentSessions = await AiTutorSession.find({
      studentId,
      moduleId,
      status: 'completed'
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('sessionType analytics startTime totalDuration')
    .lean();
    
    progress.recentSessions = recentSessions;
    
    res.json(progress);
  } catch (error) {
    console.error('Error fetching module progress:', error);
    res.status(500).json({ message: 'Error fetching module progress' });
  }
});

// PUT /api/student-progress/:moduleId/exercise - Update exercise completion
// ✅ Allow both STUDENT and TEACHER (for testing modules)
router.put('/:moduleId/exercise', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { exerciseIndex, score, isCompleted } = req.body;
    const studentId = req.user.id;
    
    const progress = await StudentProgress.findOne({ studentId, moduleId });
    if (!progress) {
      return res.status(404).json({ message: 'Progress not found' });
    }
    
    // Find or create exercise completion record
    let exerciseProgress = progress.exercisesCompleted.find(
      ex => ex.exerciseIndex === exerciseIndex
    );
    
    if (!exerciseProgress) {
      exerciseProgress = {
        exerciseIndex,
        attempts: 0,
        bestScore: 0,
        isCompleted: false
      };
      progress.exercisesCompleted.push(exerciseProgress);
    }
    
    // Update exercise progress
    exerciseProgress.attempts += 1;
    exerciseProgress.bestScore = Math.max(exerciseProgress.bestScore, score || 0);
    exerciseProgress.lastAttemptDate = new Date();
    
    if (isCompleted) {
      exerciseProgress.isCompleted = true;
    }
    
    // Update total score
    progress.totalScore += score || 0;
    
    // Recalculate progress percentage
    progress.calculateProgress();
    
    // Update streak
    if (isCompleted && score > 0) {
      progress.currentStreak += 1;
      progress.bestStreak = Math.max(progress.bestStreak, progress.currentStreak);
    } else if (score === 0) {
      progress.currentStreak = 0;
    }
    
    // Check if module is completed
    const module = await LearningModule.findById(moduleId).lean();
    const totalExercises = module.content.exercises.length;
    const completedExercises = progress.exercisesCompleted.filter(ex => ex.isCompleted).length;
    
    if (completedExercises === totalExercises && progress.status !== 'completed') {
      progress.status = 'completed';
      progress.completedAt = new Date();
    }
    
    await progress.save();
    
    res.json({
      message: 'Exercise progress updated',
      progress: {
        progressPercentage: progress.progressPercentage,
        currentStreak: progress.currentStreak,
        totalScore: progress.totalScore,
        status: progress.status
      }
    });
  } catch (error) {
    console.error('Error updating exercise progress:', error);
    res.status(500).json({ message: 'Error updating exercise progress' });
  }
});

// PUT /api/student-progress/:moduleId/notes - Update student notes
// ✅ Allow both STUDENT and TEACHER (for testing modules)
router.put('/:moduleId/notes', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { notes } = req.body;
    const studentId = req.user.id;
    
    const progress = await StudentProgress.findOneAndUpdate(
      { studentId, moduleId },
      { studentNotes: notes },
      { new: true }
    );
    
    if (!progress) {
      return res.status(404).json({ message: 'Progress not found' });
    }
    
    res.json({ message: 'Notes updated successfully' });
  } catch (error) {
    console.error('Error updating notes:', error);
    res.status(500).json({ message: 'Error updating notes' });
  }
});

// GET /api/student-progress/analytics/dashboard - Get dashboard analytics
// ✅ Allow both STUDENT and TEACHER (for testing modules)
router.get('/analytics/dashboard', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const studentId = req.user.id;
    
    // Get progress data
    const progressData = await StudentProgress.find({ studentId })
      .populate('moduleId', 'title level category')
      .lean();
    
    // Get recent sessions
    const recentSessions = await AiTutorSession.find({ studentId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('moduleId', 'title')
      .select('sessionType analytics startTime totalDuration')
      .lean();
    
    // Calculate analytics
    const analytics = {
      overview: {
        totalModules: progressData.filter(p => p.moduleId).length, // Only count valid modules
        completedModules: progressData.filter(p => p.status === 'completed' && p.moduleId).length,
        inProgressModules: progressData.filter(p => p.status === 'in-progress' && p.moduleId).length,
        totalTimeSpent: progressData.reduce((sum, p) => sum + (p.timeSpent || 0), 0),
        totalSessions: progressData.reduce((sum, p) => sum + (p.sessionsCount || 0), 0)
      },
      
      progressByLevel: progressData.reduce((acc, p) => {
        // Skip progress records with null or missing moduleId
        if (!p.moduleId || !p.moduleId.level) return acc;
        
        const level = p.moduleId.level;
        if (!acc[level]) acc[level] = { total: 0, completed: 0 };
        acc[level].total += 1;
        if (p.status === 'completed') acc[level].completed += 1;
        return acc;
      }, {}),
      
      progressByCategory: progressData.reduce((acc, p) => {
        // Skip progress records with null or missing moduleId
        if (!p.moduleId || !p.moduleId.category) return acc;
        
        const category = p.moduleId.category;
        if (!acc[category]) acc[category] = { total: 0, completed: 0 };
        acc[category].total += 1;
        if (p.status === 'completed') acc[category].completed += 1;
        return acc;
      }, {}),
      
      weeklyActivity: await getWeeklyActivity(studentId),
      
      recentSessions: recentSessions.map(session => ({
        moduleTitle: session.moduleId.title,
        sessionType: session.sessionType,
        duration: session.totalDuration,
        score: session.analytics.sessionScore,
        date: session.startTime
      })),
      
      streakData: {
        currentStreak: Math.max(...progressData.map(p => p.currentStreak || 0)),
        bestStreak: Math.max(...progressData.map(p => p.bestStreak || 0))
      }
    };
    
    res.json(analytics);
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    res.status(500).json({ message: 'Error fetching analytics' });
  }
});

// Helper function to get weekly activity
async function getWeeklyActivity(studentId) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  
  const sessions = await AiTutorSession.find({
    studentId,
    startTime: { $gte: oneWeekAgo }
  }).select('startTime totalDuration').lean();
  
  const weeklyData = {};
  // Use consistent day names (starting with Monday for better UX)
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
  // Initialize all days with zero values
  days.forEach(day => {
    weeklyData[day] = { sessions: 0, timeSpent: 0 };
  });
  
  // Aggregate session data by day
  sessions.forEach(session => {
    const dayIndex = session.startTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
    // Convert Sunday=0 to Sunday=6 for our Monday-first array
    const adjustedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
    const dayName = days[adjustedIndex];
    
    weeklyData[dayName].sessions += 1;
    weeklyData[dayName].timeSpent += session.totalDuration || 0;
  });
  
  return weeklyData;
}

// GET /api/student-progress/teacher/:studentId - Get student progress (Teachers/Admins)
router.get('/teacher/:studentId', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const progress = await StudentProgress.find({ studentId })
      .populate('moduleId', 'title level category')
      .populate('studentId', 'name email level')
      .sort({ lastAccessedAt: -1 })
      .lean();
    
    // Get recent AI sessions
    const recentSessions = await AiTutorSession.find({ studentId })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('moduleId', 'title')
      .select('sessionType analytics startTime totalDuration')
      .lean();
    
    res.json({ progress, recentSessions });
  } catch (error) {
    console.error('Error fetching student progress for teacher:', error);
    res.status(500).json({ message: 'Error fetching student progress' });
  }
});

// POST /api/student-progress/:moduleId/feedback - Add teacher feedback
router.post('/:moduleId/feedback', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { studentId, feedback, rating } = req.body;
    const teacherId = req.user.id;
    
    const progress = await StudentProgress.findOne({ studentId, moduleId });
    if (!progress) {
      return res.status(404).json({ message: 'Student progress not found' });
    }
    
    progress.teacherFeedback.push({
      feedback,
      rating,
      providedBy: teacherId,
      providedAt: new Date()
    });
    
    await progress.save();
    
    res.json({ message: 'Feedback added successfully' });
  } catch (error) {
    console.error('Error adding teacher feedback:', error);
    res.status(500).json({ message: 'Error adding feedback' });
  }
});

// GET /api/student-progress/admin/journey/:studentId - Full journey for a specific student (admin view; includes blocked content)
router.get('/admin/journey/:studentId', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const User = require('../models/User');
    const SessionRecord = require('../models/SessionRecord');
    const StudentDocument = require('../models/StudentDocument');
    const Invoice = require('../models/Invoice');
    const StudentPayment = require('../models/StudentPayment');
    const VisaTracking = require('../models/VisaTracking');
    const studentId = req.params.studentId;

    const student = await User.findById(studentId)
      .select('-password')
      .populate('assignedTeacher', 'name')
      .lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    // Level progression
    const allLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const currentLevelIndex = allLevels.indexOf(student.level);
    const opted = (student.languageLevelOpted || '').trim();
    let displayLevels;
    if (!opted) {
      displayLevels = ['A1', 'A2', 'B1', 'B2'];
    } else if (opted.includes('-')) {
      const [s, e] = opted.split('-');
      const si = allLevels.indexOf(s), ei = allLevels.indexOf(e);
      displayLevels = (si >= 0 && ei >= 0 && ei >= si) ? allLevels.slice(si, ei + 1) : ['A1', 'A2', 'B1', 'B2'];
    } else {
      const oi = allLevels.indexOf(opted);
      displayLevels = oi >= 0 ? allLevels.slice(0, Math.max(oi, currentLevelIndex) + 1) : ['A1', 'A2', 'B1', 'B2'];
    }
    if (!displayLevels.includes(student.level)) {
      displayLevels = allLevels.slice(allLevels.indexOf(displayLevels[0]), currentLevelIndex + 1);
    }

    const levelProgression = displayLevels.map(level => {
      const startDate = student.courseStartDates?.[level + 'StartDate'];
      const completedDate = student.courseCompletionDates?.[level + 'CompletionDate'];
      const li = allLevels.indexOf(level);
      let status = 'not-started';
      if (completedDate) status = 'completed';
      else if (startDate || li < currentLevelIndex) status = li === currentLevelIndex ? 'in-progress' : 'completed';
      else if (li === currentLevelIndex) status = 'in-progress';
      return { level, status, startDate, completedDate };
    });

    // Module progress per level
    const moduleProgress = await StudentProgress.aggregate([
      { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
      { $lookup: { from: 'learningmodules', localField: 'moduleId', foreignField: '_id', as: 'module' } },
      { $unwind: '$module' },
      { $group: { _id: '$module.level', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, totalTime: { $sum: '$timeSpent' } } }
    ]);
    const lessonsByLevel = {};
    let totalStudyMinutes = 0;
    moduleProgress.forEach(mp => { lessonsByLevel[mp._id] = { total: mp.total, completed: mp.completed }; totalStudyMinutes += mp.totalTime || 0; });

    // AI Bot usage this week
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const botSessions = await AiTutorSession.find({ studentId: new mongoose.Types.ObjectId(studentId), startTime: { $gte: weekStart } }).select('totalDuration startTime').lean();
    let botWeekMinutes = 0, botTodayMinutes = 0;
    botSessions.forEach(s => { const dur = s.totalDuration || 0; botWeekMinutes += dur; if (s.startTime >= todayStart) botTodayMinutes += dur; });

    // Attendance (admin view: all sessions)
    const sessionRecords = await SessionRecord.find({ studentId: new mongoose.Types.ObjectId(studentId) }).select('sessionState startTime').sort({ startTime: -1 }).lean();
    const totalSessionCount = sessionRecords.length;
    const completedSessions = sessionRecords.filter(s => s.sessionState === 'completed' || s.sessionState === 'manually_ended').length;
    const lastSession = sessionRecords[0];

    // Documents
    const { documents, docsSummary, uploadedDocs } = await buildDocumentsList(studentId, student.servicesOpted);

    // Teacher feedback latest per level
    const feedbackByLevel = {};
    const allProg = await StudentProgress.find({ studentId: new mongoose.Types.ObjectId(studentId) }).populate('moduleId', 'level').lean();
    allProg.forEach(p => {
      if (p.teacherFeedback?.length > 0 && p.moduleId?.level) {
        const latest = p.teacherFeedback.sort((a, b) => new Date(b.providedAt) - new Date(a.providedAt))[0];
        if (!feedbackByLevel[p.moduleId.level] || new Date(latest.providedAt) > new Date(feedbackByLevel[p.moduleId.level].providedAt)) {
          feedbackByLevel[p.moduleId.level] = latest;
        }
      }
    });

    // History timeline
    const history = [];
    displayLevels.forEach(level => {
      const sd = student.courseStartDates?.[level + 'StartDate'];
      const cd = student.courseCompletionDates?.[level + 'CompletionDate'];
      if (sd) history.push({ date: sd, title: level + ' course started', desc: 'Student began ' + level + ' level.' });
      if (cd) history.push({ date: cd, title: level + ' completed', desc: 'All ' + level + ' lessons completed.' });
    });
    uploadedDocs.forEach(doc => { if (doc.uploadedAt) history.push({ date: doc.uploadedAt, title: doc.documentType + ' submitted', desc: (doc.documentName || doc.documentType) + ' provided.' }); });
    if (student.createdAt) history.push({ date: student.createdAt, title: 'Student profile created', desc: 'Profile created for student ' + student.regNo + '.' });
    if (student.enrollmentDate) history.push({ date: student.enrollmentDate, title: 'Enrollment confirmed', desc: 'Student enrolled in ' + (student.servicesOpted || 'program') + '.' });
    history.sort((a, b) => new Date(b.date) - new Date(a.date));

    const payments = await resolveJourneyPayments(
      studentId,
      student.email,
      student.level,
      (id, em) => buildLegacyJourneyPayments(id, em),
    );

    // Visa
    const PORTAL_STEP_NAMES = ['Application Filed', 'Preliminary Review', 'Embassy Review', 'Embassy Feedback', 'Changes / Appointment', 'Final Submission & Decision'];
    const AU_PAIR_STEP_NAMES = ['Appointment Booking', 'Document Preparation', 'Interview Preparation', 'Embassy Visit', 'Result & Next Steps'];
    const vt = await VisaTracking.findOne({ studentId }).populate('history.updatedBy', 'name').lean();
    let visa;
    if (!vt) {
      visa = { route: 'Not set', currentStep: 0, totalSteps: 0, steps: [], stages: [], finalOutcome: '', finalOutcomeNote: '', history: [], dates: {} };
    } else {
      const steps = vt.visaType === 'AU_PAIR' ? AU_PAIR_STEP_NAMES : PORTAL_STEP_NAMES;
      let currentStep = 0;
      if (vt.stages && vt.stages.length) {
        for (let i = 0; i < vt.stages.length; i++) {
          if (vt.stages[i].outcome !== 'completed') { currentStep = i; break; }
          if (i === vt.stages.length - 1) currentStep = i;
        }
      }
      const dates = {};
      (vt.stages || []).forEach(s => { if (s.stageDate && s.stageDateLabel) { dates[s.stageDateLabel.replace(/\s+/g, '').replace('Date', '')] = s.stageDate; } });
      visa = {
        route: vt.visaType === 'AU_PAIR' ? 'Au Pair' : 'Portal Visa', currentStep, totalSteps: steps.length, steps,
        stages: (vt.stages || []).map(s => ({ stage: s.stage, status: s.status || '', message: s.message || '', actionRequired: s.actionRequired || false, actionNote: s.actionNote || '', handledBy: s.handledBy || '', outcome: s.outcome || '', outcomeDate: s.outcomeDate || null, stageDate: s.stageDate || null, stageDateLabel: s.stageDateLabel || '' })),
        finalOutcome: vt.finalOutcome || '', finalOutcomeNote: vt.finalOutcomeNote || '',
        history: (vt.history || []).map(h => ({ date: h.date, stage: h.stage, note: h.note, updatedBy: h.updatedBy?.name || 'Unknown user' })).reverse(), dates
      };
    }

    res.json({
      profile: {
        regNo: student.regNo, name: student.name, batch: student.batch,
        teacher: student.assignedTeacher?.name || student.teacherIncharge || 'Not assigned',
        servicesOpted: student.servicesOpted || '', languageLevelOpted: student.languageLevelOpted || '',
        currentLevel: student.level, studentStatus: student.studentStatus,
        enrollmentDate: student.enrollmentDate || student.createdAt,
        isTestAccount: !!student.isTestAccount,
        currentCourseDay: student.currentCourseDay != null && Number.isFinite(Number(student.currentCourseDay))
          ? Math.min(200, Math.max(1, Math.floor(Number(student.currentCourseDay))))
          : 1,
        goStatus: student.goStatus || null,
        blockedJourneyLevels: normalizeBlockedJourneyLevels(student.blockedJourneyLevels)
      },
      levelProgression, lessonsByLevel, totalStudyHours: Math.round(totalStudyMinutes / 60),
      botUsage: { todayMinutes: botTodayMinutes, weekMinutes: botWeekMinutes, targetMinutesPerWeek: 180 },
      attendance: { attended: completedSessions, total: totalSessionCount, lastSessionDate: lastSession?.startTime || null },
      documents, docsSummary,
      feedbackByLevel, history: history.slice(0, 20), payments, visa
    });
  } catch (err) {
    console.error('Admin journey error:', err);
    res.status(500).json({ message: 'Error fetching student journey' });
  }
});

// GET /api/student-progress/admin/students/:studentId/learning-overview
router.get('/admin/students/:studentId/learning-overview', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const User = require('../models/User');
    const DgModule = require('../models/DGModule');
    const studentId = req.params.studentId;

    const student = await User.findOne({ _id: studentId, role: 'STUDENT' })
      .select('name regNo email level currentCourseDay blockedJourneyLevels batch subscription medium')
      .lean();
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const blocked = normalizeBlockedJourneyLevels(student.blockedJourneyLevels);
    const currentDay = Math.min(200, Math.max(1, Math.floor(Number(student.currentCourseDay) || 1)));

    const [moduleCounts, exerciseCounts, dgCounts, recordingCounts] = await Promise.all([
      LearningModule.aggregate([
        { $match: { isActive: true, isDeleted: { $ne: true }, courseDay: { $gte: 1, $lte: currentDay } } },
        { $group: { _id: '$courseDay', count: { $sum: 1 } } }
      ]),
      DigitalExercise.aggregate([
        { $match: { visibleToStudents: true, isDeleted: { $ne: true }, courseDay: { $gte: 1, $lte: currentDay } } },
        { $group: { _id: '$courseDay', count: { $sum: 1 } } }
      ]),
      DgModule.aggregate([
        { $match: { visibleToStudents: true, courseDay: { $gte: 1, $lte: currentDay } } },
        { $group: { _id: '$courseDay', count: { $sum: 1 } } }
      ]),
      ClassRecording.aggregate([
        { $match: { active: true, courseDay: { $gte: 1, $lte: currentDay } } },
        { $group: { _id: '$courseDay', count: { $sum: 1 } } }
      ])
    ]);

    const countMap = (rows) => {
      const m = new Map();
      (rows || []).forEach((r) => m.set(Number(r._id), r.count));
      return m;
    };
    const mods = countMap(moduleCounts);
    const exs = countMap(exerciseCounts);
    const dgs = countMap(dgCounts);
    const recs = countMap(recordingCounts);

    const days = [];
    for (let d = 1; d <= currentDay; d++) {
      const lvl = levelForJourneyDay(d);
      days.push({
        day: d,
        level: lvl,
        blocked: isCourseDayAdminBlocked(blocked, d),
        modules: mods.get(d) || 0,
        exercises: exs.get(d) || 0,
        dgModules: dgs.get(d) || 0,
        recordings: recs.get(d) || 0
      });
    }

    res.json({
      profile: {
        _id: student._id,
        name: student.name,
        regNo: student.regNo,
        email: student.email,
        level: student.level,
        batch: student.batch,
        subscription: student.subscription,
        medium: student.medium,
        currentCourseDay: currentDay,
        blockedJourneyLevels: blocked
      },
      levelSegments: levelMetaForAdmin(blocked),
      days
    });
  } catch (err) {
    console.error('Admin learning overview error:', err);
    res.status(500).json({ message: 'Error fetching learning overview' });
  }
});

// PATCH /api/student-progress/admin/students/:studentId/blocked-journey-levels
router.patch('/admin/students/:studentId/blocked-journey-levels', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const User = require('../models/User');
    const studentId = req.params.studentId;
    const raw = req.body?.blockedJourneyLevels ?? req.body?.levels ?? [];
    const blockedJourneyLevels = normalizeBlockedJourneyLevels(raw);

    const student = await User.findOneAndUpdate(
      { _id: studentId, role: 'STUDENT' },
      { $set: { blockedJourneyLevels, updatedAt: new Date() } },
      { new: true }
    ).select('name regNo blockedJourneyLevels currentCourseDay level').lean();

    if (!student) return res.status(404).json({ message: 'Student not found' });

    res.json({
      success: true,
      student: {
        _id: student._id,
        name: student.name,
        regNo: student.regNo,
        blockedJourneyLevels: normalizeBlockedJourneyLevels(student.blockedJourneyLevels)
      }
    });
  } catch (err) {
    console.error('PATCH blocked-journey-levels error:', err);
    res.status(500).json({ message: 'Error updating blocked journey levels' });
  }
});

// GET /api/student-progress/admin/overview - All students progress overview (admin)
router.get('/admin/overview', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    // ═════════════════════════════════════════════════════════════════════
    // 1. Parse query params
    // ═════════════════════════════════════════════════════════════════════
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 50));
    const search = String(req.query.search || '').trim();
    const batchFilter = String(req.query.batch || '').trim();
    const statusFilter = String(req.query.status || '').trim();
    const levelFilter = String(req.query.level || '').trim();
    const sortField = ['name', 'overallPct', 'learningPct', 'classPct', 'exercisePct', 'dgPct'].includes(req.query.sortField)
      ? req.query.sortField : 'overallPct';
    const sortDir = req.query.sortDir === 'asc' ? 1 : -1;

    // ═════════════════════════════════════════════════════════════════════
    // 2. Build User filter + get total count
    // ═════════════════════════════════════════════════════════════════════
    const userFilter = { role: 'STUDENT', ...EXCLUDE_TEST };
    if (batchFilter) userFilter.batch = batchFilter;
    if (statusFilter) userFilter.studentStatus = statusFilter;
    if (levelFilter) userFilter.level = levelFilter;
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      userFilter.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { email: { $regex: safe, $options: 'i' } },
        { regNo: { $regex: safe, $options: 'i' } }
      ];
    }

    const total = await User.countDocuments(userFilter);
    const totalPages = Math.ceil(total / limit);

    // ═════════════════════════════════════════════════════════════════════
    // 3. Fetch ALL matching students (minimal fields — display fields fetched
    //    later for only the paginated page; keeps BSON transfer ~1.7s vs 3.5s)
    // ═════════════════════════════════════════════════════════════════════
    const allStudents = await User.find(userFilter)
      .select('name batch level languageLevelOpted courseCompletionDates currentCourseDay')
      .lean();
    const studentMap = {};
    allStudents.forEach(s => { studentMap[s._id.toString()] = s; });
    const allStudentIds = allStudents.map(s => s._id);

    // ═════════════════════════════════════════════════════════════════════
    // 4. Batch-fetch shared cross-collection data for ALL students
    //    (MeetingLink, ExerciseAttempt, DigitalExercise, DGSession)
    //    Run ALL 4 queries in parallel to save Atlas round-trips.
    // ═════════════════════════════════════════════════════════════════════
    const batchKeys = Array.from(new Set(allStudents.map((s) => String(s.batch || '').trim()).filter(Boolean)));
    const allBatchVals = [];
    for (const b of batchKeys) {
      allBatchVals.push(b);
      const bn = Number(b);
      if (Number.isFinite(bn) && String(bn) === b) allBatchVals.push(bn);
    }

    const [journeyMeetings, meetingAttendanceAgg, exerciseAgg, allJourneyExercises, dgAgg] = await Promise.all([
      // 4a. Journey-based class progress — WITHOUT attendance (avoids 23s BSON deserialization)
      allBatchVals.length
        ? MeetingLink.find({
            batch: { $in: allBatchVals },
            status: { $ne: 'cancelled' },
            courseDay: { $gte: 1, $lte: 200 }
          }).select('batch courseDay').lean()
        : Promise.resolve([]),

      // 4a'. Attendance stats per-student per-courseDay via lightweight $unwind
      allBatchVals.length
        ? MeetingLink.aggregate([
            { $match: { batch: { $in: allBatchVals }, status: { $ne: 'cancelled' }, courseDay: { $gte: 1, $lte: 200 } } },
            { $unwind: '$attendance' },
            { $group: {
                _id: { studentId: '$attendance.studentId', courseDay: '$courseDay' },
                attended: { $max: { $cond: ['$attendance.attended', true, false] } }
            }}
          ])
        : Promise.resolve([]),

      // 4b. Exercise attempts per student
      ExerciseAttempt.aggregate([
        { $match: { studentId: { $in: allStudentIds } } },
        { $group: { _id: '$studentId', attemptedExerciseIds: { $addToSet: '$exerciseId' } } }
      ]),

      // 4c. Exercises scheduled by journey day (1..200)
      DigitalExercise.find({
        isDeleted: { $ne: true },
        isActive: true,
        visibleToStudents: true,
        courseDay: { $gte: 1, $lte: 200 }
      }).select('_id courseDay').lean(),

      // 4d. DG: highest minutes per student — NO $unwind
      DGSession.aggregate([
        { $match: { studentId: { $in: allStudentIds } } },
        { $addFields: { sessionMaxMs: { $max: '$logs.durationMs' } } },
        { $group: { _id: '$studentId', maxMs: { $max: '$sessionMaxMs' } } },
        { $project: { maxMinutes: { $ifNull: [{ $round: [{ $divide: ['$maxMs', 60000] }] }, 0] } } }
      ])
    ]);

    // Process MeetingLink results
    const meetingsByBatch = {};
    for (const m of journeyMeetings) {
      const key = String(m.batch || '').trim();
      if (!key) continue;
      if (!meetingsByBatch[key]) meetingsByBatch[key] = [];
      meetingsByBatch[key].push(m);
    }

    // Build attendedDaysByStudent lookup from attendance aggregate
    const attendedDaysByStudent = {};
    for (const a of meetingAttendanceAgg) {
      const sid = a._id.studentId.toString();
      if (a.attended) {
        if (!attendedDaysByStudent[sid]) attendedDaysByStudent[sid] = new Set();
        attendedDaysByStudent[sid].add(a._id.courseDay);
      }
    }

    // Process ExerciseAttempt results
    const exerciseAttemptedMap = {};
    exerciseAgg.forEach(e => {
      exerciseAttemptedMap[e._id.toString()] = new Set(
        (e.attemptedExerciseIds || []).map((id) => String(id))
      );
    });

    // Pre-compute exercise map: courseDay -> exerciseId[]
    const exercisesByDay = {};
    for (const ex of allJourneyExercises) {
      const day = ex.courseDay;
      if (!exercisesByDay[day]) exercisesByDay[day] = [];
      exercisesByDay[day].push(String(ex._id));
    }
    const sortedDays = Object.keys(exercisesByDay).map(Number).sort((a, b) => a - b);

    // Process DGSession results
    const dgMinutesByStudent = {};
    let maxDgMinutes = 0;
    for (const d of dgAgg) {
      const sid = d._id.toString();
      const mins = d.maxMinutes || 0;
      dgMinutesByStudent[sid] = mins;
      if (mins > maxDgMinutes) maxDgMinutes = mins;
    }

    // ═════════════════════════════════════════════════════════════════════
    // 5. Compute per-student core metrics (classPct, exercisePct, dgPct,
    //    learningPct, overallPct) for ALL students
    //    This drives sorting and summary.
    // ═════════════════════════════════════════════════════════════════════
    const coreResults = allStudents.map(s => {
      const sid = s._id.toString();
      const studentDay = Math.max(1, Math.min(200, Number(s.currentCourseDay || 1)));
      const batchMeetings = meetingsByBatch[String(s.batch || '').trim()] || [];
      const scheduledMeetings = batchMeetings.filter((m) => Number(m.courseDay || 0) <= studentDay);
      const totalClasses = scheduledMeetings.length;
      const attendedDays = attendedDaysByStudent[sid] || new Set();
      const attendedClasses = scheduledMeetings.filter((m) => attendedDays.has(m.courseDay)).length;

      const { learningPct, levelsCompleted, totalLevels } = computeAdminProgressMetrics(s, { total: 0, verified: 0 }, null, null);

      const attRate = totalClasses ? Math.round((attendedClasses / totalClasses) * 100) : 0;
      const classPct = attRate;

      let exerciseAttempted = 0;
      let eligibleCount = 0;
      const attemptedSet = exerciseAttemptedMap[sid] || new Set();
      for (const day of sortedDays) {
        if (day > studentDay) break;
        const ids = exercisesByDay[day];
        for (const id of ids) {
          eligibleCount++;
          if (attemptedSet.has(id)) exerciseAttempted++;
        }
      }
      const exercisePct = eligibleCount ? Math.round((exerciseAttempted / eligibleCount) * 100) : 0;

      const dgMaxMinutes = dgMinutesByStudent[sid] || 0;
      const dgPct = maxDgMinutes > 0 ? Math.round((dgMaxMinutes / maxDgMinutes) * 100) : 0;
      const overallPct = Math.round((classPct + exercisePct + dgPct) / 3);

      return {
        sid,
        name: s.name,
        email: s.email,
        regNo: s.regNo,
        batch: s.batch || '',
        level: s.level,
        service: s.servicesOpted || '',
        teacher: s.assignedTeacher?.name || '',
        status: s.studentStatus || '',
        enrollmentDate: s.enrollmentDate,
        currentLevel: s.level,
        overallPct,
        learningPct,
        classPct,
        exercisePct,
        dgPct,
        classProgressText: `${attendedClasses}/${totalClasses}`,
        exerciseProgressText: `${exerciseAttempted}/${eligibleCount}`,
        dgTopMinutes: dgMaxMinutes,
        levelsCompleted,
        totalLevels,
        attendance: { attended: attendedClasses, total: totalClasses, rate: attRate },
        studentDay
      };
    });

    // ═════════════════════════════════════════════════════════════════════
    // 6. Compute summary from ALL filtered results (same as client-side)
    // ═════════════════════════════════════════════════════════════════════
    const withAtt = coreResults.filter(s => s.attendance.total > 0);
    const summary = {
      avgOverall: coreResults.length ? Math.round(coreResults.reduce((s, st) => s + st.overallPct, 0) / coreResults.length) : 0,
      avgLearning: coreResults.length ? Math.round(coreResults.reduce((s, st) => s + st.learningPct, 0) / coreResults.length) : 0,
      avgAttendance: withAtt.length ? Math.round(withAtt.reduce((s, st) => s + st.attendance.rate, 0) / withAtt.length) : 0,
      lowAttendanceCount: withAtt.filter(s => s.attendance.rate < 75).length
    };

    // ═════════════════════════════════════════════════════════════════════
    // 7. Available filter values
    // ═════════════════════════════════════════════════════════════════════
    const availableBatches = Array.from(new Set(coreResults.map(s => s.batch).filter(Boolean)))
      .sort((a, b) => Number(a) - Number(b));
    const availableLevels = Array.from(new Set(coreResults.map(s => s.level).filter(Boolean)))
      .sort();

    // ═════════════════════════════════════════════════════════════════════
    // 8. Sort core results
    // ═════════════════════════════════════════════════════════════════════
    if (sortField === 'name') {
      coreResults.sort((a, b) => {
        const va = (a.name || '').toLowerCase();
        const vb = (b.name || '').toLowerCase();
        return sortDir * (va < vb ? -1 : va > vb ? 1 : 0);
      });
    } else {
      coreResults.sort((a, b) => {
        const va = a[sortField] ?? 0;
        const vb = b[sortField] ?? 0;
        return sortDir * (va - vb);
      });
    }

    // ═════════════════════════════════════════════════════════════════════
    // 9. Paginate — get IDs for the current page
    // ═════════════════════════════════════════════════════════════════════
    const skip = (page - 1) * limit;
    const pageCore = coreResults.slice(skip, skip + limit);
    const pageStudentIds = pageCore.map(s => new mongoose.Types.ObjectId(s.sid));

    // ═════════════════════════════════════════════════════════════════════
    // 10. Fetch docs/payment/visa ONLY for the paginated page
    // ═════════════════════════════════════════════════════════════════════
    const [docAgg, payments, visas, fullStudentDetails] = await Promise.all([
      StudentDocument.aggregate([
        { $match: { studentId: { $in: pageStudentIds } } },
        { $group: { _id: '$studentId', total: { $sum: 1 }, verified: { $sum: { $cond: [{ $eq: ['$status', 'VERIFIED'] }, 1, 0] } } } }
      ]),
      StudentPayment.find({ studentId: { $in: pageStudentIds } })
        .select('studentId totalPackageAmount totalPaid pendingPayment currency').lean(),
      VisaTracking.find({ studentId: { $in: pageStudentIds } })
        .select('studentId visaType currentStage stages').lean(),
      pageStudentIds.length
        ? User.find({ _id: { $in: pageStudentIds } })
            .select('name email regNo servicesOpted assignedTeacher studentStatus enrollmentDate')
            .populate('assignedTeacher', 'name')
            .lean()
        : Promise.resolve([])
    ]);
    const fullStudentMap = {};
    fullStudentDetails.forEach(s => { fullStudentMap[s._id.toString()] = s; });

    const docMap = {};
    docAgg.forEach(d => { docMap[d._id.toString()] = d; });
    const payMap = {};
    payments.forEach(p => { payMap[p.studentId.toString()] = p; });
    const visaMap = {};
    visas.forEach(v => { visaMap[v.studentId.toString()] = v; });

    // ═════════════════════════════════════════════════════════════════════
    // 11. Build full response objects for the current page
    // ═════════════════════════════════════════════════════════════════════
    const data = pageCore.map(s => {
      const sid = s.sid;
      const full = fullStudentMap[sid] || {};
      const student = studentMap[sid] || {};
      const doc = docMap[sid] || { total: 0, verified: 0 };
      const pay = payMap[sid] || null;
      const visa = visaMap[sid] || null;

      const { docsPct, payPct, visaPct, visaSteps, visaCurrent } = computeAdminProgressMetrics(student, doc, pay, visa);

      return {
        _id: sid,
        name: full.name || s.name,
        email: full.email || '',
        regNo: full.regNo || '',
        batch: s.batch,
        level: s.level,
        service: full.servicesOpted || '',
        teacher: full.assignedTeacher?.name || '',
        status: full.studentStatus || '',
        enrollmentDate: full.enrollmentDate,
        overallPct: s.overallPct,
        learningPct: s.learningPct,
        classPct: s.classPct,
        exercisePct: s.exercisePct,
        dgPct: s.dgPct,
        classProgressText: s.classProgressText,
        exerciseTopScore: s.exercisePct,
        exerciseProgressText: s.exerciseProgressText,
        dgTopMinutes: s.dgTopMinutes,
        currentLevel: s.currentLevel,
        levelsCompleted: s.levelsCompleted,
        totalLevels: s.totalLevels,
        attendance: s.attendance,
        docs: { verified: doc.verified, total: doc.total, pct: docsPct },
        payment: pay ? { currency: pay.currency, total: pay.totalPackageAmount, paid: pay.totalPaid, pending: pay.pendingPayment, pct: payPct } : null,
        visa: visa ? { type: visa.visaType, current: visaCurrent, total: visaSteps, pct: visaPct } : null
      };
    });

    // ═════════════════════════════════════════════════════════════════════
    // 12. Return
    // ═════════════════════════════════════════════════════════════════════
    res.json({ data, total, page, totalPages, limit, summary, availableBatches, availableLevels });
  } catch (error) {
    console.error('Error fetching admin progress overview:', error);
    res.status(500).json({ message: 'Error fetching progress overview' });
  }
});

module.exports = router;