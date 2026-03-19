// models/User.js

const mongoose = require("mongoose");
const { readBuilderProgram } = require("typescript");

const completionDates = new mongoose.Schema({
  A1CompletionDate: { type: Date },
  A2CompletionDate: { type: Date },
  B1CompletionDate: { type: Date },
  B2CompletionDate: { type: Date }
}, { _id: false });

const startDates = new mongoose.Schema({
  A1StartDate: { type: Date },
  A2StartDate: { type: Date },
  B1StartDate: { type: Date },
  B2StartDate: { type: Date }
}, { _id: false });

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  regNo: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["STUDENT", "TEACHER", "ADMIN", "TEACHER_ADMIN"], required: true },
  subscription: { type: String, enum: ["SILVER", "PLATINUM"], required: function() { return this.role === "STUDENT"; } },
  level: { type: String, enum: ["A1", "A2", "B1", "B2", "C1", "C2"], required: function() { return this.role === "STUDENT"; }},
  batch: { type: String, required: function() { return this.role === "STUDENT"; }},
  medium: { type: [String], required: function() { return this.role === "STUDENT" || this.role === "TEACHER"; }},
  conversationId: { type: String, default: "" },
  assignedCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: function() { return this.role === "TEACHER"; } }], // Courses assigned to the user
  assignedBatches: [{ type: String, required: function() { return this.role === "TEACHER"; } }], // Batches assigned to the teacher
  assignedTeacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, function() { return this.role === "STUDENT"; } }, // Teacher assigned to the student
  isActive: { type: Boolean, default: true },
  profilePic: { type: String, default: "" },
  subscriptionExpiry: { type: Date, default: null },
  lastLogin: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  registeredAt: { type: Date, default: Date.now },
  lastCredentialsEmailSent: { type: Date, default: null },
  studentStatus: { type: String, enum: ["UNCERTAIN", "ONGOING", "COMPLETED", "WITHDREW"], required: function() { return this.role === "STUDENT"; } },
  phoneNumber: { type: String, default: "", required: false, function() { return this.role === "STUDENT"; } },
  address: { type: String, default: "", required: false, function() { return this.role === "STUDENT"; } },
  age: { type: Number, default: null, required: false, function() { return this.role === "STUDENT"; } },

  leadSource: { type: String, default: "", required: false, function() { return this.role === "STUDENT"; } },
  languageLevelOpted: { type: String, default: "", required: false, function() { return this.role === "STUDENT"; } },
  dateWithdrew: { type: Date, default: null, function() { return this.role === "STUDENT" && this.studentStatus === "WITHDREW"; }  },
  reasonForWithdrawing: { type: String, default: "", function() { return this.role === "STUDENT" && this.studentStatus === "WITHDREW"; }  },
  courseCompletionDates: {type: completionDates, default: () => ({}) , function() { return this.role === "STUDENT"; }  },
  courseStartDates: {type: startDates, default: () => ({}) , function() { return this.role === "STUDENT"; }  },
  qualifications: { type: String, default: "", function() { return this.role === "STUDENT"; }  },
  whatsappNumber: { type: String, default: "", function() { return this.role === "STUDENT"; } },
  otherLanguageKnown: { type: String, default: "", function() { return this.role === "STUDENT"; } },
  enrollmentDate: { type: Date, default: null, function() { return this.role === "STUDENT"; } },
  servicesOpted: { type: String, default: "", function() { return this.role === "STUDENT"; } },
  stream: { type: String, default: "", function() { return this.role === "STUDENT"; } },
  batchStartedOn: { type: Date, default: null, function() { return this.role === "STUDENT"; } },
  teacherIncharge: { type: String, default: "", function() { return this.role === "STUDENT"; } },
  languageExamStatus: { type: String, default: "", function() { return this.role === "STUDENT"; } },
  examPassedDate: { type: Date, default: null, function() { return this.role === "STUDENT"; } },
  examScores: {
    reading: { type: Number, default: null },
    listening: { type: Number, default: null },
    writing: { type: Number, default: null },
    speaking: { type: Number, default: null }
  },
  examRemark: { type: String, default: "", function() { return this.role === "STUDENT"; } },
  candidateStatus: { type: String, default: "", function() { return this.role === "STUDENT"; } },

  // ✅ move these inside schema
  courseProgress: [{
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    progressPercent: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
  }],
});

module.exports = mongoose.model("User", UserSchema);
