const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/paymentRequestController');
const approvalCtrl = require('../controllers/approvalController');
const catalogCtrl = require('../controllers/catalogSettingsController');
const legacyCtrl = require('../controllers/legacyMapController');
const { attachFinanceRole, requireFinanceAdmin } = require('../middlewares/financeRoles');
const { buildUploadMiddleware } = require('../middlewares/paymentScreenshotUpload');
const uploadScreenshot = (req, res, next) => buildUploadMiddleware()(req, res, next);

// All routes require authentication (applied in register.js)
router.use(attachFinanceRole);

// ─── Admin: Dashboard & Stats ───────────────────────────────────────────────
router.get('/dashboard/stats', ctrl.getDashboardStats);
router.get('/dashboard/analytics', ctrl.getMonthlyAnalytics);

// ─── Admin: Student browse (for Send Request tab) ────────────────────────────
router.get('/students/browse', ctrl.browseStudents);

// ─── Admin: Student table (legacy, for All Payments hub) ────────────────────
router.get('/students/table', ctrl.getStudentTable);

// ─── Admin: Student payment history ─────────────────────────────────────────
router.get('/students/:studentId/history', ctrl.getStudentPaymentHistory);

// ─── Admin: Payment Requests ─────────────────────────────────────────────────
router.get('/requests', ctrl.getAllRequests);
router.post('/requests', requireFinanceAdmin, ctrl.createRequests);
router.put('/requests/:requestId/installments', requireFinanceAdmin, ctrl.updateInstallmentSchedule);
router.delete('/requests/:requestId', requireFinanceAdmin, ctrl.archiveRequest);
router.post('/requests/:requestId/notes', ctrl.addInternalNote);
router.get('/requests/:requestId/timeline', ctrl.getRequestTimeline);

// ─── Admin: Overdue detection ────────────────────────────────────────────────
router.post('/overdue/detect', requireFinanceAdmin, ctrl.runOverdueDetection);

// ─── Admin: Approval Queue ───────────────────────────────────────────────────
router.get('/approvals', approvalCtrl.getApprovalQueue);
router.get('/approvals/:submissionId', approvalCtrl.getSubmissionDetail);
router.patch('/approvals/:submissionId/approve', requireFinanceAdmin, approvalCtrl.approvePayment);
router.patch('/approvals/:submissionId/reject', requireFinanceAdmin, approvalCtrl.rejectPayment);
router.patch('/approvals/:submissionId/reupload', requireFinanceAdmin, approvalCtrl.requestReupload);
router.patch('/approvals/:submissionId/under-review', approvalCtrl.moveToUnderReview);

// ─── Legacy manual payment mapping ───────────────────────────────────────────
router.post('/legacy/map-payment', requireFinanceAdmin, legacyCtrl.mapLegacyPaymentsHandler);
router.post('/legacy/bulk-language-paid', requireFinanceAdmin, legacyCtrl.bulkMapLegacyLanguageFeesHandler);

// ─── Catalog / pricing settings ──────────────────────────────────────────────
router.get('/catalog/settings', requireFinanceAdmin, catalogCtrl.getCatalogSettings);
router.put('/catalog/settings', requireFinanceAdmin, catalogCtrl.updateCatalogSettings);

// ─── Student-facing routes ───────────────────────────────────────────────────
router.get('/my/catalog', catalogCtrl.getMyCatalog);
router.get('/my/requests', ctrl.studentGetOwnRequests);
router.post('/my/submit', uploadScreenshot, ctrl.studentSubmitPayment);

module.exports = router;
