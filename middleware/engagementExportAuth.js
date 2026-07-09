/**
 * Auth middleware for the Engagement Overview CRM export API.
 * Send header: Authorization: Bearer <ENGAGEMENT_OVERVIEW_EXPORT_TOKEN>
 *
 * Grants read-only access to engagement data only — not to any other
 * /api/crm write endpoints or JWT-protected admin routes.
 */
function engagementExportAuth(req, res, next) {
  const expected = process.env.ENGAGEMENT_OVERVIEW_EXPORT_TOKEN;
  if (!expected) {
    return res.status(503).json({ success: false, message: 'Engagement export token not configured on server (ENGAGEMENT_OVERVIEW_EXPORT_TOKEN).' });
  }
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token || token !== expected) {
    return res.status(401).json({ success: false, message: 'Invalid or missing Authorization Bearer token.' });
  }
  next();
}

module.exports = { engagementExportAuth };
