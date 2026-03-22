//app.js

require("dotenv").config();
const express = require("express");
const app = express();
const path = require('path');
const mongoose = require("mongoose");
const cors = require("cors");
const auth = require("./middleware/auth");

const allowedOrigins =  ['http://localhost:4200', 'http://16.170.204.125', 'http://13.62.216.210', 'https://13.62.216.210', 'https://gluckstudentsportal.com']; // frontend origin


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
const upgradeRequestsRoutes = require('./routes/upgradeRequests');
const studentLogRoutes = require('./routes/studentLog');
const studentDocumentsRoutes = require('./routes/studentDocuments');
const documentRequirementsRoutes = require('./routes/documentRequirements');

const assignmentRoutes = require('./routes/assignments');
const assignmentTemplatesRoutes = require('./routes/assignmentTemplates');
const notificationRoutes = require('./routes/notifications');
const metaLeadsRoutes = require('./routes/metaLeads');
const digitalExercisesRoutes = require('./routes/digitalExercises');
const visaTrackingRoutes = require('./routes/visaTracking');
const studentPaymentRoutes = require('./routes/studentPayments');

const gradingRoutes = require("./routes/grading");
const { gradeAssignment } = require("./services/grading.service");

// Import and schedule Meta to Monday.com sync job
const { scheduleMetaToMondaySync } = require('./jobs/metaToMondaySync');

// Import and schedule auto-fetch Zoom attendance job
const { scheduleAutoFetchAttendance } = require('./jobs/autoFetchAttendance');

// Multer setup for file uploads
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const cookieParser = require('cookie-parser');

app.set('trust proxy', true); // trust first proxy (if behind a proxy like Nginx or Heroku)


// Middleware
app.use(express.json());

app.use(cors({
  origin: allowedOrigins,
  credentials: true,           // ✅ important for sending cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(cookieParser()); // Add cookie parser middleware

// Connect to MongoDB with environment-based URI
const mongoUri =
  process.env.NODE_ENV === 'production'
    ? process.env.MONGO_URI
    : process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/Updated-Gluck-Portal';

mongoose.connect(mongoUri)
  .then(() => {
    console.log(`✅ Connected to MongoDB (${process.env.NODE_ENV || 'development'})`);
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
  });

/* Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ Error connecting to MongoDB Atlas:', err));
*/


/* Connect to local MongoDB for development
mongoose.connect("mongodb://127.0.0.1:27017/Updated-Gluck-Portal", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('✅ Connected to LOCAL MongoDB'))
  .catch(err => console.error('❌ Error connecting to MongoDB:', err));
*/

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
app.use('/api/ai', aiModuleGeneratorRoutes);
app.use('/api/session-records', sessionRecordsRoutes);
app.use('/api/translate', translationRoutes);
app.use('/api/module-trash', moduleTrashRoutes);
app.use('/api/admin-analytics', adminAnalyticsRoutes);
app.use('/api/zoom', zoomRoutes);
app.use('/api/upgrade-requests', upgradeRequestsRoutes);
app.use('/api/studentLog', studentLogRoutes);
app.use('/api/student-documents', studentDocumentsRoutes);
app.use('/api/document-requirements', documentRequirementsRoutes);

app.use('/api/assignments', assignmentRoutes);
app.use('/api/assignment-templates', assignmentTemplatesRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/meta-leads', metaLeadsRoutes);
app.use('/api/digital-exercises', digitalExercisesRoutes);
app.use('/api/visa-tracking', visaTrackingRoutes);
app.use('/api/student-payments', studentPaymentRoutes);

const pdfExerciseGeneratorRoutes = require('./routes/pdfExerciseGenerator');
app.use('/api/pdf-exercises', pdfExerciseGeneratorRoutes);

const listeningMediaRoutes = require('./routes/listeningMedia');
app.use('/api/listening-media', listeningMediaRoutes);

const listeningWorksheetRoutes = require('./routes/listeningWorksheetGenerator');
app.use('/api/listening-worksheets', listeningWorksheetRoutes);

const classRecordingRoutes = require('./routes/classRecordings');
app.use('/api/class-recordings', classRecordingRoutes);

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

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  
  // Initialize cron jobs
  scheduleMetaToMondaySync();
  scheduleAutoFetchAttendance();
});


