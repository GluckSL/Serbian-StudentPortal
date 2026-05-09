const PaymentInstallment = require('../models/PaymentInstallment');
const PaymentRequest = require('../models/PaymentRequest');

const initializeInstallments = async (request, scheduledInstallments) => {
  if (!request.installmentAllowed || !scheduledInstallments?.length) return [];
  const docs = scheduledInstallments.map((inst, i) => ({
    paymentRequestId: request._id,
    studentId: request.studentId,
    installmentNumber: i + 1,
    requestedAmount: inst.amount || (request.amount / scheduledInstallments.length),
    paidAmount: 0,
    remainingAmount: inst.amount || (request.amount / scheduledInstallments.length),
    dueDate: inst.dueDate,
    currency: request.currency,
    status: 'PENDING',
  }));
  return PaymentInstallment.insertMany(docs);
};

const applyPaymentToInstallments = async (requestId, submissionId, amount) => {
  const pendingInst = await PaymentInstallment.find({ paymentRequestId: requestId, status: { $in: ['PENDING', 'SUBMITTED'] } }).sort({ installmentNumber: 1 });
  if (!pendingInst.length) {
    const req = await PaymentRequest.findById(requestId);
    if (req) {
      req.amountRemaining = Math.max(0, (req.amountRemaining || req.amount) - amount);
      if (req.amountRemaining <= 0) req.status = 'FULLY_PAID';
      await req.save();
    }
    return;
  }
  let remaining = amount;
  for (const inst of pendingInst) {
    if (remaining <= 0) break;
    const apply = Math.min(remaining, inst.remainingAmount);
    inst.paidAmount += apply;
    inst.remainingAmount = Math.max(0, inst.remainingAmount - apply);
    inst.status = inst.remainingAmount <= 0 ? 'APPROVED' : 'SUBMITTED';
    if (submissionId) inst.submissionIds.push(submissionId);
    await inst.save();
    remaining -= apply;
  }
  const req = await PaymentRequest.findById(requestId);
  if (req) {
    req.amountRemaining = Math.max(0, (req.amountRemaining || req.amount) - amount);
    if (req.amountRemaining <= 0) req.status = 'FULLY_PAID';
    await req.save();
  }
};

const markOverdueInstallments = async () => {
  const now = new Date();
  await PaymentInstallment.updateMany({ dueDate: { $lt: now }, status: 'PENDING' }, { $set: { status: 'OVERDUE' } });
};

const getInstallmentsForRequest = (requestId) =>
  PaymentInstallment.find({ paymentRequestId: requestId }).sort({ installmentNumber: 1 }).lean();

module.exports = { initializeInstallments, applyPaymentToInstallments, markOverdueInstallments, getInstallmentsForRequest };
