//models/GradingResult.js
const mongoose = require("mongoose");
const GradingResultSchema = new mongoose.Schema({
  assignmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "AssignmentTemplate",
    required: true,
  },
  level: String,
  taskType: String,

  scores: Object,
  totalScore: Number,

  feedback: [String],
  modelUsed: String,
  promptVersion: String,

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },

  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  scores: [
    {
      criterionId: { type: mongoose.Schema.Types.ObjectId, required: true },
      score: { type: Number, required: true },
      feedback: { type: String },
    }, ],
  totalScore: { type: Number, required: true },
  gradedAt: { type: Date, default: Date.now },
});

GradingResultSchema.index({ studentId: 1 });

module.exports = mongoose.model("GradingResult", GradingResultSchema);


