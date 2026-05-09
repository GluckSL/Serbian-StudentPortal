/**
 * Payment Hub v2 — Module Registration
 * Call registerPaymentModule(app, { authMiddleware, prefix, enableCron }) in app.js.
 */
const router = require('./routes/index');
const overdueCron = require('./helpers/overdueCron');
const errorHandler = require('./middlewares/errorHandler');

const registerPaymentModule = (app, { authMiddleware, prefix = '/api/new-payments', enableCron = false } = {}) => {
  if (authMiddleware) {
    app.use(prefix, authMiddleware, router);
  } else {
    app.use(prefix, router);
  }

  app.use(prefix, errorHandler);

  if (enableCron) {
    overdueCron.start();
  }

  console.log(`[PaymentHub v2] Registered at ${prefix}`);
};

module.exports = registerPaymentModule;
