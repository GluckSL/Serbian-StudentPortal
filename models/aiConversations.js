// models/aiConversations.js

const mongoose = require("mongoose");

const AiConversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // User who had the conversation
  messages: [
    {
      role: { type: String, enum: ["user", "ai"], required: true }, // Message role (user or ai)
      text: { type: String, required: true }, // Message content
    },
  ],
  timestamp: { type: Date, default: Date.now },
});

AiConversationSchema.index({ userId: 1 });

module.exports = mongoose.model("AiConversation", AiConversationSchema);
