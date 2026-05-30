//routes/aiConversations.js

const express = require("express");
const router = express.Router();
const AiConversation = require("../models/aiConversations");

// Create a new conversation
router.post("/", async (req, res) => {
  try {
    const { userId, messages } = req.body;
    const newConversation = new AiConversation({ userId, messages });
    await newConversation.save();
    res.status(201).json(newConversation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all conversations for a user
router.get("/:userId", async (req, res) => {
  try {
    const conversations = await AiConversation.find({ userId: req.params.userId }).lean();
    res.status(200).json(conversations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
