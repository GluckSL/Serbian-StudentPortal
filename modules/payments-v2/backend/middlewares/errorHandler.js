const errorHandler = (err, req, res, _next) => {
  console.error('[PaymentHub]', err);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal server error' });
};

module.exports = errorHandler;
