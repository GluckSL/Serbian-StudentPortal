//routes/courses.js

const express = require("express");
const router = express.Router();
const Course = require("../models/Course");
const CourseProgress = require("../models/CourseProgress");

// Create a new course
router.post("/", async (req, res) => {
  try {
    const { title, description } = req.body;
    const newCourse = new Course({ title, description});
    await newCourse.save();
    res.status(201).json(newCourse);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all courses
router.get("/", async (req, res) => {
  try {
    const courses = await Course.find();
    res.status(200).json(courses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Enroll student in a course
router.post("/:courseId/enroll", async (req, res) => {
  try {
    const { studentId } = req.body;
    const course = await Course.findById(req.params.courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    await CourseProgress.findOneAndUpdate(
      { studentId, courseId: course._id },
      { studentId, courseId: course._id, progressPercentage: 0, lastUpdated: Date.now() },
      { upsert: true, new: true }
    );
    res.status(200).json({ message: "Enrolled successfully", course });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all courses a student is enrolled in
router.get("/enrolled/:studentId", async (req, res) => {
  try {
    const progressEntries = await CourseProgress.find({ studentId: req.params.studentId }).select('courseId');
    const courseIds = progressEntries.map(p => p.courseId);
    const courses = courseIds.length ? await Course.find({ _id: { $in: courseIds } }) : [];
    res.status(200).json(courses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update course details
router.put("/:courseId", async (req, res) => {
  try {
    const { title, description } = req.body;
    const course = await Course.findByIdAndUpdate(
      req.params.courseId,
      { title, description },
      { new: true }
    );
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    res.status(200).json(course);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

//Get a specific course by ID
router.get("/:courseId", async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    res.status(200).json(course);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete a course
router.delete("/:courseId", async (req, res) => {
  try {
    const course = await Course.findByIdAndDelete(req.params.courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
