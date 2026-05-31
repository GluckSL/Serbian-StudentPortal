import { InstallmentRow, StudentInstallmentView } from './payment-hub-api.service';

/**
 * Client-side mirror of the server's installmentVisibility logic.
 * When a future installment's due date has not arrived yet, we still expose it
 * (scheduleLocked) so dashboards can show "next payment" and balances.
 */

function toUtcDay(d: string | Date | null | undefined): number {
  if (!d) return 0;
  const dt = d instanceof Date ? d : new Date(d);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

export function buildStudentInstallmentView(
  installments: InstallmentRow[] | undefined | null,
  now: Date = new Date(),
): StudentInstallmentView | null {
  if (!installments?.length) return null;

  const sorted = [...installments].sort((a, b) => a.installmentNumber - b.installmentNumber);
  const today = toUtcDay(now);

  for (let i = 0; i < sorted.length; i++) {
    const inst = sorted[i];
    if (inst.status === 'APPROVED') continue;
    const paid = Number(inst.paidAmount) || 0;
    const reqAmt = Number(inst.requestedAmount) || 0;
    const rem = Number(inst.remainingAmount);
    const awaitingReview =
      inst.status === 'SUBMITTED' && paid >= reqAmt && reqAmt > 0 && (Number.isNaN(rem) || rem <= 0);
    if (awaitingReview) continue;

    const sliceDay = toUtcDay(inst.dueDate);
    const dateUnlocked = i === 0 || today >= sliceDay;

    if (!dateUnlocked) {
      return {
        activeInstallmentNumber: inst.installmentNumber,
        displayAmount: inst.remainingAmount ?? inst.requestedAmount,
        displayDueDate: inst.dueDate ? new Date(inst.dueDate as string).toISOString() : null,
        canUpload: false,
        totalInstallments: sorted.length,
        allPaid: false,
        scheduleLocked: true,
      };
    }

    const canUpload = ['PENDING', 'OVERDUE', 'REJECTED'].includes(inst.status);
    return {
      activeInstallmentNumber: inst.installmentNumber,
      displayAmount: inst.remainingAmount ?? inst.requestedAmount,
      displayDueDate: inst.dueDate ? new Date(inst.dueDate as string).toISOString() : null,
      canUpload,
      totalInstallments: sorted.length,
      allPaid: false,
      scheduleLocked: false,
    };
  }

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
