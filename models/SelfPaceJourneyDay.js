// models/SelfPaceJourneyDay.js
// Maps a journey day slot to a recording. Students unlock it by attending their batch live class on courseDay.

const mongoose = require('mongoose');

const selfPaceJourneyDaySchema = new mongoose.Schema(
  {
    journeyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SelfPaceJourney',
      required: true,
      index: true,
    },

    /** Attendance day on the student's own batch (1–200) */
    courseDay: {
      type: Number,
      required: true,
      min: 1,
      max: 200,
    },

    recordingType: {
      type: String,
      enum: ['manual', 'zoom'],
      required: true,
    },

    classRecordingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRecording',
      default: null,
    },

    meetingLinkId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MeetingLink',
      default: null,
    },

    sortOrder: {
      type: Number,
      default: 0,
    },

    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

selfPaceJourneyDaySchema.index({ journeyId: 1, courseDay: 1 }, { unique: true });

module.exports = mongoose.model('SelfPaceJourneyDay', selfPaceJourneyDaySchema);
