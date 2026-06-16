/**
 * Payment Hub v2 — Module Registration
 * Call registerPaymentModule(app, { authMiddleware, prefix, enableCron }) in app.js.
 */
const router = require('./routes/index');
const overdueCron = require('./helpers/overdueCron');
const journeyDueCron = require('./helpers/journeyDueCron');
const errorHandler = require('./middlewares/errorHandler');
const { scheduleFinanceDailyReports } = require('./services/financeReportEmailService');

const registerPaymentModule = (app, { authMiddleware, prefix = '/api/new-payments', enableCron = false } = {}) => {
  if (authMiddleware) {
    app.use(prefix, authMiddleware, router);
  } else {
    app.use(prefix, router);
  }

  app.use(prefix, errorHandler);

  if (enableCron) {
    overdueCron.start();
    journeyDueCron.start();
  }

  // Finance daily email reports are always scheduled (independent of enableCron flag)
  scheduleFinanceDailyReports();

  console.log(`[PaymentHub v2] Registered at ${prefix}`);
};

module.exports = registerPaymentModule;
