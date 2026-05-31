/**
 * services/crmStudentUpsert.js
 *
 * Production-safe CRM → Portal student upsert:
 * - Optional idempotency (idempotencyKey / requestId)
 * - Duplicate-key retry / collapse races on concurrent creates
 * - Phone match only when both crmExternalId and email are absent
 * - Resilient webhook dispatch (retries + logging; never fails HTTP response)
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const { setUserPassword } = require('../utils/setUserPassword');
const CrmUpsertIdempotency = require('../models/CrmUpsertIdempotency');
const { sendStudentSignupLinkEmail } = require('../utils/sendStudentSignupLink');
const { generateRegNo, generatePassword, normalizePhone } = require('../utils/userRegistration');
const { scheduleDispatchEventResilient, sanitizeUserDoc } = require('./studentPortalCrmWebhook');
const { toStudentDto } = require('./crmStudentExport');

const ALLOWED_PROFILE_FIELDS = [
  'name',
  'phoneNumber',
  'whatsappNumber',
  'address',
  'age',
  'subscription',
  'level',
  'batch',
  'medium',
  'studentStatus',
  'leadSource',
  'servicesOpted',
  'qualifications',
  'languageLevelOpted',
  'stream',
  'otherLanguageKnown',
  'teacherIncharge',
  'reasonForWithdrawing',
  'dateWithdrew',
  'examPassedDate',
  'languageExamStatus',
  'examRemark',
  'candidateStatus',
  'documentationPaymentStatus',
  'enrollmentDate',
  'batchStartedOn',
  'crmExternalId',
];

const STUDENT_DEFAULTS = {
  subscription: 'SILVER',
  level: 'A1',
  studentStatus: 'UNCERTAIN',
  medium: ['English'],
};

const VALID_SUBSCRIPTION = new Set(['SILVER', 'PLATINUM', 'VISA_DOC_ONLY']);
const VALID_LEVEL = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const VALID_STUDENT_STATUS = new Set(['UNCERTAIN', 'ONGOING', 'COMPLETED', 'WITHDREW']);

/** Loose RFC5322-style check — placeholder domains bypass if needed later */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractIdempotencyKey(body) {
  if (!body || typeof body !== 'object') return '';
  const raw = body.idempotencyKey ?? body.requestId;
  if (raw === undefined || raw === null || raw === '') return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (s.length > 200) throw validationError('idempotencyKey / requestId must be at most 200 characters.');
  return s;
}

/** Drop meta keys before matching / persistence logic */
function stripMetaFields(body) {
  const {
    idempotencyKey,
    requestId,
    ...rest
  } = body;
  return rest;
}

function normalizeIncomingBody(body) {
  const out = { ...body };
  if (out.email !== undefined && out.email !== null) {
    const e = String(out.email).trim().toLowerCase();
    out.email = e === '' ? '' : e;
  }
  if (out.whatsappNumber !== undefined && out.whatsappNumber !== null && String(out.whatsappNumber).trim() !== '') {
    out.whatsappNumber = normalizePhone(out.whatsappNumber);
  } else if (out.whatsappNumber !== undefined) {
    out.whatsappNumber = '';
  }
  if (out.phoneNumber !== undefined && out.phoneNumber !== null && String(out.phoneNumber).trim() !== '') {
    out.phoneNumber = normalizePhone(out.phoneNumber);
  } else if (out.phoneNumber !== undefined) {
    out.phoneNumber = '';
  }
  return out;
}

function validateUpsertPayload(body) {
  if (body.portalId) {
    if (!mongoose.Types.ObjectId.isValid(body.portalId)) {
      throw validationError('Invalid portalId.');
    }
  }

  const email = body.email ? String(body.email).trim() : '';
  if (email && !email.endsWith('@sync.gluckportal.local') && !EMAIL_REGEX.test(email)) {
    throw validationError('Invalid email format.');
  }

  function rawProvided(v) {
    return v !== undefined && v !== null && String(v).trim() !== '';
  }
  if (rawProvided(body.whatsappNumber) && !normalizePhone(body.whatsappNumber)) {
    throw validationError('whatsappNumber contains no usable digits.');
  }
  if (rawProvided(body.phoneNumber) && !normalizePhone(body.phoneNumber)) {
    throw validationError('phoneNumber contains no usable digits.');
  }

  if (body.subscription !== undefined && body.subscription !== null && body.subscription !== '') {
    const s = String(body.subscription).trim().toUpperCase();
    if (!VALID_SUBSCRIPTION.has(s)) {
      throw validationError(`subscription must be one of: ${[...VALID_SUBSCRIPTION].join(', ')}`);
    }
  }

  if (body.level !== undefined && body.level !== null && body.level !== '') {
    const lv = String(body.level).trim().toUpperCase();
    if (!VALID_LEVEL.has(lv)) {
      throw validationError(`level must be one of: ${[...VALID_LEVEL].join(', ')}`);
    }
  }

  if (body.studentStatus !== undefined && body.studentStatus !== null && body.studentStatus !== '') {
    const st = String(body.studentStatus).trim().toUpperCase();
    if (!VALID_STUDENT_STATUS.has(st)) {
      throw validationError(`studentStatus must be one of: ${[...VALID_STUDENT_STATUS].join(', ')}`);
    }
  }

  if (body.age !== undefined && body.age !== null && body.age !== '') {
    const n = Number(body.age);
    if (!Number.isFinite(n) || n < 0 || n > 130) {
      throw validationError('age must be a number between 0 and 130.');
    }
  }
}

/** Phone matching allowed only when CRM did not supply crmExternalId or email */
function allowPhoneMatch(body) {
  const crm = body.crmExternalId !== undefined && body.crmExternalId !== null && String(body.crmExternalId).trim() !== '';
  const em = body.email !== undefined && body.email !== null && String(body.email).trim() !== '';
  return !crm && !em;
}

function buildProfileUpdate(body) {
  const update = {};

  for (const field of ALLOWED_PROFILE_FIELDS) {
    if (body[field] !== undefined && body[field] !== null) {
      let v = body[field];

      if (typeof v === 'string') v = v.trim();

      if (field === 'studentStatus') v = String(v).toUpperCase();
      if (field === 'subscription') v = String(v).toUpperCase();

      if (field === 'medium') {
        v = Array.isArray(v) ? v : [v];
        v = v.map((m) => String(m).trim()).filter(Boolean);
      }

      if (['dateWithdrew', 'examPassedDate', 'enrollmentDate', 'batchStartedOn'].includes(field)) {
        if (v) {
          const d = new Date(v);
          v = isNaN(d.getTime()) ? null : d;
        } else {
          v = null;
        }
      }

      if (field === 'crmExternalId') {
        v = String(v).trim();
      }

      update[field] = v;
    }
  }

  return update;
}

async function findExisting(body) {
  if (body.portalId && mongoose.Types.ObjectId.isValid(body.portalId)) {
    const u = await User.findOne({ _id: body.portalId, role: 'STUDENT' });
    if (u) return u;
    throw validationError('No student matches the provided portalId.');
  }

  const crmId = body.crmExternalId ? String(body.crmExternalId).trim() : '';
  if (crmId) {
    const u = await User.findOne({ crmExternalId: crmId, role: 'STUDENT' });
    if (u) return u;
  }

  const email = body.email ? String(body.email).trim().toLowerCase() : '';
  if (email) {
    const u = await User.findOne({ email, role: 'STUDENT' });
    if (u) return u;
  }

  if (!allowPhoneMatch(body)) return null;

  const waNorm = normalizePhone(body.whatsappNumber);
  if (waNorm) {
    const u = await User.findOne({
      role: 'STUDENT',
      $or: [{ whatsappNumber: waNorm }, { phoneNumber: waNorm }]
    });
    if (u) return u;
  }

  const phNorm = normalizePhone(body.phoneNumber);
  if (phNorm && phNorm !== waNorm) {
    const u = await User.findOne({
      role: 'STUDENT',
      $or: [{ whatsappNumber: phNorm }, { phoneNumber: phNorm }]
    });
    if (u) return u;
  }

  return null;
}

function duplicateKeyMessage(err) {
  const kp = err.keyPattern ? Object.keys(err.keyPattern) : [];
  if (kp.includes('crmExternalId')) return 'crmExternalId already linked to another student.';
  if (kp.includes('email')) return 'email already belongs to another user.';
  if (kp.includes('regNo')) return 'Registration number collision — retry the request.';
  return 'Duplicate key violation — record conflicts with existing data.';
}

async function resolveDuplicateStudent(err, mergedProfile) {
  const kp = err.keyPattern || {};
  if (kp.email && mergedProfile.email) {
    return User.findOne({ email: mergedProfile.email, role: 'STUDENT' });
  }
  if (kp.crmExternalId && mergedProfile.crmExternalId) {
    const cid = String(mergedProfile.crmExternalId).trim();
    return User.findOne({ crmExternalId: cid, role: 'STUDENT' });
  }
  return null;
}

async function lockOrReplayIdempotency(key) {
  if (!key) return { replay: null };

  try {
    await CrmUpsertIdempotency.create({ key, status: 'processing' });
    return { replay: null };
  } catch (e) {
    if (e.code !== 11000) throw e;
  }

  const maxWaitMs = 30000;
  const pollMs = 50;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    const doc = await CrmUpsertIdempotency.findOne({ key }).lean();

    if (doc?.status === 'completed' && doc.responsePayload) {
      const replayHttpStatus =
        doc.httpStatus ||
        (doc.responsePayload.action === 'created' ? 201 : 200);
      return {
        replay: { ...doc.responsePayload, idempotentReplay: true },
        replayHttpStatus,
      };
    }

    if (doc?.status === 'failed') {
      const stole = await CrmUpsertIdempotency.findOneAndUpdate(
        { key, status: 'failed' },
        {
          $set: {
            status: 'processing',
            errorMessage: '',
            responsePayload: null,
            completedAt: null,
            httpStatus: null,
          },
        },
        { new: true }
      );
      if (stole) return { replay: null };
    }
  }

  throw validationError(
    'Idempotency key still processing or contention timed out — retry with the same key shortly.'
  );
}

async function finalizeIdempotency(key, status, patch) {
  if (!key) return;
  await CrmUpsertIdempotency.updateOne({ key }, { $set: { status, ...patch } });
}

/**
 * Core upsert (no idempotency wrapper).
 */
async function executeUpsert(body, correlationId) {
  const createLogin = body.createPortalLogin === true || body.createPortalLogin === 'true';
  const sendEmail = body.sendCredentialsEmail === true || body.sendCredentialsEmail === 'true';
  const profileUpdate = buildProfileUpdate(body);

  let existing = await findExisting(body);

  if (existing) {
    Object.assign(existing, profileUpdate);
    existing.updatedAt = new Date();

    try {
      await existing.save();
    } catch (err) {
      if (err.code === 11000) throw validationError(duplicateKeyMessage(err));
      throw err;
    }

    await existing.populate({ path: 'assignedTeacher', select: 'name regNo email medium role' });

    scheduleDispatchEventResilient(
      { event: 'STUDENT_UPDATED', entity: { ...sanitizeUserDoc(existing), type: 'User' } },
      { correlationId: `${correlationId}:upd` }
    );

    return {
      action: 'updated',
      data: toStudentDto(existing.toObject({ virtuals: false })),
    };
  }

  const name = (body.name || '').trim();
  if (!name) throw validationError('name is required to create a new student.');

  let email = body.email ? String(body.email).trim().toLowerCase() : '';
  if (createLogin && (!email || email.endsWith('@sync.gluckportal.local'))) {
    throw validationError('A real email is required when createPortalLogin is true.');
  }

  if (!email) {
    const crmId = (body.crmExternalId || '').trim();
    const phoneDigits = normalizePhone(body.whatsappNumber || body.phoneNumber).replace(/^\+/, '');
    const suffix = crmId || phoneDigits || crypto.randomBytes(6).toString('hex');
    email = `crm+${suffix}@sync.gluckportal.local`;
  }

  const waNorm = normalizePhone(body.whatsappNumber || profileUpdate.whatsappNumber);
  const phNorm = normalizePhone(body.phoneNumber || profileUpdate.phoneNumber);

  const merged = {
    ...STUDENT_DEFAULTS,
    ...profileUpdate,
    name,
    email,
    whatsappNumber: waNorm || '',
    phoneNumber: phNorm || '',
  };

  if (!waNorm && !phNorm && email.endsWith('@sync.gluckportal.local')) {
    throw validationError('Provide whatsappNumber, phoneNumber, or a real email for new student creation.');
  }

  let persistedUser = null;
  let passwordPlain = '';

  for (let regAttempt = 0; regAttempt < 8; regAttempt++) {
    const regNo = await generateRegNo('STUDENT');
    passwordPlain = generatePassword('STUDENT', regNo);

    const candidate = new User({
      ...merged,
      regNo,
      role: 'STUDENT',
      password: 'placeholder', // overwritten by setUserPassword below
      registeredAt: new Date(),
      createdAt: new Date(),
      ...(createLogin ? { isActive: false, signupSource: 'crm_sync' } : {}),
    });
    await setUserPassword(candidate, passwordPlain);
    candidate.mustChangePassword = createLogin ? false : true;

    try {
      await candidate.save();
      persistedUser = candidate;
      break;
    } catch (err) {
      if (err.code !== 11000) throw err;

      const dupStudent = await resolveDuplicateStudent(err, merged);
      if (dupStudent) {
        Object.assign(dupStudent, profileUpdate);
        dupStudent.updatedAt = new Date();
        try {
          await dupStudent.save();
        } catch (e2) {
          if (e2.code === 11000) throw validationError(duplicateKeyMessage(e2));
          throw e2;
        }
        await dupStudent.populate({ path: 'assignedTeacher', select: 'name regNo email medium role' });
        scheduleDispatchEventResilient(
          { event: 'STUDENT_UPDATED', entity: { ...sanitizeUserDoc(dupStudent), type: 'User' } },
          { correlationId: `${correlationId}:upd-race` }
        );
        return {
          action: 'updated',
          data: toStudentDto(dupStudent.toObject({ virtuals: false })),
        };
      }

      if ((err.keyPattern || {}).regNo) {
        continue;
      }

      throw validationError(duplicateKeyMessage(err));
    }
  }

  if (!persistedUser) {
    throw validationError('Could not allocate a unique registration number — please retry.');
  }

  let signupLinkSentThisRequest = false;
  if (
    createLogin &&
    sendEmail &&
    !persistedUser.email.endsWith('@sync.gluckportal.local') &&
    !persistedUser.lastCredentialsEmailSent
  ) {
    try {
      const sent = await sendStudentSignupLinkEmail(persistedUser, {
        name,
        level: merged.level,
        subscription: merged.subscription,
        phoneNumber: merged.phoneNumber,
        whatsappNumber: merged.whatsappNumber,
      });
      if (sent.ok) {
        persistedUser.lastCredentialsEmailSent = new Date();
        await persistedUser.save();
        signupLinkSentThisRequest = true;
      }
    } catch (emailErr) {
      console.warn('[crmStudentUpsert] signup link email failed:', emailErr.message);
    }
  }

  await persistedUser.populate({ path: 'assignedTeacher', select: 'name regNo email medium role' });

  scheduleDispatchEventResilient(
    { event: 'STUDENT_CREATED', entity: { ...sanitizeUserDoc(persistedUser), type: 'User' } },
    { correlationId: `${correlationId}:crt` }
  );

  return {
    action: 'created',
    data: toStudentDto(persistedUser.toObject({ virtuals: false })),
    ...(createLogin ? { credentials: { regNo: persistedUser.regNo } } : {}),
    ...(signupLinkSentThisRequest ? { signupLinkEmailSent: true, credentialsEmailSent: true } : {}),
  };
}

/**
 * Public API — handles validation, idempotency, webhook + email side-effects.
 *
 * Returns API-ready fields (caller wraps with success / HTTP status).
 */
async function upsertStudentFromCrm(rawBody) {
  const idemKey = extractIdempotencyKey(rawBody || {});
  const stripped = stripMetaFields(rawBody || {});
  const body = normalizeIncomingBody(stripped);

  validateUpsertPayload(body);

  const correlationId = idemKey || crypto.randomBytes(8).toString('hex');

  const lock = await lockOrReplayIdempotency(idemKey);
  if (lock.replay) {
    return {
      ...lock.replay,
      _replayHttpStatus: lock.replayHttpStatus || 200,
    };
  }

  try {
    const result = await executeUpsert(body, correlationId);

    const storable = {
      action: result.action,
      data: result.data,
      ...(result.credentials ? { credentials: result.credentials } : {}),
      ...(result.signupLinkEmailSent ? { signupLinkEmailSent: result.signupLinkEmailSent } : {}),
      ...(result.credentialsEmailSent ? { credentialsEmailSent: result.credentialsEmailSent } : {}),
    };

    await finalizeIdempotency(idemKey, 'completed', {
      responsePayload: storable,
      completedAt: new Date(),
      httpStatus: result.action === 'created' ? 201 : 200,
      errorMessage: '',
    });

    return result;
  } catch (err) {
    await finalizeIdempotency(idemKey, 'failed', {
      errorMessage: String(err.message || err).slice(0, 500),
      responsePayload: null,
      completedAt: null,
      httpStatus: null,
    });
    throw err;
  }
}

module.exports = { upsertStudentFromCrm };
