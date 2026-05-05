const DGModule = require('../models/DGModule');
const DGSession = require('../models/DGSession');
const LearningModule = require('../models/LearningModule');
const {
  getStudentDgJourneyAccess,
  dgModuleUnlockedForStudentDay,
} = require('../utils/dgStudentJourneyGate');
const User = require('../models/User');
const { studentTargetBatchKeys, moduleTargetingQuery, normalizeBatchKeys } = require('../utils/batchTargeting');
const {
  buildDgModulePayloadFromLearning,
  resolveDefaultCharacterId,
} = require('../services/mapLearningToDgPayload');

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
    const payload = normalizePracticeWindow({
      ...req.body,
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
      targetBatches: Array.isArray(plain.targetBatchKeys) ? plain.targetBatchKeys : [],
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Load failed' });
  }
};

exports.listAdmin = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.user.role === 'TEACHER') {
      filter.createdBy = req.user.id;
    }
    const modules = await DGModule.find(filter)
      .populate('characterId')
      .sort({ updatedAt: -1 })
      .lean();
    res.json({
      modules: (modules || []).map((m) => ({
        ...m,
        targetBatches: Array.isArray(m.targetBatchKeys) ? m.targetBatchKeys : [],
      })),
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'List failed' });
  }
};

exports.listStudent = async (req, res) => {
  try {
    const access = await getStudentDgJourneyAccess(req.user.id);
    if (!access.enabled || access.learningEnabled === false) {
      return res.json({ modules: [] });
    }
    const studentDay = access.courseDay;
    const student = await User.findById(req.user.id)
      .select('batch goStatus subscription role')
      .lean();
    const studentKeys = studentTargetBatchKeys(student);

    const modules = await DGModule.find({
      isActive: true,
      visibleToStudents: true,
      ...moduleTargetingQuery(studentKeys),
      $or: [
        { courseDay: null },
        { courseDay: { $exists: false } },
        { courseDay: { $lte: studentDay } },
      ],
    })
      .populate('characterId')
      .select(
        'title description level characterId visibleToStudents updatedAt createdAt scenes courseDay targetBatchKeys'
      )
      .sort({ title: 1 })
      .lean();
    const sanitized = modules.map((m) => ({
      ...m,
      scenes: (m.scenes || []).map((s) => ({
        _id: s._id,
        type: s.type,
        order: s.order,
      })),
    }));

    const completedModuleIds = await DGSession.distinct('moduleId', {
      studentId: req.user.id,
      completed: true,
    });
    const completedSet = new Set((completedModuleIds || []).map((id) => String(id)));

    const out = sanitized.map((m) => ({
      ...m,
      studentProgress: { completed: completedSet.has(String(m._id)) },
    }));

    res.json({ modules: out, studentCourseDay: studentDay });
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
      if (!access.enabled) {
        return res.status(403).json({
          message: 'Journey content is not enabled for your batch yet.',
          code: 'JOURNEY_NOT_ACTIVE',
        });
      }
      if (access.learningEnabled === false) {
        return res.status(403).json({
          message: 'DG modules are not available for your batch.',
          code: 'LEARNING_CONTENT_DISABLED',
        });
      }
      const student = await User.findById(req.user.id)
        .select('batch goStatus subscription role')
        .lean();
      const keys = studentTargetBatchKeys(student);
      const modKeys = Array.isArray(mod.targetBatchKeys) ? mod.targetBatchKeys : [];
      if (modKeys.length) {
        const keySet = new Set(keys);
        const ok = modKeys.some((k) => keySet.has(String(k)));
        if (!ok) {
          return res.status(403).json({
            message: 'This module is not assigned to your batch.',
            code: 'BATCH_NOT_ASSIGNED',
          });
        }
      }
      if (!dgModuleUnlockedForStudentDay(mod.courseDay, access.courseDay)) {
        return res.status(403).json({
          message: 'This module unlocks on a later day of your course.',
          code: 'COURSE_DAY_LOCKED',
          studentCourseDay: access.courseDay,
          moduleCourseDay: mod.courseDay,
        });
      }
    }

    // Plain objects so JSON always includes optional audioUrl (pre-generated audio) per scene.
    let scenes = mod.getSortedScenes().map((s) => {
      const plain = typeof s.toObject === 'function' ? s.toObject() : { ...s };
      return { ...plain, audioUrl: plain.audioUrl || '' };
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
