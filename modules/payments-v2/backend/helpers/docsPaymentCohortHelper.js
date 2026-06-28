/**
 * Document payment cohort: visa/docs package students plus Silver/Platinum
 * students who have paid (or fully approved) documentation fees.
 */

const VISA_DOC_SUBSCRIPTIONS = ['VISA_DOC', 'VISA_DOC_ONLY', 'DOCS_RECOGNITION'];
const LANGUAGE_TEAM_SUBSCRIPTIONS = ['SILVER', 'PLATINUM'];
const DOCS_REQUEST_PAID_STATUSES = ['APPROVED', 'FULLY_PAID', 'PAID'];

async function getVisaDocsPackageStudentIds(User) {
  return User.find({
    role: 'STUDENT',
    isTestAccount: { $ne: true },
    subscription: { $in: VISA_DOC_SUBSCRIPTIONS },
  }).distinct('_id');
}

async function getLanguageTeamDocsPaidStudentIds(User, PaymentRequest, PaymentSubmission) {
  const docsRequests = await PaymentRequest.find({
    paymentType: 'DOCS_PAYMENT',
    isArchived: false,
  })
    .select('_id studentId status')
    .lean();

  if (!docsRequests.length) return [];

  const docsRequestIds = docsRequests.map((r) => r._id);
  const [approvedViaSubmission, paidViaRequest] = await Promise.all([
    PaymentSubmission.distinct('studentId', {
      status: 'APPROVED',
      isArchived: false,
      paymentRequestId: { $in: docsRequestIds },
    }),
    Promise.resolve(
      docsRequests
        .filter((r) => DOCS_REQUEST_PAID_STATUSES.includes(String(r.status || '').toUpperCase()))
        .map((r) => r.studentId),
    ),
  ]);

  const candidateIds = [
    ...new Set([...approvedViaSubmission, ...paidViaRequest].map((id) => String(id)).filter(Boolean)),
  ];
  if (!candidateIds.length) return [];

  return User.find({
    _id: { $in: candidateIds },
    role: 'STUDENT',
    isTestAccount: { $ne: true },
    subscription: { $in: LANGUAGE_TEAM_SUBSCRIPTIONS },
  }).distinct('_id');
}

async function getDocsPaymentStudentIds(User, PaymentRequest, PaymentSubmission) {
  const [visaPkgIds, langTeamDocsIds] = await Promise.all([
    getVisaDocsPackageStudentIds(User),
    getLanguageTeamDocsPaidStudentIds(User, PaymentRequest, PaymentSubmission),
  ]);
  const seen = new Set();
  const out = [];
  for (const id of [...visaPkgIds, ...langTeamDocsIds]) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

function summarizeStudentStatusBreakdown(students) {
  const byStatus = new Map();
  for (const student of students) {
    const status = String(student.studentStatus || 'UNCERTAIN').toUpperCase();
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
  }
  return [...byStatus.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

async function getDocsPaymentOverview(User, PaymentRequest, PaymentSubmission) {
  const studentIds = await getDocsPaymentStudentIds(User, PaymentRequest, PaymentSubmission);
  if (!studentIds.length) {
    return { total: 0, ongoing: 0, statusBreakdown: [] };
  }

  const students = await User.find({ _id: { $in: studentIds } })
    .select('studentStatus')
    .lean();

  let ongoing = 0;
  for (const s of students) {
    if (String(s.studentStatus || '').toUpperCase() === 'ONGOING') ongoing += 1;
  }

  return {
    total: students.length,
    ongoing,
    statusBreakdown: summarizeStudentStatusBreakdown(students),
  };
}

/** Standard full documentation fee tiers (LKR 3,00,000 legacy + LKR 3,54,000 current). */
const DOCS_FULL_PAID_LKR = [300000, 354000];
/** INR equivalent of the LKR 3,54,000 documentation fee. */
const DOCS_FULL_PAID_INR = [106200];

function isDocsFullPaidByReceived(row) {
  const lkr = Number(row?.docsPaidLKR) || 0;
  const inr = Number(row?.docsPaidINR) || 0;
  const usd = Number(row?.docsPaidUSD) || 0;
  if (usd > 0) return false;
  if (DOCS_FULL_PAID_LKR.includes(lkr) && inr === 0) return true;
  if (DOCS_FULL_PAID_INR.includes(inr) && lkr === 0) return true;
  return false;
}

function docsFullQuotationForRow(row) {
  const expectedLKR = Number(row?.docsExpectedLKR) || 0;
  const expectedINR = Number(row?.docsExpectedINR) || 0;
  const paidLKR = Number(row?.docsPaidLKR) || 0;
  const paidINR = Number(row?.docsPaidINR) || 0;

  if (DOCS_FULL_PAID_LKR.includes(expectedLKR)) {
    return { lkr: expectedLKR, inr: 0, usd: 0 };
  }
  if (DOCS_FULL_PAID_INR.includes(expectedINR)) {
    return { lkr: 0, inr: expectedINR, usd: 0 };
  }
  if (paidINR > 0 || expectedINR > 0) {
    return { lkr: 0, inr: 106200, usd: 0 };
  }
  if (paidLKR >= 354000 || expectedLKR >= 354000) {
    return { lkr: 354000, inr: 0, usd: 0 };
  }
  return { lkr: 300000, inr: 0, usd: 0 };
}

module.exports = {
  VISA_DOC_SUBSCRIPTIONS,
  LANGUAGE_TEAM_SUBSCRIPTIONS,
  DOCS_FULL_PAID_LKR,
  DOCS_FULL_PAID_INR,
  isDocsFullPaidByReceived,
  docsFullQuotationForRow,
  getDocsPaymentStudentIds,
  getDocsPaymentOverview,
};
