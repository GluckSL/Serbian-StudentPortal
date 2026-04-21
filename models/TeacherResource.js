const mongoose = require('mongoose');

const teacherResourceSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true },
  day: { type: String, required: true, trim: true },
  batch: { type: String, default: '', trim: true, index: true },
  level: { type: String, default: '', trim: true, index: true },
  plan: { type: String, default: '', trim: true, index: true },
  resourceType: { type: String, default: '', trim: true },
  topic: { type: String, default: '', trim: true },
  description: { type: String, default: '', trim: true },
  fileName: { type: String, required: true },
  originalName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  mimeType: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TeacherResource', teacherResourceSchema);
