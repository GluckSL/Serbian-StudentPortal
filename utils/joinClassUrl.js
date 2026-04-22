// utils/joinClassUrl.js — public URL for the authenticated join redirect endpoint

function getRequestPublicBase(req) {
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

/** Full URL students should open (sends cookies to this host for auth). */
function buildJoinClassProxyUrl(req, meetingLinkId) {
  const id = String(meetingLinkId || '').trim();
  return `${getRequestPublicBase(req)}/api/join-class/${id}`;
}

module.exports = { buildJoinClassProxyUrl, getRequestPublicBase };
