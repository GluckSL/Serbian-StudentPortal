/**
 * SalesStudentStatusHistory — append-only log of status changes for a Sales student.
 * Written automatically whenever the student's status field changes.
 */
const mongoose = require('mongoose');

const salesStudentStatusHistorySchema = new mongoose.Schema(
  {
    salesStudentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SalesStudent',
      required: true,
      index: true,
    },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'sales_student_status_history',
  }
);

salesStudentStatusHistorySchema.index({ salesStudentId: 1, createdAt: -1 });

module.exports =
  mongoose.models['SalesStudentStatusHistory'] ||
  mongoose.model('SalesStudentStatusHistory', salesStudentStatusHistorySchema);
