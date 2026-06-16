'use strict';

const SprechenExamModule = require('../models/SprechenExamModule');
const SprechenExamSession = require('../models/SprechenExamSession');
const {
  getStudentSprechenJourneyAccess,
  sprechenModuleUnlockedForStudentDay,
} = require('../utils/sprechenStudentJourneyGate');
const { normalizeBatchKeys } = require('../utils/batchTargeting');
const placeholderContent = require('../content/sprechen-a1-placeholder.json');
const a2ModelDefaults = require('../content/sprechen-a2-model-defaults.json');
const { resignMediaInObject, resignMediaInObjects, canonicalizeMediaInObject } = require('../config/presign');

// ─── Admin CRUD ───────────────────────────────────────────────────────────────

exports.listAdmin = async (req, res) => {
  try {
    const mods = await SprechenExamModule.find({ isActive: true })
      .sort({ createdAt: -1 })
      .populate('characterId', 'name avatarUrl')
      .lean();
    await resignMediaInObjects(mods);
    res.json({ modules: mods });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.getAdminById = async (req, res) => {
  try {
    const mod = await SprechenExamModule.findById(req.params.id)
      .populate('characterId', 'name avatarUrl voice')
      .lean();
    if (!mod) return res.status(404).json({ message: 'Not found' });
    await resignMediaInObject(mod);
    res.json(mod);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const payload = _sanitizePayload(req.body, req.user.id);
    const mod = new SprechenExamModule(payload);
    await mod.save();
    res.status(201).json(mod.toObject());
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const payload = _sanitizePayload(req.body, null);
    const mod = await SprechenExamModule.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true, runValidators: true }
    ).lean();
    if (!mod) return res.status(404).json({ message: 'Not found' });
    res.json(mod);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

/** Fast path: title, description, journey day, batches, etc. — does not touch Teil 1–3. */
exports.patchMetadata = async (req, res) => {
  try {
    const payload = _sanitizeMetadataPayload(req.body);
    if (!Object.keys(payload).length) {
      return res.status(400).json({ message: 'No fields to update' });
    }
    const mod = await SprechenExamModule.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true, runValidators: true }
    )
      .select(
        'title description level visibleToStudents courseDay passThreshold targetBatchKeys characterId updatedAt'
      )
      .lean();
    if (!mod) return res.status(404).json({ message: 'Not found' });
    res.json(mod);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

exports.patchVisibility = async (req, res) => {
  try {
    const { visibleToStudents } = req.body;
    const mod = await SprechenExamModule.findByIdAndUpdate(
      req.params.id,
      { visibleToStudents: Boolean(visibleToStudents) },
      { new: true }
    ).lean();
    if (!mod) return res.status(404).json({ message: 'Not found' });
    res.json({ visibleToStudents: mod.visibleToStudents });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await SprechenExamModule.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

/**
 * Seed a new module from the placeholder content JSON.
 * Useful for admins to bootstrap the first exam pack without manual entry.
 */
exports.uploadCardImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }
    const { presignS3Url, canonicalizeMediaUrl } = require('../config/presign');
    const rawUrl = req.file.location || `/uploads/sprechen-cards/${req.file.filename || ''}`;
    const canonicalUrl = canonicalizeMediaUrl(rawUrl);
    const url = req.file.location ? await presignS3Url(canonicalUrl) : canonicalUrl;
    res.json({ url, canonicalUrl });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Upload failed' });
  }
};

exports.seedFromPlaceholder = async (req, res) => {
  try {
    const { resolveOllyTutorCharacterId } = require('../services/sprechenCharacterSeed');
    const characterId = await resolveOllyTutorCharacterId();

    const payload = {
      ...placeholderContent,
      characterId,
      visibleToStudents: false,
      createdBy: req.user.id,
    };
    const mod = new SprechenExamModule(payload);
    await mod.save();
    res.status(201).json(mod.toObject());
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

exports.seedFromA2Model = async (req, res) => {
  try {
    const { resolveOllyTutorCharacterId } = require('../services/sprechenCharacterSeed');
    const characterId = await resolveOllyTutorCharacterId();

    const payload = {
      ...a2ModelDefaults,
      characterId,
      visibleToStudents: false,
      createdBy: req.user.id,
    };
    const mod = new SprechenExamModule(payload);
    await mod.save();
    res.status(201).json(mod.toObject());
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

// ─── Student API ──────────────────────────────────────────────────────────────

exports.listStudent = async (req, res) => {
  try {
    const gluckExamOnly =
      String(req.query.gluckExamOnly) === 'true' || String(req.query.gluckExamOnly) === '1';
    const access = await getStudentSprechenJourneyAccess(req.user.id);
    if (!access.enabled) {
      return res.status(403).json({ message: 'Journey not active.', code: 'JOURNEY_NOT_ACTIVE' });
    }

    const moduleFilter = { isActive: true, visibleToStudents: true };
    if (gluckExamOnly) {
      moduleFilter.$or = [{ weeklyTestEnabled: true }, { examEnabled: true }];
    }

    let moduleQuery = SprechenExamModule.find(moduleFilter).sort({ courseDay: 1, createdAt: 1 });
    if (gluckExamOnly) {
      moduleQuery = moduleQuery.select(
        'title level passThreshold courseDay weeklyTestEnabled examEnabled'
      );
    } else {
      moduleQuery = moduleQuery.populate('characterId', 'name avatarUrl voice');
    }
    const mods = await moduleQuery.lean();

    const visible = mods.filter((m) =>
      sprechenModuleUnlockedForStudentDay(m.courseDay, access.courseDay)
    );

    // Attach attempt counts per module
    const moduleIds = visible.map((m) => m._id);
    const sessions = moduleIds.length
      ? await SprechenExamSession.find({
          studentId: req.user.id,
          moduleId: { $in: moduleIds },
        })
          .select('moduleId completed scores completedAt')
          .sort({ completedAt: -1, createdAt: -1 })
          .lean()
      : [];

    const sessionMap = {};
    const completedSessions = [];
    for (const s of sessions) {
      const key = String(s.moduleId);
      if (!sessionMap[key]) sessionMap[key] = { attempts: 0, bestTotal: 0, lastCompleted: false };
      sessionMap[key].attempts += 1;
      if (s.completed) {
        sessionMap[key].lastCompleted = true;
        sessionMap[key].bestTotal = Math.max(sessionMap[key].bestTotal, s.scores?.total || 0);
        completedSessions.push(s);
      }
    }

    // Build per-module progress (always include attempts + bestTotal)
    const result = visible.map((m) => ({
      ...m,
      studentProgress: sessionMap[String(m._id)] || { attempts: 0, bestTotal: 0, lastCompleted: false },
    }));

    // Build student-level summary (latest session + aggregate + session list)
    const moduleInfoMap = {};
    for (const m of visible) {
      moduleInfoMap[String(m._id)] = { title: m.title, courseDay: m.courseDay };
    }
    const lastSession = completedSessions.length > 0 ? completedSessions[0] : null;
    const completedCount = completedSessions.length;
    const allCount = sessions.length;
    const summary = {
      lastSession: lastSession
        ? {
            sessionId: lastSession._id,
            moduleId: lastSession.moduleId,
            moduleTitle: moduleInfoMap[String(lastSession.moduleId)]?.title || '',
            courseDay: moduleInfoMap[String(lastSession.moduleId)]?.courseDay ?? null,
            scores: lastSession.scores,
            completedAt: lastSession.completedAt,
          }
        : null,
      sessions: completedSessions.map((s) => {
        const info = moduleInfoMap[String(s.moduleId)] || {};
        return {
          sessionId: s._id,
          moduleId: s.moduleId,
          moduleTitle: info.title || '',
          courseDay: info.courseDay != null ? info.courseDay : null,
          scores: s.scores,
          completedAt: s.completedAt,
        };
      }),
      aggregate: {
        total: allCount,
        completed: completedCount,
        missed: allCount - completedCount,
        passed: completedSessions.filter((s) => s.scores?.passed).length,
        avgTotal:
          completedCount > 0
            ? Math.round(
                (completedSessions.reduce((sum, s) => sum + (s.scores?.total || 0), 0) /
                  completedCount) *
                  10,
              ) / 10
            : 0,
        bestTotal: completedCount > 0 ? Math.max(...completedSessions.map((s) => s.scores?.total || 0)) : 0,
      },
    };

    if (!gluckExamOnly) {
      await resignMediaInObjects(result);
    }

    res.json({ modules: result, studentCourseDay: access.courseDay, summary });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

/**
 * GET /modules/:id/play — full module payload for the exam player.
 */
exports.getPlay = async (req, res) => {
  try {
    const mod = await SprechenExamModule.findById(req.params.id)
      .populate('characterId', 'name avatarUrl voice isDefault')
      .lean();
    if (!mod || !mod.isActive) return res.status(404).json({ message: 'Not found' });

    if (req.user.role === 'STUDENT') {
      if (!mod.visibleToStudents) {
        return res.status(403).json({ message: 'Module not available' });
      }
      const access = await getStudentSprechenJourneyAccess(req.user.id);
      if (!access.enabled) {
        return res.status(403).json({ message: 'Journey not active', code: 'JOURNEY_NOT_ACTIVE' });
      }
      if (!sprechenModuleUnlockedForStudentDay(mod.courseDay, access.courseDay)) {
        return res.status(403).json({
          message: 'Module unlocks on a later day of your course.',
          code: 'COURSE_DAY_LOCKED',
        });
      }
    }

    await resignMediaInObject(mod);
    res.json({ module: mod, character: mod.characterId || null });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─── Staff: sessions list ─────────────────────────────────────────────────────

exports.listSessions = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const sessions = await SprechenExamSession.find({ moduleId: req.params.id })
      .populate('studentId', 'name email regNo level batch')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const mod = await SprechenExamModule.findById(req.params.id).select('title passThreshold').lean();

    const rows = sessions.map((s) => ({
      _id: s._id,
      student: s.studentId,
      createdAt: s.createdAt,
      completed: s.completed,
      completedAt: s.completedAt,
      scores: s.scores,
      turnCount: s.turns.filter((t) => t.role === 'student').length,
    }));

    res.json({
      module: mod,
      sessions: rows,
      summary: {
        total: rows.length,
        completed: rows.filter((r) => r.completed).length,
        avgTotal: rows.length
          ? Math.round((rows.reduce((s, r) => s + (r.scores?.total || 0), 0) / rows.length) * 10) / 10
          : 0,
      },
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─── CSV export ───────────────────────────────────────────────────────────────

exports.exportCsv = async (req, res) => {
  try {
    const sessions = await SprechenExamSession.find({ moduleId: req.params.id })
      .populate('studentId', 'name email regNo batch level')
      .sort({ createdAt: -1 })
      .lean();

    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

    const header = ['Name', 'Email', 'RegNo', 'Batch', 'Date', 'Teil1', 'Teil2', 'Teil3', 'Total', 'Passed', 'Completed'].join(',');

    const lines = sessions.map((s) => [
      cell(s.studentId?.name),
      cell(s.studentId?.email),
      cell(s.studentId?.regNo),
      cell(s.studentId?.batch),
      cell(s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ''),
      cell(s.scores?.teil1 ?? 0),
      cell(s.scores?.teil2 ?? 0),
      cell(s.scores?.teil3 ?? 0),
      cell(s.scores?.total ?? 0),
      cell(s.scores?.passed ? 'Yes' : 'No'),
      cell(s.completed ? 'Yes' : 'No'),
    ].join(','));

    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sprechen-sessions-${req.params.id}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _sanitizeMetadataPayload(body) {
  const p = {};
  if (!body || typeof body !== 'object') return p;
  if (body.title !== undefined) p.title = String(body.title || '').trim();
  if (body.description !== undefined) p.description = String(body.description || '');
  if (body.level !== undefined) p.level = body.level || 'A1';
  if (body.examFormat !== undefined) p.examFormat = body.examFormat || 'A1';
  if (body.visibleToStudents !== undefined) p.visibleToStudents = Boolean(body.visibleToStudents);
  if (body.weeklyTestEnabled !== undefined) p.weeklyTestEnabled = Boolean(body.weeklyTestEnabled);
  if (body.examEnabled !== undefined) p.examEnabled = Boolean(body.examEnabled);
  if (body.courseDay !== undefined) {
    p.courseDay =
      body.courseDay == null || body.courseDay === ''
        ? null
        : Math.min(200, Math.max(1, Number(body.courseDay)));
  }
  if (body.passThreshold !== undefined) p.passThreshold = Number(body.passThreshold) || 10;
  if (body.characterId !== undefined) p.characterId = body.characterId || undefined;
  if (body.targetBatchKeys !== undefined) p.targetBatchKeys = normalizeBatchKeys(body.targetBatchKeys);
  if (p.weeklyTestEnabled && p.examEnabled) {
    throw new Error('Only one of Weekly Test or Exam can be enabled.');
  }
  return p;
}

function _sanitizePayload(body, createdBy) {
  const p = {};
  if (body.title !== undefined) p.title = String(body.title || '').trim();
  if (body.description !== undefined) p.description = String(body.description || '');
  if (body.level !== undefined) p.level = body.level || 'A1';
  if (body.examFormat !== undefined) p.examFormat = body.examFormat || 'A1';
  if (body.visibleToStudents !== undefined) p.visibleToStudents = Boolean(body.visibleToStudents);
  if (body.weeklyTestEnabled !== undefined) p.weeklyTestEnabled = Boolean(body.weeklyTestEnabled);
  if (body.examEnabled !== undefined) p.examEnabled = Boolean(body.examEnabled);
  if (body.courseDay !== undefined) p.courseDay = body.courseDay == null ? undefined : Number(body.courseDay);
  if (body.passThreshold !== undefined) p.passThreshold = Number(body.passThreshold) || 10;
  if (body.characterId !== undefined) p.characterId = body.characterId || undefined;
  if (body.targetBatchKeys !== undefined) p.targetBatchKeys = normalizeBatchKeys(body.targetBatchKeys);
  if (body.teil1 !== undefined) {
    p.teil1 = body.teil1;
    canonicalizeMediaInObject(p.teil1);
  }
  if (body.teil2 !== undefined) {
    p.teil2 = body.teil2;
    canonicalizeMediaInObject(p.teil2);
  }
  if (body.teil3 !== undefined) {
    p.teil3 = body.teil3;
    canonicalizeMediaInObject(p.teil3);
  }
  if (body.a2Teil1 !== undefined) {
    p.a2Teil1 = body.a2Teil1;
    canonicalizeMediaInObject(p.a2Teil1);
  }
  if (body.a2Teil2 !== undefined) {
    p.a2Teil2 = body.a2Teil2;
    canonicalizeMediaInObject(p.a2Teil2);
  }
  if (body.a2Teil3 !== undefined) {
    p.a2Teil3 = body.a2Teil3;
    canonicalizeMediaInObject(p.a2Teil3);
  }
  if (body.rubric !== undefined) p.rubric = body.rubric;
  if (createdBy) p.createdBy = createdBy;
  if (p.weeklyTestEnabled && p.examEnabled) {
    throw new Error('Only one of Weekly Test or Exam can be enabled.');
  }
  return p;
}
