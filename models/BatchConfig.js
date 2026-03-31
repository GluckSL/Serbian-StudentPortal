// models/BatchConfig.js

const mongoose = require('mongoose');

const BatchConfigSchema = new mongoose.Schema({
  batchName: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  journeyLength: {
    type: Number,
    default: 200,
    min: 1,
    max: 200
  },
  batchCurrentDay: {
    type: Number,
    default: 1,
    min: 1,
    max: 200
  },
  notes: {
    type: String,
    default: ''
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

BatchConfigSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  if (this.batchCurrentDay > this.journeyLength) {
    this.batchCurrentDay = this.journeyLength;
  }
  next();
});

module.exports = mongoose.model('BatchConfig', BatchConfigSchema);
