/**
 * salesStudentService — core CRUD operations on Sales student records.
 *
 * ISOLATION RULE: This service exclusively reads/writes sales_* collections.
 * It never imports or touches the User (Language Team student) model.
 */
const SalesStudent = require('../models/SalesStudent');
const SalesStudentService = require('../models/SalesStudentService');
const SalesStudentNote = require('../models/SalesStudentNote');
const SalesStudentStatusHistory = require('../models/SalesStudentStatusHistory');
const { invalidateCache } = require('./salesAnalyticsAggregator');

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse comma-separated or array filter values from query params. */
function parseMulti(val) {
  if (val == null || val === '') return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  return String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function applyPackageFilter(target, pkg) {
  const list = parseMulti(pkg);
  if (!list.length) return;
  target.package = list.length === 1 ? list[0] : { $in: list };
}

function applyStatusFilter(target, status) {
  const list = parseMulti(status);
  if (!list.length) return;
  const expanded = [];
  for (const s of list) {
    if (s === 'WITHDREW') expanded.push('WITHDREW', 'HOLD');
    else expanded.push(s);
  }
  const uniq = [...new Set(expanded)];
  target.status = uniq.length === 1 ? uniq[0] : { $in: uniq };
}

function optionalTextFieldMultiMatch(field, values) {
  const list = parseMulti(values);
  if (!list.length) return null;
  const clauses = list.map((v) => optionalTextFieldMatch(field, v)).filter(Boolean);
  if (!clauses.length) return null;
  if (clauses.length === 1) return clauses[0];
  return { $or: clauses };
}

function professionMultiMatch(profession) {
  const list = parseMulti(profession);
  if (!list.length) return null;
  const clauses = list.map((p) => professionMatchQuery(p)).filter(Boolean);
  if (!clauses.length) return null;
  if (clauses.length === 1) return clauses[0];
  return { $or: clauses };
}

function applyStudentFilters(target, {
  search,
  package: pkg,
  status,
  counselor,
  profession,
  currentLanguageLevel,
  documentPaymentStatus,
  documentationStatus,
  visaStatus,
} = {}) {
  applyPackageFilter(target, pkg);
  applyStatusFilter(target, status);
  if (counselor) {
    if (counselor === '__UNSPECIFIED__') {
      mergeMatchClause(target, optionalTextFieldMatch('counselor', '__UNSPECIFIED__'));
    } else {
      target.counselor = new RegExp(escapeRegex(counselor), 'i');
    }
  }
  mergeMatchClause(target, professionMultiMatch(profession));
  mergeMatchClause(target, optionalTextFieldMultiMatch('currentLanguageLevel', currentLanguageLevel));
  mergeMatchClause(target, optionalTextFieldMultiMatch('documentPaymentStatus', documentPaymentStatus));
  mergeMatchClause(target, optionalTextFieldMultiMatch('documentationStatus', documentationStatus));
  mergeMatchClause(target, optionalTextFieldMultiMatch('visaStatus', visaStatus));
  if (search) {
    const s = search.trim();
    if (s) {
      const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      target.$or = [{ name: re }, { email: re }, { phone: re }];
    }
  }
}

function mergeMatchClause(target, clause) {
  if (!clause) return;
  if (target.$or && clause.$or) {
    target.$and = target.$and || [];
    target.$and.push({ $or: target.$or }, clause);
    delete target.$or;
    return;
  }
  Object.assign(target, clause);
}

function professionMatchQuery(profession) {
  if (profession === '__UNSPECIFIED__') {
    return {
      $and: [
        {
          $or: [
            { profession: { $in: [null, ''] } },
            { profession: { $exists: false } },
          ],
        },
        {
          $or: [
            { notes: { $exists: false } },
            { notes: '' },
            { notes: { $not: /Professional:/i } },
          ],
        },
      ],
    };
  }
  if (!profession) return null;
  const escaped = escapeRegex(profession);
  return {
    $or: [
      { profession: new RegExp(`^${escaped}$`, 'i') },
      {
        $and: [
          {
            $or: [
              { profession: { $in: [null, ''] } },
              { profession: { $exists: false } },
            ],
          },
          { notes: new RegExp(`Professional:\\s*${escaped}`, 'i') },
        ],
      },
    ],
  };
}

function optionalTextFieldMatch(field, value) {
  if (!value) return null;
  if (value === '__UNSPECIFIED__') {
    return {
      $or: [
        { [field]: { $in: [null, ''] } },
        { [field]: { $exists: false } },
      ],
    };
  }
  return { [field]: new RegExp(`^${escapeRegex(value)}$`, 'i') };
}

const STUDENT_LIST_PROJECT = {
  name: 1,
  email: 1,
  phone: 1,
  age: 1,
  package: 1,
  status: 1,
  counselor: 1,
  profession: 1,
  currentLanguageLevel: 1,
  documentPaymentStatus: 1,
  documentationStatus: 1,
  documentationRemarks: 1,
  visaStatus: 1,
  updatedAt: 1,
  createdAt: 1,
};

/**
 * Build MongoDB query from filter params.
 */
function buildFilter({
  search,
  package: pkg,
  status,
  counselor,
  serviceIds,
  serviceName,
  profession,
  currentLanguageLevel,
  documentPaymentStatus,
  documentationStatus,
  visaStatus,
} = {}) {
  const query = {};
  applyStudentFilters(query, {
    search,
    package: pkg,
    status,
    counselor,
    profession,
    currentLanguageLevel,
    documentPaymentStatus,
    documentationStatus,
    visaStatus,
  });
  if (Array.isArray(serviceIds) && serviceIds.length > 0) {
    query._id = { $in: serviceIds };
  }
  return query;
}

async function listStudents({
  page = 1,
  limit = 25,
  sortBy = 'updatedAt',
  sortDir = 'desc',
  search,
  package: pkg,
  status,
  counselor,
  serviceName,
  serviceKey, // legacy alias
  profession,
  currentLanguageLevel,
  documentPaymentStatus,
  documentationStatus,
  visaStatus,
} = {}) {
  const svcFilter = serviceName || serviceKey;
  const safeLimit = Math.min(Number(limit) || 25, 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const skip = (safePage - 1) * safeLimit;
  const sortField = sortBy || 'updatedAt';
  const sortOrder = sortDir === 'asc' ? 1 : -1;
  const sort = { [sortField]: sortOrder };

  const studentMatch = {};
  applyStudentFilters(studentMatch, {
    search,
    package: pkg,
    status,
    counselor,
    profession,
    currentLanguageLevel,
    documentPaymentStatus,
    documentationStatus,
    visaStatus,
  });

  const project = STUDENT_LIST_PROJECT;

  const facetStage = {
    $facet: {
      metadata: [{ $count: 'total' }],
      data: [
        { $sort: sort },
        { $skip: skip },
        { $limit: safeLimit },
        { $project: project },
      ],
    },
  };

  let result;
  const svcNames = parseMulti(svcFilter);
  if (svcNames.length) {
    const pipeline = [
      {
        $match: {
          serviceName: svcNames.length === 1 ? svcNames[0] : { $in: svcNames },
        },
      },
      {
        $lookup: {
          from: 'sales_students',
          localField: 'salesStudentId',
          foreignField: '_id',
          as: 'student',
          pipeline: [{ $project: project }],
        },
      },
      { $unwind: '$student' },
      { $replaceRoot: { newRoot: '$student' } },
    ];
    if (Object.keys(studentMatch).length > 0) pipeline.push({ $match: studentMatch });
    pipeline.push(facetStage);
    [result] = await SalesStudentService.aggregate(pipeline);
  } else {
    const pipeline = [{ $match: studentMatch }, facetStage];
    [result] = await SalesStudent.aggregate(pipeline);
  }

  const total = result?.metadata?.[0]?.total || 0;
  const data = result?.data || [];

  if (data.length === 0) {
    return {
      data: [],
      pagination: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) },
    };
  }

  const ids = data.map((s) => s._id);
  const services = await SalesStudentService.find({ salesStudentId: { $in: ids } })
    .select('salesStudentId serviceName')
    .lean();
  const svcMap = {};
  for (const svc of services) {
    const key = String(svc.salesStudentId);
    if (!svcMap[key]) svcMap[key] = [];
    svcMap[key].push(svc);
  }

  return {
    data: data.map((s) => ({ ...s, services: svcMap[String(s._id)] || [] })),
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit),
    },
  };
}

async function getStudentDetail(id) {
  const student = await SalesStudent.findById(id).lean();
  if (!student) return null;

  const [services, notes, history] = await Promise.all([
    SalesStudentService.find({ salesStudentId: id }).lean(),
    SalesStudentNote.find({ salesStudentId: id }).sort({ createdAt: -1 }).lean(),
    SalesStudentStatusHistory.find({ salesStudentId: id }).sort({ createdAt: -1 }).lean(),
  ]);

  return { ...student, services, notes, statusHistory: history };
}

async function createStudent(data, staffUserId) {
  const student = await SalesStudent.create({
    ...data,
    createdBy: staffUserId,
    updatedBy: staffUserId,
  });

  if (Array.isArray(data.services) && data.services.length > 0) {
    const svcDocs = data.services.map((s) => ({
      salesStudentId: student._id,
      serviceName: s.serviceName || s,
    }));
    await SalesStudentService.insertMany(svcDocs, { ordered: false });
  }

  await SalesStudentStatusHistory.create({
    salesStudentId: student._id,
    fromStatus: null,
    toStatus: student.status,
    changedBy: staffUserId,
    note: 'Student created',
  });

  return student;
}

async function updateStudent(id, data, staffUserId) {
  const existing = await SalesStudent.findById(id).lean();
  if (!existing) return null;

  const statusChanged = data.status && data.status !== existing.status;

  const updated = await SalesStudent.findByIdAndUpdate(
    id,
    { ...data, updatedBy: staffUserId },
    { new: true, runValidators: true }
  ).lean();

  if (statusChanged) {
    await SalesStudentStatusHistory.create({
      salesStudentId: id,
      fromStatus: existing.status,
      toStatus: data.status,
      changedBy: staffUserId,
      note: data.statusNote || '',
    });
  }

  // Update services if provided
  if (Array.isArray(data.services)) {
    await SalesStudentService.deleteMany({ salesStudentId: id });
    if (data.services.length > 0) {
      const svcDocs = data.services.map((s) => ({
        salesStudentId: id,
        serviceName: typeof s === 'string' ? s : s.serviceName,
      }));
      await SalesStudentService.insertMany(svcDocs, { ordered: false });
    }
  }

  return updated;
}

async function deleteStudent(id) {
  const student = await SalesStudent.findByIdAndDelete(id);
  if (!student) return false;
  await Promise.all([
    SalesStudentService.deleteMany({ salesStudentId: id }),
    SalesStudentNote.deleteMany({ salesStudentId: id }),
    SalesStudentStatusHistory.deleteMany({ salesStudentId: id }),
  ]);
  return true;
}

/** Wipe all Sales dashboard data for a fresh import. */
async function clearAllSalesData() {
  const [services, notes, history, students] = await Promise.all([
    SalesStudentService.deleteMany({}),
    SalesStudentNote.deleteMany({}),
    SalesStudentStatusHistory.deleteMany({}),
    SalesStudent.deleteMany({}),
  ]);
  invalidateCache();
  return {
    students: students.deletedCount || 0,
    services: services.deletedCount || 0,
    notes: notes.deletedCount || 0,
    statusHistory: history.deletedCount || 0,
  };
}

async function addNote(studentId, { type, content, followUpDate }, staffUserId) {
  return SalesStudentNote.create({
    salesStudentId: studentId,
    type: type || 'NOTE',
    content,
    followUpDate: followUpDate || null,
    createdBy: staffUserId,
  });
}

async function updateNote(noteId, data) {
  return SalesStudentNote.findByIdAndUpdate(noteId, data, { new: true }).lean();
}

module.exports = {
  listStudents,
  getStudentDetail,
  createStudent,
  updateStudent,
  deleteStudent,
  clearAllSalesData,
  addNote,
  updateNote,
  buildFilter,
  parseMulti,
};
