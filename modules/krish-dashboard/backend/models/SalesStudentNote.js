/**
 * SalesStudentNote — notes and follow-ups for a Sales student.
 */
const mongoose = require('mongoose');

const salesStudentNoteSchema = new mongoose.Schema(
  {
    salesStudentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SalesStudent',
      required: true,
      index: true,
    },
    type: { type: String, enum: ['NOTE', 'FOLLOW_UP'], default: 'NOTE' },
    content: { type: String, required: true, trim: true },
    followUpDate: { type: Date, default: null },
    isCompleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    collection: 'sales_student_notes',
  }
);

salesStudentNoteSchema.index({ salesStudentId: 1, createdAt: -1 });
salesStudentNoteSchema.index({ type: 1, isCompleted: 1, followUpDate: 1 });

module.exports =
  mongoose.models['SalesStudentNote'] ||
  mongoose.model('SalesStudentNote', salesStudentNoteSchema);
