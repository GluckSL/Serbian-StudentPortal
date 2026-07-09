'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { engagementExportAuth } = require('../middleware/engagementExportAuth');

// ── Helper: create a minimal mock req/res/next ───────────────────────────────

function mockRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

function mockReq(authHeader) {
  return { headers: authHeader ? { authorization: authHeader } : {} };
}

// ── engagementExportAuth ──────────────────────────────────────────────────────

describe('engagementExportAuth middleware', () => {
  const ORIGINAL = process.env.ENGAGEMENT_OVERVIEW_EXPORT_TOKEN;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.ENGAGEMENT_OVERVIEW_EXPORT_TOKEN;
    } else {
      process.env.ENGAGEMENT_OVERVIEW_EXPORT_TOKEN = ORIGINAL;
    }
  });

  it('returns 503 when the env token is not set', () => {
    delete process.env.ENGAGEMENT_OVERVIEW_EXPORT_TOKEN;
    const res = mockRes();
    let nextCalled = false;
    engagementExportAuth(mockReq('Bearer abc'), res, () => { nextCalled = true; });
    assert.equal(res._status, 503);
    assert.equal(res._body.success, false);
    assert.ok(res._body.message.includes('ENGAGEMENT_OVERVIEW_EXPORT_TOKEN'));
    assert.equal(nextCalled, false);
  });

  it('returns 401 when no Authorization header is sent', () => {
    process.env.ENGAGEMENT_OVERVIEW_EXPORT_TOKEN = 'secret';
    const res = mockRes();
    let nextCalled = false;
    engagementExportAuth(mockReq(null), res, () => { nextCalled = true; });
    assert.equal(res._status, 401);
    assert.equal(res._body.success, false);
    assert.equal(nextCalled, false);
  });

  it('returns 401 when the Bearer token is wrong', () => {
    process.env.ENGAGEMENT_OVERVIEW_EXPORT_TOKEN = 'secret';
    const res = mockRes();
    let nextCalled = false;
    engagementExportAuth(mockReq('Bearer wrongtoken'), res, () => { nextCalled = true; });
    assert.equal(res._status, 401);
    assert.equal(res._body.success, false);
    assert.equal(nextCalled, false);
  });

  it('returns 401 when the header is not a Bearer scheme', () => {
    process.env.ENGAGEMENT_OVERVIEW_EXPORT_TOKEN = 'secret';
    const res = mockRes();
    let nextCalled = false;
    engagementExportAuth(mockReq('Basic secret'), res, () => { nextCalled = true; });
    assert.equal(res._status, 401);
    assert.equal(nextCalled, false);
  });

  it('calls next() when the token is correct', () => {
    process.env.ENGAGEMENT_OVERVIEW_EXPORT_TOKEN = 'my-real-token';
    const res = mockRes();
    let nextCalled = false;
    engagementExportAuth(mockReq('Bearer my-real-token'), res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res._status, null);
  });
});
