const portalAnalytics = require('../services/portalAnalytics.service');

function requireStudent(req, res, next) {
  if (req.user?.role !== 'STUDENT') {
    return res.status(403).json({ message: 'Only students can record portal sessions.' });
  }
  next();
}

exports.startSession = async (req, res) => {
  try {
    const studentId = req.user.id;
    const result = await portalAnalytics.startSession(studentId);
    res.status(201).json(result);
  } catch (err) {
    if (err.message === 'INVALID_STUDENT') return res.status(400).json({ message: 'Invalid user' });
    console.error('[portal] startSession', err);
    res.status(500).json({ message: 'Failed to start session' });
  }
};

exports.heartbeat = async (req, res) => {
  try {
    const { sessionId, page } = req.body || {};
    const result = await portalAnalytics.heartbeat(req.user.id, sessionId, page);
    res.json(result);
  } catch (err) {
    if (err.message === 'INVALID_STUDENT') return res.status(400).json({ message: 'Invalid user' });
    if (err.message === 'INVALID_SESSION') return res.status(400).json({ message: 'sessionId required' });
    if (err.message === 'SESSION_NOT_FOUND') return res.status(404).json({ message: 'Session not found' });
    if (err.message === 'SESSION_ENDED') return res.status(410).json({ message: 'Session already ended' });
    if (err.message === 'SESSION_STALE') {
      return res.status(410).json({ message: 'Session expired; start a new session' });
    }
    console.error('[portal] heartbeat', err);
    res.status(500).json({ message: 'Heartbeat failed' });
  }
};

exports.endSession = async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    await portalAnalytics.endSession(req.user.id, sessionId);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'INVALID_STUDENT') return res.status(400).json({ message: 'Invalid user' });
    if (err.message === 'INVALID_SESSION') return res.status(400).json({ message: 'sessionId required' });
    if (err.message === 'SESSION_NOT_FOUND') return res.status(404).json({ message: 'Session not found' });
    console.error('[portal] endSession', err);
    res.status(500).json({ message: 'Failed to end session' });
  }
};

exports.overview = async (req, res) => {
  try {
    const { from, to } = portalAnalytics.parseDateRange(req.query);
    const data = await portalAnalytics.getOverview(from, to);
    res.json(data);
  } catch (err) {
    console.error('[portal-analytics] overview', err);
    res.status(500).json({ message: 'Failed to load overview' });
  }
};

exports.dashboard = async (req, res) => {
  try {
    const { from, to } = portalAnalytics.parseDateRange(req.query);
    const raw = String(req.query.includeHistorical || '').toLowerCase();
    const includeHistorical = raw === '1' || raw === 'true' || raw === 'yes';
    const data = await portalAnalytics.getDashboard(from, to, includeHistorical);
    res.json(data);
  } catch (err) {
    console.error('[portal-analytics] dashboard', err);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
};

exports.studentWise = async (req, res) => {
  try {
    const { from, to } = portalAnalytics.parseDateRange(req.query);
    const data = await portalAnalytics.getStudentWise(from, to, req.query.limit, req.query.sortBy, req.query.order);
    res.json({ items: data, range: { from, to } });
  } catch (err) {
    console.error('[portal-analytics] studentWise', err);
    res.status(500).json({ message: 'Failed to load student data' });
  }
};

exports.pageWise = async (req, res) => {
  try {
    const { from, to } = portalAnalytics.parseDateRange(req.query);
    const data = await portalAnalytics.getPageWise(from, to, req.query.limit);
    res.json({ items: data, range: { from, to } });
  } catch (err) {
    console.error('[portal-analytics] pageWise', err);
    res.status(500).json({ message: 'Failed to load page data' });
  }
};

exports.timeline = async (req, res) => {
  try {
    const { from, to } = portalAnalytics.parseDateRange(req.query);
    const data = await portalAnalytics.getTimeline(from, to, req.query.limit, req.query.skip);
    res.json({ ...data, range: { from, to } });
  } catch (err) {
    console.error('[portal-analytics] timeline', err);
    res.status(500).json({ message: 'Failed to load timeline' });
  }
};

exports.sessionWise = async (req, res) => {
  try {
    const { from, to } = portalAnalytics.parseDateRange(req.query);
    const data = await portalAnalytics.getSessionWise(from, to, req.query.limit);
    res.json({ items: data, range: { from, to } });
  } catch (err) {
    console.error('[portal-analytics] sessionWise', err);
    res.status(500).json({ message: 'Failed to load sessions' });
  }
};

exports.requireStudent = requireStudent;
