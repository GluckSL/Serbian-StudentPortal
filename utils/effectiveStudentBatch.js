/**
 * Batch label used for journey-scoped content (live classes, class recordings, etc.).
 * Silver GO students follow GO-SILVER (Tamil) or GO-SINHALA (Sinhala) without a traditional User.batch value.
 */

const { goBatchForStudent, isSilverGoStudent, isGoRosterPoolBatch } = require('./goSilverTrack');

function normalizeBatch(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/^batch\s+/, '')
    .replace(/\s+/g, ' ');
}

/** True when a student's effective batch matches a meeting / recording batch string. */
function batchesAlign(studentBatch, meetingBatch) {
  const a = normalizeBatch(studentBatch);
  const b = normalizeBatch(meetingBatch);
  if (!a || !b) return false;
  if (a === b) return true;
  return (
    b.startsWith(`${a} -`) || b.startsWith(`${a}:`) || b.startsWith(`${a} |`) ||
    a.startsWith(`${b} -`) || a.startsWith(`${b}:`) || a.startsWith(`${b} |`)
  );
}

function effectiveStudentBatch(student) {
  if (!student) return '';
  const direct = String(student.batch || '').trim();
  if (direct) return direct;
  if (String(student.goStatus || '') === 'GO' && String(student.subscription || '').toUpperCase() === 'SILVER') {
    return goBatchForStudent(student);
  }
  return '';
}

/**
 * All batch labels to match against journey-tagged content (recordings, meetings).
 * Silver GO students often keep a legacy `User.batch` while GO journey content uses GO-SILVER — include both.
 */
function allStudentBatchStringsForContent(student) {
  if (!student) return [];
  const out = [];
  const seen = new Set();
  const add = (s) => {
    const t = String(s || '').trim();
    if (!t) return;
    const k = normalizeBatch(t);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  add(student.batch);
  if (String(student.goStatus || '') === 'GO' && String(student.subscription || '').toUpperCase() === 'SILVER') {
    const goBatch = goBatchForStudent(student);
    if (goBatch) add(goBatch);
  }
  return out;
}

/**
 * Batch keys used for class-recording VISIBILITY (manual + Zoom feeds).
 * Silver GO journey content is tagged GO-SILVER / GO-SINHALA. User.batch is often
 * a numeric roster slot — not a recording tag. Real class batch labels (e.g. "Batch 35")
 * are included alongside the GO track. Journey-day completion uses silverGoRecordingBatchKeys.
 */
function recordingAccessBatchKeys(student) {
  if (!student) return [];
  if (isSilverGoStudent(student)) {
    const out = [];
    const seen = new Set();
    const add = (s) => {
      const t = String(s || '').trim();
      if (!t) return;
      const k = normalizeBatch(t);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(t);
    };
    const legacy = String(student.batch || '').trim();
    if (legacy && !isGoRosterPoolBatch(legacy)) add(legacy);
    add(goBatchForStudent(student));
    return out;
  }
  return allStudentBatchStringsForContent(student);
}

module.exports = {
  effectiveStudentBatch,
  allStudentBatchStringsForContent,
  recordingAccessBatchKeys,
  batchesAlign,
  normalizeBatch,
  isGoRosterPoolBatch
};
