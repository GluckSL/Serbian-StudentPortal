//models/Rubric.js
const mongoose = require("mongoose");

const CriterionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  maxScore: { type: Number, required: true },
  description: String
});

const RubricSchema = new mongoose.Schema({
  level: { type: String, required: true },      // A1 A2 B1 B2
  taskType: { type: String, required: true },   // writing_email, essay
  criteria: [CriterionSchema]
});

RubricSchema.index({ level: 1, taskType: 1 });

module.exports = mongoose.model("Rubric", RubricSchema);
