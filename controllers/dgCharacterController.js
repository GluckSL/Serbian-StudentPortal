const DGCharacter = require('../models/DGCharacter');
const { ensureDefaultDgCharacter } = require('../services/dgCharacterSeed');

exports.list = async (req, res) => {
  try {
    const activeOnly = String(req.query.activeOnly) !== '0';
    const q = activeOnly ? { isActive: true } : {};
    let items = await DGCharacter.find(q).sort({ isDefault: -1, name: 1 }).lean();
    if (items.length === 0) {
      await ensureDefaultDgCharacter();
      items = await DGCharacter.find(q).sort({ isDefault: -1, name: 1 }).lean();
    }
    res.json({ characters: items });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to list characters' });
  }
};

exports.getById = async (req, res) => {
  try {
    const doc = await DGCharacter.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ message: 'Character not found' });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to load character' });
  }
};

exports.create = async (req, res) => {
  try {
    if (req.body.isDefault === true || String(req.body.isDefault) === 'true') {
      await DGCharacter.updateMany({}, { $set: { isDefault: false } });
    }
    const doc = new DGCharacter(req.body);
    await doc.save();
    res.status(201).json(doc);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Create failed' });
  }
};

exports.update = async (req, res) => {
  try {
    if (req.body.isDefault === true || String(req.body.isDefault) === 'true') {
      await DGCharacter.updateMany({ _id: { $ne: req.params.id } }, { $set: { isDefault: false } });
    }
    const doc = await DGCharacter.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!doc) return res.status(404).json({ message: 'Character not found' });
    res.json(doc);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Update failed' });
  }
};

exports.remove = async (req, res) => {
  try {
    const doc = await DGCharacter.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: 'Character not found' });
    res.json({ success: true, character: doc });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Delete failed' });
  }
};
