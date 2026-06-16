const svc = require('../services/salesStudentService');
const SalesStudent = require('../models/SalesStudent');

function staffId(req) {
  return req.user?.userId || req.user?.id || null;
}

async function addNote(req, res) {
  try {
    const student = await SalesStudent.findById(req.params.id).lean();
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const note = await svc.addNote(req.params.id, req.body, staffId(req));
    res.status(201).json({ success: true, data: note });
  } catch (err) {
    console.error('[KrishDash] addNote error', err);
    res.status(500).json({ success: false, message: 'Failed to add note' });
  }
}

async function updateNote(req, res) {
  try {
    const note = await svc.updateNote(req.params.noteId, req.body);
    if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
    res.json({ success: true, data: note });
  } catch (err) {
    console.error('[KrishDash] updateNote error', err);
    res.status(500).json({ success: false, message: 'Failed to update note' });
  }
}

module.exports = { addNote, updateNote };
