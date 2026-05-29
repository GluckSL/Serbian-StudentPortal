//models/Course.js

const mongoose = require("mongoose");

const CourseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  //teacherName: { type: String, required: true },
  //teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Referring to the teacher user
  // students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Array of students enrolled
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

CourseSchema.index({ title: 1 });

module.exports = mongoose.model("Course", CourseSchema);
