const mongoose = require('mongoose');

const metaDefaultsSchema = new mongoose.Schema(
  {
    remainderFrom: { type: String, default: '' },
    participate: { type: String, default: '' },
    feedbackForm: { type: String, default: '' }
  },
  { _id: false }
);

const crmStudentPortalSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    /** If set, overrides process.env.STUDENT_PORTAL_CRM_WEBHOOK_URL */
    webhookUrlOverride: { type: String, default: '' },
    metaDefaults: { type: metaDefaultsSchema, default: () => ({}) },
    /** event name -> boolean; missing key treated as enabled */
    enabledEvents: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    cronEnabled: { type: Boolean, default: false },
    cronExpression: { type: String, default: '0 2 * * *' },
    lastFullSyncAt: { type: Date, default: null },
    lastFullSyncResult: { type: mongoose.Schema.Types.Mixed, default: null },
    lastDispatchError: { type: String, default: '' },
    lastDispatchAt: { type: Date, default: null },
    lastDispatchSuccessAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('CrmStudentPortalSettings', crmStudentPortalSettingsSchema);
