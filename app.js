//app.js

require("dotenv").config();

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
const path = require('path');
const mongoose = require("mongoose");
const cors = require("cors");
const dns = require('dns').promises;
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

const isProduction = process.env.NODE_ENV === 'production';

/** In dev, allow any localhost / 127.0.0.1 port so ng serve --port works. */
function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
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
const learningModulesRoutes = require('./routes/learningModules');
const aiTutorRoutes = require('./routes/aiTutor');
const studentProgressRoutes = require('./routes/studentProgress');
const aiModuleGeneratorRoutes = require('./routes/aiModuleGenerator');
const sessionRecordsRoutes = require('./routes/sessionRecords');
const translationRoutes = require('./routes/translation');
const moduleTrashRoutes = require('./routes/moduleTrash');
const adminAnalyticsRoutes = require('./routes/adminAnalytics');
const zoomRoutes = require('./routes/zoom');
const zoomWebhookRoutes = require('./routes/zoomWebhook');
const joinClassRoutes = require('./routes/joinClass');
const upgradeRequestsRoutes = require('./routes/upgradeRequests');
const studentLogRoutes = require('./routes/studentLog');
const studentDocumentsRoutes = require('./routes/studentDocuments');
const documentRequirementsRoutes = require('./routes/documentRequirements');

const assignmentRoutes = require('./routes/assignments');
const assignmentTemplatesRoutes = require('./routes/assignmentTemplates');
const notificationRoutes = require('./routes/notifications');
const metaLeadsRoutes = require('./routes/metaLeads');
const digitalExercisesRoutes = require('./routes/digitalExercises');
const dgRoutes = require('./routes/dg');
const visaTrackingRoutes = require('./routes/visaTracking');
const studentPaymentRoutes = require('./routes/studentPayments');
const batchJourneyRoutes = require('./routes/batchJourney');
const goStudentsRoutes = require('./routes/goStudents');
const invoiceManagementRoutes = require('./routes/invoiceManagement');
const paymentSubmissionsRoutes = require('./routes/paymentSubmissions');
const supportTicketRoutes = require('./routes/supportTickets');
const announcementRoutes = require('./routes/announcements');
const crmStudentPortalRoutes = require('./routes/crmStudentPortal');
const reminderRoutes = require('./routes/reminders');
const crmPortalRoutes = require('./routes/crmPortal');
const testAccountRoutes = require('./routes/testAccounts');

const gradingRoutes = require("./routes/grading");
const { gradeAssignment } = require("./services/grading.service");

// Import and schedule Meta to Monday.com sync job
const { scheduleMetaToMondaySync } = require('./jobs/metaToMondaySync');

// Import and schedule auto-fetch Zoom attendance job
const { scheduleAutoFetchAttendance } = require('./jobs/autoFetchAttendance');
const { scheduleJourneyDayRollover } = require('./jobs/journeyDayRollover');
const { scheduleZoomMeetingReminderEmails } = require('./jobs/zoomMeetingReminderEmails');

// WhatsApp CRM notification jobs
const { scheduleClassReminders } = require('./jobs/whatsapp/classReminder');
const { scheduleAbsenceAlerts } = require('./jobs/whatsapp/absenceAlert');
const { scheduleMissedActivitiesAlerts } = require('./jobs/whatsapp/missedActivities');
const { scheduleWeeklyReports } = require('./jobs/whatsapp/weeklyReport');
const { scheduleConsecutiveAbsenceAlerts } = require('./jobs/whatsapp/consecutiveAbsence');
const { scheduleStudentPortalCrmFullSync } = require('./jobs/studentPortalCrmFullSync');
const { schedulePortalSessionStaleClose } = require('./jobs/portalSessionStaleClose');
const { portalRouter, analyticsRouter } = require('./routes/portalAnalytics.routes');

// Multer setup for file uploads
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.set('trust proxy', true); // trust first proxy (if behind a proxy like Nginx or Heroku)


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

/** Wait for MongoDB before accepting traffic / crons — avoids Mongoose “buffering timed out” spam when Atlas is unreachable. */
async function connectMongoDb() {
  await warnIfSuspiciousMongoDns(mongoUri).catch(() => {});
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 45_000,
    socketTimeoutMS: 45_000,
  });
  console.log(`✅ Connected to MongoDB (${process.env.NODE_ENV || 'development'})`);
  await ensureDefaultDgCharacter();
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
app.use('/api/learning-modules', learningModulesRoutes);
app.use('/api/ai-tutor', aiTutorRoutes);
app.use('/api/student-progress', studentProgressRoutes);
const adminPerformanceRoutes = require('./routes/adminPerformance');
app.use('/api/admin-performance', adminPerformanceRoutes);
app.use('/api/ai', aiModuleGeneratorRoutes);
app.use('/api/session-records', sessionRecordsRoutes);
app.use('/api/translate', translationRoutes);
app.use('/api/module-trash', moduleTrashRoutes);
app.use('/api/admin-analytics', adminAnalyticsRoutes);
app.use('/api/zoom', zoomRoutes);
app.use('/api', joinClassRoutes);
app.use('/api', joinClassRoutes);
app.use('/api/upgrade-requests', upgradeRequestsRoutes);
app.use('/api/studentLog', studentLogRoutes);
app.use('/api/student-documents', studentDocumentsRoutes);
app.use('/api/document-requirements', documentRequirementsRoutes);

app.use('/api/assignments', assignmentRoutes);
app.use('/api/assignment-templates', assignmentTemplatesRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/meta-leads', metaLeadsRoutes);
app.use('/api/digital-exercises', digitalExercisesRoutes);
app.use('/api/dg', dgRoutes);
app.use('/api/visa-tracking', visaTrackingRoutes);
app.use('/api/student-payments', studentPaymentRoutes);
app.use('/api/batch-journey', batchJourneyRoutes);
app.use('/api/go-students', goStudentsRoutes);

app.use('/api/invoices', invoiceManagementRoutes);
app.use('/api/payment-submissions', paymentSubmissionsRoutes);
app.use('/api/support', supportTicketRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/reminders', reminderRoutes);
const allRemindersRoutes = require('./routes/allReminders');
app.use('/api/allreminders', allRemindersRoutes);
app.use('/api/crm', crmPortalRoutes);
app.use('/api/test-accounts', testAccountRoutes);
app.use('/api/crm-student-portal', crmStudentPortalRoutes);

const pdfExerciseGeneratorRoutes = require('./routes/pdfExerciseGenerator');
app.use('/api/pdf-exercises', pdfExerciseGeneratorRoutes);

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
app.use('/api/portal', portalRouter);
app.use('/api/portal-analytics', analyticsRouter);

const classResourceRoutes = require('./routes/classResources');
app.use('/api/class-resources', classResourceRoutes);

const classDoubtRoutes = require('./routes/classDoubts');
app.use('/api/class-doubts', classDoubtRoutes);

const classSubmissionRoutes = require('./routes/classSubmissions');
app.use('/api/class-submissions', classSubmissionRoutes);

const teacherResourceRoutes = require('./routes/teacherResources');
app.use('/api/teacher-resources', teacherResourceRoutes);

// Payment Hub v2
const registerPaymentModule = require('./modules/payments-v2/backend/register');
registerPaymentModule(app, { authMiddleware: auth.verifyToken, prefix: '/api/new-payments', enableCron: true });

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


app.get("*", (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendPath, 'index.html'));
  } else {
    res.status(404).json({ error: 'API route not found' });
  }
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

connectMongoDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);

      scheduleMetaToMondaySync();
      scheduleAutoFetchAttendance();
      scheduleJourneyDayRollover();
      scheduleZoomMeetingReminderEmails();

      scheduleClassReminders();
      scheduleAbsenceAlerts();
      scheduleMissedActivitiesAlerts();
      scheduleWeeklyReports();
      scheduleConsecutiveAbsenceAlerts();
      scheduleStudentPortalCrmFullSync();
      schedulePortalSessionStaleClose();
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed — server not started:', err.message || err);
    console.error(
      '   Fix: verify MONGO_URI, Atlas Database User password, and Network Access (IP allowlist: add 0.0.0.0/0 for testing or your current IP). ' +
      'SRV DNS can succeed while the driver still cannot complete TLS/auth.'
    );
    process.exit(1);
  });


