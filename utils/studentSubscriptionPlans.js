'use strict';

/** Course plans — full portal (classes, DG bot, arena, etc.) */
const COURSE_PLANS = new Set(['SILVER', 'PLATINUM']);

/** Service / relocation plans — docs, visa, post-landing only */
const SERVICE_PLANS = new Set(['DOCS_RECOGNITION', 'VISA_DOC', 'POST_LANDING', 'VISA_DOC_ONLY']);

const ALL_STUDENT_PLANS = new Set([...COURSE_PLANS, ...SERVICE_PLANS]);

/** Maps subscription code → catalog reference row label keyword */
const SERVICE_PLAN_CATALOG_KEY = {
  DOCS_RECOGNITION: 'doc',
  VISA_DOC: 'visa',
  VISA_DOC_ONLY: 'visa',
  POST_LANDING: 'relocation',
};

/** Fallback fees if catalog row missing */
const SERVICE_PLAN_FALLBACK = {
  DOCS_RECOGNITION: { lkr: 354000, inr: 106200 },
  VISA_DOC: { lkr: 472000, inr: 141600 },
  VISA_DOC_ONLY: { lkr: 472000, inr: 141600 },
  POST_LANDING: { lkr: 1180000, inr: 354000 },
};

function normalizeSubscription(raw) {
  return String(raw || '').trim().toUpperCase();
}

function isCoursePlan(subscription) {
  return COURSE_PLANS.has(normalizeSubscription(subscription));
}

function isServicePlan(subscription) {
  const s = normalizeSubscription(subscription);
  return SERVICE_PLANS.has(s);
}

function isAllowedStudentPlan(subscription) {
  return ALL_STUDENT_PLANS.has(normalizeSubscription(subscription));
}

function findReferenceRow(referenceRows, keyword) {
  const key = String(keyword || '').toLowerCase();
  if (!key || !Array.isArray(referenceRows)) return null;
  return (
    referenceRows.find((r) => {
      const label = String(r.label || '').toLowerCase();
      if (key === 'doc') return label.includes('doc');
      if (key === 'visa') return label.includes('visa');
      if (key === 'relocation') return label.includes('reloc');
      return label.includes(key);
    }) || null
  );
}

function amountFromReferenceRow(row, currency) {
  if (!row) return 0;
  const curr = String(currency || 'INR').toUpperCase();
  return curr === 'LKR' ? Number(row.lkr) || 0 : Number(row.inr) || 0;
}

function getServicePlanAmount(subscription, currency, referenceRows) {
  const sub = normalizeSubscription(subscription);
  const catalogKey = SERVICE_PLAN_CATALOG_KEY[sub];
  if (!catalogKey) return 0;
  const row = findReferenceRow(referenceRows, catalogKey);
  const fromCatalog = amountFromReferenceRow(row, currency);
  if (fromCatalog > 0) return fromCatalog;
  const fb = SERVICE_PLAN_FALLBACK[sub];
  if (!fb) return 0;
  return String(currency || 'INR').toUpperCase() === 'LKR' ? fb.lkr : fb.inr;
}

function formatSubscriptionLabel(raw) {
  const v = normalizeSubscription(raw);
  const map = {
    SILVER: 'Silver',
    PLATINUM: 'Platinum',
    DOCS_RECOGNITION: 'Docs recognition',
    VISA_DOC: 'Visa doc',
    VISA_DOC_ONLY: 'Visa doc',
    POST_LANDING: 'Post landing',
  };
  return map[v] || raw || '';
}

module.exports = {
  COURSE_PLANS,
  SERVICE_PLANS,
  ALL_STUDENT_PLANS,
  normalizeSubscription,
  isCoursePlan,
  isServicePlan,
  isAllowedStudentPlan,
  getServicePlanAmount,
  findReferenceRow,
  formatSubscriptionLabel,
};
