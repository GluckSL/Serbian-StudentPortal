// Converts uploaded agreement templates (PDF or Word) to PDF for preview/fill.
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

const WD_FORMAT_PDF = 17;
const WD_FORMAT_DOCX = 12;

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

function isDocxFile(originalname) {
  return extFromName(originalname) === '.docx';
}

function isDocxBuffer(buffer, filename = '') {
  if (!buffer?.length) return false;
  if (isDocxFile(filename)) return true;
  return buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function isAllowedTemplateUpload(mimetype, originalname) {
  const ext = extFromName(originalname);
  if (ALLOWED_EXTENSIONS.has(ext)) return true;
  if (mimetype === 'application/pdf') return true;
  if (WORD_MIMES.has(mimetype) && (ext === '.doc' || ext === '.docx')) return true;
  return false;
}

/** Resolve LibreOffice soffice.exe (env + common Windows install paths). */
function findSofficeBinary() {
  const candidates = [
    process.env.LIBRE_OFFICE_EXE,
    process.env.SOFFICE_PATH,
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) { /* ignore */ }
  }
  return null;
}

function libreOfficeOptions(originalname) {
  const ext = extFromName(originalname) || '.docx';
  const options = { fileName: `source${ext}` };
  const soffice = findSofficeBinary();
  if (soffice) options.sofficeBinaryPaths = [soffice];
  return options;
}

/** LibreOffice headless via npm wrapper. */
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
          console.warn('[agreements] libreoffice-convert:', err.message);
          return resolve(null);
        }
        if (!result?.length) return resolve(null);
        resolve(Buffer.from(result));
      }
    );
  });
}

/** LibreOffice CLI — often works when npm wrapper cannot find soffice. */
async function convertWordWithSofficeCli(buffer, originalname) {
  const soffice = findSofficeBinary();
  if (!soffice) return null;

  const ext = extFromName(originalname) || '.docx';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agreement-lo-'));
  const inputPath = path.join(tmpDir, `source${ext}`);

  try {
    fs.writeFileSync(inputPath, buffer);
    await execFileAsync(
      soffice,
      ['--headless', '--norestore', '--invisible', '--convert-to', 'pdf', '--outdir', tmpDir, inputPath],
      { timeout: 180000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    );

    const base = path.basename(inputPath, ext);
    const pdfPath = path.join(tmpDir, `${base}.pdf`);
    if (!fs.existsSync(pdfPath) || !fs.statSync(pdfPath).size) return null;
    return fs.readFileSync(pdfPath);
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.stdout?.toString?.() || err.message;
    console.warn('[agreements] soffice CLI failed:', detail);
    return null;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
}

/** Windows + Microsoft Word — ExportAsFixedFormat (more reliable than SaveAs2). */
async function convertWordWithMsWord(buffer, originalname, outputFormat = 'pdf') {
  if (process.platform !== 'win32') return null;

  const ext = extFromName(originalname) || '.docx';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agreement-word-'));
  const inputPath = path.join(tmpDir, `source${ext}`);
  const outputPath = path.join(tmpDir, outputFormat === 'docx' ? 'output.docx' : 'output.pdf');
  const format = outputFormat === 'docx' ? WD_FORMAT_DOCX : WD_FORMAT_PDF;

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
      '  $word.AutomationSecurity = 3',
      `  $doc = $word.Documents.Open(${JSON.stringify(inputPath)}, $false, $false, $false)`,
      outputFormat === 'docx'
        ? `  $doc.SaveAs2(${JSON.stringify(outputPath)}, ${format})`
        : `  $doc.ExportAsFixedFormat(${JSON.stringify(outputPath)}, ${format})`,
      '  $doc.Close($false)',
      '  $word.Quit()',
      '  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null',
      '  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null',
      '  [GC]::Collect()',
      '  [GC]::WaitForPendingFinalizers()',
      '} catch {',
      '  if ($doc) { try { $doc.Close($false) } catch {} }',
      '  if ($word) { try { $word.Quit() } catch {} }',
      '  Write-Error $_.Exception.Message',
      '  exit 1',
      '}'
    ].join('\r\n');

    const scriptPath = path.join(tmpDir, 'convert.ps1');
    fs.writeFileSync(scriptPath, psScript, 'utf8');

    await execFileAsync(
      'powershell.exe',
      ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { timeout: 180000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    );

    if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).size) return null;
    return fs.readFileSync(outputPath);
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.stdout?.toString?.() || err.message;
    console.warn(`[agreements] MS Word ${outputFormat} conversion failed:`, detail);
    return null;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
}

const FORMATTING_ERROR =
  'Could not convert Word to PDF. Install LibreOffice (free) or ensure Microsoft Word is installed and can open files. ' +
  'Set LIBRE_OFFICE_EXE in .env to your soffice.exe path, e.g. C:\\Program Files\\LibreOffice\\program\\soffice.exe';

/**
 * Ensure buffer is .docx (convert .doc via Word when needed).
 */
async function ensureDocxBuffer(buffer, mimetype, originalname) {
  if (!buffer?.length) return null;
  if (isDocxBuffer(buffer, originalname)) return buffer;

  if (isWordFile(mimetype, originalname) && extFromName(originalname) === '.doc') {
    const docx = await convertWordWithMsWord(buffer, originalname, 'docx');
    if (docx) return docx;
    const viaLo = findSofficeBinary();
    if (viaLo) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agreement-doc-'));
      const inputPath = path.join(tmpDir, 'source.doc');
      try {
        fs.writeFileSync(inputPath, buffer);
        await execFileAsync(
          viaLo,
          ['--headless', '--convert-to', 'docx', '--outdir', tmpDir, inputPath],
          { timeout: 180000, windowsHide: true }
        );
        const out = path.join(tmpDir, 'source.docx');
        if (fs.existsSync(out)) return fs.readFileSync(out);
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) { /* ignore */ }
      }
    }
  }
  return null;
}

async function convertWordToPdf(buffer, originalname) {
  const viaCli = await convertWordWithSofficeCli(buffer, originalname);
  if (viaCli) return { pdfBuffer: viaCli, conversion: 'libreoffice-cli' };

  const viaWord = await convertWordWithMsWord(buffer, originalname, 'pdf');
  if (viaWord) return { pdfBuffer: viaWord, conversion: 'msword' };

  const viaLo = await convertWordWithLibreOffice(buffer, originalname);
  if (viaLo) return { pdfBuffer: viaLo, conversion: 'libreoffice' };

  throw new Error(FORMATTING_ERROR);
}

/**
 * @returns {Promise<{ pdfBuffer: Buffer, sourceType: 'pdf' | 'word', conversion?: string, docxBuffer?: Buffer }>}
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
    const docxBuffer = (await ensureDocxBuffer(buffer, mimetype, originalname)) || buffer;
    const nameForPdf = isDocxBuffer(docxBuffer, originalname) ? 'source.docx' : originalname;
    const { pdfBuffer, conversion } = await convertWordToPdf(docxBuffer, nameForPdf);
    return { pdfBuffer, sourceType: 'word', conversion, docxBuffer };
  }

  throw new Error('Only PDF, DOC, and DOCX files are allowed for agreement templates.');
}

module.exports = {
  isAllowedTemplateUpload,
  isWordFile,
  isDocxFile,
  isDocxBuffer,
  ensureDocxBuffer,
  findSofficeBinary,
  normalizeTemplateUploadToPdf,
  convertWordToPdf
};
