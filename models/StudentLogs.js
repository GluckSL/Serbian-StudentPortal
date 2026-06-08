// StudentLogs.js
const mongoose = require("mongoose");

const StudentLogsSchema = new mongoose.Schema({
    action: { type: String, required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    levelAtUpdate: { type: String, enum: ["A1", "A2", "B1", "B2", "C1", "C2"], required: true },
    batchAtUpdate: { type: String, required: true },
    assignedTeacherAtUpdate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false
    },
    statusAtUpdate: { type: String, enum: ["UNCERTAIN", "ONGOING", "COMPLETED", "WITHDREW"], required: true },
    subscriptionAtUpdate: { type: String, enum: ["SILVER", "PLATINUM", "DOCS_RECOGNITION", "VISA_DOC", "POST_LANDING", "VISA_DOC_ONLY"], required: true },
    mediumAtUpdate: { type: [String], required: true },
    updatedAt: { type: Date, default: Date.now }
});

StudentLogsSchema.index({ studentId: 1, updatedAt: -1 });
StudentLogsSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("StudentLogs", StudentLogsSchema);