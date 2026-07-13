/**
 * Weekly Milestone Check Jobs
 *
 * 1. Day 6 Weekly Test Score Alert  (daily 08:00 IST)
 *    ─ Finds students who completed any DigitalExercise or DGModule flagged
 *      weeklyTestEnabled: true on courseDay 6 with a score < 60%.
 *    ─ Each failing attempt is reported only once (tracked via CronJobLog).
 *
 * 2. Day 6 Completion Check  (daily 01:00 IST — after midnight rollover)
 *    ─ Finds ONGOING students who advanced to Day 8 without completing
 *      all exercises and DG-Bot modules assigned to courseDay 6.
 *    ─ Each student is reported only once (tracked via CronJobLog).
 *    ─ Shows name, batch, email, completed items, and a completion % bar.
 *
 * Recipients: aiswarya@gluckglobal.com, sourav@gluckglobal.com
 */

const cron            = require('node-cron');
const DigitalExercise = require('../models/DigitalExercise');
const DGModule        = require('../models/DGModule');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const DGSession       = require('../models/DGSession');
const User            = require('../models/User');
const CronJobLog      = require('../models/CronJobLog');
const transporter     = require('../config/emailConfig');
const {
  buildWeeklyTestLowScoreEmail,
  buildDay6CompletionCheckEmail,
} = require('../utils/emailTemplates');

const TZ                  = 'Asia/Colombo';
const REPORT_RECIPIENTS   = ['aiswarya@gluckglobal.com', 'sourav@gluckglobal.com'];
const WEEKLY_TEST_DAY     = 6;    // courseDay on which weekly tests sit
const LOW_SCORE_THRESHOLD = 60;   // % below which we alert
const DEADLINE_DAY        = 8;    // students on currentCourseDay >= this missed the Day-6 deadline

const LOG_PREFIX_TEST = '[WeeklyTestAlert]';
const LOG_PREFIX_DAY6 = '[Day6CompletionCheck]';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}

function reportDateLabel() {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/** Returns true if the CronJobLog key already exists (= already reported). */
async function alreadyLogged(key) {
  return !!(await CronJobLog.findOne({ jobName: key }).lean());
}

async function markLogged(key) {
  await CronJobLog.findOneAndUpdate(
    { jobName: key },
    { $set: { lastRunDate: todayStr(), lastRunAt: new Date() }, $inc: { runCount: 1 } },
    { upsert: true },
  );
}

// ─────────────────────────────────────────────────────────────
// 1.  DAY 6 WEEKLY TEST SCORE ALERT
// ─────────────────────────────────────────────────────────────

async function processWeeklyTestScoreAlerts() {
  // ── Find weekly-test exercises on Day 6 ──────────────────────
  const [wtExercises, wtDgModules] = await Promise.all([
    DigitalExercise.find({ weeklyTestEnabled: true, courseDay: WEEKLY_TEST_DAY })
      .select('_id title')
      .lean(),
    DGModule.find({ weeklyTestEnabled: true, courseDay: WEEKLY_TEST_DAY, isActive: true })
      .select('_id title')
      .lean(),
  ]);

  if (!wtExercises.length && !wtDgModules.length) {
    console.log(`${LOG_PREFIX_TEST} No weekly-test content found for courseDay ${WEEKLY_TEST_DAY} — skipping.`);
    return;
  }

  const exerciseIds = wtExercises.map((e) => e._id);
  const dgModuleIds = wtDgModules.map((m) => m._id);

  // ── Collect low-scoring exercise attempts ─────────────────────
  const lowExAttempts = exerciseIds.length
    ? await ExerciseAttempt.find({
        exerciseId:      { $in: exerciseIds },
        status:          'completed',
        scorePercentage: { $lt: LOW_SCORE_THRESHOLD },
      })
        .select('_id studentId exerciseId scorePercentage')
        .lean()
    : [];

  // ── Collect low-scoring DG sessions ─────────────────────────
  // DGSession stores score (0–100) inside moduleCompletionPercent or a dedicated score field.
  // We use `score` and fall back to `moduleCompletionPercent`.
  const lowDgSessions = dgModuleIds.length
    ? await DGSession.find({
        moduleId:  { $in: dgModuleIds },
        completed: true,
        $or: [
          { score:                    { $lt: LOW_SCORE_THRESHOLD } },
          { moduleCompletionPercent:  { $lt: LOW_SCORE_THRESHOLD } },
        ],
      })
        .select('_id studentId moduleId score moduleCompletionPercent')
        .lean()
    : [];

  // ── Filter out already-reported records ─────────────────────
  const unreportedEx  = [];
  const unreportedDg  = [];

  for (const a of lowExAttempts) {
    if (!(await alreadyLogged(`weeklyTestLowScore:ex:${a._id}`))) unreportedEx.push(a);
  }
  for (const s of lowDgSessions) {
    if (!(await alreadyLogged(`weeklyTestLowScore:dg:${s._id}`))) unreportedDg.push(s);
  }

  if (!unreportedEx.length && !unreportedDg.length) {
    console.log(`${LOG_PREFIX_TEST} All low-score records already reported — nothing to send.`);
    return;
  }

  // ── Get ONGOING student details ──────────────────────────────
  const allStudentIds = [
    ...new Set([
      ...unreportedEx.map((a) => String(a.studentId)),
      ...unreportedDg.map((s) => String(s.studentId)),
    ]),
  ];

  const students = await User.find({
    _id: { $in: allStudentIds },
    role: 'STUDENT', isActive: true, studentStatus: 'ONGOING',
  })
    .select('_id name email batch')
    .lean();

  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  // Build exercise title lookup
  const exTitleMap = new Map(wtExercises.map((e) => [String(e._id), e.title || 'Day 6 Weekly Test']));
  const dgTitleMap = new Map(wtDgModules.map((m) => [String(m._id), m.title || 'Day 6 Weekly Module']));

  const reportItems = [];
  const today = todayStr();

  for (const attempt of unreportedEx) {
    const student = studentMap.get(String(attempt.studentId));
    if (!student) { await markLogged(`weeklyTestLowScore:ex:${attempt._id}`); continue; }
    reportItems.push({
      name:          student.name,
      email:         student.email,
      batch:         student.batch || '—',
      score:         attempt.scorePercentage ?? 0,
      exerciseTitle: exTitleMap.get(String(attempt.exerciseId)),
    });
    await markLogged(`weeklyTestLowScore:ex:${attempt._id}`);
  }

  for (const session of unreportedDg) {
    const student = studentMap.get(String(session.studentId));
    if (!student) { await markLogged(`weeklyTestLowScore:dg:${session._id}`); continue; }
    const score = session.score ?? session.moduleCompletionPercent ?? 0;
    reportItems.push({
      name:          student.name,
      email:         student.email,
      batch:         student.batch || '—',
      score,
      exerciseTitle: dgTitleMap.get(String(session.moduleId)),
    });
    await markLogged(`weeklyTestLowScore:dg:${session._id}`);
  }

  if (!reportItems.length) {
    console.log(`${LOG_PREFIX_TEST} No ONGOING students in low-score results — email not sent.`);
    return;
  }

  // Sort by score ascending so worst first
  reportItems.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));

  const { subject, html } = buildWeeklyTestLowScoreEmail({
    students:   reportItems,
    reportDate: reportDateLabel(),
  });

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global Portal'}" <${process.env.EMAIL_USER}>`,
    to:   REPORT_RECIPIENTS.join(', '),
    subject,
    html,
  });

  console.log(
    `${LOG_PREFIX_TEST} ✅ Alert sent — ${reportItems.length} student(s) with Day ${WEEKLY_TEST_DAY} weekly test score < ${LOW_SCORE_THRESHOLD}%.`
  );
}

// ─────────────────────────────────────────────────────────────
// 2.  DAY 6 CONTENT COMPLETION CHECK
// ─────────────────────────────────────────────────────────────

async function processDay6CompletionCheck() {
  // ── All Day-6 content (exercises + DG modules) ───────────────
  const [exercises, dgModules] = await Promise.all([
    DigitalExercise.find({ courseDay: WEEKLY_TEST_DAY }).select('_id title').lean(),
    DGModule.find({ courseDay: WEEKLY_TEST_DAY, isActive: true }).select('_id title').lean(),
  ]);

  const exerciseIds  = exercises.map((e) => e._id);
  const dgModuleIds  = dgModules.map((m) => m._id);
  const totalContent = exerciseIds.length + dgModuleIds.length;

  if (totalContent === 0) {
    console.log(`${LOG_PREFIX_DAY6} No content found for courseDay ${WEEKLY_TEST_DAY} — skipping.`);
    return;
  }

  // ── Students who have passed the Day-7 deadline ─────────────
  const eligibleStudents = await User.find({
    role:             'STUDENT',
    isActive:         true,
    studentStatus:    'ONGOING',
    currentCourseDay: { $gte: DEADLINE_DAY },
  })
    .select('_id name email batch currentCourseDay')
    .lean();

  if (!eligibleStudents.length) {
    console.log(`${LOG_PREFIX_DAY6} No students on Day ${DEADLINE_DAY}+ found.`);
    return;
  }

  // ── Filter out already-reported students ─────────────────────
  const toCheck = [];
  for (const student of eligibleStudents) {
    if (!(await alreadyLogged(`day6NotDone:${student._id}`))) toCheck.push(student);
  }

  if (!toCheck.length) {
    console.log(`${LOG_PREFIX_DAY6} All eligible students already reported — nothing to send.`);
    return;
  }

  const studentIds = toCheck.map((s) => s._id);

  // ── Completed exercise attempts ───────────────────────────────
  const completedAttempts = exerciseIds.length
    ? await ExerciseAttempt.find({
        studentId:  { $in: studentIds },
        exerciseId: { $in: exerciseIds },
        status:     'completed',
      })
        .select('studentId exerciseId')
        .lean()
    : [];

  const completedExMap = new Map(); // studentId → Set<exerciseId>
  for (const a of completedAttempts) {
    const sid = String(a.studentId);
    if (!completedExMap.has(sid)) completedExMap.set(sid, new Set());
    completedExMap.get(sid).add(String(a.exerciseId));
  }

  // ── Completed DG sessions ────────────────────────────────────
  const completedSessions = dgModuleIds.length
    ? await DGSession.find({
        studentId: { $in: studentIds },
        moduleId:  { $in: dgModuleIds },
        completed: true,
      })
        .select('studentId moduleId')
        .lean()
    : [];

  const completedDgMap = new Map(); // studentId → Set<moduleId>
  for (const s of completedSessions) {
    const sid = String(s.studentId);
    if (!completedDgMap.has(sid)) completedDgMap.set(sid, new Set());
    completedDgMap.get(sid).add(String(s.moduleId));
  }

  // ── Compute completion and build report ──────────────────────
  const incompleteStudents = [];

  for (const student of toCheck) {
    const sid          = String(student._id);
    const doneEx       = (completedExMap.get(sid) || new Set()).size;
    const doneDg       = (completedDgMap.get(sid) || new Set()).size;
    const totalDone    = doneEx + doneDg;
    const completionPct = Math.round((totalDone / totalContent) * 100);

    // Mark as checked regardless of result — avoid re-processing this student next run
    await markLogged(`day6NotDone:${student._id}`);

    if (completionPct < 100) {
      incompleteStudents.push({
        name:           student.name,
        email:          student.email,
        batch:          student.batch || '—',
        completionPct,
        completedItems: totalDone,
        totalItems:     totalContent,
        currentDay:     student.currentCourseDay,
      });
    }
  }

  if (!incompleteStudents.length) {
    console.log(`${LOG_PREFIX_DAY6} All newly-checked students completed Day ${WEEKLY_TEST_DAY} — email not sent.`);
    return;
  }

  // Sort worst first (lowest % then name)
  incompleteStudents.sort(
    (a, b) => a.completionPct - b.completionPct || a.name.localeCompare(b.name)
  );

  const { subject, html } = buildDay6CompletionCheckEmail({
    students:   incompleteStudents,
    reportDate: reportDateLabel(),
  });

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global Portal'}" <${process.env.EMAIL_USER}>`,
    to:   REPORT_RECIPIENTS.join(', '),
    subject,
    html,
  });

  console.log(
    `${LOG_PREFIX_DAY6} ✅ Alert sent — ${incompleteStudents.length} student(s) with incomplete Day ${WEEKLY_TEST_DAY} content.`
  );
}

// ─────────────────────────────────────────────────────────────
// Schedulers
// ─────────────────────────────────────────────────────────────

function scheduleWeeklyMilestoneChecks() {
  // Weekly test low-score check: daily 8 AM IST
  cron.schedule('0 8 * * *', () => {
    processWeeklyTestScoreAlerts().catch((err) =>
      console.error(`${LOG_PREFIX_TEST} ❌ Job error:`, err.message),
    );
  }, { timezone: TZ });

  // Day 6 completion check: daily 1 AM IST (after midnight rollover)
  cron.schedule('0 1 * * *', () => {
    processDay6CompletionCheck().catch((err) =>
      console.error(`${LOG_PREFIX_DAY6} ❌ Job error:`, err.message),
    );
  }, { timezone: TZ });

  console.log(
    `⏰ [WeeklyMilestoneChecks] Scheduled — Day 6 weekly test score alert (08:00 IST) + Day 6 completion check (01:00 IST)`
  );
}

module.exports = {
  scheduleWeeklyMilestoneChecks,
  processWeeklyTestScoreAlerts,
  processDay6CompletionCheck,
};
