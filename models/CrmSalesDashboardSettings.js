const mongoose = require('mongoose');

/**
 * Saved counsellor shortlist for the CRM Sales Dashboard.
 * Single shared doc for the portal (admins select once; used every load).
 */
const crmSalesDashboardSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    /**
     * Display names / match keys for watched counsellors.
     * Matching is case-insensitive against CRM `assignedSalesRepresentative`.
     */
    counsellorNames: {
      type: [String],
      default: () => [],
    },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  'CrmSalesDashboardSettings',
  crmSalesDashboardSettingsSchema
);
