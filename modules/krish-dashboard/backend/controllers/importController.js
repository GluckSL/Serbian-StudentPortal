const multer = require('multer');
const XLSX = require('xlsx');
const { previewRows, commitImport } = require('../services/salesImportService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseFile(buffer, mimetype, originalname) {
  const name = (originalname || '').toLowerCase();
  const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls') ||
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (isXlsx) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
  }

  // CSV fallback — basic parser (papaparse is frontend-only here)
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
}

const uploadMiddleware = upload.single('file');

async function preview(req, res) {
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    try {
      const rows = parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (rows.length === 0) {
        return res.status(400).json({ success: false, message: 'File is empty or unreadable' });
      }

      const result = previewRows(rows);
      res.json({
        success: true,
        data: {
          totalRows: rows.length,
          importCount: result.importCount,
          warningCount: result.warningCount,
          duplicateEmailCount: result.duplicateEmailCount,
          duplicateNameCount: result.duplicateNameCount,
          professionCount: result.professionCount,
          rows: result.rows.slice(0, 10),
          warnings: result.warnings,
          valid: result.valid.slice(0, 10),
          invalid: result.invalid,
          validCount: result.validCount,
          invalidCount: result.invalidCount,
        },
      });
    } catch (e) {
      console.error('[KrishDash] import preview error', e);
      res.status(500).json({ success: false, message: 'Failed to parse file' });
    }
  });
}

async function commit(req, res) {
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });

    try {
      const staffUserId = req.user?.userId || req.user?.id || null;

      // Prefer full file upload so every row is imported (preview only shows a sample).
      if (req.file) {
        const rows = parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);
        if (rows.length === 0) {
          return res.status(400).json({ success: false, message: 'File is empty or unreadable' });
        }
        console.log(`[KrishDash] import commit started — ${rows.length} spreadsheet rows`);
        const parsed = previewRows(rows);
        const result = await commitImport(parsed.rows, staffUserId);
        console.log(
          `[KrishDash] import commit done — imported ${result.imported}, updated ${result.updated}, profession rows ${parsed.professionCount}, failed ${result.failed.length}`
        );
        return res.json({ success: true, data: result });
      }

      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, message: 'No file or rows provided' });
      }

      const result = await commitImport(rows, staffUserId);
      res.json({ success: true, data: result });
    } catch (e) {
      console.error('[KrishDash] import commit error', e);
      res.status(500).json({ success: false, message: 'Import failed' });
    }
  });
}

module.exports = { preview, commit };
