const mongoose = require('mongoose');

const dynamicFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  page: { type: Number, required: true },    // 1-indexed
  x: { type: Number, required: true },       // 0–1 normalized (fraction of page width)
  y: { type: Number, required: true },       // 0–1 normalized (fraction of page height)
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  sampleText: { type: String, default: '' }, // exact text in PDF (e.g. {{studentName}})
  placeholderToken: { type: String, default: '' }, // same as sampleText when using {{…}} markers
  fontSize: { type: Number, default: 11 },
  required: { type: Boolean, default: true }
}, { _id: false, id: false });

const agreementTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  description: { type: String, default: '' },
  r2Key: { type: String, default: '' }, // PDF preview; optional when docxR2Key is set
  /** Original DOCX for real {{placeholder}} replacement (recommended). */
  docxR2Key: { type: String, default: '' },
  fillMode: { type: String, enum: ['docx', 'overlay'], default: 'overlay' },
  pageCount: { type: Number, default: 0 },
  dynamicFields: { type: [dynamicFieldSchema], default: [] },
  aiSuggestions: { type: mongoose.Schema.Types.Mixed, default: null },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

agreementTemplateSchema.index({ isActive: 1, name: 1 });

module.exports = mongoose.model('AgreementTemplate', agreementTemplateSchema);
