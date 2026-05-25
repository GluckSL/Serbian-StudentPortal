/**
 * utils/setUserPassword.js
 *
 * Central helper that always performs two operations together when setting a password:
 *  1. bcrypt hash → user.password  (used for login authentication)
 *  2. AES-256-GCM ciphertext → user.passwordRecoverable  (ADMIN display only)
 *
 * Callers must still call user.save() themselves unless `save: true` option is passed,
 * so the function can be composed with other field mutations before a single save.
 */

const bcrypt = require('bcryptjs');
const { encryptPassword } = require('./passwordRecoverable');

/**
 * @param {object} user          - Mongoose User document
 * @param {string} plainPassword - Plaintext password to set
 * @param {object} [opts]
 * @param {boolean} [opts.save=false] - If true, calls user.save() before returning
 */
async function setUserPassword(user, plainPassword, opts = {}) {
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(plainPassword, salt);

  const encrypted = encryptPassword(plainPassword);
  if (encrypted !== null) {
    user.passwordRecoverable = encrypted;
  }

  if (opts.save) {
    await user.save();
  }
}

module.exports = { setUserPassword };
