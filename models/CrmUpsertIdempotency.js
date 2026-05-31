/**
 * Stores CRM upsert idempotency keys so retried POST /api/crm/students/upsert
 * (and bulk rows with idempotencyKey) return the same response without re-sending
 * webhooks or credential emails.
 */

const mongoose = require('mongoose');

const crmUpsertIdempotencySchema = new mongoose.Schema(
  {
    /** Unique client-supplied key (idempotencyKey or requestId). Max length enforced at application layer. */
    key: { type: String, required: true, unique: true },

    /** processing | completed | failed */
    status: {
      type: String,
      enum: ['processing', 'completed', 'failed'],
      default: 'processing',
      index: true,
    },

    /** Serialized successful API payload { action, data, credentials?, idempotentReplay } */
    responsePayload: { type: mongoose.Schema.Types.Mixed, default: null },

    httpStatus: { type: Number, default: null },

    /** Last error message when status === failed */
    errorMessage: { type: String, default: '' },

    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Auto-expire documents after 14 days so the collection stays bounded.
crmUpsertIdempotencySchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

module.exports = mongoose.model('CrmUpsertIdempotency', crmUpsertIdempotencySchema);
