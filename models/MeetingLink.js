// models/MeetingLink.js
const mongoose = require('mongoose');

const meetingLinkSchema = new mongoose.Schema({
  // Basic Info
  batch: { type: String, required: true },
  plan: { type: String, required: true, enum: ['SILVER', 'PLATINUM', 'VISA_DOC_ONLY'] },
  platform: { type: String, required: true },
  link: { type: String, required: true },
  
  // Meeting Details
  topic: { type: String },
  agenda: { type: String },
  startTime: { type: Date },
  duration: { type: Number }, // in minutes
  timezone: { type: String, default: 'Asia/Colombo' },
  
  // Optional: day in the 200-day course journey
  courseDay: { type: Number, default: null, min: 0, max: 200 },

  /** Groups rows created in one bulk journey scheduling run (optional). */
  bulkScheduleId: { type: String, default: null, index: true },

  /** Optional per-meeting metadata from bulk journey UI (module / agent / notes). */
  journeyBulkMeta: {
    moduleId: { type: mongoose.Schema.Types.ObjectId, default: null },
    aiAgentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    notes: { type: String, default: '' }
  },
  
  // Zoom-specific fields
  zoomMeetingId: { type: String }, // Zoom meeting ID
  zoomMeetingUuid: { type: String }, // Zoom meeting UUID (needed for past meeting reports)
  zoomPassword: { type: String },
  hostEmail: { type: String },
  startUrl: { type: String }, // For host to start meeting
  joinUrl: { type: String }, // For participants to join

  // Last time the Zoom meeting was verified to still exist on Zoom's side.
  // Used to throttle the auto expiry-check + regeneration on join.
  lastZoomCheckAt: { type: Date },
  
  // Admin/user who created the meeting
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },

  // Teacher assigned to host/teach the class
  assignedTeacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Students invited to the meeting
  attendees: [{
    studentId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    name: String,
    email: String,
    registrantId: String, // Zoom registrant ID
    joinUrl: String, // Personal join URL for this student
    addedAt: { type: Date, default: Date.now }
  }],
  
  // Meeting status
  status: {
    type: String,
    enum: ['scheduled', 'started', 'ended', 'cancelled'],
    default: 'scheduled'
  },
  
  // Attendance tracking
  attendance: [{
    studentId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    name: String,
    email: String,
    attended: { type: Boolean, default: false },
    joinTime: Date,
    leaveTime: Date,
    duration: Number, // in seconds
    durationMinutes: Number, // in minutes
    attendancePercent: { type: Number }, // optional; % of meeting duration present
    status: { type: String, enum: ['attended', 'absent', 'late'], default: 'absent' },
    
    // Enhanced matching fields
    confidence: { type: Number, default: 0 }, // 0-100
    finalConfidence: { type: Number },
    confidenceLevel: { type: String, enum: ['high', 'medium', 'low'] },
    debugSummary: { type: String },
    matchMethod: { 
      type: String, 
      enum: ['email', 'email_local', 'exact_name', 'exact_trim_name', 'sanitized_name', 'partial_name', 'fuzzy_name', 'containment', 'single_participant', 'no_match', 'manual_map', 'manual_mark', 'manual_mark_all', 'manual_add', 'initials_name', 'join_log_time', 'ambiguous'], 
      default: 'no_match' 
    },
    zoomName: String, // Name displayed in Zoom
    zoomEmail: String, // Email from Zoom (if available)
    needsReview: { type: Boolean, default: false },

    // Matching diagnostics & integrity hints
    debug: { type: mongoose.Schema.Types.Mixed },
    clickedJoin: { type: Boolean, default: false },
    appearedInZoom: { type: Boolean, default: false },
    mismatchReason: { type: String, default: null },
  }],
  
  // Attendance metadata
  attendanceRecorded: { type: Boolean, default: false },
  attendanceRecordedAt: Date,
  attendanceRetries: { type: Number, default: 0 },
  attendanceError: { type: String, default: '' },
  
  // Reminder emails (~10 min before start) — not sent at schedule time
  reminderEmailSent: { type: Boolean, default: false },
  reminderEmailSentAt: Date,

  // WhatsApp CRM notification flags
  reminderWhatsappSent: { type: Boolean, default: false },
  reminderWhatsappSentAt: Date,
  absenceWhatsappSent: { type: Boolean, default: false },
  absenceWhatsappSentAt: Date,

  // Early join reminder (automated: 5 min after start, students not yet in JoinLog)
  earlyJoinReminderSent: { type: Boolean, default: false },
  earlyJoinReminderSentAt: Date,

  // Post-class feedback notification
  feedbackNotificationSent: { type: Boolean, default: false },
  feedbackNotificationSentAt: Date,

  // Email notification status
  emailNotificationStatus: {
    attempted: { type: Number, default: 0 },
    successful: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    allSent: { type: Boolean, default: false },
    failedStudents: [{
      name: String,
      email: String,
      error: String
    }],
    lastAttempt: Date
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

meetingLinkSchema.index({ batch: 1, status: 1, courseDay: 1 });
meetingLinkSchema.index({ assignedTeacher: 1, startTime: 1 });

// Update timestamp on save
meetingLinkSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('MeetingLink', meetingLinkSchema);
