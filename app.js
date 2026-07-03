//app.js

require("dotenv").config();

// Windows / some ISP DNS returns querySrv ECONNREFUSED for mongodb+srv; public resolvers fix Atlas SRV lookups in Node.
(function configureMongoDnsResolvers() {
  const uri = process.env.MONGO_URI || '';
  if (!uri.startsWith('mongodb+srv://')) return;
  const fromEnv = (process.env.MONGO_DNS_SERVERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const servers = fromEnv.length ? fromEnv : process.platform === 'win32' ? ['1.1.1.1', '8.8.8.8'] : [];
  if (!servers.length) return;
  const dnsSync = require('dns');
  dnsSync.setServers(servers);
  if (typeof dnsSync.setDefaultResultOrder === 'function') {
    dnsSync.setDefaultResultOrder('ipv4first');
  }
  console.log(`[Mongo DNS] Using DNS resolvers: ${servers.join(', ')} (SRV lookup for Atlas)`);
})();

// Validate critical S3 env vars at startup so issues are visible immediately
const REQUIRED_S3_VARS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET'];
const missingS3Vars = REQUIRED_S3_VARS.filter(v => !process.env[v]);
if (missingS3Vars.length > 0) {
  console.error('❌ Missing S3 environment variables:', missingS3Vars.join(', '));
} else {
  console.log(`✅ S3 configured: bucket="${process.env.S3_BUCKET}" region="${process.env.AWS_REGION}"`);
}
const express = require("express");
const app = express();
app.set('etag', false);
const path = require('path');
const mongoose = require("mongoose");
const cors = require("cors");
const compression = require('compression');
const dns = require('dns').promises; // uses resolvers from configureMongoDnsResolvers above
const auth = require("./middleware/auth");

const allowedOrigins = [
  'http://localhost:4200',
  'http://localhost:4700',
  'http://127.0.0.1:4200',
  'http://127.0.0.1:4700',
  'http://16.170.204.125',
  'http://13.62.216.210',
  'https://13.62.216.210',
  'https://gluckstudentsportal.com',
  'https://www.gluckstudentsportal.com'
]; // frontend origins

/** Allow any localhost / 127.0.0.1 port (ng serve, Karma :9876, etc.). Safe: browsers only send these origins from pages on the same machine. */
function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return true;
  }
  return false;
}


const authRoutes = require("./routes/auth");
const courseRoutes = require("./routes/courses");
const subscriptionRoutes = require("./routes/subscriptions");
const aiConversationRoutes = require("./routes/aiConversations");
const adminRoutes = require("./routes/admin");
const studentRoutes = require("./routes/student")
const User = require("./models/User");
const Course = require('./models/Course');
const profileRoutes = require('./routes/profile');
const teacherRoutes = require('./routes/teacher');
const roleProtectedRoutes = require('./routes/roleProtected');
const feedbackRoutes = require('./routes/feedback');

const profilePicUploadRoutes = require('./routes/profile');
const timeTableRoutes = require('./routes/timeTable');
const courseMaterialRoutes = require('./routes/courseMaterial');
const aiTutorRoutes = require('./routes/aiTutor');
const studentProgressRoutes = require('./routes/studentProgress');
const aiModuleGeneratorRoutes = require('./routes/aiModuleGenerator');
const sessionRecordsRoutes = require('./routes/sessionRecords');
const translationRoutes = require('./routes/translation');
const moduleTrashRoutes = require('./routes/moduleTrash');
const zoomRoutes = require('./routes/zoom');
const zoomWebhookRoutes = require('./routes/zoomWebhook');
const joinClassRoutes = require('./routes/joinClass');
const upgradeRequestsRoutes = require('./routes/upgradeRequests');
const studentLogRoutes = require('./routes/studentLog');
const studentDocumentsRoutes = require('./routes/studentDocuments');
const documentRequirementsRoutes = require('./routes/documentRequirements');
const agreementsRoutes = require('./routes/agreements');

const assignmentRoutes = require('./routes/assignments');
const assignmentTemplatesRoutes = require('./routes/assignmentTemplates');
const notificationRoutes = require('./routes/notifications');
const metaLeadsRoutes = require('./routes/metaLeads');
const digitalExercisesRoutes = require('./routes/digitalExercises');
const dgRoutes = require('./routes/dg');
const sprechenRoutes = require('./routes/sprechen');
const visaTrackingRoutes = require('./routes/visaTracking');
const studentPaymentRoutes = require('./routes/studentPayments');
const batchJourneyRoutes = require('./routes/batchJourney');
const goStudentsRoutes = require('./routes/goStudents');
const goStudentsSinhalaRoutes = require('./routes/goStudentsSinhala');
const invoiceManagementRoutes = require('./routes/invoiceManagement');
const paymentSubmissionsRoutes = require('./routes/paymentSubmissions');
const supportTicketRoutes = require('./routes/supportTickets');
const ollyRoutes = require('./routes/olly');
const announcementRoutes = require('./routes/announcements');
const jobOpeningsRoutes = require('./routes/jobOpenings');
const crmPortalRoutes = require('./routes/crmPortal');
const crmPortalProxyRoutes = require('./routes/crmPortalProxy');
const testAccountRoutes = require('./routes/testAccounts');
const gluckRoomRoutes = require('./routes/gluckRoom');
const correctionRoutes = require('./routes/correction');
const classFeedbackRoutes = require('./routes/classFeedback');

const gradingRoutes = require("./routes/grading");
const { gradeAssignment } = require("./services/grading.service");

// Import and schedule Meta to Monday.com sync job
const { scheduleMetaToMondaySync } = require('./jobs/metaToMondaySync');

// Import and schedule auto-fetch Zoom attendance job
const { scheduleAutoFetchAttendance } = require('./jobs/autoFetchAttendance');
const { scheduleJourneyDayRollover } = require('./jobs/journeyDayRollover');
const { scheduleZoomMeetingReminderEmails } = require('./jobs/zoomMeetingReminderEmails');
const { scheduleZoomMeetingLinkHealth } = require('./jobs/zoomMeetingLinkHealth');

// WhatsApp CRM notification jobs
const { scheduleClassReminders } = require('./jobs/whatsapp/classReminder');
const { scheduleAbsenceAlerts } = require('./jobs/whatsapp/absenceAlert');
const { scheduleMissedActivitiesAlerts } = require('./jobs/whatsapp/missedActivities');
const { scheduleWeeklyReports } = require('./jobs/whatsapp/weeklyReport');
const { scheduleConsecutiveAbsenceAlerts } = require('./jobs/whatsapp/consecutiveAbsence');
const { schedulePaymentOverdueReminder } = require('./jobs/whatsapp/paymentOverdueReminder');
const { isWhatsappAutomatedJobsEnabled } = require('./services/whatsappCrmService');
const { scheduleDailyTaskReminder } = require('./jobs/dailyTaskReminder');
const { scheduleConsecutiveAbsenceEmailReport } = require('./jobs/consecutiveAbsenceEmailReport');
const { scheduleStudentPortalCrmFullSync } = require('./jobs/studentPortalCrmFullSync');
const { schedulePortalSessionStaleClose } = require('./jobs/portalSessionStaleClose');
const { schedulePublishScheduledAnnouncements } = require('./jobs/publishScheduledAnnouncements');
const { scheduleGluckRoomAutoStart } = require('./jobs/gluckRoomAutoStart');
const { scheduleDailyStudentStatusReport } = require('./jobs/dailyStudentStatusReport');
const { scheduleStudentDetailChangesReport } = require('./jobs/studentDetailChangesReport');
const { scheduleNeverLoggedInReport } = require('./jobs/neverLoggedInReport');
const { scheduleCrucialStudentsReport } = require('./services/crucialStudentsEmailService');
const { scheduleBatchDay1Reminders } = require('./jobs/batchDay1Reminder');
const { scheduleMilestoneAbsenceAlerts, scheduleWeeklyAbsenceSummary } = require('./jobs/absenceNotifications');
const { scheduleWeeklyMilestoneChecks } = require('./jobs/weeklyMilestoneChecks');
const { scheduleLateJoinEarlyExitAlerts } = require('./jobs/lateJoinEarlyExitAlert');
const { portalRouter, analyticsRouter } = require('./routes/portalAnalytics.routes');
const { scheduleFeedbackNotifications } = require('./jobs/classFeedbackNotification');

// Multer setup for file uploads
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.set('trust proxy', true); // trust first proxy (if behind a proxy like Nginx or Heroku)

app.use(compression());

// Zoom webhook — must be registered BEFORE express.json() so the raw body
// is available for HMAC signature verification
// Zoom recording.completed payloads can exceed 1 MB (recording_files metadata)
app.use('/api/zoom/webhook', express.raw({ type: '*/*', limit: '15mb' }), zoomWebhookRoutes);

// Middleware
app.use(express.json({ limit: '20mb' }));

app.use(cors({
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked for origin: ${origin || '(none)'}`));
    }
  },
  credentials: true,           // ✅ important for sending cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Connect to MongoDB with environment-based URI
const mongoUri =
  process.env.NODE_ENV === 'production'
    ? process.env.MONGO_URI
    : process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/Updated-Gluck-Portal';

if (!mongoUri || typeof mongoUri !== 'string') {
  console.error('❌ MONGO_URI is missing or invalid. Set it in .env (Atlas URI or local mongodb://…).');
  process.exit(1);
}

const { ensureDefaultDgCharacter } = require('./services/dgCharacterSeed');
const { ensureInteractiveGamesSeeded } = require('./services/interactiveGamesSeed');
const { ensureDefaultChallenges } = require('./services/interactiveGames/dailyChallenges');
const { ensureDefaultAchievements } = require('./services/interactiveGames/achievements');
const { ensureDefaultQuests } = require('./services/interactiveGames/quests');
const { scheduleGlueckArenaJobs } = require('./jobs/glueckArenaDailyReset');
const { initGlueckArenaSockets } = require('./sockets/glueckArenaMultiplayer');
const { initGluckRoomControls } = require('./sockets/gluckRoomControls');
const http = require('http');
const { ensurePortalBatches } = require('./services/ensurePortalBatches');

function parseMongoHosts(uri) {
  if (!uri || typeof uri !== 'string') return [];
  if (uri.startsWith('mongodb+srv://')) {
    const withoutProto = uri.slice('mongodb+srv://'.length);
    const afterAuth = withoutProto.includes('@') ? withoutProto.split('@')[1] : withoutProto;
    const host = afterAuth.split('/')[0]?.trim();
    return host ? [host] : [];
  }
  if (uri.startsWith('mongodb://')) {
    const withoutProto = uri.slice('mongodb://'.length);
    const afterAuth = withoutProto.includes('@') ? withoutProto.split('@')[1] : withoutProto;
    const hostPart = afterAuth.split('/')[0] || '';
    return hostPart
      .split(',')
      .map((h) => h.trim().split(':')[0])
      .filter(Boolean);
  }
  return [];
}

async function warnIfSuspiciousMongoDns(uri) {
  const hosts = parseMongoHosts(uri);
  if (!hosts.length) return;

  for (const host of hosts) {
    try {
      if (uri.startsWith('mongodb+srv://')) {
        const srvName = `_mongodb._tcp.${host}`;
        const srv = await dns.resolveSrv(srvName);
        const suspicious = srv.some((r) => String(r.name || '').includes('.domain.name'));
        if (suspicious) {
          console.error(
            `❌ [Mongo DNS guard] Suspicious SRV resolution for ${srvName}. ` +
              `Your DNS appears to rewrite Atlas domains. Switch DNS to 1.1.1.1/8.8.8.8 and run "ipconfig /flushdns".`
          );
        } else {
          console.log(`✅ [Mongo DNS guard] SRV lookup OK for ${srvName}`);
        }
      } else {
        const ips = await dns.resolve4(host);
        const suspicious = ips.some((ip) => ip.startsWith('185.38.109.'));
        if (suspicious) {
          console.error(
            `❌ [Mongo DNS guard] Suspicious A record(s) for ${host}: ${ips.join(', ')}. ` +
              `Switch DNS to 1.1.1.1/8.8.8.8 and run "ipconfig /flushdns".`
          );
        } else {
          console.log(`✅ [Mongo DNS guard] DNS lookup OK for ${host}`);
        }
      }
    } catch (err) {
      console.error(
        `❌ [Mongo DNS guard] Failed DNS check for ${host}: ${err.message}. ` +
          `If you see ENOTFOUND for mongodb.net hosts, change DNS to 1.1.1.1/8.8.8.8 and flush DNS.`
      );
    }
  }
}

function isRetryableMongoConnectError(err) {
  const msg = String(err?.message || err || '');
  return /ENOTFOUND|ECONNREFUSED|querySrv|ETIMEDOUT|ETIMEOUT/i.test(msg);
}

/**
 * Windows: dns.lookup (used by the MongoDB driver) ignores dns.setServers().
 * dns.resolve4/resolve6 honor setServers — route Atlas host lookups through them.
 */
function createAtlasDnsLookup() {
  const dnsMod = require('dns');
  return (hostname, options, callback) => {
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
      return dnsMod.lookup(hostname, options, callback);
    }
    const wantV6 = options?.family === 6;
    const resolver = wantV6
      ? dnsMod.promises.resolve6(hostname)
      : dnsMod.promises.resolve4(hostname);
    resolver
      .then((addrs) => {
        const addr = addrs?.[0];
        if (!addr) {
          callback(new Error(`getaddrinfo ENOTFOUND ${hostname}`));
          return;
        }
        callback(null, addr, wantV6 ? 6 : 4);
      })
      .catch((err) => callback(err));
  };
}

function mongoConnectOptions() {
  const opts = {
    serverSelectionTimeoutMS: 45_000,
    socketTimeoutMS: 45_000,
    family: 4,
  };
  if (mongoUri.startsWith('mongodb+srv://')) {
    opts.lookup = createAtlasDnsLookup();
  }
  return opts;
}

/** Wait for MongoDB before accepting traffic / crons — avoids Mongoose “buffering timed out” spam when Atlas is unreachable. */
async function connectMongoDb() {
  const maxAttempts = 3;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await warnIfSuspiciousMongoDns(mongoUri).catch(() => {});
      await mongoose.connect(mongoUri, mongoConnectOptions());
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isRetryableMongoConnectError(err)) {
        console.warn(
          `[MongoDB] Connect attempt ${attempt}/${maxAttempts} failed (${err.message}). Retrying in 3s…`
        );
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }

  if (lastErr) throw lastErr;

  console.log(`✅ Connected to MongoDB (${process.env.NODE_ENV || 'development'})`);
  await ensureDefaultDgCharacter();
  await ensureInteractiveGamesSeeded();
  await ensureDefaultChallenges();
  await ensureDefaultAchievements();
  await ensureDefaultQuests();
  await ensurePortalBatches();
  const { migrateBatchTypesFromGeneralToNew } = require('./services/migrateBatchTypes');
  await migrateBatchTypesFromGeneralToNew();
}

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/aiConversations', aiConversationRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/protected', roleProtectedRoutes);
app.use('/api/feedback', feedbackRoutes);

app.use('/api/timeTable', timeTableRoutes);
app.use('/api/courseMaterial', courseMaterialRoutes);
app.use('/api/ai-tutor', aiTutorRoutes);
app.use('/api/student-progress', studentProgressRoutes);
const adminPerformanceRoutes = require('./routes/adminPerformance');
app.use('/api/admin-performance', adminPerformanceRoutes);
app.use('/api/ai', aiModuleGeneratorRoutes);
app.use('/api/session-records', sessionRecordsRoutes);
app.use('/api/translate', translationRoutes);
app.use('/api/module-trash', moduleTrashRoutes);
app.use('/api/zoom', zoomRoutes);
app.use('/api', joinClassRoutes);
app.use('/api/upgrade-requests', upgradeRequestsRoutes);
app.use('/api/studentLog', studentLogRoutes);
app.use('/api/student-documents', studentDocumentsRoutes);
app.use('/api/document-requirements', documentRequirementsRoutes);
app.use('/api/agreements', agreementsRoutes);

app.use('/api/assignments', assignmentRoutes);
app.use('/api/assignment-templates', assignmentTemplatesRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/meta-leads', metaLeadsRoutes);
app.use('/api/digital-exercises', digitalExercisesRoutes);
app.use('/api/dg', dgRoutes);
app.use('/api/sprechen', sprechenRoutes);
app.use('/api/visa-tracking', visaTrackingRoutes);
app.use('/api/student-payments', studentPaymentRoutes);
app.use('/api/batch-journey', batchJourneyRoutes);
app.use('/api/go-students', goStudentsRoutes);
app.use('/api/go-students-sinhala', goStudentsSinhalaRoutes);

app.use('/api/invoices', invoiceManagementRoutes);
app.use('/api/payment-submissions', paymentSubmissionsRoutes);
app.use('/api/support', supportTicketRoutes);
app.use('/api/olly', ollyRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/job-openings', jobOpeningsRoutes);
app.use('/api/crm', crmPortalRoutes);
app.use('/api/crm-portal', auth.verifyToken, crmPortalProxyRoutes);
app.use('/api/test-accounts', testAccountRoutes);
app.use('/api/gluckroom', gluckRoomRoutes);
app.use('/api/correction', correctionRoutes);
app.use('/api/class-feedback', classFeedbackRoutes);

const pdfExerciseGeneratorRoutes = require('./routes/pdfExerciseGenerator');
app.use('/api/pdf-exercises', pdfExerciseGeneratorRoutes);

const batchLeaderboardRoutes = require('./routes/batchLeaderboard');
app.use('/api/batch-leaderboard', batchLeaderboardRoutes);

const aiStagePhase1Routes = require('./routes/aiStagePhase1');
const aiStagePhase2Routes = require('./routes/aiStagePhase2');
const aiStagePhase3Routes = require('./routes/aiStagePhase3');
app.use('/api/ai-stage', aiStagePhase1Routes);
app.use('/api/ai-stage', aiStagePhase2Routes);
app.use('/api/ai-stage', aiStagePhase3Routes);

const listeningMediaRoutes = require('./routes/listeningMedia');
app.use('/api/listening-media', listeningMediaRoutes);
const r2UploadsRoutes = require('./routes/r2Uploads');
app.use('/api/r2', r2UploadsRoutes);

// Audio-based pronunciation evaluation (MediaRecorder → Whisper → scoring)
const pronunciationEvaluationRoutes = require('./routes/pronunciationEvaluation');
app.use('/api/pronunciation', pronunciationEvaluationRoutes);

const listeningWorksheetRoutes = require('./routes/listeningWorksheetGenerator');
app.use('/api/listening-worksheets', listeningWorksheetRoutes);

const classRecordingRoutes = require('./routes/classRecordings');
app.use('/api/class-recordings', classRecordingRoutes);

const recordingAccessRequestRoutes = require('./routes/recordingAccessRequests');
app.use('/api/recording-access-requests', recordingAccessRequestRoutes);

const journeyCrossBatchRecordingAccessRoutes = require('./routes/journeyCrossBatchRecordingAccess');
app.use('/api/journey-cross-batch-recording-access', journeyCrossBatchRecordingAccessRoutes);

const selfPaceRoutes = require('./routes/selfPace');
app.use('/api/self-pace', selfPaceRoutes);
app.use('/api/portal', portalRouter);
app.use('/api/portal-analytics', analyticsRouter);

const classResourceRoutes = require('./routes/classResources');
app.use('/api/class-resources', classResourceRoutes);

const goRecordingResourceRoutes = require('./routes/goRecordingResources');
app.use('/api/go-recording-resources', goRecordingResourceRoutes);

const classDoubtRoutes = require('./routes/classDoubts');
app.use('/api/class-doubts', classDoubtRoutes);

const interactiveGamesRoutes = require('./routes/interactiveGames');
const studentLoginStreakRoutes = require('./routes/studentLoginStreak');
app.use('/api/interactive-games', interactiveGamesRoutes);
app.use('/api/student/login-streak', studentLoginStreakRoutes);

const languageTrackingRoutes = require('./routes/languageTracking');
app.use('/api/language-tracking', languageTrackingRoutes);

const publicSignupRoutes = require('./routes/publicSignup');
app.use('/api/public-signup', publicSignupRoutes);
const classSubmissionRoutes = require('./routes/classSubmissions');
app.use('/api/class-submissions', classSubmissionRoutes);

const teacherResourceRoutes = require('./routes/teacherResources');
app.use('/api/teacher-resources', teacherResourceRoutes);

const googleSheetSyncRoutes = require('./routes/googleSheetSync');
app.use('/api/google-sheet', googleSheetSyncRoutes);

// Payment Hub v2
const registerPaymentModule = require('./modules/payments-v2/backend/register');
registerPaymentModule(app, { authMiddleware: auth.verifyToken, prefix: '/api/new-payments', enableCron: false });

// Enrollment Overview — isolated Sales student management (no Language Team writes)
const registerKrishDashboard = require('./modules/krish-dashboard/backend/register');
registerKrishDashboard(app, { authMiddleware: auth.verifyToken });

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.get("/api/user/profile", auth.verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) return res.status(404).json({ msg: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const frontendPath = path.join(__dirname, "dist", "angular-germanbuddy", "browser");
app.use(express.static(frontendPath));


// SPA catch-all — exclude /api and /ws (socket.io) paths
app.get(/^\/(?!api|ws).*/, (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// API 404 for unmatched API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});



// Student feedback route
app.use('/api/feedback', feedbackRoutes);

// Grading route
app.use('/api/grading', gradingRoutes);
app.post('/api/grade-assignment', async (req, res) => {
  try {
    const { assignmentId, studentId, level, taskType, submissionText } = req.body;
    const result = await gradeAssignment({ assignmentId, studentId, level, taskType, submissionText });
    res.json(result);
  } catch (err) {
    console.error('Error grading assignment:', err);
    res.status(500).json({ error: 'Failed to grade assignment' });
  } finally {
    // Optional: Clean up uploaded files if needed
    // fs.unlink(req.file.path, (err) => {
    //   if (err) console.error('Error deleting uploaded file:', err);
    // });
  }
});

const PORT = process.env.PORT || 4000;

let httpServer = null;
let isShuttingDown = false;
const SHUTDOWN_FORCE_MS = 3000;

function stopBackgroundWork() {
  try {
    const cron = require('node-cron');
    const tasks = cron.getTasks?.();
    if (tasks) {
      for (const task of tasks.values()) {
        task.stop();
      }
    }
  } catch (err) {
    console.warn('[shutdown] cron stop:', err.message);
  }
  try {
    const overdueCron = require('./modules/payments-v2/backend/helpers/overdueCron');
    const journeyDueCron = require('./modules/payments-v2/backend/helpers/journeyDueCron');
    overdueCron.stop();
    journeyDueCron.stop();
  } catch { /* payment crons optional */ }
}

function closeArenaSockets() {
  try {
    const { getIo } = require('./sockets/glueckArenaMultiplayer');
    const io = getIo();
    if (!io) return;
    if (typeof io.disconnectSockets === 'function') {
      io.disconnectSockets(true);
    }
    io.close();
  } catch { /* sockets optional */ }
}

function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`[shutdown] ${signal} received — closing server`);

  const forceExitTimer = setTimeout(() => {
    console.warn(`[shutdown] forcing exit after ${SHUTDOWN_FORCE_MS}ms`);
    process.exit(1);
  }, SHUTDOWN_FORCE_MS);
  if (typeof forceExitTimer.unref === 'function') {
    forceExitTimer.unref();
  }

  stopBackgroundWork();
  closeArenaSockets();

  const finish = () => {
    clearTimeout(forceExitTimer);
    mongoose
      .disconnect()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  if (!httpServer) {
    finish();
    return;
  }

  if (typeof httpServer.closeAllConnections === 'function') {
    httpServer.closeAllConnections();
  }

  httpServer.close((err) => {
    if (err) console.warn('[shutdown] http close:', err.message);
    finish();
  });
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));

connectMongoDb()
  .then(() => {
    const envCheck = require('./services/interactiveGames/productionHealth').validateEnvironment();
    if (envCheck.warnings.length) console.warn('[glueck-arena] Env warnings:', envCheck.warnings);
    if (!envCheck.ok) console.error('[glueck-arena] Env errors:', envCheck.errors);

    httpServer = http.createServer(app);
    initGlueckArenaSockets(httpServer);
    initGluckRoomControls(httpServer, app);
    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);

      scheduleMetaToMondaySync();
      scheduleAutoFetchAttendance();
      scheduleJourneyDayRollover();
      scheduleZoomMeetingReminderEmails();
      scheduleZoomMeetingLinkHealth();
      schedulePublishScheduledAnnouncements();

      if (isWhatsappAutomatedJobsEnabled()) {
        scheduleClassReminders();
        scheduleAbsenceAlerts();
        scheduleMissedActivitiesAlerts();
        scheduleWeeklyReports();
        scheduleConsecutiveAbsenceAlerts();
        schedulePaymentOverdueReminder();
        console.log('[WhatsApp] Automated notification jobs scheduled');
      } else {
        console.log('[WhatsApp] Automated jobs OFF — manual CRM send still available if WHATSAPP_MANUAL_SEND_ENABLED=true');
      }
      // Daily task reminder runs email regardless of WhatsApp gate
      scheduleDailyTaskReminder();
      scheduleConsecutiveAbsenceEmailReport();
      scheduleStudentPortalCrmFullSync();
      schedulePortalSessionStaleClose();
      scheduleGlueckArenaJobs();
      scheduleGluckRoomAutoStart();
      scheduleDailyStudentStatusReport();
      scheduleStudentDetailChangesReport();
      scheduleCrucialStudentsReport();
      scheduleNeverLoggedInReport();
      scheduleBatchDay1Reminders();
      scheduleMilestoneAbsenceAlerts();
      scheduleWeeklyAbsenceSummary();
      scheduleWeeklyMilestoneChecks();
      scheduleLateJoinEarlyExitAlerts();
      scheduleFeedbackNotifications();

      const overdueCron = require('./modules/payments-v2/backend/helpers/overdueCron');
      const journeyDueCron = require('./modules/payments-v2/backend/helpers/journeyDueCron');
      overdueCron.start();
      journeyDueCron.start();
    });
  })
  .catch((err) => {
    const msg = String(err?.message || err || '');
    console.error('❌ MongoDB connection failed — server not started:', msg);
    if (/ENOTFOUND|querySrv/i.test(msg)) {
      console.error(
        '   DNS: set Windows DNS to 1.1.1.1 and 8.8.8.8, run "ipconfig /flushdns", restart terminal, then "node app.js".'
      );
      console.error('   Or add to .env: MONGO_DNS_SERVERS=1.1.1.1,8.8.8.8');
    }
    if (/whitelist|server selection timed out|Could not connect to any servers/i.test(msg)) {
      console.error(
        '   Atlas: add your current public IP in MongoDB Atlas → Network Access → IP Access List (or use 0.0.0.0/0 for dev only).'
      );
    }
    console.error('   Also verify MONGO_URI and Atlas database user password in .env.');
    process.exit(1);
  });
