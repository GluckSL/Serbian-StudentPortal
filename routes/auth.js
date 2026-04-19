//routes/auth.js

require('dotenv').config();  // Load environment variables

const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Course = require("../models/Course");
const StudentLogs = require("../models/StudentLogs");
const UserActivityLog = require("../models/UserActivityLog");
const router = express.Router();
const transporter = require("../config/emailConfig");
const {
  scheduleDispatchEvent,
  sanitizeUserDoc,
  userEventForRole
} = require("../services/studentPortalCrmWebhook");

//const auth = require("../middleware/auth");
const { verifyToken, isAdmin } = require('../middleware/auth');
const checkRole = require("../middleware/checkRole");
const JWT_SECRET = process.env.JWT_SECRET;
const SUB_ADMIN_DEFAULT_PERMISSIONS = ["dashboard", "profile"];
const ALLOWED_SIDEBAR_PERMISSION_IDS = [
  "dashboard",
  "analytic-dash",
  "students",
  "student-logs",
  "teachers",
  "user-roles",
  "modules",
  "exercises",
  "journey",
  "manage-classes",
  "attendance",
  "import-meeting",
  "class-recordings",
  "ai-bot-report",
  "documents",
  "visa-tracking",
  "student-progress",
  "payments",
  "invoices",
  "payment-approvals",
  "timetable",
  "monday-sync",
  "support-tickets",
  "announcements",
  "whatsapp-announcement",
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

// Read CRM data from Monday.com â€” Full sync: update existing + create new (all packages, exclude WITHDREW)
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

  const eligibleItems = allItems.filter(item => {
    const get = (id) => mondayGet(item.column_values, id);
    return get("color_mm019dcv").toUpperCase().trim() !== "WITHDREW";
  });

  console.log(`âœ… ${eligibleItems.length} eligible (excluding WITHDREW)`);

  let created = 0, updated = 0, skipped = 0, errors = 0;
  const createdNames = [], updatedNames = [], errorNames = [];

  for (const item of eligibleItems) {
    try {
      const get = (id) => mondayGet(item.column_values, id);
      const name = item.name;
      const email = get("text_mkw3spks").trim().toLowerCase();
      if (!email) { skipped++; continue; }

      const phoneNumber = get("text_mkw2wpvr");
      const whatsappNumber = get("phone_mkv0a5mm");
      const address = get("text_mkv080k2");
      const ageStr = get("text_mkw38wse");
      const qualifications = get("text_mkw32n6r");
      const enrollmentDateStr = get("date_mkw7wejn");
      const servicesOpted = get("color_mm023vmt") || get("text_mkwz1j6q");
      const subscription = get("color_mm02jfyb").toUpperCase().trim();
      const languageLevelOpted = get("color_mm02c95");
      const batch = get("dropdown_mkxx6cfp");
      const studentStatus = get("color_mm019dcv").toUpperCase().trim();
      const level = get("dropdown_mkzshj5a").toUpperCase().trim();
      const otherLanguageKnown = get("dropdown_mkzsadkp");
      const medium = get("dropdown_mkw09h9j");
      const leadSource = get("dropdown_mm0d9jrv");
      const stream = get("text_mkwtq4fq");
      const batchStartedOnStr = get("date_mkxkba8t");
      const teacherIncharge = get("dropdown_mkw72gz4");

      let assignedTeacherId = null;
      if (teacherIncharge) {
        const tName = teacherIncharge.trim();
        const escapedName = tName.replace(/[.*+?^${}()|[\]\\]/g, '\\' + '$&');
        const teacher = await User.findOne({ role: { $in: ['TEACHER', 'TEACHER_ADMIN'] }, name: { $regex: new RegExp('(^|\\s)' + escapedName + '(\\s|$)', 'i') } }).select('_id');
        if (teacher) assignedTeacherId = teacher._id;
      }

      const dateWithdrewStr = get("date_mkzzgvxv");
      const reasonForWithdrawing = get("text_mkzz24qx");
      const a1StartStr = get("date_mm1dceqs"), a1CompletedStr = get("date_mkzt1xj");
      const a2StartStr = get("date_mm1dwzc8"), a2CompletedStr = get("date_mkztk1pn");
      const b1StartStr = get("date_mm1d7az3"), b1CompletedStr = get("date_mkztxce7");
      const b2StartStr = get("date_mm1dbv8e"), b2CompletedStr = get("date_mkztwdfn");
      const examPassedDateStr = get("date_mkw7zwjh");
      const languageExamStatus = get("color_mkw7syb");
      const candidateStatus = get("text_mkzzjdv1");
      const examRemark = get("text_mkzzbgz1");
      const readingScore = get("numeric_mkzz97be"), listeningScore = get("numeric_mkzz8sr4");
      const writingScore = get("numeric_mkzz2bzg"), speakingScore = get("numeric_mkzz8q32");
      const documentationPaymentStatus = mondayGetFirstNonEmpty(
        item.column_values,
        process.env.MONDAY_COL_DOCUMENTATION_PAYMENT_STATUS
      );

      const parseDate = (str) => str ? new Date(str) : null;

      const updateData = {
        name, phoneNumber, whatsappNumber, address,
        age: ageStr ? parseInt(ageStr) : null, qualifications,
        servicesOpted, subscription, languageLevelOpted, batch,
        studentStatus, level, otherLanguageKnown,
        medium: medium ? [medium] : [], leadSource, stream, teacherIncharge,
        ...(assignedTeacherId ? { assignedTeacher: assignedTeacherId } : {}),
        reasonForWithdrawing, languageExamStatus, candidateStatus, examRemark,
        documentationPaymentStatus,
        enrollmentDate: parseDate(enrollmentDateStr),
        batchStartedOn: parseDate(batchStartedOnStr),
        dateWithdrew: parseDate(dateWithdrewStr),
        examPassedDate: parseDate(examPassedDateStr),
        examScores: { reading: readingScore ? parseFloat(readingScore) : null, listening: listeningScore ? parseFloat(listeningScore) : null, writing: writingScore ? parseFloat(writingScore) : null, speaking: speakingScore ? parseFloat(speakingScore) : null },
        courseStartDates: { A1StartDate: parseDate(a1StartStr), A2StartDate: parseDate(a2StartStr), B1StartDate: parseDate(b1StartStr), B2StartDate: parseDate(b2StartStr) },
        courseCompletionDates: { A1CompletionDate: parseDate(a1CompletedStr), A2CompletionDate: parseDate(a2CompletedStr), B1CompletionDate: parseDate(b1CompletedStr), B2CompletionDate: parseDate(b2CompletedStr) },
        updatedAt: new Date()
      };

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        await User.updateOne({ email }, { $set: updateData });
        updated++; updatedNames.push(name);
      } else {
        const regNo = await generateRegNo("STUDENT");
        const passwordPlain = await generatePassword("STUDENT", regNo);
        const hashedPassword = await bcrypt.hash(passwordPlain, 10);
        const newUser = new User({ ...updateData, email, regNo, password: hashedPassword, role: "STUDENT", registeredAt: parseDate(enrollmentDateStr) || new Date(), createdAt: new Date() });
        await newUser.save();
        try {
          await transporter.sendMail({ from: process.env.EMAIL_USER, to: email, subject: "Welcome to GlÃ¼ck Global Student Portal ðŸŽ‰",
            html: `<div style="font-family:Arial,sans-serif;color:#000;line-height:1.6"><p>Hello ${name},</p><p>You have successfully registered to the <strong>GlÃ¼ck Global Student Portal</strong>. Here are your login credentials:</p><ul><li><strong>Web App ID:</strong> ${regNo}</li><li><strong>Password:</strong> ${passwordPlain}</li></ul><p>Please keep this information safe and do not share it with anyone.</p><p>You can access the Portal at: <a href="https://gluckstudentsportal.com">https://gluckstudentsportal.com</a></p><p>Best regards,<br><strong>GlÃ¼ck Global Pvt Ltd</strong></p></div>` });
          newUser.lastCredentialsEmailSent = new Date(); await newUser.save();
          console.log(`  ðŸ“§ Credentials email sent to ${email}`);
        } catch (emailErr) { console.error(`  âš ï¸ Failed to send email to ${email}:`, emailErr.message); }
        created++; createdNames.push(name);
      }
    } catch (itemErr) { console.error(`  âŒ Error processing item "${item.name}":`, itemErr.message); errors++; errorNames.push(item.name); }
  }

  const result = { created, updated, skipped, errors, totalOnBoard: allItems.length, eligible: eligibleItems.length, createdNames, updatedNames, errorNames, duration: Math.round((Date.now() - startTime.getTime()) / 1000) };
  console.log(`\nâœ… Monday CRM sync completed: Created: ${created} | Updated: ${updated} | Skipped: ${skipped} | Errors: ${errors}`);
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

    // Filter: All packages, exclude WITHDREW status
    const eligibleItems = allItems.filter(item => {
      const get = (id) => mondayGet(item.column_values, id);
      const currentStatus = get("color_mm019dcv").toUpperCase().trim();
      return currentStatus !== "WITHDREW";
    });

    const parseDate = (str) => str ? new Date(str) : null;
    const newStudents = [];
    const updatedStudents = [];
    const skipped = [];

    for (const item of eligibleItems) {
      const get = (id) => mondayGet(item.column_values, id);

      const name              = item.name;
      const email             = get("text_mkw3spks").trim().toLowerCase();
      const phoneNumber       = get("text_mkw2wpvr");
      const address           = get("text_mkv080k2");
      const age               = get("text_mkw38wse");
      const qualifications    = get("text_mkw32n6r");
      const enrollmentDate    = get("date_mkw7wejn");
      const servicesOpted     = get("color_mm023vmt") || get("text_mkwz1j6q");
      const subscription      = get("color_mm02jfyb").toUpperCase().trim();
      const languageLevelOpted = get("color_mm02c95");
      const batch             = get("dropdown_mkxx6cfp");
      const studentStatus     = get("color_mm019dcv").toUpperCase().trim();
      const level             = get("dropdown_mkzshj5a").toUpperCase().trim();
      const medium            = get("dropdown_mkw09h9j");
      const leadSource        = get("dropdown_mm0d9jrv");
      const stream            = get("text_mkwtq4fq");
      const teacherIncharge   = get("dropdown_mkw72gz4");
      const documentationPaymentStatus = mondayGetFirstNonEmpty(
        item.column_values,
        process.env.MONDAY_COL_DOCUMENTATION_PAYMENT_STATUS
      );

      if (!email) { skipped.push({ name, reason: 'No email' }); continue; }

      const mondayData = {
        name, email, phoneNumber, address, age, qualifications,
        servicesOpted, subscription, languageLevelOpted, batch,
        studentStatus, level, medium, leadSource, stream,
        teacherIncharge, enrollmentDate, documentationPaymentStatus
      };

      const existingUser = await User.findOne({ email }).lean();

      if (existingUser) {
        // Compare fields to find changes
        const changes = [];
        const fieldsToCompare = {
          name: name,
          phoneNumber: phoneNumber,
          subscription: subscription,
          batch: batch,
          level: level,
          studentStatus: studentStatus,
          servicesOpted: servicesOpted,
          languageLevelOpted: languageLevelOpted,
          stream: stream,
          leadSource: leadSource,
          teacherIncharge: teacherIncharge,
          address: address,
          documentationPaymentStatus: documentationPaymentStatus
        };

        for (const [field, mondayVal] of Object.entries(fieldsToCompare)) {
          const portalVal = String(existingUser[field] || '');
          const mVal = String(mondayVal || '');
          if (portalVal !== mVal && mVal) {
            changes.push({ field, portalValue: portalVal || '(empty)', mondayValue: mVal });
          }
        }

        if (changes.length > 0) {
          updatedStudents.push({
            name, email, regNo: existingUser.regNo, changes
          });
        }
      } else {
        newStudents.push(mondayData);
      }
    }

    res.json({
      success: true,
      totalOnBoard: allItems.length,
      eligibleCount: eligibleItems.length,
      newStudents,
      updatedStudents,
      skipped,
      summary: {
        willCreate: newStudents.length,
        willUpdate: updatedStudents.length,
        noChanges: eligibleItems.length - newStudents.length - updatedStudents.length - skipped.length,
        skipped: skipped.length
      }
    });
  } catch (err) {
    console.error("âŒ Monday sync preview error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// âœ… Reg No generation for different roles
async function generateRegNo(role) {
  const roleKey = typeof role === "string" ? role.trim().toUpperCase() : "";
  if (!roleKey) {
    throw new Error("Role is required to generate regNo");
  }
  // map roles to prefixes
  const prefixMap = {
    STUDENT: "STUD",
    TEACHER: "T",
    ADMIN: "AD",
    SUB_ADMIN: "SAD"
  };

  const prefix = prefixMap[roleKey] || roleKey.substring(0, 2).toUpperCase(); // fallback

  const lastUser = await User.findOne({
    role: roleKey,
    regNo: { $regex: `^${prefix}\\d+$` }
  })
    // Sort by regNo so padding keeps correct order (e.g., SAD003 < SAD010)
    .sort({ regNo: -1 })
    .exec();

  let nextNumber = 1;

  if (lastUser && lastUser.regNo) {
    const match = lastUser.regNo.match(new RegExp(`^${prefix}(\\d+)$`));
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  return prefix + String(nextNumber).padStart(3, "0");
}

async function getRegNoSeed(role) {
  const roleKey = typeof role === "string" ? role.trim().toUpperCase() : "";
  if (!roleKey) throw new Error("Role is required to generate regNo");

  const prefixMap = {
    STUDENT: "STUD",
    TEACHER: "T",
    ADMIN: "AD",
    SUB_ADMIN: "SAD"
  };
  const prefix = prefixMap[roleKey] || roleKey.substring(0, 2).toUpperCase();

  const lastUser = await User.findOne({
    role: roleKey,
    regNo: { $regex: `^${prefix}\\d+$` }
  })
    .sort({ regNo: -1 })
    .lean();

  let nextNumber = 1;
  if (lastUser?.regNo) {
    const match = lastUser.regNo.match(new RegExp(`^${prefix}(\\d+)$`));
    if (match) nextNumber = parseInt(match[1], 10) + 1;
  }

  return { prefix, nextNumber, roleKey };
}

//Password generation
async function generatePassword(role, regNo) {
  // map roles to prefixes
  const prefixMap = {
    STUDENT: "Student",
    TEACHER: "Teacher",
    ADMIN: "Admin",
    SUB_ADMIN: "SubAdmin"
  };

  const roleKey = typeof role === "string" ? role.trim().toUpperCase() : "";
  if (!roleKey) {
    throw new Error("Role is required to generate password");
  }
  const prefix = prefixMap[roleKey] || roleKey;

  // get last 3 characters of regNo
  const lastThreeDigits = regNo.slice(-3);

  // get current year
  const currentYear = new Date().getFullYear();

  // construct password
  const password = `${prefix}${lastThreeDigits}@${currentYear}`;

  return password;
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
      const hashedPassword = await bcrypt.hash(password, 10);

      user = new User({
        regNo,
        name: normalizedName,
        email: normalizedEmail,
        password: hashedPassword,
        role: normalizedRole
      });

      if (user.role === "STUDENT") {
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
      // âœ‰ï¸ Send email
      const passwordPlain = password; // Store plain password temporarily for email
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: "Welcome to Gluck Global Student Portal ",
        html: `
          <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
            <p>Hello ${user.name},</p>

            <p>You have successfully registered to the <strong>GlUck Global Student Portal</strong>. Here are your login credentials:</p>

            <ul>
              <li><strong>Web App ID:</strong> ${user.regNo}</li>
              <li><strong>Password:</strong> ${passwordPlain}</li>
            </ul>

            <p>Please keep this information safe and do not share it with anyone.</p>

            <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>

            <p>Best regards,<br>
            <strong>GlUck Global Pvt Ltd</strong></p>
          </div>
        `
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log("âœ… Email sent to", user.email);

        // Update lastCredentialsEmailSent timestamp
        user.lastCredentialsEmailSent = new Date();
        await user.save();
      } catch (err) {
        console.error("âŒ Email sending failed:", err);
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


// âœ… Login
router.post("/login", async (req, res) => {
  try {
    const { regNo, password } = req.body;

    const user = await User.findOne({ regNo });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    // ðŸ”´ BLOCK WITHDREW STUDENTS
    if (user.role === "STUDENT" && user.studentStatus === "WITHDREW") {
      return res.status(403).json({
        msg: "Your student account has been withdrawn. Access denied."
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    // ✅ track last login + keep login history (best effort)
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

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        name: user.name
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    // âœ… Set cookie instead of sending token
    res.cookie("authToken", token, {
      httpOnly: true,
      secure: false,   // âœ… FIXED: false in development
      sameSite: 'Lax', // âœ… FIXED: 'Lax' for localhost
      path: '/',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // âœ… Send user info only (no token in response)
    return res.json({
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        subscription: user.subscription,
        profilePhoto: user.profilePhoto || null,
        sidebarPermissions: user.sidebarPermissions || [],
        teacherTabPermissions: user.teacherTabPermissions || [],
        sidebarAccessLevels: user.sidebarAccessLevels || {},
        teacherTabAccessLevels: user.teacherTabAccessLevels || {}
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// âœ… Logout
router.post("/logout", (req, res) => {
  // ✅ best-effort: record logout activity when token present
  try {
    const token = req.cookies?.authToken;
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

  res.clearCookie("authToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // âœ… true in production with HTTPS
    sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax', // âœ… FIXED: Match login settings
    domain: process.env.NODE_ENV === 'production' ? '.gluckstudentsportal.com' : undefined, // âœ… FIXED: Match login settings
    path: '/' // âœ… FIXED: Match login settings
  });
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

    const user = await query;

    if (!user) {
      return res.status(404).json({ message: "User not found" });
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
    }).select("name email regNo role sidebarPermissions teacherTabPermissions sidebarAccessLevels teacherTabAccessLevels").sort({ role: 1, name: 1 });

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
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword.trim(), salt);
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
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(plainPassword, salt);
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
      batchAtUpdate: student.batch,
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
        batchAtUpdate: existingUser.batch,
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
      updateData.sidebarPermissions = normalizeSidebarPermissions(
        accessLevelsToPermissions(normalizedSidebarAccessLevels)
      );
      updateData.teacherTabPermissions = [];
      updateData.teacherTabAccessLevels = {};
    } else if (role) {
      updateData.sidebarPermissions = [];
      updateData.sidebarAccessLevels = {};
    }

    // Teacher tab permissions (supports both legacy list and access levels map)
    if (role === "TEACHER") {
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

    // Generate a new password
    const passwordPlain = await generatePassword(user.role, user.regNo);
    const hashedPassword = await bcrypt.hash(passwordPlain, 10);

    // Update user password and email sent timestamp
    user.password = hashedPassword;
    user.lastCredentialsEmailSent = new Date();
    await user.save();

    // Send email with credentials
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Your GlÃ¼ck Global Student Portal Credentials ðŸŽ‰",
      html: `
        <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
          <p>Hello ${user.name},</p>

          <p>As requested, here are your login credentials for the <strong>GlÃ¼ck Global Student Portal</strong>:</p>

          <ul>
            <li><strong>Web App ID:</strong> ${user.regNo}</li>
            <li><strong>Password:</strong> ${passwordPlain}</li>
          </ul>

          <p>Please keep this information safe and do not share it with anyone.</p>

          <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>

          <p>Best regards,<br>
          <strong>GlÃ¼ck Global Pvt Ltd</strong></p>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("âœ… Credentials email resent to", user.email);

      res.json({
        success: true,
        msg: "Credentials email sent successfully",
        lastSent: user.lastCredentialsEmailSent
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
              const newHashedPassword = await bcrypt.hash(newPasswordPlain, 10);

              // Update password
              existingUser.password = newHashedPassword;
              existingUser.lastCredentialsEmailSent = new Date();
              await existingUser.save();

              // Send credentials email
              await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: existingUser.email,
                subject: "Your GlÃ¼ck Global Student Portal Credentials ðŸ”‘",
                html: `
                  <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
                    <p>Hello ${existingUser.name},</p>

                    <p>Your login credentials for the <strong>GlÃ¼ck Global Student Portal</strong> have been sent as requested:</p>

                    <ul>
                      <li><strong>Web App ID:</strong> ${existingUser.regNo}</li>
                      <li><strong>Password:</strong> ${newPasswordPlain}</li>
                    </ul>

                    <p>Please keep this information safe and do not share it with anyone.</p>

                    <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>

                    <p>Best regards,<br>
                    <strong>GlÃ¼ck Global Pvt Ltd</strong></p>
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
        const hashedPassword = await bcrypt.hash(passwordPlain, 10);

        // Create new user
        const newUser = new User({
          name: student.name.trim(),
          email: student.email.trim().toLowerCase(),
          regNo,
          password: hashedPassword,
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

        // âœ… Auto-set start date for current level
        const level = student.level.toUpperCase();
        if (!newUser.courseStartDates) {
          newUser.courseStartDates = {};
        }
        const levelStartField = `${level}StartDate`;
        newUser.courseStartDates[levelStartField] = new Date();

        await newUser.save();

        scheduleDispatchEvent({
          event: "STUDENT_CREATED",
          entity: { ...sanitizeUserDoc(newUser), type: "User" },
          metaOverrides: { syncMode: "live" }
        });

        // Send welcome email if requested
        if (sendEmails) {
          try {
            await transporter.sendMail({
              from: process.env.EMAIL_USER,
              to: newUser.email,
              subject: "Welcome to GlÃ¼ck Global Student Portal ðŸŽ‰",
              html: `
                <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
                  <p>Hello ${newUser.name},</p>

                  <p>You have successfully registered to the <strong>GlÃ¼ck Global Student Portal</strong>. Here are your login credentials:</p>

                  <ul>
                    <li><strong>Web App ID:</strong> ${regNo}</li>
                    <li><strong>Password:</strong> ${passwordPlain}</li>
                  </ul>

                  <p>Please keep this information safe and do not share it with anyone.</p>

                  <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>

                  <p>Best regards,<br>
                  <strong>GlÃ¼ck Global Pvt Ltd</strong></p>
                </div>
              `
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

module.exports = router;
