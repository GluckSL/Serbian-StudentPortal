const fs = require('fs');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const StudentExtractedData = require('../models/StudentExtractedData');
const StudentDocument = require('../models/StudentDocument');
const User = require('../models/User');
const { mapToSheetRow, getSheetHeaders } = require('../utils/fieldMapper');
const activityLog = require('./googleSheetActivityLog');

const LOG_PREFIX = '[GoogleSheetSync]';
const ICON_OK = '✓';
const ICON_FAIL = '✗';

function log(...args) {
  console.log(LOG_PREFIX, ...args);
}

function warn(...args) {
  console.warn(LOG_PREFIX, ...args);
}

function statusLine(ok, message) {
  log(`${ok ? ICON_OK : ICON_FAIL} ${message}`);
}

/** dotenv often loads only the first line of a multiline GOOGLE_PRIVATE_KEY — recover from .env or file. */
function loadPrivateKey() {
  const keyPath = process.env.GOOGLE_PRIVATE_KEY_PATH;
  if (keyPath) {
    const resolved = path.resolve(keyPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`GOOGLE_PRIVATE_KEY_PATH not found: ${resolved}`);
    }
    return fs.readFileSync(resolved, 'utf8');
  }

  let key = process.env.GOOGLE_PRIVATE_KEY || '';
  if (key.includes('BEGIN PRIVATE KEY') && !key.includes('END PRIVATE KEY')) {
    try {
      const envPath = path.join(process.cwd(), '.env');
      const raw = fs.readFileSync(envPath, 'utf8');
      const match = raw.match(/GOOGLE_PRIVATE_KEY=([\s\S]*?)(?=\n#|\nGOOGLE_|\nKEEP_|\n[A-Z][A-Z0-9_]+=)/);
      if (match) {
        key = match[1].trim().replace(/^["']|["']$/g, '');
        // recovered multiline key from .env file (dotenv truncates PEM)
      }
    } catch (e) {
      warn('Could not read multiline private key from .env:', e.message);
    }
  }

  key = key.replace(/\\n/g, '\n').trim();
  if (!key.includes('END PRIVATE KEY')) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY is incomplete in .env (only first line loaded). ' +
        'Use one line with \\n escapes, set GOOGLE_PRIVATE_KEY_PATH to a .pem file, or paste the service account JSON path.',
    );
  }
  return normalizePrivateKeyPem(key);
}

/** Fix .env line-wrapped base64 that breaks OpenSSL decoder on Windows. */
function normalizePrivateKeyPem(raw) {
  const begin = '-----BEGIN PRIVATE KEY-----';
  const end = '-----END PRIVATE KEY-----';
  const start = raw.indexOf(begin);
  const finish = raw.indexOf(end);
  if (start === -1 || finish === -1) return raw;
  const body = raw.slice(start + begin.length, finish).replace(/\s/g, '');
  if (!body.length) return raw;
  const wrapped = body.match(/.{1,64}/g)?.join('\n') || body;
  return `${begin}\n${wrapped}\n${end}\n`;
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const spreadsheetId = (process.env.GOOGLE_SPREADSHEET_ID || '').trim();
  const key = loadPrivateKey();
  if (!email || !key || !spreadsheetId) {
    throw new Error(
      'Google Sheets credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SPREADSHEET_ID in .env',
    );
  }
  const auth = new JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return { auth, spreadsheetId, serviceAccountEmail: email };
}

function expectedSpreadsheetTitle() {
  return (process.env.GOOGLE_SPREADSHEET_TITLE_EXPECTED || 'WEBSITE SHEET SYNC').trim();
}

function normalizeTitle(s) {
  return String(s || '').trim().toLowerCase();
}

function titleMatches(actualTitle, expectedTitle) {
  const a = normalizeTitle(actualTitle);
  const e = normalizeTitle(expectedTitle);
  if (!e) return true;
  return a === e || a.includes(e) || e.includes(a);
}

function buildConnectionMeta(doc, sheet, { spreadsheetId, serviceAccountEmail } = {}) {
  const expectedTitle = expectedSpreadsheetTitle();
  const actualTitle = doc.title || '(no title)';
  const titleOk = titleMatches(actualTitle, expectedTitle);
  const sid = spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID;

  return {
    spreadsheetId: sid,
    spreadsheetUrl: doc.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${sid}/edit`,
    spreadsheetTitle: actualTitle,
    expectedTitle,
    titleMatch: titleOk,
    worksheetTitle: sheet.title,
    worksheetIndex: sheet.index,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    serviceAccountEmail: serviceAccountEmail || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    connected: true,
  };
}

async function getSheetsAccessToken() {
  const { auth } = getAuth();
  const tokenResponse = await auth.getAccessToken();
  if (!tokenResponse?.token) {
    throw new Error('Could not obtain Google Sheets access token');
  }
  return tokenResponse.token;
}

async function sheetsApiRequest(pathSuffix, { method = 'GET', body } = {}) {
  const { spreadsheetId } = getAuth();
  const token = await getSheetsAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${pathSuffix}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Sheets API ${res.status}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return null;
}

/** Write header + all rows via Sheets API (works on empty sheets). */
async function writeAllRowsToSheet(worksheetTitle, headers, rowObjects) {
  const matrix = rowObjects.map((r) => {
    const { _regNo, _studentId, ...cleanRow } = r;
    return headers.map((h) => String(cleanRow[h] ?? ''));
  });
  const values = [headers, ...matrix];
  const range = `${worksheetTitle}!A1`;
  const clearRange = encodeURIComponent(`${worksheetTitle}!A:ZZ`);
  await sheetsApiRequest(`/values/${clearRange}:clear`, { method: 'POST', body: {} });
  await sheetsApiRequest(
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: { range, values } },
  );
  return values.length - 1;
}

async function connectSpreadsheet({ quiet = false } = {}) {
  const { auth, spreadsheetId, serviceAccountEmail } = getAuth();
  const doc = new GoogleSpreadsheet(spreadsheetId, auth);
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  if (!sheet) {
    throw new Error('No worksheet found in the spreadsheet. Create at least one sheet tab.');
  }
  const meta = buildConnectionMeta(doc, sheet, { spreadsheetId, serviceAccountEmail });
  if (!quiet) {
    statusLine(
      meta.titleMatch,
      `Sheet "${meta.spreadsheetTitle}" → tab "${meta.worksheetTitle}" (${meta.rowCount} rows reserved)`,
    );
    if (!meta.titleMatch) {
      warn(`Title mismatch: expected "${meta.expectedTitle}" — check GOOGLE_SPREADSHEET_ID`);
    }
  }
  return { doc, sheet, meta };
}

async function getSheet(options) {
  return connectSpreadsheet(options);
}

/** Read-only check for admin UI / scripts — does not write rows. */
async function verifySheetConnection() {
  const { meta } = await connectSpreadsheet({ quiet: true });
  let headerCount = 0;
  try {
    const range = encodeURIComponent(`${meta.worksheetTitle}!1:1`);
    const data = await sheetsApiRequest(`/values/${range}`);
    headerCount = (data?.values?.[0] || []).filter((c) => c != null && String(c).trim() !== '').length;
  } catch {
    headerCount = 0;
  }
  return {
    ...meta,
    configured: true,
    headerCount,
    openInBrowserHint:
      meta.titleMatch ?
        'Click “Sync to Google Sheets” to fill the sheet (OCR alone does not write rows).' :
        'GOOGLE_SPREADSHEET_ID may point to a different file than the one you have open.',
  };
}

async function syncAllStudents() {
  if (activityLog.isJobRunning()) {
    throw new Error('A sync or OCR job is already running. Wait for it to finish.');
  }

  activityLog.startJob('sync', 0, 'Starting sync to Google Sheets…');

  try {
    const { sheet, meta } = await connectSpreadsheet({ quiet: true });
    if (!meta.titleMatch) {
      activityLog.append('warn', `✗ Sheet title mismatch (expected "${meta.expectedTitle}") — continuing anyway`);
    } else {
      activityLog.append('success', `✓ Connected to "${meta.spreadsheetTitle}" (${sheet.title})`);
    }

    const headers = getSheetHeaders();
    const students = await User.find({ role: 'STUDENT', isTestAccount: { $ne: true } })
      .select('_id regNo name email phoneNumber nationality')
      .lean();

    activityLog.setJobProgress(0, students.length, `Loading ${students.length} students…`);

    const rows = [];
    const errors = [];
    const syncedStudentIds = [];
    const logEvery = Math.max(1, Math.floor(students.length / 20));

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
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
        syncedStudentIds.push(student._id);
      } catch (err) {
        errors.push({ studentId: student._id, regNo: student.regNo, error: err.message });
      }

      if ((i + 1) % logEvery === 0 || i === students.length - 1) {
        activityLog.setJobProgress(
          i + 1,
          students.length,
          `Prepared rows ${i + 1} / ${students.length}${errors.length ? ` (${errors.length} errors)` : ''}`,
        );
      }
    }

    activityLog.append('info', `Writing ${rows.length} rows to Google Sheet…`);
    const rowsWritten = await writeAllRowsToSheet(sheet.title, headers, rows);
    statusLine(rowsWritten > 0, `Sync done: ${rowsWritten} data rows on sheet`);

    if (syncedStudentIds.length) {
      await StudentExtractedData.updateMany(
        { studentId: { $in: syncedStudentIds } },
        { $set: { lastSyncedToSheet: new Date() } },
      );
    }

    const ok = rowsWritten > 0 && errors.length === 0;
    activityLog.endJob(
      ok || rowsWritten > 0,
      rowsWritten > 0 ?
        `✓ Sync complete: ${rowsWritten} rows on sheet (${rows.length} students, ${errors.length} errors)` :
        `✗ Sync finished but no rows were written`,
    );

    return {
      totalStudents: students.length,
      synced: rows.length,
      errors,
      sheet: meta,
      worksheetTitle: sheet.title,
      rowsWritten,
    };
  } catch (err) {
    activityLog.endJob(false, `✗ Sync failed: ${err.message}`);
    throw err;
  }
}

async function syncSingleStudent(studentId) {
  const { sheet, meta } = await connectSpreadsheet({ quiet: true });
  const headers = getSheetHeaders();

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
  const values = [headers.map((h) => String(row[h] ?? ''))];
  const appendRange = `${sheet.title}!A:ZZ`;
  await sheetsApiRequest(
    `/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: { range: appendRange, values } },
  );

  await StudentExtractedData.findOneAndUpdate(
    { studentId },
    { $set: { lastSyncedToSheet: new Date() } },
  );

  statusLine(true, `Synced ${student.regNo} → "${meta.spreadsheetTitle}"`);
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
  let sheetConnection = null;
  let sheetConnectionError = null;
  try {
    getAuth();
    sheetConfigured = true;
    sheetConnection = await verifySheetConnection();
  } catch (e) {
    sheetConnectionError = e.message;
  }

  return {
    totalStudents,
    ocrCompleted,
    ocrPending,
    syncedToSheet: syncedCount,
    lastSyncTime,
    sheetConfigured,
    sheetConnection,
    sheetConnectionError,
    configuredSpreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || null,
    expectedSpreadsheetTitle: expectedSpreadsheetTitle(),
  };
}

module.exports = {
  syncAllStudents,
  syncSingleStudent,
  getSyncStatus,
  verifySheetConnection,
  getActivity: (since) => activityLog.getActivity(since),
  clearActivityLog: () => activityLog.clearLog(),
  isSheetJobRunning: () => activityLog.isJobRunning(),
};
