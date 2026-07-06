/**
 * Weekly Test Incomplete Reminder
 *
 * Runs at 08:00 Asia/Colombo every day.
 *
 * Targets ONGOING students who are currently on a "Day 7" boundary of any
 * weekly cycle (currentCourseDay ∈ {7, 14, 21, 28, …}).  For each such
 * student we check whether they have completed ALL weeklyTestEnabled content
 * (DigitalExercises + DGModules) from their previous day (courseDay = N − 1,
 * i.e. the weekly-test day).  Those who have NOT are sent:
 *
 *   • A reminder email directly to the student
 *   • A WhatsApp nudge (if WHATSAPP_AUTOMATED_JOBS_ENABLED=true)
 *
 * Sends at most once per student per calendar day via CronJobLog dedup.
 */
'use strict';

const cron            = require('node-cron');
const User            = require('../models/User');
const DigitalExercise = require('../models/DigitalExercise');
const DGModule        = require('../models/DGModule');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const DGSession       = require('../models/DGSession');
const transporter     = require('../config/emailConfig');
const {
  buildWeeklyTestIncompleteReminderEmail,
} = require('../utils/emailTemplates');
const {
  sendWhatsappNotification,
  NOTIFICATION_TYPES,
  isWhatsappAutomatedJobsEnabled,
  getBatchSettingsMap,
  isBatchAllowedBySettings,
} = require('../services/whatsappCrmService');
const {
  resolveStudentPhone,
  wasReminderSentToday,
  markReminderSentToday,
} = require('../services/studentReminderHelpers');

const TZ         = 'Asia/Colombo';
const JOB_PREFIX = 'weeklyTestIncompleteReminder';
const LOG        = '[WeeklyTestIncompleteReminder]';

// ─────────────────────────────────────────────────────────────────────────────
// Core processor
// ─────────────────────────────────────────────────────────────────────────────

async function processWeeklyTestIncompleteReminders() {
  // 1. Find all ONGOING students who are on a Day-7 boundary (7, 14, 21, …)
  const allStudents = await User.find({
    role:          'STUDENT',
    isActive:      true,
    studentStatus: 'ONGOING',
  })
    .select('_id name email batch level subscription whatsappNumber phoneNumber currentCourseDay')
    .lean();

  // Filter to students on a weekly-test boundary
  const boundaryStudents = allStudents.filter(
    (s) => s.currentCourseDay > 0 && s.currentCourseDay % 7 === 0,
  );

  if (!boundaryStudents.length) {
    console.log(`${LOG} No students currently on a Day-7 boundary — skipping.`);
    return;
  }

  // 2. Group students by their missed weekly-test day (currentCourseDay − 1)
  //    so we can fetch content per test day in bulk instead of one-by-one.
  const byTestDay = new Map(); // testDay → student[]
  for (const student of boundaryStudents) {
    const testDay = student.currentCourseDay - 1; // e.g. 6, 13, 20, …
    if (!byTestDay.has(testDay)) byTestDay.set(testDay, []);
    byTestDay.get(testDay).push(student);
  }

  const batchSettings       = await getBatchSettingsMap();
  const whatsappEnabled     = isWhatsappAutomatedJobsEnabled();
  const portalUrl           = process.env.FRONTEND_URL || 'https://gluckstudentsportal.com';

  let sent    = 0;
  let skipped = 0;

  for (const [testDay, students] of byTestDay) {
    // 3. Fetch all weeklyTestEnabled content for this test day
    const [wtExercises, wtDgModules] = await Promise.all([
      DigitalExercise.find({ weeklyTestEnabled: true, courseDay: testDay })
        .select('_id title')
        .lean(),
      DGModule.find({ weeklyTestEnabled: true, courseDay: testDay, isActive: true })
        .select('_id title')
        .lean(),
    ]);

    if (!wtExercises.length && !wtDgModules.length) {
      // No weekly-test content exists for this test day — nothing to remind about
      skipped += students.length;
      continue;
    }

    const exerciseIds = wtExercises.map((e) => e._id);
    const dgModuleIds = wtDgModules.map((m) => m._id);

    // Build title maps for the reminder message
    const exTitleMap = new Map(wtExercises.map((e) => [String(e._id), e.title || `Day ${testDay} Weekly Test`]));
    const dgTitleMap = new Map(wtDgModules.map((m) => [String(m._id), m.title || `Day ${testDay} Weekly Module`]));

    const studentIds = students.map((s) => s._id);

    // 4. Fetch completions for all students in this group in one query each
    const [completedAttempts, completedSessions] = await Promise.all([
      exerciseIds.length
        ? ExerciseAttempt.find({
            studentId:  { $in: studentIds },
            exerciseId: { $in: exerciseIds },
            status:     'completed',
          })
            .select('studentId exerciseId')
            .lean()
        : [],
      dgModuleIds.length
        ? DGSession.find({
            studentId: { $in: studentIds },
            moduleId:  { $in: dgModuleIds },
            completed: true,
            $or: [{ moduleFullyComplete: true }, { moduleFullyComplete: { $exists: false } }],
          })
            .select('studentId moduleId')
            .lean()
        : [],
    ]);

    // Build per-student completion sets
    const completedExMap = new Map(); // studentId → Set<exerciseId>
    for (const a of completedAttempts) {
      const sid = String(a.studentId);
      if (!completedExMap.has(sid)) completedExMap.set(sid, new Set());
      completedExMap.get(sid).add(String(a.exerciseId));
    }

    const completedDgMap = new Map(); // studentId → Set<moduleId>
    for (const s of completedSessions) {
      const sid = String(s.studentId);
      if (!completedDgMap.has(sid)) completedDgMap.set(sid, new Set());
      completedDgMap.get(sid).add(String(s.moduleId));
    }

    // 5. Process each student
    for (const student of students) {
      try {
        // Batch-level WhatsApp gate check
        if (!isBatchAllowedBySettings(batchSettings, NOTIFICATION_TYPES.WEEKLY_TEST_REMINDER, student.batch)) {
          skipped++;
          continue;
        }

        // Once-per-day dedup
        if (await wasReminderSentToday(JOB_PREFIX, student._id)) {
          skipped++;
          continue;
        }

        const sid      = String(student._id);
        const doneEx   = completedExMap.get(sid) || new Set();
        const doneDg   = completedDgMap.get(sid) || new Set();

        // Collect uncompleted item titles
        const missingItems = [
          ...wtExercises.filter((e) => !doneEx.has(String(e._id))).map((e) => e.title || `Day ${testDay} Weekly Test`),
          ...wtDgModules.filter((m) => !doneDg.has(String(m._id))).map((m) => m.title || `Day ${testDay} Weekly Module`),
        ];

        // Student already completed everything — no reminder needed
        if (!missingItems.length) {
          skipped++;
          continue;
        }

        const currentDay = student.currentCourseDay;

        // ── WhatsApp (gated) ──────────────────────────────────────────────
        if (whatsappEnabled) {
          const phone  = resolveStudentPhone(student);
          const waMsg  =
            `Good morning ${student.name}! 🌅 You haven't completed your Week ${Math.ceil(currentDay / 7)} ` +
            `Weekly Test from Day ${testDay} yet. Please complete it to unlock your Day ${currentDay} modules! ` +
            `Log in now: ${portalUrl}/login`;
          await sendWhatsappNotification({
            phone,
            name:    student.name,
            type:    NOTIFICATION_TYPES.WEEKLY_TEST_REMINDER,
            message: waMsg,
            data:    { studentId: student._id, testDay, currentDay, missingCount: missingItems.length },
          });
        }

        // ── Email (always runs) ───────────────────────────────────────────
        if (student.email) {
          const { subject, html, text } = buildWeeklyTestIncompleteReminderEmail({
            name:         student.name,
            testDay,
            currentDay,
            missingItems,
            portalUrl,
          });
          await transporter.sendMail({
            from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global'}" <${process.env.EMAIL_USER}>`,
            to:   student.email,
            subject,
            html,
            text,
          });
        }

        await markReminderSentToday(JOB_PREFIX, student._id);
        sent++;
      } catch (err) {
        console.error(
          `${LOG} ❌ Error for student ${student._id} (${student.name}):`,
          err.message,
        );
      }
    }
  }

  console.log(`${LOG} ✅ Done — ${sent} reminder(s) sent, ${skipped} skipped.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler
// ─────────────────────────────────────────────────────────────────────────────

function scheduleWeeklyTestIncompleteReminder() {
  // 08:00 AM Asia/Colombo daily
  cron.schedule('0 8 * * *', () => {
    processWeeklyTestIncompleteReminders().catch((err) =>
      console.error(`${LOG} ❌ Job error:`, err.message),
    );
  }, { timezone: TZ });

  console.log(`⏰ ${LOG} Scheduled — runs at 08:00 AM Asia/Colombo daily`);
}

module.exports = {
  scheduleWeeklyTestIncompleteReminder,
  processWeeklyTestIncompleteReminders,
};
