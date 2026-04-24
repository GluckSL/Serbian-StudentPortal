const DGModule = require('../models/DGModule');
const DGCharacter = require('../models/DGCharacter');

function sortScenes(scenes) {
  return [...(scenes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
}

exports.create = async (req, res) => {
  try {
    const payload = {
      ...req.body,
      scenes: sortScenes(req.body.scenes || []),
      createdBy: req.user.id,
    };
    const doc = new DGModule(payload);
    await doc.save();
    await doc.populate('characterId');
    res.status(201).json(doc);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Create module failed' });
  }
};

exports.update = async (req, res) => {
  try {
    const body = { ...req.body };
    if (Array.isArray(body.scenes)) body.scenes = sortScenes(body.scenes);
    delete body.createdBy;
    const doc = await DGModule.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    }).populate('characterId');
    if (!doc) return res.status(404).json({ message: 'Module not found' });
    res.json(doc);
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
    res.json(doc);
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
    res.json({ modules });
  } catch (e) {
    res.status(500).json({ message: e.message || 'List failed' });
  }
};

exports.listStudent = async (req, res) => {
  try {
    const modules = await DGModule.find({
      isActive: true,
      visibleToStudents: true,
    })
      .populate('characterId')
      .select('title description level characterId visibleToStudents updatedAt createdAt scenes')
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
    res.json({ modules: sanitized });
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

    // Plain objects so JSON always includes optional audioUrl (pre-generated audio) per scene.
    const scenes = mod.getSortedScenes().map((s) => {
      const plain = typeof s.toObject === 'function' ? s.toObject() : { ...s };
      return { ...plain, audioUrl: plain.audioUrl || '' };
    });
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
