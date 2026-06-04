const fs = require('fs');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const User = require('../models/User');
const StudentDocument = require('../models/StudentDocument');
const { extractDocument, downloadFromS3, parseName, mergeStructuredResults } = require('./ocrService');
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

async function writeAllRowsToSheet(worksheetTitle, headers, rowObjects) {
  const matrix = rowObjects.map((r) => headers.map((h) => String(r[h] ?? '')));
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
        'Click Sync to Google Sheets to fill the sheet.' :
        'GOOGLE_SPREADSHEET_ID may point to a different file than the one you have open.',
  };
}

let batchRunning = false;

async function extractAndWriteSelectedStudents(studentIds) {
  if (batchRunning || activityLog.isJobRunning()) {
    throw new Error('An extraction job is already running. Wait for it to finish.');
  }
  batchRunning = true;

  try {
    const students = await User.find({ _id: { $in: studentIds }, role: 'STUDENT', isTestAccount: { $ne: true } })
      .select('_id regNo name email phoneNumber nationality batch level')
      .lean();

    if (!students.length) throw new Error('No valid students found');

    const { sheet, meta } = await connectSpreadsheet({ quiet: true });
    const headers = getSheetHeaders();
    const total = students.length;

    const existingRange = encodeURIComponent(`${sheet.title}!1:1`);
    let existingData;
    try {
      existingData = await sheetsApiRequest(`/values/${existingRange}`);
    } catch { /* assume empty */ }
    const existingHeaders = (existingData?.values?.[0] || []).filter(c => String(c || '').trim() !== '');
    if (existingHeaders.length === 0) {
      await sheetsApiRequest(
        `/values/${encodeURIComponent(`${sheet.title}!A1`)}?valueInputOption=USER_ENTERED`,
        { method: 'PUT', body: { range: `${sheet.title}!A1`, values: [headers] } },
      );
      activityLog.append('info', `Headers written (${headers.length} cols)`);
    }

    activityLog.startJob('extract', total, `${total} students...`);

    const results = [];
    for (let i = 0; i < total; i++) {
      const student = students[i];
      try {
        const docs = await StudentDocument.find({
          studentId: student._id,
          isCurrent: true,
          status: { $ne: 'REJECTED' },
          mimeType: { $in: ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'] },
        }).lean();

        const merged = { candidate: {}, father: {}, mother: {}, spouse: {}, contactPerson: {}, education: {} };
        let docsProcessed = 0;

        for (const doc of docs) {
          const docLabel = doc.documentType || doc.fileName || 'unknown';
          const studentRef = student.regNo || student._id;
          try {
            const fileBuffer = await downloadFromS3(doc.filePath);
            const result = await extractDocument(fileBuffer, doc.mimeType, doc.documentType);
            if (result?.structured) {
              mergeStructuredResults(merged, result.structured);
              docsProcessed++;
              activityLog.append('success', `${studentRef} ${docLabel} ✓`);
            }
          } catch (docErr) {
            console.error(`[Extract] Failed doc ${doc.fileName}: ${docErr.message}`);
            activityLog.append('error', `${studentRef} ${docLabel} ✗ ${docErr.message}`);
          }
        }

        if (!merged.candidate.email && student.email) merged.candidate.email = student.email;
        if (!merged.candidate.familyName && !merged.candidate.firstName && student.name) {
          const n = parseName(student.name);
          if (!merged.candidate.familyName) merged.candidate.familyName = n.familyName;
          if (!merged.candidate.firstName) merged.candidate.firstName = n.firstName;
        }

        const row = mapToSheetRow(merged, student, docs);
        const values = [row.map(v => String(v ?? ''))];
        const appendRange = `${sheet.title}!A:ZZ`;
        await sheetsApiRequest(
          `/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { method: 'POST', body: { range: appendRange, values } },
        );

        results.push({ studentId: student._id, regNo: student.regNo, status: 'ok', documentsProcessed: docsProcessed, extracted: merged });
        activityLog.append('success', `${student.regNo || student._id} ✓ (${docsProcessed} docs)`);
      } catch (err) {
        results.push({ studentId: student._id, regNo: student.regNo, status: 'error', error: err.message });
        activityLog.append('error', `${student.regNo || student._id} ✗ ${err.message}`);
      }

      activityLog.setJobProgress(i + 1, total, `${i + 1}/${total}`);
    }

    const okCount = results.filter((r) => r.status === 'ok').length;
    const failCount = total - okCount;
    statusLine(failCount === 0, `Extraction done: ${okCount}/${total} written to sheet`);
    activityLog.endJob(failCount === 0, `Done: ${okCount}/${total} ✓${failCount ? ` ${failCount} ✗` : ''}`);

    return { total, ok: okCount, errors: failCount, details: results };
  } catch (err) {
    activityLog.endJob(false, `✗ Extraction failed: ${err.message}`);
    throw err;
  } finally {
    batchRunning = false;
  }
}

module.exports = {
  extractAndWriteSelectedStudents,
  verifySheetConnection,
  getActivity: (since) => activityLog.getActivity(since),
  clearActivityLog: () => activityLog.clearLog(),
  isJobRunning: () => activityLog.isJobRunning(),
};
