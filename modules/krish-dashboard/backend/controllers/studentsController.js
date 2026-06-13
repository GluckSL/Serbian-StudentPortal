const svc = require('../services/salesStudentService');
const { invalidateCache } = require('../services/salesAnalyticsAggregator');

function staffId(req) {
  return req.user?.userId || req.user?.id || null;
}

async function list(req, res) {
  try {
    const result = await svc.listStudents({
      page: req.query.page,
      limit: req.query.limit,
      sortBy: req.query.sortBy,
      sortDir: req.query.sortDir,
      search: req.query.search,
      package: req.query.package,
      status: req.query.status,
      counselor: req.query.counselor,
      serviceName: req.query.serviceName || req.query.serviceKey,
      profession: req.query.profession,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[KrishDash] list error', err);
    res.status(500).json({ success: false, message: 'Failed to load students' });
  }
}

async function detail(req, res) {
  try {
    const student = await svc.getStudentDetail(req.params.id);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    res.json({ success: true, data: student });
  } catch (err) {
    console.error('[KrishDash] detail error', err);
    res.status(500).json({ success: false, message: 'Failed to load student' });
  }
}

async function create(req, res) {
  try {
    const student = await svc.createStudent(req.body, staffId(req));
    invalidateCache();
    res.status(201).json({ success: true, data: student });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'A student with this email already exists in the sales database' });
    }
    console.error('[KrishDash] create error', err);
    res.status(500).json({ success: false, message: 'Failed to create student' });
  }
}

async function update(req, res) {
  try {
    const student = await svc.updateStudent(req.params.id, req.body, staffId(req));
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    invalidateCache();
    res.json({ success: true, data: student });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email already in use' });
    }
    console.error('[KrishDash] update error', err);
    res.status(500).json({ success: false, message: 'Failed to update student' });
  }
}

async function remove(req, res) {
  try {
    const deleted = await svc.deleteStudent(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Student not found' });
    invalidateCache();
    res.json({ success: true, message: 'Student deleted' });
  } catch (err) {
    console.error('[KrishDash] delete error', err);
    res.status(500).json({ success: false, message: 'Failed to delete student' });
  }
}

async function resetAll(req, res) {
  try {
    const result = await svc.clearAllSalesData();
    res.json({ success: true, data: result, message: 'All sales student data cleared' });
  } catch (err) {
    console.error('[KrishDash] reset error', err);
    res.status(500).json({ success: false, message: 'Failed to reset sales data' });
  }
}

module.exports = { list, detail, create, update, remove, resetAll };
