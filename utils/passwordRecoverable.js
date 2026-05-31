/**
 * utils/passwordRecoverable.js
 *
 * AES-256-GCM encryption/decryption for storing a recoverable copy of plaintext
 * passwords exclusively for ADMIN display. Login authentication still uses bcrypt.
 *
 * Requires env var: PASSWORD_RECOVERABLE_KEY (exactly 32 bytes, hex-encoded = 64 hex chars)
 *
 * If the key is absent the module still loads but encrypt/decrypt will throw, which
 * causes setUserPassword to skip writing the recoverable field gracefully (non-fatal
 * in development; fatal fast-fail in production via the key presence check in app startup).
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function getKey() {
  const hex = process.env.PASSWORD_RECOVERABLE_KEY || '';
  if (!hex || hex.length !== 64) {
    return null;
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt plaintext password. Returns a single base64 string: iv:authTag:ciphertext
 * Returns null if the key is not configured (dev / no-op fallback).
 */
function encryptPassword(plain) {
  const key = getKey();
  if (!key) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a ciphertext produced by encryptPassword.
 * Returns the plaintext string, or null on any error (bad key, corrupt data, etc.).
 */
function decryptPassword(ciphertext) {
  if (!ciphertext) return null;
  const key = getKey();
  if (!key) return null;

  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, encB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const encBuf = Buffer.from(encB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encBuf), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Persist recoverable copy for ADMIN directory (encrypted when possible, else plain).
 * @param {string} plain
 * @returns {string|null}
 */
function storeRecoverablePassword(plain) {
  if (!plain || typeof plain !== 'string') return null;
  const trimmed = plain.trim();
  if (!trimmed) return null;
  const encrypted = encryptPassword(trimmed);
  return encrypted ?? trimmed;
}

/** Read stored recoverable value (AES or legacy plain text). */
function readRecoverablePassword(stored) {
  if (!stored || typeof stored !== 'string') return null;
  const decrypted = decryptPassword(stored);
  if (decrypted) return decrypted;
  if (!stored.includes(':') && stored.trim()) return stored.trim();
  return null;
}

module.exports = {
  encryptPassword,
  decryptPassword,
  storeRecoverablePassword,
  readRecoverablePassword,
};
