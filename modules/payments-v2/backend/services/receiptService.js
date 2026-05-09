const crypto = require('crypto');

const generateAndStoreReceipt = async ({ student, submission, request, approvedByName, uploadToS3 }) => {
  const receiptNumber = `RCPT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  return { receiptNumber, receiptKey: null };
};

module.exports = { generateAndStoreReceipt };
