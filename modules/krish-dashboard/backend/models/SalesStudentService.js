/**
 * SalesStudentService — services opted by a Sales student (CRM "Service Opted" values).
 */
const mongoose = require('mongoose');

/** Default display order for dashboard cards (CRM service opted values). */
const SERVICE_OPTED_CATALOG = [
  'Only for language',
  'Ausbildung',
  'Dependant',
  'Skilled Jobs',
];

const salesStudentServiceSchema = new mongoose.Schema(
  {
    salesStudentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SalesStudent',
      required: true,
      index: true,
    },
    serviceName: { type: String, required: true, trim: true },
  },
  {
    timestamps: true,
    collection: 'sales_student_services',
  }
);

salesStudentServiceSchema.index({ serviceName: 1 });
salesStudentServiceSchema.index({ salesStudentId: 1, serviceName: 1 }, { unique: true });
salesStudentServiceSchema.index({ serviceName: 1, salesStudentId: 1 });

module.exports =
  mongoose.models['SalesStudentService'] ||
  mongoose.model('SalesStudentService', salesStudentServiceSchema);

module.exports.SERVICE_OPTED_CATALOG = SERVICE_OPTED_CATALOG;
