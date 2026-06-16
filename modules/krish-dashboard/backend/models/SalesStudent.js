/**
 * SalesStudent — Sales Team student record.
 *
 * ISOLATION RULE: This model is completely independent of the Language Team
 * `User` (role: STUDENT) collection. No field here references portal student
 * IDs. The same person may exist in both systems; that is intentional and
 * required by the business. Never sync or cross-write between the two.
 */
const mongoose = require('mongoose');

const PACKAGES = ['PLATINUM', 'SILVER', 'VISA_DOCS'];
const STATUSES = ['NOT_STARTED', 'UNCERTAIN', 'ONGOING', 'COMPLETED', 'WITHDREW'];

const salesStudentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true, default: '' },
    age: { type: Number, default: null },
    package: { type: String, enum: PACKAGES, required: true },
    status: { type: String, enum: STATUSES, required: true, default: 'UNCERTAIN' },
    counselor: { type: String, trim: true, default: '' },
    /** CRM "Professional" column (e.g. O/L, Engineer, IT Professional) — drill-down cards. */
    profession: { type: String, trim: true, default: '' },
    qualifications: { type: String, trim: true, default: '' },
    /** CRM "Specialization" column — stored separately, not used for profession cards. */
    specialization: { type: String, trim: true, default: '' },
    /** CRM "Current language level" column. */
    currentLanguageLevel: { type: String, trim: true, default: '' },
    /** CRM "Document Payment Status" column. */
    documentPaymentStatus: { type: String, trim: true, default: '' },
    /** CRM "Documentation status" column. */
    documentationStatus: { type: String, trim: true, default: '' },
    /** CRM "Documentation Remarks" column. */
    documentationRemarks: { type: String, trim: true, default: '' },
    /** CRM "Visa status" column. */
    visaStatus: { type: String, trim: true, default: '' },
    notes: { type: String, default: '' }, // short inline note; full notes in SalesStudentNote
    // Staff audit refs — read-only after write; NOT portal student refs
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    collection: 'sales_students',
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────
salesStudentSchema.index({ email: 1 }, { unique: true });
salesStudentSchema.index({ status: 1, package: 1 });
salesStudentSchema.index({ package: 1, status: 1, updatedAt: -1 });
salesStudentSchema.index({ counselor: 1 });
salesStudentSchema.index({ updatedAt: -1 });
salesStudentSchema.index({ name: 'text', email: 'text', phone: 'text' });
salesStudentSchema.index({ status: 1, updatedAt: -1 });
salesStudentSchema.index({ profession: 1, status: 1 });

module.exports =
  mongoose.models['SalesStudent'] ||
  mongoose.model('SalesStudent', salesStudentSchema);
