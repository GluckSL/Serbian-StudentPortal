const chatBuffers = new Map();

const MAX_MESSAGES = 100;
const RATE_LIMIT_WINDOW_MS = 10000;
const RATE_LIMIT_MAX = 5;
const MAX_MESSAGE_LENGTH = 500;

const userMessageTimestamps = new Map();

function getBuffer(roomCode) {
  if (!chatBuffers.has(roomCode)) {
    chatBuffers.set(roomCode, []);
  }
  return chatBuffers.get(roomCode);
}

function addMessage(roomCode, userId, userName, message, isSystem = false) {
  const buf = getBuffer(roomCode);
  const msg = {
    userId,
    userName,
    message: String(message).slice(0, MAX_MESSAGE_LENGTH),
    timestamp: Date.now(),
    isSystem,
  };
  buf.push(msg);
  if (buf.length > MAX_MESSAGES) buf.shift();
  return msg;
}

function getHistory(roomCode, limit = 50) {
  const buf = getBuffer(roomCode);
  return buf.slice(-limit);
}

function checkRateLimit(userId) {
  const now = Date.now();
  const timestamps = userMessageTimestamps.get(userId) || [];
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  userMessageTimestamps.set(userId, recent);
  return true;
}

function cleanupBuffer(roomCode) {
  chatBuffers.delete(roomCode);
}

function validateMessage(message) {
  if (!message || typeof message !== 'string') return false;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) return false;
  return true;
}

module.exports = {
  addMessage,
  getHistory,
  checkRateLimit,
  cleanupBuffer,
  validateMessage,
};
