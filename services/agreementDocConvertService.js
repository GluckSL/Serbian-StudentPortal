// Converts uploaded agreement templates (PDF or Word) to a PDF buffer for storage and field overlay.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx']);
const WORD_MIMES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-word',
  'application/octet-stream'
]);

let libreConvert = null;
try {
  libreConvert = require('libreoffice-convert');
} catch (e) {
  console.warn('[agreements] libreoffice-convert not loaded:', e.message);
}

function extFromName(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function isPdfFile(mimetype, originalname) {
  if (mimetype === 'application/pdf') return true;
  return extFromName(originalname) === '.pdf';
}

function isWordFile(mimetype, originalname) {
  const ext = extFromName(originalname);
  if (ext === '.doc' || ext === '.docx') return true;
  return WORD_MIMES.has(mimetype) && (ext === '.doc' || ext === '.docx');
}

function isAllowedTemplateUpload(mimetype, originalname) {
  const ext = extFromName(originalname);
  if (ALLOWED_EXTENSIONS.has(ext)) return true;
  if (mimetype === 'application/pdf') return true;
  if (WORD_MIMES.has(mimetype) && (ext === '.doc' || ext === '.docx')) return true;
  return false;
}

function libreOfficeOptions(originalname) {
  const ext = extFromName(originalname) || '.docx';
  const options = { fileName: `source${ext}` };
  const custom = process.env.LIBRE_OFFICE_EXE || process.env.SOFFICE_PATH;
  if (custom) options.sofficeBinaryPaths = [custom];
  return options;
}

/** LibreOffice headless — keeps logos, colors, headers/footers. */
function convertWordWithLibreOffice(buffer, originalname) {
  if (!libreConvert?.convertWithOptions) return Promise.resolve(null);
  return new Promise((resolve) => {
    libreConvert.convertWithOptions(
      buffer,
      '.pdf',
      undefined,
      libreOfficeOptions(originalname),
      (err, result) => {
        if (err) {
          console.warn('[agreements] LibreOffice conversion failed:', err.message);
          return resolve(null);
        }
        if (!result?.length) return resolve(null);
        resolve(Buffer.from(result));
      }
    );
  });
}

/** Windows + Microsoft Word — full-fidelity PDF (same as Save as PDF in Word). */
async function convertWordWithMsWord(buffer, originalname) {
  if (process.platform !== 'win32') return null;

  const ext = extFromName(originalname) || '.docx';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agreement-word-'));
  const inputPath = path.join(tmpDir, `source${ext}`);
  const outputPath = path.join(tmpDir, 'output.pdf');

  try {
    fs.writeFileSync(inputPath, buffer);

    const psScript = [
      '$ErrorActionPreference = "Stop"',
      '$word = $null',
      '$doc = $null',
      'try {',
      '  $word = New-Object -ComObject Word.Application',
      '  $word.Visible = $false',
      '  $word.DisplayAlerts = 0',
      `  $doc = $word.Documents.Open(${JSON.stringify(inputPath)}, $false, $true)`,
      `  $doc.SaveAs2(${JSON.stringify(outputPath)}, 17)`,
      '  $doc.Close([ref]0)',
      '  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc)',
      '  $word.Quit([ref]0)',
      '[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)',
      '} catch {',
      '  if ($doc) { try { $doc.Close([ref]0) } catch {} }',
      '  if ($word) { try { $word.Quit([ref]0) } catch {} }',
      '  throw',
      '}'
    ].join('\n');

    const scriptPath = path.join(tmpDir, 'convert.ps1');
    fs.writeFileSync(scriptPath, psScript, 'utf8');

    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { timeout: 180000, windowsHide: true }
    );

    if (!fs.existsSync(outputPath)) return null;
    const stat = fs.statSync(outputPath);
    if (!stat.size) return null;
    return fs.readFileSync(outputPath);
  } catch (err) {
    console.warn('[agreements] MS Word conversion failed:', err.message);
    return null;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
}

const FORMATTING_ERROR =
  'Could not convert Word to PDF with full formatting. ' +
  'On this server: install LibreOffice, or use Windows with Microsoft Word. ' +
  'Easiest option: open your file in Word → File → Save As → PDF, then upload the PDF here.';

async function convertWordToPdf(buffer, originalname) {
  const viaLo = await convertWordWithLibreOffice(buffer, originalname);
  if (viaLo) return { pdfBuffer: viaLo, conversion: 'libreoffice' };

  const viaWord = await convertWordWithMsWord(buffer, originalname);
  if (viaWord) return { pdfBuffer: viaWord, conversion: 'msword' };

  throw new Error(FORMATTING_ERROR);
}

/**
 * @returns {Promise<{ pdfBuffer: Buffer, sourceType: 'pdf' | 'word', conversion?: string }>}
 */
async function normalizeTemplateUploadToPdf(buffer, mimetype, originalname) {
  if (!buffer?.length) throw new Error('Empty file uploaded');

  if (!isAllowedTemplateUpload(mimetype, originalname)) {
    throw new Error('Only PDF, DOC, and DOCX files are allowed for agreement templates.');
  }

  if (isPdfFile(mimetype, originalname)) {
    return { pdfBuffer: buffer, sourceType: 'pdf', conversion: 'none' };
  }

  if (isWordFile(mimetype, originalname)) {
    const { pdfBuffer, conversion } = await convertWordToPdf(buffer, originalname);
    return { pdfBuffer, sourceType: 'word', conversion };
  }

  throw new Error('Only PDF, DOC, and DOCX files are allowed for agreement templates.');
}

module.exports = {
  isAllowedTemplateUpload,
  normalizeTemplateUploadToPdf
};
