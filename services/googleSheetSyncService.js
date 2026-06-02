const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const StudentExtractedData = require('../models/StudentExtractedData');
const StudentDocument = require('../models/StudentDocument');
const User = require('../models/User');
const { mapToSheetRow, getSheetHeaders } = require('../utils/fieldMapper');

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!email || !key || !spreadsheetId) {
    throw new Error('Google Sheets credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SPREADSHEET_ID in .env');
  }
  const auth = new JWT({
    email,
    key: key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return { auth, spreadsheetId };
}

async function getSheet() {
  const { auth, spreadsheetId } = getAuth();
  const doc = new GoogleSpreadsheet(spreadsheetId, auth);
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  if (!sheet) {
    throw new Error('No worksheet found in the spreadsheet. Create at least one sheet tab.');
  }
  return { doc, sheet };
}

async function ensureHeaders(sheet) {
  const desiredHeaders = getSheetHeaders();
  try {
    await sheet.loadHeaderRow();
    const currentHeaders = sheet.headerValues || [];
    const needsUpdate = desiredHeaders.some(h => !currentHeaders.includes(h));
    if (!needsUpdate && currentHeaders.length > 0) return desiredHeaders;
  } catch {}
  await sheet.setHeaderRow(desiredHeaders);
  return desiredHeaders;
}

async function syncAllStudents() {
  const { sheet } = await getSheet();
  await ensureHeaders(sheet);

  const students = await User.find({ role: 'STUDENT', isTestAccount: { $ne: true } })
    .select('_id regNo name email phoneNumber nationality')
    .lean();

  const rows = [];
  const errors = [];

  for (const student of students) {
    try {
      const extracted = await StudentExtractedData.findOne({ studentId: student._id }).lean();
      const docs = await StudentDocument.find({
        studentId: student._id,
        isCurrent: true,
      }).select('documentType status').lean();

      const row = mapToSheetRow(extracted, student, docs);
      row['_regNo'] = student.regNo || '';
      row['_studentId'] = student._id.toString();
      rows.push(row);
    } catch (err) {
      errors.push({ studentId: student._id, regNo: student.regNo, error: err.message });
    }
  }

  await sheet.clearRows();
  await sheet.addRows(rows.map(r => {
    const { _regNo, _studentId, ...cleanRow } = r;
    return cleanRow;
  }));

  await StudentExtractedData.updateMany(
    { lastSyncedToSheet: { $exists: true } },
    { $set: { lastSyncedToSheet: new Date() } }
  );

  return {
    totalStudents: students.length,
    synced: rows.length,
    errors,
  };
}

async function syncSingleStudent(studentId) {
  const { sheet } = await getSheet();
  await ensureHeaders(sheet);

  const student = await User.findById(studentId).lean();
  if (!student || student.role !== 'STUDENT') {
    throw new Error('Student not found');
  }

  const extracted = await StudentExtractedData.findOne({ studentId }).lean();
  const docs = await StudentDocument.find({
    studentId,
    isCurrent: true,
  }).select('documentType status').lean();

  const row = mapToSheetRow(extracted, student, docs);

  await sheet.addRow(row);

  await StudentExtractedData.findOneAndUpdate(
    { studentId },
    { $set: { lastSyncedToSheet: new Date() } }
  );

  return { studentId, regNo: student.regNo, synced: true };
}

async function getSyncStatus() {
  const totalStudents = await User.countDocuments({ role: 'STUDENT', isTestAccount: { $ne: true } });
  const ocrCompleted = await StudentExtractedData.countDocuments({ ocrStatus: 'COMPLETED' });
  const ocrPending = await StudentExtractedData.countDocuments({ ocrStatus: { $ne: 'COMPLETED' } });
  const syncedCount = await StudentExtractedData.countDocuments({ lastSyncedToSheet: { $ne: null } });

  let lastSyncTime = null;
  const lastSynced = await StudentExtractedData.findOne({ lastSyncedToSheet: { $ne: null } })
    .sort({ lastSyncedToSheet: -1 })
    .select('lastSyncedToSheet')
    .lean();
  if (lastSynced) {
    lastSyncTime = lastSynced.lastSyncedToSheet;
  }

  let sheetConfigured = false;
  try {
    const { auth, spreadsheetId } = getAuth();
    sheetConfigured = !!(auth && spreadsheetId);
  } catch {}

  return {
    totalStudents,
    ocrCompleted,
    ocrPending,
    syncedToSheet: syncedCount,
    lastSyncTime,
    sheetConfigured,
  };
}

module.exports = { syncAllStudents, syncSingleStudent, getSyncStatus };
