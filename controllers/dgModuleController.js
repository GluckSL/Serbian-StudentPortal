const mongoose = require('mongoose');
const DGModule = require('../models/DGModule');
const DGSession = require('../models/DGSession');
const LearningModule = require('../models/LearningModule');
const {
  getStudentDgJourneyAccess,
  dgModuleUnlockedForAccess,
  dgWeekLockMessage,
} = require('../utils/dgStudentJourneyGate');
const User = require('../models/User');
const { isContentBlockedForStudent } = require('../utils/journeyContentBlock');
const { normalizeBatchKeys, moduleTargetingQuery } = require('../utils/batchTargeting');
const { dgModuleVersionClauseForBatch, normalizeBatchType } = require('../utils/batchType');
const { TRIAL_JOURNEY_DAY } = require('../utils/journeyDay');

function effectiveDgUnlockDay(access) {
  if (access?.trialDayEnabled && Number(access.journeyCourseDay) === TRIAL_JOURNEY_DAY) {
    return TRIAL_JOURNEY_DAY;
  }
  return Number.isFinite(Number(access?.courseDay)) ? Number(access.courseDay) : 1;
}
const { weekDayRange } = require('../utils/oldBatchDgWeekAccess');
const {
  buildDgModulePayloadFromLearning,
  resolveDefaultCharacterId,
} = require('../services/mapLearningToDgPayload');
const { generateScenesWithAi } = require('../services/dgSceneGeneratorService');

const MAX_LEARNING_IMPORT_BATCH = 20;

function sortScenes(scenes) {
  return [...(scenes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function normalizePracticeWindow(input) {
  const out = { ...input };
  const toNumOrUndef = (v) => {
    if (v === undefined) return undefined;
    if (v === null || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const min = toNumOrUndef(input.minPracticeMinutes);
  const max = toNumOrUndef(input.maxPracticeMinutes);
  if (min !== undefined) out.minPracticeMinutes = min;
  if (max !== undefined) out.maxPracticeMinutes = max;

  if (out.minPracticeMinutes !== undefined) {
    if (Number.isNaN(out.minPracticeMinutes) || out.minPracticeMinutes < 5 || out.minPracticeMinutes > 120) {
      throw new Error('Min practice minutes must be between 5 and 120.');
    }
  }
  if (out.maxPracticeMinutes !== undefined && out.maxPracticeMinutes !== null) {
    if (Number.isNaN(out.maxPracticeMinutes) || out.maxPracticeMinutes < 5 || out.maxPracticeMinutes > 180) {
      throw new Error('Max practice minutes must be between 5 and 180.');
    }
  }
  if (
    out.minPracticeMinutes !== undefined &&
    out.maxPracticeMinutes !== undefined &&
    out.maxPracticeMinutes !== null &&
    out.maxPracticeMinutes < out.minPracticeMinutes
  ) {
    throw new Error('Max practice minutes must be greater than or equal to min practice minutes.');
  }

  return out;
}

function normalizeExamBucketFlags(input) {
  const weeklyTestEnabled = input?.weeklyTestEnabled === true || String(input?.weeklyTestEnabled) === 'true';
  const examEnabled = input?.examEnabled === true || String(input?.examEnabled) === 'true';
  if (weeklyTestEnabled && examEnabled) {
    throw new Error('Only one of Weekly Test or Exam can be enabled.');
  }
  return { weeklyTestEnabled, examEnabled };
}

exports.createFromLearning = async (req, res) => {
  try {
    const ids = req.body.learningModuleIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'learningModuleIds must be a non-empty array' });
    }
    if (ids.length > MAX_LEARNING_IMPORT_BATCH) {
      return res.status(400).json({
        message: `At most ${MAX_LEARNING_IMPORT_BATCH} modules per request`,
      });
    }

    let characterId;
    try {
      characterId = await resolveDefaultCharacterId();
    } catch (e) {
      return res.status(400).json({ message: e.message || 'No default character' });
    }

    const results = [];
    const errors = [];

    for (const rawId of ids) {
      const learningModuleId = String(rawId);
      try {
        const lm = await LearningModule.findById(learningModuleId).lean();
        if (!lm || lm.isDeleted) {
          errors.push({ learningModuleId, message: 'Learning module not found' });
          continue;
        }

        const basePayload = await buildDgModulePayloadFromLearning(lm, characterId);
        const payload = normalizePracticeWindow({
          ...basePayload,
          scenes: sortScenes(basePayload.scenes || []),
          createdBy: req.user.id,
        });

        const doc = new DGModule(payload);
        await doc.save();

        results.push({
          learningModuleId,
          dgModuleId: doc._id.toString(),
          title: doc.title,
        });
      } catch (e) {
        errors.push({
          learningModuleId,
          message: e.message || 'Create failed',
        });
      }
    }

    const statusCode = results.length === 0 ? 400 : 200;
    res.status(statusCode).json({ results, errors });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Import failed' });
  }
};

exports.create = async (req, res) => {
  try {
    const bucketFlags = normalizeExamBucketFlags(req.body || {});
    const payload = normalizePracticeWindow({
      ...req.body,
      ...bucketFlags,
      scenes: sortScenes(req.body.scenes || []),
      createdBy: req.user.id,
    });
    // Accept human-readable batch names as `targetBatches` and store normalized keys.
    if (Array.isArray(req.body?.targetBatches)) {
      payload.targetBatchKeys = normalizeBatchKeys(req.body.targetBatches);
    }
    const doc = new DGModule(payload);
    await doc.save();
    await doc.populate('characterId');
    const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    res.status(201).json({
      ...plain,
      version: plain.version || 'v1',
      targetBatches: Array.isArray(plain.targetBatchKeys) ? plain.targetBatchKeys : [],
    });
  } catch (e) {
    res.status(400).json({ message: e.message || 'Create module failed' });
  }
};

exports.update = async (req, res) => {
  try {
    const body = normalizePracticeWindow({ ...req.body });
    if (Array.isArray(body.scenes)) body.scenes = sortScenes(body.scenes);
    delete body.createdBy;
    if ('weeklyTestEnabled' in (req.body || {}) || 'examEnabled' in (req.body || {})) {
      const bucketFlags = normalizeExamBucketFlags(req.body || {});
      body.weeklyTestEnabled = bucketFlags.weeklyTestEnabled;
      body.examEnabled = bucketFlags.examEnabled;
    }
    if (Array.isArray(req.body?.targetBatches)) {
      body.targetBatchKeys = normalizeBatchKeys(req.body.targetBatches);
    }
    const doc = await DGModule.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    }).populate('characterId');
    if (!doc) return res.status(404).json({ message: 'Module not found' });
    const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    res.json({
      ...plain,
      version: plain.version || 'v1',
      targetBatches: Array.isArray(plain.targetBatchKeys) ? plain.targetBatchKeys : [],
    });
  } catch (e) {
    res.status(400).json({ message: e.message || 'Update failed' });
  }
};

exports.getAdminById = async (req, res) => {
  try {
    const doc = await DGModule.findById(req.params.id).populate('characterId');
    if (!doc || !doc.isActive) {
      return res.status(404).json({ message: 'Module not found' });
    }
    if (req.user.role === 'TEACHER' && doc.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    res.json({
      ...plain,
      version: plain.version || 'v1',
      targetBatches: Array.isArray(plain.targetBatchKeys) ? plain.targetBatchKeys : [],
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Load failed' });
  }
};

/** Fields for admin grid only — full module (scenes, vocab, role-play, description) loads on GET /modules/:id or /play. */
const ADMIN_MODULE_LIST_SELECT =
  'title level language courseDay visibleToStudents weeklyTestEnabled examEnabled characterId targetBatchKeys beginnerMode.enabled updatedAt';

exports.listAdmin = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.user.role === 'TEACHER') {
      filter.createdBy = req.user.id;
    }
    const version = req.query.version;
    if (version === 'v2') {
      filter.version = 'v2';
    } else if (version === 'v1') {
      filter.$or = [{ version: 'v1' }, { version: { $exists: false } }];
    }
    const modules = await DGModule.find(filter)
      .select(ADMIN_MODULE_LIST_SELECT + ' version')
      .sort({ updatedAt: -1 })
      .lean();
    res.json({
      modules: (modules || []).map((m) => ({
        ...m,
        version: m.version || 'v1',
        targetBatches: Array.isArray(m.targetBatchKeys) ? m.targetBatchKeys : [],
        beginnerMode: { enabled: !!m.beginnerMode?.enabled },
      })),
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'List failed' });
  }
};

/** POST /dg/modules/:id/copy-to-v2 — Deep-clone a v1 module into DG Bot Modules 2.0. */
exports.copyToV2 = async (req, res) => {
  try {
    const source = await DGModule.findById(req.params.id).lean();
    if (!source || !source.isActive) {
      return res.status(404).json({ message: 'Module not found' });
    }
    if (source.version === 'v2') {
      return res.status(400).json({ message: 'Module is already a v2 module.' });
    }
    const { _id, createdAt, updatedAt, __v, ...rest } = source;
    const copy = new DGModule({
      ...rest,
      title: source.title,
      version: 'v2',
      targetBatchKeys: [],
      visibleToStudents: false,
      createdBy: req.user.id,
    });
    await copy.save();
    const plain = copy.toObject();
    res.status(201).json({
      module: {
        ...plain,
        version: 'v2',
        targetBatches: [],
        beginnerMode: { enabled: !!plain.beginnerMode?.enabled },
      },
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Copy failed' });
  }
};

/** PATCH /dg/modules/:id/target-batches — Update targetBatchKeys for a v2 module. */
exports.patchTargetBatches = async (req, res) => {
  try {
    const { targetBatches } = req.body;
    if (!Array.isArray(targetBatches)) {
      return res.status(400).json({ message: 'targetBatches must be an array.' });
    }
    const doc = await DGModule.findById(req.params.id);
    if (!doc || !doc.isActive) {
      return res.status(404).json({ message: 'Module not found' });
    }
    if (doc.version !== 'v2') {
      return res.status(400).json({ message: 'Only v2 modules support batch targeting via this endpoint.' });
    }
    doc.targetBatchKeys = normalizeBatchKeys(targetBatches);
    await doc.save();
    const plain = doc.toObject();
    res.json({
      success: true,
      targetBatches: Array.isArray(plain.targetBatchKeys) ? plain.targetBatchKeys : [],
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Update target batches failed' });
  }
};

exports.listStudent = async (req, res) => {
  try {
    const gluckExamOnly =
      String(req.query.gluckExamOnly) === 'true' || String(req.query.gluckExamOnly) === '1';
    const access = await getStudentDgJourneyAccess(req.user.id);
    if (access.dgBotEnabled === false) {
      return res.json({
        modules: [],
        studentCourseDay: access.courseDay ?? 1,
        unlockMode: access.unlockMode || 'none',
        dgUnlockedWeek: access.dgUnlockedWeek ?? 0,
      });
    }
    const studentDay = effectiveDgUnlockDay(access);
    const unlockAccess = { ...access, courseDay: studentDay };

    const batchKeys = access.batchKeys || [];
    const batchType = normalizeBatchType(access.batchType);
    const andParts = [
      { isActive: true },
      { visibleToStudents: true },
      dgModuleVersionClauseForBatch(batchType),
    ];
    if (batchKeys.length) {
      andParts.push(moduleTargetingQuery(batchKeys));
    }
    if (gluckExamOnly) {
      andParts.push({ $or: [{ weeklyTestEnabled: true }, { examEnabled: true }] });
    }
    const moduleFilter = { $and: andParts };

    let moduleQuery = DGModule.find(moduleFilter);
    if (gluckExamOnly) {
      moduleQuery = moduleQuery.select(
        'title level language courseDay weeklyTestEnabled examEnabled'
      );
    } else {
      moduleQuery = moduleQuery.select(
        'title description level language visibleToStudents weeklyTestEnabled examEnabled scenes courseDay'
      );
    }
    // Fetch modules and student doc in parallel — they are independent queries
    const [modules, studentDoc] = await Promise.all([
      moduleQuery.sort({ title: 1 }).lean(),
      User.findById(req.user.id).select('blockedJourneyLevels').lean(),
    ]);
    const A1_A2_LEVELS = new Set(['A1', 'A2']);
    const unlockedForDay = (modules || []).filter((m) => {
      // A1 and A2 content is always visible regardless of journey day.
      const isA1A2 = A1_A2_LEVELS.has(String(m?.level || '').toUpperCase());
      if (!isA1A2 && !dgModuleUnlockedForAccess(unlockAccess, m?.courseDay)) return false;
      if (isContentBlockedForStudent(studentDoc, { courseDay: m?.courseDay, level: m?.level })) return false;
      return true;
    });
    const sanitized = gluckExamOnly
      ? unlockedForDay
      : unlockedForDay.map((m) => ({
          ...m,
          scenes: (m.scenes || []).map((s) => ({
            _id: s._id,
            type: s.type,
            order: s.order,
          })),
        }));

    const studentOid =
      typeof req.user.id === 'string' && mongoose.Types.ObjectId.isValid(req.user.id)
        ? new mongoose.Types.ObjectId(req.user.id)
        : req.user.id;

    const moduleIds = sanitized.map((m) => m._id);
    let completedModuleIds = [];
    let bestProgressRows = [];
    if (moduleIds.length) {
      [completedModuleIds, bestProgressRows] = await Promise.all([
        DGSession.distinct('moduleId', {
          studentId: studentOid,
          completed: true,
          moduleId: { $in: moduleIds },
          $or: [{ moduleFullyComplete: true }, { moduleFullyComplete: { $exists: false } }],
        }),
        DGSession.aggregate([
          {
            $match: {
              studentId: studentOid,
              completed: true,
              moduleCompletionPercent: { $type: 'number' },
              moduleId: { $in: moduleIds },
            },
          },
          {
            $group: {
              _id: '$moduleId',
              bestCompletionPercent: { $max: '$moduleCompletionPercent' },
            },
          },
        ]),
      ]);
    }

    const completedSet = new Set((completedModuleIds || []).map((id) => String(id)));
    const bestPctByModule = new Map(
      (bestProgressRows || []).map((r) => [String(r._id), Math.min(100, Math.round(r.bestCompletionPercent))]),
    );

    const out = sanitized.map((m) => ({
      ...m,
      studentProgress: gluckExamOnly
        ? { completed: completedSet.has(String(m._id)) }
        : {
            completed: completedSet.has(String(m._id)),
            bestCompletionPercent: bestPctByModule.get(String(m._id)) ?? 0,
          },
    }));

    const unlockedRange =
      access.unlockMode === 'weekly'
        ? weekDayRange(access.dgUnlockedWeek ?? 1)
        : null;
    const dgWeekHint =
      access.unlockMode === 'weekly' && unlockedRange
        ? `Week ${access.dgUnlockedWeek}: journey days ${unlockedRange.start}–${unlockedRange.end}. Complete all modules in this week to unlock the next.`
        : null;

    res.json({
      modules: out,
      studentCourseDay: studentDay,
      unlockMode: access.unlockMode || 'daily',
      dgUnlockedWeek: access.dgUnlockedWeek ?? 1,
      dgWeekHint,
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'List failed' });
  }
};

exports.getPlay = async (req, res) => {
  try {
    const mod = await DGModule.findOne({
      _id: req.params.id,
      isActive: true,
    }).populate('characterId');

    if (!mod) {
      return res.status(404).json({ message: 'Module not found' });
    }

    if (req.user.role === 'STUDENT' && !mod.visibleToStudents) {
      return res.status(403).json({ message: 'Module not available' });
    }

    if (req.user.role === 'STUDENT') {
      const access = await getStudentDgJourneyAccess(req.user.id);
      if (access.dgBotEnabled === false) {
        return res.status(403).json({
          message: 'DG modules are not available for your batch.',
          code: 'LEARNING_CONTENT_DISABLED',
        });
      }
      const batchType = normalizeBatchType(access.batchType);
      const modVersion = mod.version === 'v2' ? 'v2' : 'v1';
      if (batchType === 'new2' && modVersion !== 'v2') {
        return res.status(403).json({
          message: 'This module is not available for your batch.',
          code: 'VERSION_NOT_ALLOWED',
        });
      }
      if (batchType === 'new' && modVersion === 'v2') {
        return res.status(403).json({
          message: 'This module is not available for your batch.',
          code: 'VERSION_NOT_ALLOWED',
        });
      }
      const unlockAccess = { ...access, courseDay: effectiveDgUnlockDay(access) };
      if (!dgModuleUnlockedForAccess(unlockAccess, mod.courseDay)) {
        const weekLock = dgWeekLockMessage(access, mod.courseDay);
        if (weekLock) {
          return res.status(403).json(weekLock);
        }
        return res.status(403).json({
          message: 'This module unlocks on a later day of your course.',
          code: 'COURSE_DAY_LOCKED',
          studentCourseDay: access.courseDay,
          moduleCourseDay: mod.courseDay,
        });
      }
      const studentDoc = await User.findById(req.user.id).select('blockedJourneyLevels').lean();
      if (isContentBlockedForStudent(studentDoc, { courseDay: mod.courseDay, level: mod.level })) {
        return res.status(403).json({
          message: 'This DG module is not available for your learning path.',
          code: 'CONTENT_LEVEL_BLOCKED',
        });
      }

      // Block students from replaying a fully-completed module
      const studentOid =
        typeof req.user.id === 'string' && mongoose.Types.ObjectId.isValid(req.user.id)
          ? new mongoose.Types.ObjectId(req.user.id)
          : req.user.id;
      const alreadyCompleted = await DGSession.exists({
        studentId: studentOid,
        moduleId: mod._id,
        completed: true,
        $or: [{ moduleFullyComplete: true }, { moduleFullyComplete: { $exists: false } }],
      });
      if (alreadyCompleted) {
        return res.status(403).json({
          message: 'You have already completed this module. New modules unlock as you progress through your journey.',
          code: 'MODULE_ALREADY_COMPLETED',
        });
      }
    }

    // Plain objects so JSON always includes optional audioUrl (pre-generated audio) per scene.
    let scenes = mod.getSortedScenes().map((s) => {
      const plain = typeof s.toObject === 'function' ? s.toObject() : { ...s };
      return { ...plain, audioUrl: plain.audioUrl || '', imageUrl: plain.imageUrl || '' };
    });

    // ── Auto-generate scenes from vocabulary when the module has only the
    //    default intro but has vocabulary/grammar configured.
    //    This ensures the player always has content to run through regardless
    //    of whether scenes were manually built in the admin form.
    const hasOnlyIntro = scenes.length <= 1;
    const vocab = (mod.allowedVocabulary && mod.allowedVocabulary.length > 0)
      ? mod.allowedVocabulary
      : (mod.aiTutorVocabulary || []);

    if (hasOnlyIntro && vocab.length > 0) {
      const introScene = scenes[0] || {
        type: 'intro',
        text: "Hi! I'm your digital guide. Let's learn together.",
        audioUrl: '',
        expectedAnswer: '',
        translation: '',
        hint: '',
        order: 0,
      };
      const generated = [introScene];

      // Teach scenes — one per word, up to 8
      const teachWords = vocab.slice(0, 8);
      for (const v of teachWords) {
        generated.push({
          type: 'teach',
          text: `${v.word} — ${v.translation || ''}`,
          audioUrl: '',
          expectedAnswer: '',
          translation: v.translation || '',
          hint: '',
          order: generated.length,
        });
      }

      // Practice scenes — first 4 words the student must say aloud
      const practiceWords = vocab.slice(0, Math.min(4, vocab.length));
      for (const v of practiceWords) {
        generated.push({
          type: 'practice',
          text: `Say: ${v.word}`,
          audioUrl: '',
          expectedAnswer: v.word,
          translation: v.translation || '',
          hint: v.word,
          order: generated.length,
        });
      }

      // Closing feedback scene
      generated.push({
        type: 'feedback',
        text: "Great work! You have completed this lesson.",
        audioUrl: '',
        expectedAnswer: '',
        translation: '',
        hint: '',
        order: generated.length,
      });

      scenes = generated;
    }

    const character = mod.characterId;
    res.json({
      module: {
        _id: mod._id,
        title: mod.title,
        description: mod.description,
        level: mod.level,
        language: mod.language,
        nativeLanguage: mod.nativeLanguage,
        minimumCompletionTime: mod.minimumCompletionTime,
        minPracticeMinutes: mod.minPracticeMinutes,
        maxPracticeMinutes: mod.maxPracticeMinutes,
        courseDay: mod.courseDay,
        scenes,
        rolePlayScenario: mod.rolePlayScenario,
        allowedVocabulary: mod.allowedVocabulary,
        aiTutorVocabulary: mod.aiTutorVocabulary,
        allowedGrammar: mod.allowedGrammar,
        conversationFlow: mod.conversationFlow,
        beginnerMode: mod.beginnerMode,
      },
      character,
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Load failed' });
  }
};

exports.patchVisibility = async (req, res) => {
  try {
    const visible = req.body.visibleToStudents === true || String(req.body.visibleToStudents) === 'true';
    const doc = await DGModule.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Module not found' });
    if (req.user.role === 'TEACHER' && doc.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    doc.visibleToStudents = visible;
    await doc.save();
    res.json({ success: true, visibleToStudents: doc.visibleToStudents });
  } catch (e) {
    res.status(400).json({ message: e.message || 'Update failed' });
  }
};

exports.remove = async (req, res) => {
  try {
    const doc = await DGModule.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Module not found' });
    if (req.user.role === 'TEACHER' && doc.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    doc.isActive = false;
    await doc.save();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Delete failed' });
  }
};

/**
 * POST /dg/modules/scenes/generate
 * Body: {
 *   count, level, language, nativeLanguage,
 *   rolePlayScenario, allowedVocabulary, aiTutorVocabulary, allowedGrammar
 * }
 * Returns: { scenes: DGScene[] }  (NOT persisted — caller decides what to do)
 */
exports.generateScenes = async (req, res) => {
  try {
    const body = req.body || {};
    const count = Math.max(2, Math.min(30, Number(body.count) || 8));

    const rps = body.rolePlayScenario || {};
    if (!rps.situation || !rps.studentRole || !rps.aiRole) {
      return res.status(400).json({
        message:
          'Please fill Situation, Student role, and AI role before generating scenes.',
      });
    }

    const totalVocab =
      (Array.isArray(body.allowedVocabulary) ? body.allowedVocabulary.length : 0) +
      (Array.isArray(body.aiTutorVocabulary) ? body.aiTutorVocabulary.length : 0);
    if (totalVocab === 0) {
      return res.status(400).json({
        message:
          'Add at least one vocabulary word (student or AI) before generating scenes.',
      });
    }

    const scenes = await generateScenesWithAi({
      count,
      level: body.level,
      language: body.language,
      nativeLanguage: body.nativeLanguage,
      rolePlayScenario: rps,
      allowedVocabulary: body.allowedVocabulary,
      aiTutorVocabulary: body.aiTutorVocabulary,
      allowedGrammar: body.allowedGrammar,
    });

    res.json({ scenes });
  } catch (e) {
    const msg = e?.message || 'AI scene generation failed';
    const status = /OPENAI_API_KEY|api key/i.test(msg) ? 500 : 400;
    res.status(status).json({ message: msg });
  }
};
