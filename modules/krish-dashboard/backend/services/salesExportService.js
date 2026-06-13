/**
 * salesExportService — stream CSV or XLSX export from sales_students.
 * Only reads sales collections; never touches Language Team data.
 */
const SalesStudent = require('../models/SalesStudent');
const SalesStudentService = require('../models/SalesStudentService');
const { buildFilter, parseMulti } = require('./salesStudentService');

const HEADERS = [
  'Name', 'Email', 'Phone', 'Current Language Level', 'Age', 'Package', 'Services',
  'Professional', 'Status', 'Counselor',
  'Document Payment Status', 'Documentation Status', 'Documentation Remarks', 'Visa Status',
  'Created Date', 'Last Updated',
];

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

async function fetchForExport(filters) {
  let serviceIds;
  const svcFilter = filters.serviceName || filters.serviceKey;
  const svcNames = parseMulti(svcFilter);
  if (svcNames.length) {
    const svcDocs = await SalesStudentService.find({
      serviceName: svcNames.length === 1 ? svcNames[0] : { $in: svcNames },
    })
      .select('salesStudentId')
      .lean();
    serviceIds = [...new Set(svcDocs.map((d) => d.salesStudentId))];
    if (serviceIds.length === 0) return [];
  }

  const filter = buildFilter({ ...filters, serviceIds });
  const students = await SalesStudent.find(filter).sort({ updatedAt: -1 }).lean();
  const ids = students.map((s) => s._id);
  const services = await SalesStudentService.find({ salesStudentId: { $in: ids } }).lean();

  const svcMap = {};
  for (const svc of services) {
    const key = String(svc.salesStudentId);
    if (!svcMap[key]) svcMap[key] = [];
    svcMap[key].push(svc.serviceName || svc.serviceKey || '');
  }

  return students.map((s) => ({
    Name: s.name,
    Email: s.email,
    Phone: s.phone || '',
    'Current Language Level': s.currentLanguageLevel || '',
    Age: s.age != null ? s.age : '',
    Package: s.package,
    Services: (svcMap[String(s._id)] || []).join('; '),
    Professional: s.profession || '',
    Status: s.status,
    Counselor: s.counselor || '',
    'Document Payment Status': s.documentPaymentStatus || '',
    'Documentation Status': s.documentationStatus || '',
    'Documentation Remarks': s.documentationRemarks || '',
    'Visa Status': s.visaStatus || '',
    'Created Date': formatDate(s.createdAt),
    'Last Updated': formatDate(s.updatedAt),
  }));
}

/**
 * Build CSV string from export rows.
 */
function buildCsv(rows) {
  const escape = (v) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [HEADERS.join(',')];
  for (const row of rows) {
    lines.push(HEADERS.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

/**
 * Build XLSX buffer using the xlsx library already installed in the project.
 */
async function buildXlsx(rows) {
  const XLSX = require('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sales Students');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { fetchForExport, buildCsv, buildXlsx };
