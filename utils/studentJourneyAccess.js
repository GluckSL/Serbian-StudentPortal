const BatchConfig = require('../models/BatchConfig');
const { allStudentBatchStringsForContent, normalizeBatch } = require('./effectiveStudentBatch');

function normalizeJourneyDay(rawDay) {
  if (rawDay != null && Number.isFinite(Number(rawDay))) {
    return Math.min(200, Math.max(1, Math.floor(Number(rawDay))));
  }
  return 1;
}

/**
 * Content access rule for STUDENT users:
 * - GO students always have journey content access.
 * - Non-GO students require at least one active BatchConfig (journeyActive=true)
 *   matching their effective batch keys.
 */
async function getJourneyAccessForStudent(student) {
  if (!student || String(student.role || '').toUpperCase() !== 'STUDENT') {
    return { enabled: true, courseDay: 1, batchKeys: [] };
  }

  const courseDay = normalizeJourneyDay(student.currentCourseDay);
  const isGoStudent = String(student.goStatus || '').toUpperCase() === 'GO';
  const batchKeys = allStudentBatchStringsForContent(student);

  if (isGoStudent) {
    return { enabled: true, courseDay, batchKeys, reason: 'GO_STUDENT' };
  }
  if (!batchKeys.length) {
    return { enabled: false, courseDay, batchKeys, reason: 'NO_BATCH' };
  }

  const activeBatchConfigs = await BatchConfig.find({ journeyActive: true })
    .select('batchName')
    .lean();
  const activeSet = new Set(
    activeBatchConfigs
      .map((cfg) => normalizeBatch(cfg.batchName))
      .filter(Boolean)
  );
  const enabled = batchKeys.some((key) => activeSet.has(normalizeBatch(key)));

  return {
    enabled,
    courseDay,
    batchKeys,
    reason: enabled ? 'ACTIVE_BATCH' : 'BATCH_NOT_ACTIVE'
  };
}

async function getJourneyAccessForStudentId(UserModel, studentId) {
  const student = await UserModel.findById(studentId)
    .select('role batch goStatus subscription currentCourseDay')
    .lean();
  if (!student) return { enabled: false, courseDay: 1, batchKeys: [], reason: 'STUDENT_NOT_FOUND' };
  return getJourneyAccessForStudent(student);
}

module.exports = {
  normalizeJourneyDay,
  getJourneyAccessForStudent,
  getJourneyAccessForStudentId
};
