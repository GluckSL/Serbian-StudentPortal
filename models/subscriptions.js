//models/subscriptions.js

const mongoose = require("mongoose");

const SubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ["silver", "platinum"], required: true },
  startDate: { type: Date, required: true },
  expiryDate: { type: Date, required: true },
  courses: [
    {
      name: { type: String }, // e.g., "A1", "B2"
      assistantId: { type: String },
      apiKey: { type: String }
    }
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

SubscriptionSchema.index({ userId: 1 });

module.exports = mongoose.model("Subscription", SubscriptionSchema);



/* const mongoose = require("mongoose");

const SubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // User who has the subscription
  type: { type: String, enum: ["free", "premium"], required: true }, // Subscription type
  startDate: { type: Date, required: true },
  expiryDate: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Subscription", SubscriptionSchema);
 */