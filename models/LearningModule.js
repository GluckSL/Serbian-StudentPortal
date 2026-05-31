// Learning Modules replaced by DG Bot. Stub keeps legacy routes loadable.
const mongoose = require('mongoose');

const learningModuleSchema = new mongoose.Schema(
  {
    title: String,
    level: String,
    category: String,
    courseDay: Number,
    isActive: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: true },
    visibleToStudents: { type: Boolean, default: false },
    targetBatchKeys: [String]
  },
  { timestamps: true }
);

module.exports = mongoose.models.LearningModule ||
  mongoose.model('LearningModule', learningModuleSchema);
