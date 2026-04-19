/**
 * Batch label used for journey-scoped content (live classes, class recordings, etc.).
 * Silver GO students follow the GO-SILVER schedule without a traditional User.batch value.
 */

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
    return 'GO-SILVER';
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
    add('GO-SILVER');
  }
  return out;
}

module.exports = {
  effectiveStudentBatch,
  allStudentBatchStringsForContent,
  batchesAlign,
  normalizeBatch
};
