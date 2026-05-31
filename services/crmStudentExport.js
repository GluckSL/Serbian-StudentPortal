/**
 * services/crmStudentExport.js
 *
 * Serialises a Mongoose User (STUDENT role) lean doc to the CRM export DTO.
 * The DTO is the canonical shape returned by:
 *   GET /api/crm/students/export
 *   GET /api/crm/students/:portalId
 */

/**
 * Map a lean User doc (with assignedTeacher populated) to the CRM DTO.
 * Never exposes the password field.
 */
function toStudentDto(user) {
  const teacher = user.assignedTeacher || null;

  return {
    // ── Stable linking IDs ────────────────────────────────────────────────
    portalId: String(user._id),
    crmExternalId: user.crmExternalId || '',
    regNo: user.regNo || '',

    // ── Identity ──────────────────────────────────────────────────────────
    name: user.name || '',
    email: user.email || '',
    whatsappNumber: user.whatsappNumber || '',
    phoneNumber: user.phoneNumber || '',
    address: user.address || '',
    age: user.age ?? null,

    // ── Academic / enrolment ─────────────────────────────────────────────
    subscription: user.subscription || '',
    level: user.level || '',
    batch: user.batch || '',
    medium: Array.isArray(user.medium) ? user.medium : (user.medium ? [user.medium] : []),
    studentStatus: user.studentStatus || '',
    isActive: user.isActive !== false,
    isTestAccount: !!user.isTestAccount,

    // ── Dates ─────────────────────────────────────────────────────────────
    enrollmentDate: user.enrollmentDate || null,
    batchStartedOn: user.batchStartedOn || null,
    subscriptionExpiry: user.subscriptionExpiry || null,
    dateWithdrew: user.dateWithdrew || null,
    examPassedDate: user.examPassedDate || null,

    // ── CRM / sales fields ────────────────────────────────────────────────
    leadSource: user.leadSource || '',
    servicesOpted: user.servicesOpted || '',
    qualifications: user.qualifications || '',
    languageLevelOpted: user.languageLevelOpted || '',
    stream: user.stream || '',
    otherLanguageKnown: user.otherLanguageKnown || '',
    teacherIncharge: user.teacherIncharge || '',
    reasonForWithdrawing: user.reasonForWithdrawing || '',
    candidateStatus: user.candidateStatus || '',
    documentationPaymentStatus: user.documentationPaymentStatus || '',

    // ── Exam ─────────────────────────────────────────────────────────────
    languageExamStatus: user.languageExamStatus || '',
    examRemark: user.examRemark || '',
    examScores: {
      reading: user.examScores?.reading ?? null,
      listening: user.examScores?.listening ?? null,
      writing: user.examScores?.writing ?? null,
      speaking: user.examScores?.speaking ?? null,
    },

    // ── Course progress dates ─────────────────────────────────────────────
    courseStartDates: user.courseStartDates || {},
    courseCompletionDates: user.courseCompletionDates || {},
    currentCourseDay: user.currentCourseDay ?? 1,

    // ── Teacher (populated) ───────────────────────────────────────────────
    assignedTeacher: teacher
      ? {
          portalId: String(teacher._id),
          name: teacher.name || '',
          regNo: teacher.regNo || '',
          email: teacher.email || '',
          medium: Array.isArray(teacher.medium) ? teacher.medium : [],
        }
      : null,

    // ── GO Silver ─────────────────────────────────────────────────────────
    goStatus: user.goStatus || null,
    goJoiningDate: user.goJoiningDate || null,

    // ── Timestamps ────────────────────────────────────────────────────────
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    registeredAt: user.registeredAt || null,
    lastLogin: user.lastLogin || null,
  };
}

module.exports = { toStudentDto };
