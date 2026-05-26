//routes/auth.js

require('dotenv').config();  // Load environment variables

const crypto = require('crypto');
const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Course = require("../models/Course");
const StudentLogs = require("../models/StudentLogs");
const UserActivityLog = require("../models/UserActivityLog");
const { recordStudentLogin } = require("../utils/studentCountry");
const router = express.Router();
const transporter = require("../config/emailConfig");
const {
  scheduleDispatchEvent,
  sanitizeUserDoc,
  userEventForRole
} = require("../services/studentPortalCrmWebhook");
const {
  generateRegNo: sharedGenerateRegNo,
  getRegNoSeed: sharedGetRegNoSeed,
  generatePassword: sharedGeneratePassword,
  createRegNoAllocator,
} = require('../utils/userRegistration');
const { studentRequiresWithdrawalConfirmation } = require('../utils/portalBatchPresets');
const {
  sendWithdrawalLoginAttemptEmail,
  sendWithdrawalDecisionEmail,
} = require('../services/withdrawalLoginNotification.service');
const { setUserPassword } = require('../utils/setUserPassword');
const { sendStudentSignupLinkEmail } = require('../utils/sendStudentSignupLink');
const { studentRequiresPasswordSetup } = require('../utils/studentPasswordSetup');
const {
  buildPasswordResetOtpEmail,
  buildEmailChangeOtpEmail,
  buildPortalCredentialsEmail,
  buildWelcomeOneTimePasswordEmail,
  buildSignupLinkEmail,
  buildForcePasswordResetEmail,
} = require('../utils/emailTemplates');
const PasswordResetOtp = require('../models/PasswordResetOtp');
const EmailChangeOtp = require('../models/EmailChangeOtp');
const StudentSignupApplication = require('../models/StudentSignupApplication');
const {
  forgotPasswordRequestLimiter,
  forgotPasswordResetLimiter,
  loginLimiter,
  setupEmailOtpLimiter,
  setupCompleteLimiter,
} = require('../middleware/authRateLimit');

function signPasswordSetupToken(userId) {
  return jwt.sign(
    { id: String(userId), purpose: 'password_setup' },
    JWT_SECRET,
    { expiresIn: '30m' }
  );
}

function verifyPasswordSetupToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (decoded.purpose !== 'password_setup' || !decoded.id) {
    throw new Error('Invalid setup token');
  }
  return decoded;
}

function issueLoginResponse(user, keepSessionActive, res) {
  const remember = Boolean(keepSessionActive);
  const jwtExpires = remember ? '30d' : '24h';
  const token = jwt.sign(
    { id: user._id, role: user.role, name: user.name, tv: user.authTokenVersion ?? 0 },
    JWT_SECRET,
    { expiresIn: jwtExpires }
  );
  return res.json({
    token,
    user: {
      name: user.name,
      email: user.email,
      role: user.role,
      subscription: user.subscription,
      profilePhoto: user.profilePhoto || null,
      sidebarPermissions: user.sidebarPermissions || [],
      teacherTabPermissions: user.teacherTabPermissions || [],
      sidebarAccessLevels: user.sidebarAccessLevels || {},
      sidebarDeletePermissions: user.sidebarDeletePermissions || [],
      teacherTabAccessLevels: user.teacherTabAccessLevels || {},
    },
  });
}

function loginRequestMeta(req) {
  return {
    ip: req.headers['x-forwarded-for']?.toString()?.split(',')?.[0]?.trim() || req.ip || '',
    userAgent: req.headers['user-agent'] || '',
  };
}

//const auth = require("../middleware/auth");
const { verifyToken, isAdmin, extractBearerToken } = require('../middleware/auth');
const checkRole = require("../middleware/checkRole");
const JWT_SECRET = process.env.JWT_SECRET;

/** StudentLogs.batchAtUpdate is required; empty string / null / undefined must not be stored. */
function batchAtUpdateForLog(batch, emptyFallback = "N/A") {
  const s = batch == null ? "" : String(batch).trim();
  return s || emptyFallback;
}

const SUB_ADMIN_DEFAULT_PERMISSIONS = ["dashboard", "profile"];
const ALLOWED_SIDEBAR_PERMISSION_IDS = [
  "dashboard",
  "analytic-dash",
  "students",
  "student-logs",
  "teachers",
  "user-roles",
  "modules",
  "dg-bot",
  "sprechen-exam",
  "exercises",
  "teacher-resources",
  "journey",
  "go-students",
  "go-students-sinhala",
  "manage-classes",
  "attendance",
  "import-meeting",
  "class-recordings",
  "ai-bot-report",
  "documents",
  "visa-tracking",
  "student-progress",
  "admin-performance",
  "payments",
  "invoices",
  "payment-approvals",
  "timetable",
  "monday-sync",
  "support-tickets",
  "announcements",
  "reminders",
  "glueck-arena",
  "help",
  "profile"
];
const ALLOWED_ACCESS_LEVELS = ["view", "edit", "full"];

function normalizeSidebarPermissions(sidebarPermissions) {
  if (!Array.isArray(sidebarPermissions)) {
    return [...SUB_ADMIN_DEFAULT_PERMISSIONS];
  }

  const uniqueValid = Array.from(
    new Set(
      sidebarPermissions.filter(
        (permissionId) =>
          typeof permissionId === "string" &&
          ALLOWED_SIDEBAR_PERMISSION_IDS.includes(permissionId)
      )
    )
  );

  if (!uniqueValid.includes("dashboard")) uniqueValid.unshift("dashboard");
  if (!uniqueValid.includes("profile")) uniqueValid.push("profile");

  return uniqueValid;
}

function normalizeTeacherTabPermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  return Array.from(
    new Set(
      permissions.filter(
        (id) => typeof id === "string" && ALLOWED_SIDEBAR_PERMISSION_IDS.includes(id)
      )
    )
  );
}

function normalizeSidebarDeletePermissions(deletePermissions, accessLevels = {}) {
  const normalized = [];
  if (!Array.isArray(deletePermissions)) return normalized;

  const levels =
    accessLevels && typeof accessLevels === "object" && !Array.isArray(accessLevels)
      ? accessLevels
      : {};

  for (const permissionId of deletePermissions) {
    if (
      typeof permissionId !== "string" ||
      !ALLOWED_SIDEBAR_PERMISSION_IDS.includes(permissionId)
    ) {
      continue;
    }
    const level = levels[permissionId];
    if (level === "edit" || level === "full") {
      if (!normalized.includes(permissionId)) normalized.push(permissionId);
    }
  }
  return normalized;
}

function normalizeAccessLevels(accessLevels, fallbackPermissions = []) {
  const normalized = {};

  if (accessLevels && typeof accessLevels === "object" && !Array.isArray(accessLevels)) {
    for (const [permissionId, level] of Object.entries(accessLevels)) {
      if (
        ALLOWED_SIDEBAR_PERMISSION_IDS.includes(permissionId) &&
        ALLOWED_ACCESS_LEVELS.includes(level)
      ) {
        normalized[permissionId] = level;
      }
    }
  }

  if (Array.isArray(fallbackPermissions)) {
    for (const permissionId of fallbackPermissions) {
      if (ALLOWED_SIDEBAR_PERMISSION_IDS.includes(permissionId) && !normalized[permissionId]) {
        normalized[permissionId] = "view";
      }
    }
  }

  return normalized;
}

function accessLevelsToPermissions(accessLevels) {
  if (!accessLevels || typeof accessLevels !== "object") return [];
  return Object.entries(accessLevels)
    .filter(
      ([permissionId, level]) =>
        ALLOWED_SIDEBAR_PERMISSION_IDS.includes(permissionId) &&
        ALLOWED_ACCESS_LEVELS.includes(level)
    )
    .map(([permissionId]) => permissionId);
}

// Read CRM data from Monday.com — full sync: every board row (including WITHDREW) → portal student record
// Track last sync status
let lastSyncStatus = { lastRun: null, result: null };

/**
 * Monday column_values: many column types leave `text` empty; use typed GraphQL fields, then `value` JSON.
 * See: StatusValue.label, DropdownValue.values[].label, MirrorValue.display_value.
 */
function mondayColumnDisplay(col) {
  if (!col) return '';
  if (col.display_value != null && String(col.display_value).trim() !== '') {
    return String(col.display_value).trim();
  }
  if (col.label != null && String(col.label).trim() !== '') {
    return String(col.label).trim();
  }
  if (Array.isArray(col.values) && col.values.length > 0) {
    const parts = col.values
      .map((v) => (v && v.label != null ? String(v.label).trim() : ''))
      .filter(Boolean);
    if (parts.length) return parts.join(', ');
  }
  const t = String(col.text || '').trim();
  if (t) return t;
  const v = col.value;
  if (v == null || v === '') return '';
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    if (!parsed || typeof parsed !== 'object') return '';
    const label = parsed.label;
    if (label != null && typeof label === 'object' && label.text != null) {
      return String(label.text).trim();
    }
    if (typeof label === 'string') return label.trim();
    if (parsed.text != null) return String(parsed.text).trim();
    const chosen = parsed.chosenValues || parsed.chosen_values;
    if (Array.isArray(chosen) && chosen[0]?.name) {
      return String(chosen[0].name).trim();
    }
  } catch (_) {
    /* ignore malformed JSON */
  }
  return '';
}

/** Sub-selection for items.column_values (items_page queries). */
const MONDAY_COLUMN_VALUES_GQL = `id type text value ... on StatusValue { label } ... on DropdownValue { values { label } } ... on MirrorValue { display_value }`;

function mondayGet(columnValues, id) {
  const col = columnValues.find((c) => c.id === id);
  return mondayColumnDisplay(col);
}

/** Env may be one id or comma-separated ids (try in order until a non-empty label). */
function mondayGetFirstNonEmpty(columnValues, envCsv) {
  const ids = String(envCsv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const colId of ids) {
    const s = String(mondayGet(columnValues, colId) || '').trim();
    if (s) return s;
  }
  return '';
}

function normalizeSubscription(raw) {
  const original = String(raw || '').trim();
  if (!original) return '';
  const normalized = original
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.includes('VISA') && (normalized.includes('DOC') || normalized.includes('DOCUMENT'))) {
    return 'VISA_DOC_ONLY';
  }
  if (normalized.includes('PLATINUM') || normalized === 'PLAT') return 'PLATINUM';
  if (normalized.includes('SILVER') || normalized === 'SIL') return 'SILVER';
  return normalized;
}

function normalizeStudentStatus(raw) {
  const normalized = String(raw || '')
    .toUpperCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return 'UNCERTAIN';
  if (normalized === 'NOT STARTED') return 'ONGOING';
  if (normalized === 'STARTED' || normalized === 'IN PROGRESS') return 'ONGOING';
  if (normalized === 'COMPLETE') return 'COMPLETED';
  if (normalized === 'WITHDRAWN') return 'WITHDREW';
  return normalized;
}

function normalizeLevel(primary, fallback = '') {
  const candidates = [primary, fallback].map((v) => String(v || '').toUpperCase().trim()).filter(Boolean);
  for (const text of candidates) {
    const match = text.match(/\b(A1|A2|B1|B2|C1|C2)\b/);
    if (match) return match[1];
  }
  return 'A1';
}

function normalizeBatch(raw, normalizedSubscription) {
  const b = String(raw || '').trim();
  if (b) return b;
  // Batch is required for all non-SILVER students in User schema.
  if (normalizedSubscription && normalizedSubscription !== 'SILVER') return 'UNASSIGNED';
  return '';
}

/** Monday email cells sometimes contain multiple addresses or stray text — take the first valid email. */
function normalizeMondayEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  const match = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return match ? match[0] : '';
}

function escapeRegexForEmail(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find portal user for a Monday row — by normalized email, case-insensitive email, or Monday item id.
 * Handles email changes on Monday when crmExternalId already links an older portal record.
 */
async function findPortalUserForMondayRow(email, crmExternalId) {
  const normalized = normalizeMondayEmail(email) || String(email || '').trim().toLowerCase();
  if (normalized) {
    const exact = await User.findOne({ email: normalized });
    if (exact) return exact;
    const ci = await User.findOne({
      email: new RegExp(`^${escapeRegexForEmail(normalized)}$`, 'i'),
    });
    if (ci) return ci;
  }
  const mondayId = String(crmExternalId || '').trim();
  if (mondayId) {
    const byCrm = await User.findOne({ crmExternalId: mondayId });
    if (byCrm) return byCrm;
  }
  return null;
}

/** Another portal user already owns this email (blocks Monday email change onto linked row). */
async function findEmailConflictOwner(email, excludeUserId) {
  const normalized = normalizeMondayEmail(email) || String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  return User.findOne({
    _id: { $ne: excludeUserId },
    email: new RegExp(`^${escapeRegexForEmail(normalized)}$`, 'i'),
  });
}

/** Lightweight row for sync preview drill-down tables. */
function previewRowFromMondayItem(item) {
  const get = (id) => mondayGet(item.column_values, id);
  const rawSubscription = get('color_mm02jfyb');
  const subscription = normalizeSubscription(rawSubscription);
  return {
    name: item.name,
    email: normalizeMondayEmail(get('text_mkw3spks')) || '',
    studentStatus: normalizeStudentStatus(get('color_mm019dcv')),
    batch: normalizeBatch(get('dropdown_mkxx6cfp'), subscription),
    level: normalizeLevel(get('dropdown_mkzshj5a'), get('color_mm02c95')),
    subscription,
    servicesOpted: get('color_mm023vmt') || get('text_mkwz1j6q') || '',
    teacherIncharge: get('dropdown_mkw72gz4') || '',
    mondayItemId: String(item.id),
  };
}

/** Same email on multiple Monday rows → one portal user; last row wins. */
function dedupeMondayItemsByEmail(items) {
  const byEmail = new Map();
  let duplicateRows = 0;
  let noEmail = 0;
  const duplicateRowsList = [];
  const noEmailRows = [];

  for (const item of items) {
    const get = (id) => mondayGet(item.column_values, id);
    const email = normalizeMondayEmail(get('text_mkw3spks'));
    if (!email) {
      noEmail += 1;
      noEmailRows.push({ ...previewRowFromMondayItem(item), detail: 'No valid email on Monday row' });
      continue;
    }
    if (byEmail.has(email)) {
      duplicateRows += 1;
      const superseded = byEmail.get(email);
      duplicateRowsList.push({
        ...previewRowFromMondayItem(superseded),
        email,
        detail: `Earlier row merged — kept "${item.name}" (id ${item.id}) for this email`,
        replacedByName: item.name,
        replacedById: String(item.id),
      });
    }
    byEmail.set(email, item);
  }
  return { items: [...byEmail.values()], duplicateRows, noEmail, duplicateRowsList, noEmailRows };
}

/** Defaults so User schema validation passes when Monday fields are empty. */
function ensureStudentCreateFields(data) {
  const d = { ...data };
  if (!d.subscription) d.subscription = 'SILVER';
  if (!d.studentStatus) d.studentStatus = 'UNCERTAIN';
  if (!d.level) d.level = 'A1';
  d.batch = normalizeBatch(d.batch, d.subscription);
  if (!Array.isArray(d.medium) || !d.medium.length) d.medium = ['Not set'];
  d.mustChangePassword = true;
  return d;
}

/** Monday / CRM new students: inactive until self-signup + payment is complete. */
function ensureMondayNewStudentFields(data) {
  const d = ensureStudentCreateFields(data);
  d.isActive = false;
  d.signupSource = d.signupSource || 'crm_monday_sync';
  d.mustChangePassword = false;
  return d;
}

/** Build portal update payload from one Monday board item (all CRM columns). */
async function mapMondayItemToPortalFields(item) {
  const get = (id) => mondayGet(item.column_values, id);
  const name = item.name;
  const email = normalizeMondayEmail(get('text_mkw3spks'));
  if (!email) return { skip: true, reason: 'No email', name };

  const phoneNumber = get('text_mkw2wpvr');
  const whatsappNumber = get('phone_mkv0a5mm');
  const address = get('text_mkv080k2');
  const ageStr = get('text_mkw38wse');
  const qualifications = get('text_mkw32n6r');
  const enrollmentDateStr = get('date_mkw7wejn');
  const servicesOpted = get('color_mm023vmt') || get('text_mkwz1j6q');
  const rawSubscription = get('color_mm02jfyb');
  const languageLevelOpted = get('color_mm02c95');
  const rawBatch = get('dropdown_mkxx6cfp');
  const studentStatus = normalizeStudentStatus(get('color_mm019dcv'));
  const rawLevel = get('dropdown_mkzshj5a');
  const subscription = normalizeSubscription(rawSubscription);
  const level = normalizeLevel(rawLevel, languageLevelOpted);
  const batch = normalizeBatch(rawBatch, subscription);
  const otherLanguageKnown = get('dropdown_mkzsadkp');
  const medium = get('dropdown_mkw09h9j');
  const leadSource = get('dropdown_mm0d9jrv');
  const stream = get('text_mkwtq4fq');
  const batchStartedOnStr = get('date_mkxkba8t');
  const teacherIncharge = get('dropdown_mkw72gz4');

  let assignedTeacherId = null;
  if (teacherIncharge) {
    const tName = teacherIncharge.trim();
    const escapedName = tName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const teacher = await User.findOne({
      role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
      name: { $regex: new RegExp('(^|\\s)' + escapedName + '(\\s|$)', 'i') },
    }).select('_id');
    if (teacher) assignedTeacherId = teacher._id;
  }

  const dateWithdrewStr = get('date_mkzzgvxv');
  const reasonForWithdrawing = get('text_mkzz24qx');
  const a1StartStr = get('date_mm1dceqs');
  const a1CompletedStr = get('date_mkzt1xj');
  const a2StartStr = get('date_mm1dwzc8');
  const a2CompletedStr = get('date_mkztk1pn');
  const b1StartStr = get('date_mm1d7az3');
  const b1CompletedStr = get('date_mkztxce7');
  const b2StartStr = get('date_mm1dbv8e');
  const b2CompletedStr = get('date_mkztwdfn');
  const examPassedDateStr = get('date_mkw7zwjh');
  const languageExamStatus = get('color_mkw7syb');
  const candidateStatus = get('text_mkzzjdv1');
  const examRemark = get('text_mkzzbgz1');
  const readingScore = get('numeric_mkzz97be');
  const listeningScore = get('numeric_mkzz8sr4');
  const writingScore = get('numeric_mkzz2bzg');
  const speakingScore = get('numeric_mkzz8q32');
  const documentationPaymentStatus = mondayGetFirstNonEmpty(
    item.column_values,
    process.env.MONDAY_COL_DOCUMENTATION_PAYMENT_STATUS
  );

  const parseDate = (str) => (str ? new Date(str) : null);

  const updateData = {
    name,
    phoneNumber,
    whatsappNumber,
    address,
    age: ageStr ? parseInt(ageStr, 10) : null,
    qualifications,
    servicesOpted,
    subscription,
    languageLevelOpted,
    batch,
    studentStatus,
    level,
    otherLanguageKnown,
    medium: medium ? [medium] : [],
    leadSource,
    stream,
    teacherIncharge,
    ...(assignedTeacherId ? { assignedTeacher: assignedTeacherId } : {}),
    reasonForWithdrawing,
    languageExamStatus,
    candidateStatus,
    examRemark,
    documentationPaymentStatus,
    crmExternalId: String(item.id),
    enrollmentDate: parseDate(enrollmentDateStr),
    batchStartedOn: parseDate(batchStartedOnStr),
    dateWithdrew: parseDate(dateWithdrewStr),
    examPassedDate: parseDate(examPassedDateStr),
    examScores: {
      reading: readingScore ? parseFloat(readingScore) : null,
      listening: listeningScore ? parseFloat(listeningScore) : null,
      writing: writingScore ? parseFloat(writingScore) : null,
      speaking: speakingScore ? parseFloat(speakingScore) : null,
    },
    courseStartDates: {
      A1StartDate: parseDate(a1StartStr),
      A2StartDate: parseDate(a2StartStr),
      B1StartDate: parseDate(b1StartStr),
      B2StartDate: parseDate(b2StartStr),
    },
    courseCompletionDates: {
      A1CompletionDate: parseDate(a1CompletedStr),
      A2CompletionDate: parseDate(a2CompletedStr),
      B1CompletionDate: parseDate(b1CompletedStr),
      B2CompletionDate: parseDate(b2CompletedStr),
    },
    updatedAt: new Date(),
  };

  if (studentStatus !== 'WITHDREW') {
    updateData.dateWithdrew = null;
    updateData.reasonForWithdrawing = '';
  }

  return { name, email, updateData, studentStatus, mondayItemId: String(item.id) };
}

async function computeMondayPortalReconciliation(allItems, dedupedItems, duplicateRows, noEmail) {
  const mondayEmails = [];
  const mondayIds = [];
  let mondayWithdrew = 0;
  for (const item of dedupedItems) {
    const get = (id) => mondayGet(item.column_values, id);
    const email = normalizeMondayEmail(get('text_mkw3spks'));
    if (email) mondayEmails.push(email);
    mondayIds.push(String(item.id));
    if (normalizeStudentStatus(get('color_mm019dcv')) === 'WITHDREW') mondayWithdrew += 1;
  }

  const [portalTotal, portalActive, portalWithdrew, portalMatchedByEmail, portalMatchedByCrmId] =
    await Promise.all([
      User.countDocuments({ role: 'STUDENT' }),
      User.countDocuments({ role: 'STUDENT', studentStatus: { $ne: 'WITHDREW' } }),
      User.countDocuments({ role: 'STUDENT', studentStatus: 'WITHDREW' }),
      mondayEmails.length
        ? User.countDocuments({ role: 'STUDENT', email: { $in: mondayEmails } })
        : Promise.resolve(0),
      mondayIds.length
        ? User.countDocuments({ role: 'STUDENT', crmExternalId: { $in: mondayIds } })
        : Promise.resolve(0),
    ]);

  const mondayUniqueEmails = mondayEmails.length;
  const portalMatchedMonday = Math.max(portalMatchedByEmail, portalMatchedByCrmId);

  return {
    portalTotal,
    portalActive,
    portalWithdrew,
    mondayTotalOnBoard: allItems.length,
    mondayWithdrew,
    mondayUniqueEmails,
    mondayRowsWithoutEmail: noEmail,
    mondayDuplicateEmailRows: duplicateRows,
    portalMatchedMonday,
    portalMissingFromMonday: Math.max(0, mondayUniqueEmails - portalMatchedMonday),
    portalExtraNotOnMonday: Math.max(0, portalTotal - portalMatchedMonday),
    /** Target portal count aligned with CRM (unique emails on board). */
    crmSyncTarget: mondayUniqueEmails,
  };
}

// Reusable Monday.com sync function
async function runMondaySync() {
  console.log("ðŸ”„ Starting Monday CRM full sync...");
  const startTime = new Date();
  if (!process.env.MONDAY_COL_DOCUMENTATION_PAYMENT_STATUS) {
    console.warn(
      '⚠️ MONDAY_COL_DOCUMENTATION_PAYMENT_STATUS is not set — documentation payment will not sync; distinct filter will stay empty until env + sync.'
    );
  }
  const BOARD_ID = process.env.MONDAY_BOARD_ID;

  let allItems = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const query = cursor
      ? `query ($boardId: [ID!], $cursor: String!) { boards(ids: $boardId) { items_page(limit: 500, cursor: $cursor) { cursor items { id name column_values { ${MONDAY_COLUMN_VALUES_GQL} } } } } }`
      : `query ($boardId: [ID!]) { boards(ids: $boardId) { items_page(limit: 500) { cursor items { id name column_values { ${MONDAY_COLUMN_VALUES_GQL} } } } } }`;
    const variables = cursor ? { boardId: [BOARD_ID], cursor } : { boardId: [BOARD_ID] };
    const response = await axios.post("https://api.monday.com/v2", { query, variables }, { headers: { Authorization: process.env.MONDAY_API_TOKEN, "Content-Type": "application/json" } });
    const page = response.data.data.boards[0].items_page;
    allItems = allItems.concat(page.items);
    cursor = page.cursor;
    hasMore = !!cursor;
  }

  console.log(`ðŸ“‹ Fetched ${allItems.length} total items from Monday board ${BOARD_ID}`);

  const { items: syncItems, duplicateRows, noEmail } = dedupeMondayItemsByEmail(allItems);

  console.log(
    `âœ… ${allItems.length} Monday rows → ${syncItems.length} unique emails to sync` +
    ` (${duplicateRows} duplicate rows merged, ${noEmail} without email)`
  );

  let created = 0, updated = 0, skipped = 0, errors = 0;
  const createdNames = [], updatedNames = [], errorNames = [];
  const allocStudentRegNo = createRegNoAllocator('STUDENT');

  for (const item of syncItems) {
    let email = '';
    let updateData = null;
    let name = item.name;
    let studentStatus = 'UNCERTAIN';
    try {
      const mapped = await mapMondayItemToPortalFields(item);
      if (mapped.skip) {
        skipped++;
        continue;
      }
      name = mapped.name;
      email = mapped.email;
      updateData = mapped.updateData;
      studentStatus = mapped.studentStatus;

      const mondayId = updateData.crmExternalId;
      const existingUser = await findPortalUserForMondayRow(email, mondayId);
      const portalUpdate = { ...updateData, email };

      if (existingUser) {
        const emailConflict = await findEmailConflictOwner(email, existingUser._id);
        if (emailConflict) {
          // Monday email is on a different portal row than the stale crmExternalId link — update the email owner.
          await User.updateOne({ _id: emailConflict._id }, { $set: portalUpdate });
          if (String(emailConflict._id) !== String(existingUser._id)) {
            await User.updateOne(
              { _id: existingUser._id, crmExternalId: mondayId },
              { $set: { crmExternalId: '' } }
            );
          }
          console.log(
            `  ↻ Monday row linked to ${emailConflict.regNo} (${email}); cleared stale crm link on ${existingUser.regNo}`
          );
          updated++;
          updatedNames.push(name);
          continue;
        }
        await User.updateOne({ _id: existingUser._id }, { $set: portalUpdate });
        if (String(existingUser.email || '').toLowerCase() !== email) {
          console.log(
            `  ↻ Monday row linked — email updated: ${existingUser.email} → ${email} (${existingUser.regNo})`
          );
        }
        updated++;
        updatedNames.push(name);
      } else {
        const regNo = await allocStudentRegNo();
        const passwordPlain = await generatePassword('STUDENT', regNo);
        const createFields = ensureMondayNewStudentFields({
          ...updateData,
          email,
          regNo,
          password: 'placeholder', // overwritten by setUserPassword below
          role: 'STUDENT',
          registeredAt: updateData.enrollmentDate || new Date(),
          createdAt: new Date(),
        });
        const newUser = new User(createFields);
        await setUserPassword(newUser, passwordPlain);
        await newUser.save();
        if (studentStatus !== 'WITHDREW') {
          try {
            const sent = await sendStudentSignupLinkEmail(newUser, {
              name,
              level: updateData.level,
              subscription: updateData.subscription,
              phoneNumber: updateData.phoneNumber,
              whatsappNumber: updateData.whatsappNumber,
            });
            if (sent.ok) {
              newUser.lastCredentialsEmailSent = new Date();
              await newUser.save();
              console.log(`  📧 Signup link sent to ${email}`);
            }
          } catch (emailErr) {
            console.error(`  ⚠️ Failed to send signup link to ${email}:`, emailErr.message);
          }
        }
        created++;
        createdNames.push(name);
        console.log(`  ✅ Created ${regNo} — ${name} (${email})`);
      }
    } catch (itemErr) {
      if (itemErr.code === 11000 && email && updateData) {
        try {
          const dupField = itemErr.keyPattern ? Object.keys(itemErr.keyPattern)[0] : '';
          const existing = await findPortalUserForMondayRow(email, updateData.crmExternalId);
          if (existing) {
            const emailConflict = await findEmailConflictOwner(email, existing._id);
            const targetId = emailConflict ? emailConflict._id : existing._id;
            if (emailConflict && String(emailConflict._id) !== String(existing._id)) {
              await User.updateOne(
                { _id: existing._id, crmExternalId: updateData.crmExternalId },
                { $set: { crmExternalId: '' } }
              );
            }
            await User.updateOne({ _id: targetId }, { $set: { ...updateData, email } });
            updated++;
            updatedNames.push(item.name);
            console.log(`  ↻ Unique key conflict resolved — updated ${emailConflict?.regNo || existing.regNo} (${email})`);
            continue;
          }
          if ((dupField === 'regNo' || dupField === 'crmExternalId') && studentStatus !== undefined) {
            const regNo = await allocStudentRegNo();
            const passwordPlain = await generatePassword('STUDENT', regNo);
            const createFields = ensureMondayNewStudentFields({
              ...updateData,
              email,
              regNo,
              password: 'placeholder', // overwritten by setUserPassword below
              role: 'STUDENT',
              registeredAt: updateData.enrollmentDate || new Date(),
              createdAt: new Date(),
            });
            const newUser = new User(createFields);
            await setUserPassword(newUser, passwordPlain);
            await newUser.save();
            if (studentStatus !== 'WITHDREW') {
              try {
                const sent = await sendStudentSignupLinkEmail(newUser, {
                  name,
                  level: updateData.level,
                  subscription: updateData.subscription,
                  phoneNumber: updateData.phoneNumber,
                  whatsappNumber: updateData.whatsappNumber,
                });
                if (sent.ok) {
                  newUser.lastCredentialsEmailSent = new Date();
                  await newUser.save();
                  console.log(`  📧 Signup link sent to ${email}`);
                }
              } catch (emailErr) {
                console.error(`  ⚠️ Failed to send signup link to ${email}:`, emailErr.message);
              }
            }
            created++;
            createdNames.push(name);
            console.log(`  ✅ Created ${regNo} (after ${dupField} conflict) — ${name} (${email})`);
            continue;
          }
        } catch (retryErr) {
          console.error(`  ❌ Retry update failed for "${item.name}":`, retryErr.message);
        }
      }
      console.error(`  âŒ Error processing item "${item.name}":`, itemErr.message);
      errors++;
      errorNames.push(item.name);
    }
  }

  const reconciliation = await computeMondayPortalReconciliation(allItems, syncItems, duplicateRows, noEmail);
  const result = {
    created,
    updated,
    skipped: skipped + noEmail,
    errors,
    totalOnBoard: allItems.length,
    syncUnique: syncItems.length,
    duplicateRowsMerged: duplicateRows,
    rowsWithoutEmail: noEmail,
    reconciliation,
    createdNames,
    updatedNames,
    errorNames,
    duration: Math.round((Date.now() - startTime.getTime()) / 1000),
  };
  console.log(`\nâœ… Monday CRM sync completed: Created: ${created} | Updated: ${updated} | Skipped: ${result.skipped} | Errors: ${errors}`);
  console.log(`   CRM target: ${reconciliation.crmSyncTarget} | Portal matched: ${reconciliation.portalMatchedMonday}`);
  lastSyncStatus = { lastRun: new Date(), result };
  return result;
}


// Cron: run sync every day at 11:50 PM Sri Lanka time
cron.schedule("50 23 * * *", async () => {
  try { await runMondaySync(); } catch (err) { console.error("âŒ CRM sync error:", err.message); lastSyncStatus = { lastRun: new Date(), result: { error: err.message } }; }
}, { timezone: "Asia/Colombo" });

// GET /api/auth/monday-sync-status â€” Last sync info
router.get("/monday-sync-status", verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), (req, res) => {
  res.json({ success: true, ...lastSyncStatus });
});

// POST /api/auth/monday-sync-run â€” Force manual sync
router.post("/monday-sync-run", verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const result = await runMondaySync();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
// âœ… Preview Monday.com sync â€” dry run showing what would change
router.get("/monday-sync-preview", verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const BOARD_ID = process.env.MONDAY_BOARD_ID;

    // Fetch ALL items from the board (paginated) â€” same logic as cron
    let allItems = [];
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const query = cursor
        ? `query ($boardId: [ID!], $cursor: String!) {
            boards(ids: $boardId) {
              items_page(limit: 500, cursor: $cursor) {
                cursor
                items { id name column_values { ${MONDAY_COLUMN_VALUES_GQL} } }
              }
            }
          }`
        : `query ($boardId: [ID!]) {
            boards(ids: $boardId) {
              items_page(limit: 500) {
                cursor
                items { id name column_values { ${MONDAY_COLUMN_VALUES_GQL} } }
              }
            }
          }`;

      const variables = cursor ? { boardId: [BOARD_ID], cursor } : { boardId: [BOARD_ID] };
      const response = await axios.post(
        "https://api.monday.com/v2",
        { query, variables },
        { headers: { Authorization: process.env.MONDAY_API_TOKEN, "Content-Type": "application/json" } }
      );

      const page = response.data.data.boards[0].items_page;
      allItems = allItems.concat(page.items);
      cursor = page.cursor;
      hasMore = !!cursor;
    }

    const { items: syncItems, duplicateRows, noEmail, duplicateRowsList, noEmailRows } =
      dedupeMondayItemsByEmail(allItems);

    const newStudents = [];
    const updatedStudents = [];
    const skipped = [];
    const drillDown = {
      allBoardRows: allItems.map(previewRowFromMondayItem),
      withdrewOnMonday: allItems
        .filter((item) => {
          const get = (id) => mondayGet(item.column_values, id);
          return normalizeStudentStatus(get('color_mm019dcv')) === 'WITHDREW';
        })
        .map(previewRowFromMondayItem),
      uniqueEmailsToSync: [],
      duplicateRowsMerged: duplicateRowsList,
      noEmailRows,
      matchedInPortal: [],
      missingFromPortal: [],
      portalOnly: [],
      noChanges: [],
    };

    const previewScalarFields = [
      'name', 'phoneNumber', 'whatsappNumber', 'address', 'qualifications',
      'servicesOpted', 'subscription', 'languageLevelOpted', 'batch',
      'studentStatus', 'level', 'otherLanguageKnown', 'leadSource', 'stream',
      'teacherIncharge', 'reasonForWithdrawing', 'languageExamStatus',
      'candidateStatus', 'examRemark', 'documentationPaymentStatus',
    ];

    for (const item of syncItems) {
      const mapped = await mapMondayItemToPortalFields(item);
      if (mapped.skip) {
        skipped.push({ name: mapped.name || item.name, reason: mapped.reason || 'No email' });
        continue;
      }

      const { name, email, updateData } = mapped;
      const syncRow = {
        name,
        email,
        batch: updateData.batch,
        level: updateData.level,
        subscription: updateData.subscription,
        studentStatus: updateData.studentStatus,
        servicesOpted: updateData.servicesOpted,
        teacherIncharge: updateData.teacherIncharge,
        mondayItemId: updateData.crmExternalId,
      };
      drillDown.uniqueEmailsToSync.push(syncRow);

      const existingUser = await findPortalUserForMondayRow(email, updateData.crmExternalId);
      const existingLean = existingUser ? existingUser.toObject() : null;

      if (existingLean) {
        const changes = [];
        for (const field of previewScalarFields) {
          const mondayVal = updateData[field];
          let portalVal = existingLean[field];
          if (field === 'medium') {
            portalVal = Array.isArray(portalVal) ? portalVal.join(', ') : String(portalVal || '');
            const mVal = Array.isArray(mondayVal) ? mondayVal.join(', ') : String(mondayVal || '');
            if (portalVal !== mVal) {
              changes.push({ field, portalValue: portalVal || '(empty)', mondayValue: mVal || '(empty)' });
            }
            continue;
          }
          const pStr = portalVal == null ? '' : String(portalVal);
          const mStr = mondayVal == null ? '' : String(mondayVal);
          if (pStr !== mStr) {
            changes.push({ field, portalValue: pStr || '(empty)', mondayValue: mStr || '(empty)' });
          }
        }

        const emailChanged =
          String(existingLean.email || '').toLowerCase() !== String(email || '').toLowerCase();
        if (emailChanged) {
          changes.unshift({
            field: 'email',
            portalValue: existingLean.email || '(empty)',
            mondayValue: email || '(empty)',
          });
        }

        drillDown.matchedInPortal.push({ ...syncRow, regNo: existingLean.regNo });

        if (changes.length > 0) {
          updatedStudents.push({ name, email, regNo: existingLean.regNo, changes });
        } else {
          drillDown.noChanges.push({ ...syncRow, regNo: existingLean.regNo });
        }
      } else {
        drillDown.missingFromPortal.push(syncRow);
        newStudents.push({
          name,
          email,
          regNo: '',
          batch: updateData.batch,
          level: updateData.level,
          subscription: updateData.subscription,
          studentStatus: updateData.studentStatus,
          servicesOpted: updateData.servicesOpted,
          teacherIncharge: updateData.teacherIncharge,
          mondayItemId: updateData.crmExternalId,
        });
      }
    }

    const mondayEmailSet = drillDown.uniqueEmailsToSync.map((r) => r.email).filter(Boolean);
    if (mondayEmailSet.length) {
      const portalOnlyUsers = await User.find({
        role: 'STUDENT',
        email: { $nin: mondayEmailSet },
      })
        .select('name email regNo batch level subscription studentStatus servicesOpted teacherIncharge')
        .lean();
      drillDown.portalOnly = portalOnlyUsers.map((u) => ({
        name: u.name,
        email: u.email,
        regNo: u.regNo,
        batch: u.batch || '',
        level: u.level || '',
        subscription: u.subscription || '',
        studentStatus: u.studentStatus || '',
        servicesOpted: u.servicesOpted || '',
        teacherIncharge: u.teacherIncharge || '',
        detail: 'In portal but email not on Monday board',
      }));
    }

    const reconciliation = await computeMondayPortalReconciliation(allItems, syncItems, duplicateRows, noEmail);

    res.json({
      success: true,
      totalOnBoard: allItems.length,
      eligibleCount: allItems.length,
      eligibleUniqueCount: syncItems.length,
      duplicateRowsMerged: duplicateRows,
      rowsWithoutEmail: noEmail,
      reconciliation,
      drillDown,
      newStudents,
      updatedStudents,
      skipped,
      summary: {
        willCreate: newStudents.length,
        willUpdate: updatedStudents.length,
        noChanges: syncItems.length - newStudents.length - updatedStudents.length,
        skipped: skipped.length + noEmail,
      },
    });
  } catch (err) {
    console.error("âŒ Monday sync preview error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// Delegating to shared utils/userRegistration.js — keeping local names for all call sites.
async function generateRegNo(role) {
  return sharedGenerateRegNo(role);
}

async function getRegNoSeed(role) {
  const { prefix, nextNumber } = await sharedGetRegNoSeed(role);
  const roleKey = typeof role === 'string' ? role.trim().toUpperCase() : '';
  return { prefix, nextNumber, roleKey };
}

async function generatePassword(role, regNo) {
  return sharedGeneratePassword(role, regNo);
}

// âœ… Get teachers by student level + medium
router.get("/teachers", async (req, res) => {
  try {
    const { level, medium } = req.query;

    if (!level || !medium) {
      return res.status(400).json({ msg: "Level and medium are required" });
    }

    // 1ï¸âƒ£ Find the course for this level
    const course = await Course.findOne({ title: level }); // assuming title = level like "A1"
    if (!course) {
      return res.status(404).json({ msg: "No course found for this level" });
    }

    // 2ï¸âƒ£ Find teachers (including TEACHER_ADMIN) who teach this course & match medium
    const teachers = await User.find({
      role: { $in: ["TEACHER", "TEACHER_ADMIN"] },
      medium: { $in: [medium] },
      assignedCourses: course._id
    }).select("name email regNo medium assignedCourses");

    if (!teachers || teachers.length === 0) {
      return res.status(404).json({ msg: "No teachers found for this level and medium" });
    }

    res.json(teachers);
  } catch (err) {
    console.error("Error fetching teachers:", err);
    res.status(500).json({ error: err.message });
  }
});

// âœ… Get teachers by student medium
router.get("/teachersByMedium", async (req, res) => {
  try {
    const { medium } = req.query;

    if (!medium) {
      return res.status(400).json({ msg: "Medium is required" });
    }

    const teachers = await User.find({
      role: { $in: ["TEACHER", "TEACHER_ADMIN"] },
      medium: { $in: [medium] }
    }).select("name email regNo medium assignedCourses");

    if (!teachers || teachers.length === 0) {
      return res.status(404).json({ msg: "No teachers found for this medium" });
    }

    res.json(teachers);
  } catch (err) {
    console.error("Error fetching teachers:", err);
    res.status(500).json({ error: err.message });
  }
});


// âœ… Signup
router.post("/signup", async (req, res) => {
  try {
    const {
      name,
      email,
      role,
      subscription,
      level,
      batch,
      medium,
      studentStatus,
      assignedCourses,
      assignedBatches,
      assignedTeacher,
      phoneNumber,
      address,
      age,
      programEnrolled: servicesOpted,
      leadSource,
      languageLevelOpted,
      dateWithdrew,
      reasonForWithdrewing,
      courseCompletionDates,
      courseStartDates,
      qualifications,
      sidebarPermissions,
      sendCredentialsEmail
     } = req.body;

    const normalizedRole = typeof role === "string" ? role.trim().toUpperCase() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedName = typeof name === "string" ? name.trim() : "";

    if (!normalizedName) {
      return res.status(400).json({ msg: "Name is required" });
    }
    if (!normalizedEmail) {
      return res.status(400).json({ msg: "Email is required" });
    }
    if (!normalizedRole) {
      return res.status(400).json({ msg: "Role is required" });
    }
    if (!["STUDENT", "TEACHER", "ADMIN", "SUB_ADMIN", "TEACHER_ADMIN"].includes(normalizedRole)) {
      return res.status(400).json({ msg: "Invalid role" });
    }

    // Fast pre-check for duplicate email (still handle race via E11000 below)
    let existingByEmail = await User.findOne({ email: normalizedEmail });
    if (existingByEmail) return res.status(400).json({ msg: "User already exists" });

    // regNo is unique; collisions can happen (race conditions / existing data).
    // Try sequential candidates (e.g., SAD003, SAD004...) to guarantee progress.
    const MAX_REGNO_CANDIDATES = 25;
    let user;
    let password;

    const { prefix: regPrefix, nextNumber: regStart } = await getRegNoSeed(normalizedRole);

    for (let offset = 0; offset < MAX_REGNO_CANDIDATES; offset++) {
      const regNo = regPrefix + String(regStart + offset).padStart(3, "0");
      password = await generatePassword(normalizedRole, regNo);

      user = new User({
        regNo,
        name: normalizedName,
        email: normalizedEmail,
        password: 'placeholder', // will be overwritten by setUserPassword below
        role: normalizedRole
      });
      await setUserPassword(user, password);

      if (user.role === "STUDENT") {
        user.mustChangePassword = true;
        user.subscription = subscription;
        user.level = level;
        user.batch = batch;
        user.medium = medium;
        user.studentStatus = studentStatus;
        user.phoneNumber = phoneNumber;
        user.address = address;
        user.age = age;
        user.servicesOpted = servicesOpted;
        user.leadSource = leadSource;
        user.languageLevelOpted = languageLevelOpted;
        user.dateWithdrew = dateWithdrew;
        user.reasonForWithdrawing = reasonForWithdrewing;
        user.courseCompletionDates = courseCompletionDates;
        user.courseStartDates = courseStartDates;
        user.qualifications = qualifications;

        // ✅ Auto-set start date for current level if not provided
        if (!user.courseStartDates) {
          user.courseStartDates = {};
        }
        const levelStartField = `${level}StartDate`;
        if (!user.courseStartDates[levelStartField]) {
          user.courseStartDates[levelStartField] = new Date();
        }

        // 🔍 Teacher assignment
        if (assignedTeacher) {
          // case 1: frontend provided teacher id
          user.assignedTeacher = assignedTeacher;
        } else {
          // case 2: backend finds one automatically
          const course = await Course.findOne({ level });
          if (!course) {
            return res.status(400).json({ msg: "No course found for this level" });
          }

          const teacher = await User.findOne({
            role: "TEACHER",
            medium: { $in: [medium] },
            assignedCourses: course._id
          });

          if (teacher) {
            user.assignedTeacher = teacher._id;
          } else {
            return res.status(400).json({ msg: "No teacher found for this level and medium" });
          }
        }
      } else if (user.role === "TEACHER") {
        user.assignedBatches = assignedBatches;
        user.medium = medium;
        user.assignedCourses = assignedCourses; // Assign courses if provided
      } else if (user.role === "SUB_ADMIN") {
        user.sidebarPermissions = normalizeSidebarPermissions(sidebarPermissions);
      }

      try {
        await user.save();
        break; // success
      } catch (saveErr) {
        // Duplicate key (email/regNo). Retry only for regNo collisions.
        if (saveErr?.code === 11000) {
          const dupField = Object.keys(saveErr?.keyPattern || saveErr?.keyValue || {})[0];
          if (dupField === "regNo") {
            // try next candidate
            continue;
          }
          if (dupField === "email") {
            return res.status(400).json({ msg: "User already exists" });
          }
          return res.status(400).json({ error: `${dupField} already exists` });
        }
        throw saveErr;
      }
    }

    if (!user?._id) {
      return res.status(500).json({ error: "Failed to allocate unique regNo. Please try again." });
    }

    const shouldSendCredentialsEmail =
      user.role === "SUB_ADMIN" ? !!sendCredentialsEmail : true;

    if (shouldSendCredentialsEmail) {
      if (user.role === 'STUDENT') {
        // New student path: send a signup link so they set their own password
        try {
          const signupApp = await StudentSignupApplication.create({
            name: user.name,
            email: user.email,
            emailVerifiedAt: new Date(),
            status: 'payment_pending',
            userId: user._id,
          });
          const frontendUrl = process.env.FRONTEND_URL || 'https://gluckstudentsportal.com';
          const signupUrl = `${frontendUrl}/signup/apply?token=${signupApp.applicationToken}`;
          const linkMail = buildSignupLinkEmail({ name: user.name, signupUrl });
          await transporter.sendMail({ from: process.env.EMAIL_USER, to: user.email, subject: linkMail.subject, html: linkMail.html });
          console.log('Email sent to', user.email);
          user.lastCredentialsEmailSent = new Date();
          await user.save();
        } catch (emailErr) {
          console.error('Signup link email failed:', emailErr?.message);
        }
      } else {
        // Non-student (teachers/admins): keep sending credentials
        const passwordPlain = password;
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: user.email,
          subject: 'Welcome to Gluck Global Student Portal',
          html: `
        <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
          <p>Hello ${user.name},</p>
          <p>You have successfully registered to the <strong>Gluck Global Student Portal</strong>. Here are your login credentials:</p>
          <ul>
            <li><strong>Web App ID:</strong> ${user.regNo}</li>
            <li><strong>Password:</strong> ${passwordPlain}</li>
          </ul>
          <p>Please keep this information safe and do not share it with anyone.</p>
          <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>
          <p>Best regards,<br><strong>Gluck Global Pvt Ltd</strong></p>
        </div>
      `,
        };
        try {
          await transporter.sendMail(mailOptions);
          console.log('Email sent to', user.email);
          user.lastCredentialsEmailSent = new Date();
          await user.save();
        } catch (err) {
          console.error('Email sending failed:', err);
        }
      }
    }
    const responsePayload = { msg: "User created successfully", user };
    if (user.role === "SUB_ADMIN") {
      responsePayload.generatedCredentials = {
        regNo: user.regNo,
        password
      };
    }

    const createdEvent = userEventForRole(user.role, "CREATED");
    if (createdEvent) {
      scheduleDispatchEvent({
        event: createdEvent,
        entity: { ...sanitizeUserDoc(user), type: "User" },
        metaOverrides: { syncMode: "live" }
      });
    }

    res.status(201).json(responsePayload);
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ✅ Login — accepts regNo or email as identifier
router.post("/login", loginLimiter, async (req, res) => {
  try {
    // Support both legacy `regNo` field and new `identifier` field from updated frontend
    const identifier = (req.body.identifier || req.body.regNo || '').trim();
    const { password, keepSessionActive } = req.body;

    if (!identifier) return res.status(400).json({ msg: "Invalid credentials" });

    // Route lookup: email if identifier contains @, otherwise treat as regNo
    let user;
    if (identifier.includes('@')) {
      user = await User.findOne({ email: identifier.toLowerCase() });
    } else {
      user = await User.findOne({ regNo: identifier });
    }
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    // Keep ADMIN directory password column in sync when recoverable copy is missing.
    if (user.role === 'STUDENT' && password) {
      const { readRecoverablePassword, storeRecoverablePassword } = require('../utils/passwordRecoverable');
      if (!readRecoverablePassword(user.passwordRecoverable)) {
        const stored = storeRecoverablePassword(password);
        if (stored) {
          user.passwordRecoverable = stored;
          await user.save().catch(() => {});
        }
      }
    }

    // ⚠️ Uncertain / Withdrawn — show confirmation modal instead of logging in
    if (studentRequiresWithdrawalConfirmation(user)) {
      const loginAttemptTime = new Date().toISOString();
      sendWithdrawalLoginAttemptEmail(user, {
        loginAttemptTime,
        ...loginRequestMeta(req),
      }).catch((err) => {
        console.error('[withdrawal-alert] Login attempt email failed:', err?.message || err);
      });

      return res.json({
        requiresConfirmation: true,
        loginAttemptTime,
        studentInfo: {
          studentId: String(user._id),
          studentName: user.name,
          batch: user.batch,
          studentStatus: user.studentStatus,
          email: user.email,
          regNo: user.regNo,
        },
      });
    }

    // 🔐 First-login / ongoing student — set permanent password before access
    if (studentRequiresPasswordSetup(user)) {
      const setupToken = signPasswordSetupToken(user._id);
      const otpPreSent = Boolean(user.mustChangePassword && user.passwordChangedAt);
      return res.json({
        requiresPasswordSetup: true,
        otpPreSent,
        setupToken,
        studentInfo: {
          studentId: String(user._id),
          studentName: user.name,
          email: user.email,
          regNo: user.regNo,
          studentStatus: user.studentStatus,
        },
      });
    }

    if (user.role === 'STUDENT') {
      await recordStudentLogin(user, req);
    } else {
      try {
        user.lastLogin = new Date();
        await user.save();
        await UserActivityLog.create({
          userId: user._id,
          role: user.role,
          type: "LOGIN",
          ip: req.headers["x-forwarded-for"]?.toString()?.split(",")?.[0]?.trim() || req.ip || "",
          userAgent: req.headers["user-agent"] || ""
        });
      } catch (e) {
        console.warn("Failed to record login activity:", e?.message || e);
      }
    }

    return issueLoginResponse(user, keepSessionActive, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ✅ First-login setup — Flow A: request email change (admin approval required)
// Student submits new email + desired password → notifies admins → pending approval
router.post("/setup/request-email-change", setupEmailOtpLimiter, async (req, res) => {
  const EmailChangeRequest = require('../models/EmailChangeRequest');
  const { storeRecoverablePassword } = require('../utils/passwordRecoverable');
  try {
    const { setupToken, newEmail: rawNewEmail, newPassword, confirmPassword } = req.body;
    if (!setupToken || !rawNewEmail || !newPassword || !confirmPassword) {
      return res.status(400).json({ msg: 'All fields are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ msg: 'Password must be at least 8 characters.' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ msg: 'Passwords do not match.' });
    }

    const decoded = verifyPasswordSetupToken(setupToken);
    const user = await User.findById(decoded.id);
    if (!user || user.role !== 'STUDENT') {
      return res.status(400).json({ msg: 'Invalid setup session.' });
    }

    const newEmail = String(rawNewEmail).trim().toLowerCase();
    if (!newEmail.includes('@')) {
      return res.status(400).json({ msg: 'Please enter a valid email address.' });
    }
    if (newEmail === String(user.email).toLowerCase()) {
      return res.status(400).json({ msg: 'New email must be different from your current email.' });
    }
    const taken = await User.findOne({ email: newEmail, _id: { $ne: user._id } });
    if (taken) {
      return res.status(400).json({ msg: 'That email address is already registered to another account.' });
    }

    const newPasswordEncrypted = storeRecoverablePassword(newPassword);

    // Cancel any pending request from this user
    await EmailChangeRequest.deleteMany({ userId: user._id, status: 'pending' });

    await EmailChangeRequest.create({
      userId: user._id,
      studentName: user.name,
      regNo: user.regNo,
      currentEmail: user.email,
      newEmail,
      newPasswordEncrypted,
    });

    // Notify admin emails
    const adminNotifyHtml = `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1a1a2e;max-width:560px;">
  <h2 style="color:#6c3fc5;">Email Change Request — Glück Global Portal</h2>
  <p><strong>Student:</strong> ${user.name} (${user.regNo})</p>
  <p><strong>Current Email:</strong> ${user.email}</p>
  <p><strong>Requested New Email:</strong> ${newEmail}</p>
  <p>Please review and approve/reject this request in the <a href="https://gluckstudentsportal.com/admin/support-tickets">Admin Panel → Support Tickets</a>.</p>
  <p style="color:#9ca3af;font-size:12px;">This is an automated notification from the Glück Global Student Portal.</p>
</div>`;

    const adminEmails = ['languageschool@gluckglobal.com', 'sourav@gluckglobal.com'];
    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: adminEmails.join(', '),
      subject: `Email Change Request: ${user.name} (${user.regNo})`,
      html: adminNotifyHtml,
    }).catch((e) => console.error('[setup/request-email-change] admin notify failed:', e?.message));

    return res.json({
      msg: 'Your request has been sent. The support team will review it and update your email soon. You will be notified once approved.',
    });
  } catch (err) {
    console.error('[setup/request-email-change]', err);
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(400).json({ msg: 'Your setup session expired. Please log in again.' });
    }
    return res.status(500).json({ msg: 'Could not submit request. Please try again.' });
  }
});

// ✅ First-login setup — Flow B Step 1: send OTP to current email
router.post("/setup/send-otp", setupEmailOtpLimiter, async (req, res) => {
  try {
    const { setupToken } = req.body;
    if (!setupToken) return res.status(400).json({ msg: 'Setup token is required.' });

    const decoded = verifyPasswordSetupToken(setupToken);
    const user = await User.findById(decoded.id);
    if (!user || user.role !== 'STUDENT') {
      return res.status(400).json({ msg: 'Invalid setup session.' });
    }

    await EmailChangeOtp.deleteMany({ userId: user._id });

    const otp = String(crypto.randomInt(100000, 999999));
    const otpHash = await bcrypt.hash(otp, await bcrypt.genSalt(10));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await EmailChangeOtp.create({ userId: user._id, pendingNewEmail: user.email, otpHash, expiresAt });

    const { subject, html } = buildPasswordResetOtpEmail({ name: user.name, otp, expiresMinutes: 15 });
    await transporter.sendMail({ from: process.env.EMAIL_USER, to: user.email, subject, html });
    console.log('[setup/send-otp] OTP sent to user email:', user.email);

    return res.json({ msg: `A verification code was sent to ${user.email}.`, email: user.email });
  } catch (err) {
    console.error('[setup/send-otp]', err);
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(400).json({ msg: 'Your setup session expired. Please log in again.' });
    }
    return res.status(500).json({ msg: 'Could not send verification code. Please try again.' });
  }
});

// ✅ First-login setup — Flow B Step 2: verify OTP + set password → log in
router.post("/setup/complete", setupCompleteLimiter, async (req, res) => {
  try {
    const { setupToken, otp, newPassword, confirmPassword, keepSessionActive } = req.body;

    if (!setupToken || !otp || !newPassword || !confirmPassword) {
      return res.status(400).json({ msg: 'All fields are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ msg: 'Password must be at least 8 characters.' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ msg: 'Passwords do not match.' });
    }

    const decoded = verifyPasswordSetupToken(setupToken);
    const user = await User.findById(decoded.id);
    if (!user || user.role !== 'STUDENT') {
      return res.status(400).json({ msg: 'Invalid setup session.' });
    }
    if (!studentRequiresPasswordSetup(user)) {
      return res.status(400).json({ msg: 'Password setup is not required for this account.' });
    }

    const otpDoc = await EmailChangeOtp.findOne({ userId: user._id, used: false });
    if (!otpDoc || otpDoc.expiresAt < new Date()) {
      if (otpDoc) await EmailChangeOtp.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({ msg: 'Verification code expired. Please request a new one.' });
    }
    otpDoc.attempts += 1;
    if (otpDoc.attempts > 5) {
      await EmailChangeOtp.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({ msg: 'Too many invalid attempts. Please request a new code.' });
    }
    await otpDoc.save();

    const otpValid = await bcrypt.compare(String(otp).trim(), otpDoc.otpHash);
    if (!otpValid) {
      return res.status(400).json({ msg: 'Incorrect verification code. Please try again.' });
    }

    otpDoc.used = true;
    await otpDoc.save();

    await setUserPassword(user, newPassword);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await recordStudentLogin(user, req);

    const credsMail = buildPortalCredentialsEmail({ name: user.name, regNo: user.regNo, email: user.email, password: newPassword });
    transporter.sendMail({ from: process.env.EMAIL_USER, to: user.email, subject: credsMail.subject, html: credsMail.html })
      .catch((e) => console.error('[setup/complete] email failed:', e?.message));

    return issueLoginResponse(user, keepSessionActive, res);
  } catch (err) {
    console.error('[setup/complete]', err);
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(400).json({ msg: 'Your setup session expired. Please log in again.' });
    }
    return res.status(500).json({ msg: 'Could not complete setup. Please try again.' });
  }
});

// ✅ Forgot Password — Step 1: Request OTP
router.post("/forgot-password/request", forgotPasswordRequestLimiter, async (req, res) => {
  // Always return generic 200 to prevent email enumeration
  const GENERIC_RESPONSE = { msg: "If an account with that email exists, a reset code has been sent." };
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ msg: "A valid email address is required." });
    }

    const user = await User.findOne({ email, isActive: { $ne: false } });
    if (!user) return res.json(GENERIC_RESPONSE); // Don't reveal non-existence

    // Invalidate any previous unused OTPs for this email
    await PasswordResetOtp.deleteMany({ email });

    const otp = String(crypto.randomInt(100000, 999999));
    const salt = await bcrypt.genSalt(10);
    const otpHash = await bcrypt.hash(otp, salt);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await PasswordResetOtp.create({ email, otpHash, expiresAt });

    const { subject, html } = buildPasswordResetOtpEmail({
      name: user.name,
      otp,
      expiresMinutes: 15,
    });

    try {
      await transporter.sendMail({ from: process.env.EMAIL_USER, to: email, subject, html });
      console.log('[forgot-password/request] OTP sent to user email:', email);
    } catch (mailErr) {
      console.error('[forgot-password] Email send failed:', mailErr.message);
      // Still return generic 200; OTP is in DB but mail failed — user can retry
    }

    return res.json(GENERIC_RESPONSE);
  } catch (err) {
    console.error('[forgot-password/request]', err);
    return res.json(GENERIC_RESPONSE); // Never reveal server errors to clients
  }
});

// ✅ Forgot Password — Step 2: Verify OTP and set new password
router.post("/forgot-password/reset", forgotPasswordResetLimiter, async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const otp = String(req.body.otp || '').trim();
    const newPassword = (req.body.newPassword || '').trim();
    const confirmPassword = (req.body.confirmPassword || '').trim();

    if (!email || !otp || !newPassword || !confirmPassword) {
      return res.status(400).json({ msg: "All fields are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ msg: "Password must be at least 8 characters." });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ msg: "Passwords do not match." });
    }

    const otpDoc = await PasswordResetOtp.findOne({ email, used: false });
    if (!otpDoc) {
      return res.status(400).json({ msg: "Invalid or expired reset code. Please request a new one." });
    }

    if (otpDoc.expiresAt < new Date()) {
      await PasswordResetOtp.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({ msg: "Reset code has expired. Please request a new one." });
    }

    // Increment attempt counter before verifying (prevent timing-based enumeration)
    otpDoc.attempts += 1;
    if (otpDoc.attempts > 5) {
      await PasswordResetOtp.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({ msg: "Too many invalid attempts. Please request a new reset code." });
    }
    await otpDoc.save();

    const isOtpValid = await bcrypt.compare(otp, otpDoc.otpHash);
    if (!isOtpValid) {
      return res.status(400).json({ msg: "Incorrect reset code. Please try again." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ msg: "Account not found." });
    }

    await setUserPassword(user, newPassword);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();

    // Mark OTP as used
    otpDoc.used = true;
    await otpDoc.save();

    return res.json({ msg: "Password reset successfully. You can now log in with your new password." });
  } catch (err) {
    console.error('[forgot-password/reset]', err);
    return res.status(500).json({ msg: "Something went wrong. Please try again." });
  }
});

// ✅ Change Password (logged-in user)
router.put("/change-password", verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ msg: "All fields are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ msg: "New password must be at least 8 characters." });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ msg: "New passwords do not match." });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ msg: "User not found." });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Current password is incorrect." });
    }

    await setUserPassword(user, newPassword);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();

    return res.json({ msg: "Password changed successfully." });
  } catch (err) {
    console.error('[change-password]', err);
    return res.status(500).json({ msg: "Something went wrong. Please try again." });
  }
});

// ⚠️ Withdrawal Confirmation — called when uncertain/withdrawl student responds to the modal
router.post("/withdrawal-confirmation", async (req, res) => {
  try {
    const { studentId, decision, loginAttemptTime, keepSessionActive } = req.body;

    if (!studentId || !decision) {
      return res.status(400).json({ msg: "studentId and decision are required" });
    }

    const user = await User.findById(studentId);
    if (!user) return res.status(404).json({ msg: "Student not found" });

    if (!['YES', 'NO'].includes(decision)) {
      return res.status(400).json({ msg: "decision must be YES or NO" });
    }

    const emailResult = await sendWithdrawalDecisionEmail(user, {
      decision,
      loginAttemptTime,
      responseAt: new Date(),
      ...loginRequestMeta(req),
    });

    // Never issue a login token — admin must change batch/status to ONGOING (or similar) first
    const messages = {
      YES: 'Thank you. Our team will reach you within 24-72 hours. You cannot access the portal until your account status is updated by our team.',
      NO: 'Thank you. Your withdrawal has been recorded. Our team has been notified.',
    };

    return res.json({
      success: true,
      decision,
      emailSent: emailResult.ok,
      message: messages[decision],
    });

  } catch (err) {
    console.error("Withdrawal confirmation error:", err);
    res.status(500).json({ error: err.message });
  }
});

// âœ… Logout
router.post("/logout", (req, res) => {
  // ✅ best-effort: record logout activity when token present
  try {
    const token = extractBearerToken(req);
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload?.id) {
        UserActivityLog.create({
          userId: payload.id,
          role: payload.role || "",
          type: "LOGOUT",
          ip: req.headers["x-forwarded-for"]?.toString()?.split(",")?.[0]?.trim() || req.ip || "",
          userAgent: req.headers["user-agent"] || ""
        }).catch(() => {});
      }
    }
  } catch (_) {}

  return res.json({ msg: "Logged out successfully" });
});


// âœ… Profile route
router.get("/profile", verifyToken, async (req, res) => {
  try {
    let query = User.findById(req.user.id).select("-password");

    // If the logged-in user is a student â†’ populate teacher info
    if (req.user.role === "STUDENT") {
      query = query.populate("assignedTeacher", "name email");
      // ðŸ‘† populate assignedTeacher with only name & email fields
    }

    let user = await query;

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === 'STUDENT') {
      try {
        const { ensureStudentLevelMatchesJourneyDay } = require('../services/journeyLevelSync.service');
        const sync = await ensureStudentLevelMatchesJourneyDay(user._id);
        if (sync.synced) {
          user = await query;
        }
      } catch (e) {
        console.warn('ensureStudentLevelMatchesJourneyDay:', e.message);
      }
    }

    if (studentRequiresWithdrawalConfirmation(user)) {
      return res.status(403).json({
        message:
          'Portal access is not available until your account status is updated by the Gluck Global team.',
        requiresReactivation: true,
      });
    }

    res.json(user);
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// âœ… Get all teachers and admins for role management (MUST be before /:id route)
router.get("/teachers-and-admins", verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const users = await User.find({
      role: { $in: ['TEACHER', 'TEACHER_ADMIN', 'ADMIN', 'SUB_ADMIN'] }
    }).select("name email regNo role sidebarPermissions teacherTabPermissions sidebarAccessLevels sidebarDeletePermissions teacherTabAccessLevels").sort({ role: 1, name: 1 });

    res.status(200).json(users);
  } catch (error) {
    console.error("âŒ Error fetching teachers and admins:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// Admin set/change password for any user (ADMIN only)
router.put("/admin-set-password/:id", verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.trim().length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    await setUserPassword(user, newPassword.trim());
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();
    res.status(200).json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error("Error changing password (admin):", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// Admin set/change password AND email credentials (ADMIN only)
router.put("/admin-set-password-and-email/:id", verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.trim().length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const plainPassword = newPassword.trim();
    await setUserPassword(user, plainPassword);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();
    console.log(`📧 Sending admin password email with App ID template for user ${user._id} (${user.regNo})`);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Your Gluck Global Student Portal Credentials (App ID + Password)",
      html: `
        <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
          <p>Hello ${user.name},</p>

          <p>Your password has been updated. Here are your login credentials for the <strong>Gluck Global Portal</strong>:</p>

          <ul>
            <li><strong>App ID:</strong> ${user.regNo}</li>
            <li><strong>Password:</strong> ${plainPassword}</li>
          </ul>

          <p>Please keep this information safe and do not share it with anyone.</p>

          <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>

          <p>Best regards,<br>
          <strong>Gluck Global Pvt Ltd</strong></p>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      res.status(200).json({ success: true, message: "Password updated and credentials emailed successfully." });
    } catch (emailErr) {
      console.error("Email sending failed:", emailErr);
      res.status(500).json({
        success: false,
        message: "Password updated, but email failed to send. Please try again."
      });
    }
  } catch (error) {
    console.error("Error changing password + email (admin):", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// âœ… Get a user by ID
router.get("/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    res.status(200).json(user);
  } catch (error) {
    console.error("âŒ Error fetching user:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// âœ… Get teachers by batch
router.get("/teachers-by-batch/:batch", async (req, res) => {
  try {
    const batch = req.params.batch;
    console.log("ðŸ” Fetching teachers for batch:", batch);

    if (!batch) {
      return res.status(400).json({ message: "Batch is required." });
    }

    const teachers = await User.find({
      role: { $in: ["TEACHER", "TEACHER_ADMIN"] },
      assignedBatches: { $in: [batch] }
    }).select("name");

    teachers.forEach(teacher => {
      console.log("ðŸ‘¨â€ðŸ« Found teacher:", teacher.name);
    });

    // âœ… Always return 200 with array
    res.status(200).json(teachers);

  } catch (error) {
    console.error("âŒ Error fetching teachers by batch:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});


// Update assigned teacher by batch
router.put("/update-teacher-by-batch", async (req, res) => {
  try {
    const { batch, newTeacherId } = req.body;

    if (!batch || !newTeacherId) {
      return res.status(400).json({
        message: "Batch and newTeacherId are required."
      });
    }

    const students = await User.find({
      role: "STUDENT",
      batch: batch
    });

    if (students.length === 0) {
      return res.status(404).json({
        message: "No students found for the specified batch."
      });
    }

    const logs = students.map(student => ({
      action: "UPDATE",
      studentId: student._id,
      levelAtUpdate: student.level,
      batchAtUpdate: batchAtUpdateForLog(student.batch, batch),
      assignedTeacherAtUpdate: student.assignedTeacher,
      statusAtUpdate: student.studentStatus,
      subscriptionAtUpdate: student.subscription,
      mediumAtUpdate: student.medium
    }));

    await StudentLogs.insertMany(logs);
    console.log(`âœ… Created ${logs.length} student log entries for teacher update by batch.`);

    const result = await User.updateMany(
      { role: "STUDENT", batch: batch },
      { assignedTeacher: newTeacherId }
    );

    res.status(200).json({
      message: `Assigned teacher updated for ${result.nModified} students.`
    });

  } catch (error) {
    res.status(500).json({ message: "Internal server error." });
  }
});


// âœ… Update user by ID
router.put("/:id", async (req, res) => {
  try {
    // 1ï¸âƒ£ Get existing user (OLD data)
    const existingUser = await User.findById(req.params.id);

    if (!existingUser) {
      return res.status(404).json({ message: "User not found." });
    }

    // 2ï¸âƒ£ Log OLD data into StudentLogs (if STUDENT)
    if (existingUser.role === "STUDENT") {
      const logEntry = new StudentLogs({
        action: "UPDATE",
        studentId: existingUser._id,
        levelAtUpdate: existingUser.level,
        batchAtUpdate: batchAtUpdateForLog(existingUser.batch),
        assignedTeacherAtUpdate: existingUser.assignedTeacher,
        statusAtUpdate: existingUser.studentStatus,
        subscriptionAtUpdate: existingUser.subscription,
        mediumAtUpdate: existingUser.medium
      });

      await logEntry.save();
    }

    // 3ï¸âƒ£ Extract NEW data
    const {
      name,
      email,
      role,
      subscription,
      level,
      batch,
      medium,
      assignedCourses,
      assignedTeacher,
      assignedBatches,
      studentStatus,
      phoneNumber,
      address,
      age,
      programEnrolled: servicesOpted,
      leadSource,
      languageLevelOpted,
      dateWithdrew,
      courseCompletionDates,
      courseStartDates,
      reasonForWithdrawing,
      qualifications,
      sidebarPermissions,
      teacherTabPermissions,
      sidebarAccessLevels,
      sidebarDeletePermissions,
      teacherTabAccessLevels
    } = req.body;

    // 4ï¸âƒ£ Build update object
    const updateData = {
      name,
      email,
      role,
      subscription,
      level,
      batch,
      medium,
      assignedCourses,
      assignedTeacher,
      assignedBatches,
      studentStatus,
      phoneNumber,
      address,
      age,
      servicesOpted,
      leadSource,
      languageLevelOpted,
      dateWithdrew,
      reasonForWithdrawing,
      courseCompletionDates,
      courseStartDates,
      qualifications
    };

    // Sub-admin sidebar permissions (supports both legacy list and access levels map)
    if (role === "SUB_ADMIN") {
      const hasSidebarAccessLevelsPayload = typeof sidebarAccessLevels !== "undefined";
      const accessLevelSeed = hasSidebarAccessLevelsPayload
        ? normalizeAccessLevels(sidebarAccessLevels)
        : normalizeAccessLevels(existingUser.sidebarAccessLevels || {});

      const normalizedSidebarPermissions =
        hasSidebarAccessLevelsPayload
          ? normalizeSidebarPermissions(accessLevelsToPermissions(accessLevelSeed))
          : typeof sidebarPermissions !== "undefined"
          ? normalizeSidebarPermissions(sidebarPermissions)
          : normalizeSidebarPermissions(existingUser.sidebarPermissions || []);

      const normalizedSidebarAccessLevels = normalizeAccessLevels(
        accessLevelSeed,
        normalizedSidebarPermissions
      );

      if (!normalizedSidebarAccessLevels.dashboard) {
        normalizedSidebarAccessLevels.dashboard = "view";
      }
      if (!normalizedSidebarAccessLevels.profile) {
        normalizedSidebarAccessLevels.profile = "view";
      }

      updateData.sidebarAccessLevels = normalizedSidebarAccessLevels;
      updateData.sidebarDeletePermissions = normalizeSidebarDeletePermissions(
        typeof sidebarDeletePermissions !== "undefined"
          ? sidebarDeletePermissions
          : existingUser.sidebarDeletePermissions || [],
        normalizedSidebarAccessLevels
      );
      updateData.sidebarPermissions = normalizeSidebarPermissions(
        accessLevelsToPermissions(normalizedSidebarAccessLevels)
      );
      updateData.teacherTabPermissions = [];
      updateData.teacherTabAccessLevels = {};
    } else if (role) {
      updateData.sidebarPermissions = [];
      updateData.sidebarAccessLevels = {};
      updateData.sidebarDeletePermissions = [];
    }

    // Teacher tab permissions (supports both legacy list and access levels map)
    if (role === "TEACHER" || role === "TEACHER_ADMIN") {
      const hasTeacherAccessLevelsPayload = typeof teacherTabAccessLevels !== "undefined";
      const teacherAccessLevelSeed = hasTeacherAccessLevelsPayload
        ? normalizeAccessLevels(teacherTabAccessLevels)
        : normalizeAccessLevels(existingUser.teacherTabAccessLevels || {});

      const normalizedTeacherTabPermissions =
        hasTeacherAccessLevelsPayload
          ? normalizeTeacherTabPermissions(accessLevelsToPermissions(teacherAccessLevelSeed))
          : typeof teacherTabPermissions !== "undefined"
          ? normalizeTeacherTabPermissions(teacherTabPermissions)
          : normalizeTeacherTabPermissions(existingUser.teacherTabPermissions || []);

      const normalizedTeacherTabAccessLevels = normalizeAccessLevels(
        teacherAccessLevelSeed,
        normalizedTeacherTabPermissions
      );

      updateData.teacherTabAccessLevels = normalizedTeacherTabAccessLevels;
      updateData.teacherTabPermissions = normalizeTeacherTabPermissions(
        accessLevelsToPermissions(normalizedTeacherTabAccessLevels)
      );
      updateData.sidebarPermissions = [];
      updateData.sidebarAccessLevels = {};
      updateData.sidebarDeletePermissions = [];
    } else if (role && role !== "SUB_ADMIN") {
      updateData.teacherTabPermissions = [];
      updateData.teacherTabAccessLevels = {};
    }

    // âœ… Auto-set start date for new level if level changed and start date not set
    if (existingUser.role === "STUDENT" && level && level !== existingUser.level) {
      if (!updateData.courseStartDates) {
        updateData.courseStartDates = existingUser.courseStartDates || {};
      }
      const levelStartField = `${level}StartDate`;
      if (!updateData.courseStartDates[levelStartField]) {
        updateData.courseStartDates[levelStartField] = new Date();
      }
    }

    // 5ï¸âƒ£ Clear withdraw data if not withdrew
    if (studentStatus !== "WITHDREW") {
      updateData.dateWithdrew = null;
      updateData.reasonForWithdrawing = "";
    }

    // Silver students may omit batch — persist as null so Mongo does not keep an empty string.
    if (existingUser.role === "STUDENT") {
      const resolvedSub = String(
        (subscription !== undefined ? subscription : existingUser.subscription) || ""
      ).toUpperCase();
      if (resolvedSub === "SILVER" && batch !== undefined && !String(batch || "").trim()) {
        updateData.batch = null;
      }
    }

    // 6ï¸âƒ£ Update user
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    const updatedEvent = userEventForRole(updatedUser.role, "UPDATED");
    if (updatedEvent) {
      scheduleDispatchEvent({
        event: updatedEvent,
        entity: { ...sanitizeUserDoc(updatedUser), type: "User" },
        metaOverrides: { syncMode: "live" }
      });
    }

    res.status(200).json({
      message: "User updated successfully.",
      data: updatedUser
    });

  } catch (error) {
    console.error("Update error:", error);

    // âœ… Handle duplicate key error specifically
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists. Please use a different ${field}.`
      });
    }

    res.status(500).json({ message: "Internal server error." });
  }
});


// âœ… Delete user by ID
router.delete("/:id", async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);

    if (!deletedUser) {
      return res.status(404).json({ message: "User not found." });
    }

    const deletedEvent = userEventForRole(deletedUser.role, "DELETED");
    if (deletedEvent) {
      scheduleDispatchEvent({
        event: deletedEvent,
        entity: { ...sanitizeUserDoc(deletedUser), type: "User" },
        metaOverrides: { syncMode: "live" }
      });
    }

    res.status(200).json({ message: "User deleted successfully." });
  } catch (error) {
    res.status(500).json({ message: "Internal server error." });
  }
});

// âœ… Resend credentials email to a student
router.post("/resend-credentials/:userId", verifyToken, checkRole('ADMIN'), async (req, res) => {
  try {
    const userId = req.params.userId;

    // Find the user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Only allow for students
    if (user.role !== "STUDENT") {
      return res.status(400).json({ msg: "Credentials can only be resent to students" });
    }

    // Generate a new one-time password
    const passwordPlain = await generatePassword(user.role, user.regNo);
    await setUserPassword(user, passwordPlain);
    user.mustChangePassword = true;
    user.passwordChangedAt = null;
    user.lastCredentialsEmailSent = new Date();
    await user.save();

    const welcomeMail = buildWelcomeOneTimePasswordEmail({
      name: user.name,
      regNo: user.regNo,
      email: user.email,
      password: passwordPlain,
    });
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: welcomeMail.subject,
      html: welcomeMail.html,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("âœ… Credentials email resent to", user.email);

      res.json({
        success: true,
        msg: "Credentials email sent successfully",
        lastSent: user.lastCredentialsEmailSent,
        displayPassword: passwordPlain,
      });
    } catch (emailErr) {
      console.error("âŒ Email sending failed:", emailErr);
      res.status(500).json({
        success: false,
        msg: "Failed to send email. Please try again."
      });
    }

  } catch (err) {
    console.error("Error resending credentials:", err);
    res.status(500).json({ error: err.message });
  }
});

// âœ… Protected role-based routes
router.get("/protected", verifyToken, (req, res) => {
  res.json({ msg: "You have access!", user: req.user });
});

router.get("/admin-dashboard", verifyToken, checkRole('ADMIN'), (req, res) => {
  res.json({ msg: "Welcome to the admin dashboard" });
});

router.get("/teacher-dashboard", verifyToken, checkRole('TEACHER'), (req, res) => {
  res.json({ msg: "Welcome to the teacher dashboard" });
});

router.get("/student-dashboard", verifyToken, checkRole('STUDENT'), (req, res) => {
  res.json({ msg: "Welcome to the student dashboard" });
});

// âœ… NEW: Get users by role (for unified user management)
router.get("/users-by-role/:role", verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { role } = req.params;

    // Validate role
    if (!['ADMIN', 'TEACHER', 'STUDENT', 'SUB_ADMIN'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role specified' });
    }

    const users = await User.find({ role })
      .select('-password')
      .populate('assignedCourses', 'title')
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    console.error('Error fetching users by role:', error);
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// âœ… NEW: Bulk upload students
router.post("/bulk-upload-students", verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { students, sendEmails = true } = req.body;

    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Students array is required and must not be empty'
      });
    }

    const results = {
      successful: [],
      failed: [],
      skipped: []
    };

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      const rowNumber = i + 2; // +2 because row 1 is header, and array is 0-indexed

      try {
        // Validate required fields
        if (!student.name || !student.name.trim()) {
          results.failed.push({
            row: rowNumber,
            data: student,
            reason: 'Name is required'
          });
          continue;
        }

        if (!student.email || !student.email.trim()) {
          results.failed.push({
            row: rowNumber,
            data: student,
            reason: 'Email is required'
          });
          continue;
        }

        if (!student.subscription || !['SILVER', 'PLATINUM'].includes(student.subscription.toUpperCase())) {
          results.failed.push({
            row: rowNumber,
            data: student,
            reason: 'Subscription must be SILVER or PLATINUM'
          });
          continue;
        }

        if (!student.level || !['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(student.level.toUpperCase())) {
          results.failed.push({
            row: rowNumber,
            data: student,
            reason: 'Level must be A1, A2, B1, B2, C1, or C2'
          });
          continue;
        }

        if (!student.studentStatus || !student.studentStatus.trim()) {
          results.failed.push({
            row: rowNumber,
            data: student,
            reason: 'Student Status is required'
          });
          continue;
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email: student.email.trim().toLowerCase() });
        if (existingUser) {
          // âœ… RESEND CREDENTIALS instead of skipping
          if (sendEmails) {
            try {
              // Generate new password for existing user
              const newPasswordPlain = await generatePassword("STUDENT", existingUser.regNo);

              // Update password hash + recoverable copy (ADMIN password column)
              await setUserPassword(existingUser, newPasswordPlain);
              existingUser.lastCredentialsEmailSent = new Date();
              await existingUser.save();

              // Send credentials email
              await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: existingUser.email,
                subject: "Your Gluck Global Student Portal Credentials",
                html: `
                  <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
                    <p>Hello ${existingUser.name},</p>

                    <p>Your login credentials for the <strong>Gluck Global Student Portal</strong> have been sent as requested:</p>

                    <ul>
                      <li><strong>Web App ID:</strong> ${existingUser.regNo}</li>
                      <li><strong>Password:</strong> ${newPasswordPlain}</li>
                    </ul>

                    <p>Please keep this information safe and do not share it with anyone.</p>

                    <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>

                    <p>Best regards,<br>
                    <strong>Gluck Global Pvt Ltd</strong></p>
                  </div>
                `
              });

              results.successful.push({
                row: rowNumber,
                name: existingUser.name,
                email: existingUser.email,
                regNo: existingUser.regNo,
                password: newPasswordPlain,
                emailSent: true,
                isExistingUser: true,
                action: 'credentials_resent'
              });
            } catch (emailError) {
              console.error(`Email error for existing user ${existingUser.email}:`, emailError);
              results.failed.push({
                row: rowNumber,
                data: student,
                reason: `Failed to resend credentials: ${emailError.message}`,
                existingRegNo: existingUser.regNo
              });
            }
          } else {
            // If sendEmails is false, just skip
            results.skipped.push({
              row: rowNumber,
              data: student,
              reason: 'Email already exists (credentials not resent because sendEmails=false)',
              existingRegNo: existingUser.regNo
            });
          }
          continue;
        }

        // Generate RegNo and Password
        const regNo = await generateRegNo("STUDENT");
        const passwordPlain = await generatePassword("STUDENT", regNo);

        // Create new user
        const newUser = new User({
          name: student.name.trim(),
          email: student.email.trim().toLowerCase(),
          regNo,
          password: 'placeholder', // overwritten by setUserPassword below
          role: "STUDENT",
          subscription: student.subscription.toUpperCase(),
          level: student.level.toUpperCase(),
          studentStatus: student.studentStatus.trim(),
          medium: student.medium ? student.medium.trim() : undefined,
          batch: student.batch ? student.batch.trim() : undefined,
          phoneNumber: student.phoneNumber ? student.phoneNumber.trim() : undefined,
          address: student.address ? student.address.trim() : undefined,
          age: student.age ? parseInt(student.age) : undefined,
          servicesOpted: student.programEnrolled ? student.programEnrolled.trim() : (student.servicesOpted ? student.servicesOpted.trim() : undefined),
          leadSource: student.leadSource ? student.leadSource.trim() : undefined
        });

        // ✅ Auto-set start date for current level
        const level = student.level.toUpperCase();
        if (!newUser.courseStartDates) {
          newUser.courseStartDates = {};
        }
        const levelStartField = `${level}StartDate`;
        newUser.courseStartDates[levelStartField] = new Date();

        await setUserPassword(newUser, passwordPlain);
        newUser.mustChangePassword = true;
        await newUser.save();

        scheduleDispatchEvent({
          event: "STUDENT_CREATED",
          entity: { ...sanitizeUserDoc(newUser), type: "User" },
          metaOverrides: { syncMode: "live" }
        });

        // Send welcome email if requested
        if (sendEmails) {
          try {
            const welcomeMail = buildWelcomeOneTimePasswordEmail({
              name: newUser.name,
              regNo,
              email: newUser.email,
              password: passwordPlain,
            });
            await transporter.sendMail({
              from: process.env.EMAIL_USER,
              to: newUser.email,
              subject: welcomeMail.subject,
              html: welcomeMail.html,
            });

            // Update lastCredentialsEmailSent timestamp
            newUser.lastCredentialsEmailSent = new Date();
            await newUser.save();

            results.successful.push({
              row: rowNumber,
              name: newUser.name,
              email: newUser.email,
              regNo: newUser.regNo,
              password: passwordPlain,
              emailSent: true
            });
          } catch (emailError) {
            console.error(`Email error for ${newUser.email}:`, emailError);
            results.successful.push({
              row: rowNumber,
              name: newUser.name,
              email: newUser.email,
              regNo: newUser.regNo,
              password: passwordPlain,
              emailSent: false,
              emailError: 'Failed to send email'
            });
          }
        } else {
          results.successful.push({
            row: rowNumber,
            name: newUser.name,
            email: newUser.email,
            regNo: newUser.regNo,
            password: passwordPlain,
            emailSent: false
          });
        }

      } catch (error) {
        console.error(`Error processing student at row ${rowNumber}:`, error);
        results.failed.push({
          row: rowNumber,
          data: student,
          reason: error.message || 'Unknown error'
        });
      }
    }

    // Return summary
    res.json({
      success: true,
      message: 'Bulk upload completed',
      summary: {
        total: students.length,
        successful: results.successful.length,
        failed: results.failed.length,
        skipped: results.skipped.length
      },
      results
    });

  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during bulk upload',
      error: error.message
    });
  }
});

// ─── POST /admin/force-password-reset/:studentId — logout, OTP email, must set new password ───

router.post('/admin/force-password-reset/:studentId', verifyToken, checkRole(['ADMIN', 'SUB_ADMIN']), async (req, res) => {
  try {
    const user = await User.findById(req.params.studentId);
    if (!user) {
      return res.status(404).json({ msg: 'Student not found.' });
    }
    if (user.role !== 'STUDENT') {
      return res.status(400).json({ msg: 'Password reset can only be triggered for students.' });
    }

    user.authTokenVersion = (user.authTokenVersion || 0) + 1;
    user.mustChangePassword = true;
    await user.save();

    await EmailChangeOtp.deleteMany({ userId: user._id });

    const otp = String(crypto.randomInt(100000, 999999));
    const otpHash = await bcrypt.hash(otp, await bcrypt.genSalt(10));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await EmailChangeOtp.create({
      userId: user._id,
      pendingNewEmail: user.email,
      otpHash,
      expiresAt,
    });

    const frontendUrl = (process.env.FRONTEND_URL || 'https://gluckstudentsportal.com').replace(/\/$/, '');
    const loginUrl = `${frontendUrl}/login`;
    const { subject, html } = buildForcePasswordResetEmail({
      name: user.name,
      regNo: user.regNo,
      otp,
      loginUrl,
      expiresMinutes: 15,
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject,
      html,
    });

    console.log('[admin/force-password-reset] Sent to', user.email, 'regNo', user.regNo);

    return res.json({
      success: true,
      msg: `Password reset initiated for ${user.name}. They were signed out and emailed a verification code.`,
    });
  } catch (err) {
    console.error('[POST /auth/admin/force-password-reset]', err);
    return res.status(500).json({ msg: 'Failed to initiate password reset. Please try again.' });
  }
});

// ─── POST /admin/signup-link — send a signup link to a prospective student ───

router.post('/admin/signup-link', verifyToken, checkRole(['ADMIN', 'SUB_ADMIN']), async (req, res) => {
  try {
    if (!['ADMIN', 'SUB_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ msg: 'Forbidden' });
    }
    const { name, email, level, subscription } = req.body;
    if (!email || !String(email).includes('@')) {
      return res.status(400).json({ msg: 'A valid email is required.' });
    }

    // Create (or reuse) a signup application
    let signupApp = await StudentSignupApplication.findOne({
      email: email.trim().toLowerCase(),
      status: { $in: ['draft', 'email_verified', 'documents_done', 'payment_pending'] },
    }).sort({ updatedAt: -1 });
    if (!signupApp) {
      signupApp = await StudentSignupApplication.create({
        name: name || '',
        email: email.trim().toLowerCase(),
        level: level || undefined,
        subscription: subscription || undefined,
        inviteToken: require('crypto').randomUUID(),
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://gluckstudentsportal.com';
    const signupUrl = `${frontendUrl}/signup/apply?token=${signupApp.applicationToken}`;
    const linkMail = buildSignupLinkEmail({ name: name || 'there', signupUrl });
    await transporter.sendMail({ from: process.env.EMAIL_USER, to: email.trim().toLowerCase(), subject: linkMail.subject, html: linkMail.html });

    return res.json({ success: true, msg: `Signup link sent to ${email}.`, applicationToken: signupApp.applicationToken });
  } catch (err) {
    console.error('[POST /auth/admin/signup-link]', err);
    return res.status(500).json({ msg: 'Failed to send signup link. Please try again.' });
  }
});

module.exports = router;
