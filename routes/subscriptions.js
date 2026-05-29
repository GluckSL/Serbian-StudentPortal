//routes/subscriptions.js

const express = require("express");
const router = express.Router();
const Subscription = require("../models/subscriptions");
const { verifyToken, checkRole } = require("../middleware/auth");

// Create a new subscription
router.post("/", async (req, res) => {
  try {
    const { userId, type, startDate, expiryDate } = req.body;
    const newSubscription = new Subscription({ userId, type, startDate, expiryDate });
    await newSubscription.save();
    res.status(201).json(newSubscription);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all subscriptions
router.get("/", async (req, res) => {
  try {
    const subscriptions = await Subscription.find().populate("userId").lean();
    res.status(200).json(subscriptions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all subscriptions for a specific user (admin)
router.get("/user/:userId", async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ userId: req.params.userId }).populate("userId").lean();
    res.status(200).json(subscriptions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update a subscription
router.put("/:id", async (req, res) => {
  try {
    const updatedSub = await Subscription.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedSub) return res.status(404).json({ message: "Subscription not found" });
    res.status(200).json(updatedSub);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete a subscription
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await Subscription.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Subscription not found" });
    res.status(200).json({ message: "Subscription deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get subscriptions for the logged-in student
router.get("/me", verifyToken, checkRole("student"), async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ userId: req.user.id }).lean();
    res.status(200).json(subscriptions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


module.exports = router;
