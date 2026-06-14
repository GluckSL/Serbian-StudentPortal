const { fetchForExport, buildCsv, buildXlsx } = require('../services/salesExportService');

async function exportStudents(req, res) {
  try {
    const format = (req.query.format || 'csv').toLowerCase();
    const filters = {
      search: req.query.search,
      package: req.query.package,
      status: req.query.status,
      counselor: req.query.counselor,
      serviceName: req.query.serviceName || req.query.serviceKey,
      profession: req.query.profession,
      currentLanguageLevel: req.query.currentLanguageLevel,
      documentPaymentStatus: req.query.documentPaymentStatus,
      documentationStatus: req.query.documentationStatus,
      visaStatus: req.query.visaStatus,
      enrolledFrom: req.query.enrolledFrom,
      enrolledTo: req.query.enrolledTo,
    };

    const rows = await fetchForExport(filters);

    if (format === 'xlsx') {
      const buffer = await buildXlsx(rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="enrollment-overview-students.xlsx"');
      return res.send(buffer);
    }

    const csv = buildCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="enrollment-overview-students.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[KrishDash] export error', err);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
}

module.exports = { exportStudents };
