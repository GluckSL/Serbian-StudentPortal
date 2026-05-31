/**
 * Apply student name / reg no / email text search to a MongoDB User query.
 * @param {Record<string, unknown>} query
 * @param {string} studentName
 */
function applyStudentNameFilter(query, studentName) {
  const term = String(studentName || '').trim();
  if (!term) return;

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  query.$or = [
    { name: { $regex: regex } },
    { regNo: { $regex: regex } },
    { email: { $regex: regex } }
  ];
}

module.exports = { applyStudentNameFilter };
