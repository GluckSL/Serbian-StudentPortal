/**
 * Installment visibility helper — shared between student-facing APIs and admin mirrors.
 *
 * Rule:
 *   - Installment 1 is always visible/payable as soon as it exists.
 *   - Installment k (k > 1) unlocks when:
 *       • every earlier installment (< k) is APPROVED, AND
 *       • today's UTC date >= due date of installment k
 *     i.e. the student must have paid all prior slices AND the schedule date
 *     must have arrived.
 */

/**
 * Normalise a Date/string/null to a midnight-UTC date integer (YYYYMMDD) for
 * calendar-day comparisons without timezone drift.
 */
const toUtcDay = (d) => {
  if (!d) return 0;
  const dt = d instanceof Date ? d : new Date(d);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
};

/**
 * Given a sorted (by installmentNumber asc) array of lean PaymentInstallment
 * documents and the current time, return the "active" installment that the
 * student should interact with right now, or null if all are APPROVED.
 *
 * @param {Array} installments - sorted lean PaymentInstallment docs
 * @param {Date}  [now]        - override "today" (defaults to new Date())
 * @returns {{ installment, canUpload, allPaid } | null}
 */
const getCurrentStudentInstallment = (installments, now) => {
  if (!installments || installments.length === 0) {
    return { installment: null, canUpload: false, allPaid: true, scheduleLocked: false };
  }

  const today = toUtcDay(now || new Date());

  for (let i = 0; i < installments.length; i++) {
    const inst = installments[i];

    // Skip fully settled slices (approved, or paid in full and awaiting admin review)
    if (inst.status === 'APPROVED') continue;
    const paid = Number(inst.paidAmount) || 0;
    const reqAmt = Number(inst.requestedAmount) || 0;
    const rem = Number(inst.remainingAmount);
    const awaitingReview =
      inst.status === 'SUBMITTED' && paid >= reqAmt && reqAmt > 0 && (Number.isNaN(rem) || rem <= 0);
    if (awaitingReview) continue;

    // For later slices, every prior slice must be APPROVED first (guaranteed here:
    // we only skip APPROVED rows, so all j < i are APPROVED).

    // Prior slices done — check if this slice's due date has arrived.
    const sliceDay = toUtcDay(inst.dueDate);
    const dateUnlocked = i === 0 || today >= sliceDay;

    if (!dateUnlocked) {
      // Next slice exists but calendar gate not passed — still surface it for "next payment" UI.
      return { installment: inst, canUpload: false, allPaid: false, scheduleLocked: true };
    }

    const canUpload = ['PENDING', 'OVERDUE', 'REJECTED'].includes(inst.status);
    return { installment: inst, canUpload, allPaid: false, scheduleLocked: false };
  }

  return { installment: null, canUpload: false, allPaid: true, scheduleLocked: false };
};

/**
 * Build the `studentInstallmentView` payload that goes onto each PaymentRequest
 * response for the student-facing API.
 */
const buildStudentInstallmentView = (installments, now) => {
  const sorted = [...(installments || [])].sort((a, b) => a.installmentNumber - b.installmentNumber);
  const result = getCurrentStudentInstallment(sorted, now);

  if (result.allPaid) {
    return {
      activeInstallmentNumber: null,
      displayAmount: 0,
      displayDueDate: null,
      canUpload: false,
      totalInstallments: sorted.length,
      allPaid: true,
      scheduleLocked: false,
    };
  }

  const { installment, canUpload, scheduleLocked } = result;
  if (!installment) return null;

  const due = installment.dueDate ? (installment.dueDate instanceof Date ? installment.dueDate.toISOString() : new Date(installment.dueDate).toISOString()) : null;

  return {
    activeInstallmentNumber: installment.installmentNumber,
    displayAmount: installment.remainingAmount ?? installment.requestedAmount,
    displayDueDate: due,
    canUpload: !!canUpload,
    totalInstallments: sorted.length,
    allPaid: false,
    scheduleLocked: !!scheduleLocked,
  };
};

module.exports = { getCurrentStudentInstallment, buildStudentInstallmentView, toUtcDay };
