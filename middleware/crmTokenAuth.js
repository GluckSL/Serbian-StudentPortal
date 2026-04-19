/**
 * Shared auth for server-to-server CRM (WordPress poller, etc.).
 * Send header: X-CRM-Token: <REMINDERS_CRM_TOKEN>
 */
function crmTokenAuth(req, res, next) {
  const token = req.headers['x-crm-token'] || req.headers['X-CRM-Token'];
  const expected = process.env.REMINDERS_CRM_TOKEN;
  if (!expected) {
    return res.status(503).json({ success: false, message: 'CRM token not configured on server (REMINDERS_CRM_TOKEN).' });
  }
  if (!token || token !== expected) {
    return res.status(401).json({ success: false, message: 'Invalid or missing X-CRM-Token header.' });
  }
  next();
}

module.exports = { crmTokenAuth };
