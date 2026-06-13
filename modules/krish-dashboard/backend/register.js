/**
 * Enrollment Overview Module Registration
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ISOLATION RULE — READ BEFORE MODIFYING                      ║
 * ║                                                              ║
 * ║  This module owns four MongoDB collections:                  ║
 * ║    sales_students, sales_student_services,                   ║
 * ║    sales_student_notes, sales_student_status_history         ║
 * ║                                                              ║
 * ║  It must NEVER write to the Language Team "users" collection  ║
 * ║  (role: STUDENT) or call any endpoint in routes/admin.js.    ║
 * ║                                                              ║
 * ║  The same person may appear in both systems with the same    ║
 * ║  name/email/phone — this is intentional. Do NOT add sync     ║
 * ║  or cross-reference logic between the two systems.           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Call registerKrishDashboard(app, { authMiddleware }) in app.js.
 */
const router = require('./routes/index');
const SalesStudent = require('./models/SalesStudent');

async function migrateLegacyStatuses() {
  try {
    const result = await SalesStudent.updateMany({ status: 'HOLD' }, { $set: { status: 'WITHDREW' } });
    if (result.modifiedCount > 0) {
      console.log(`[EnrollmentOverview] Migrated ${result.modifiedCount} students HOLD → WITHDREW`);
    }
  } catch (err) {
    console.error('[EnrollmentOverview] status migration error', err.message);
  }
}

function registerKrishDashboard(app, { authMiddleware, prefix = '/api/enrollment-overview' } = {}) {
  const mount = (path) => {
    if (authMiddleware) {
      app.use(path, authMiddleware, router);
    } else {
      app.use(path, router);
    }
  };
  mount(prefix);
  if (prefix !== '/api/krish-dashboard') {
    mount('/api/krish-dashboard');
  }
  if (prefix !== '/api/enrollment-overdue') {
    mount('/api/enrollment-overdue');
  }
  migrateLegacyStatuses();
  console.log(`[EnrollmentOverview] Registered at ${prefix} (legacy aliases supported)`);
}

module.exports = registerKrishDashboard;
