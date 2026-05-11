// utils/attendanceDebug.js — optional verbose attendance logs (ATTENDANCE_DEBUG=true)

function attendanceDebugEnabled() {
  return String(process.env.ATTENDANCE_DEBUG || '').trim().toLowerCase() === 'true';
}

function attendanceDebug(...args) {
  if (attendanceDebugEnabled()) console.log(...args);
}

function attendanceWarn(...args) {
  if (attendanceDebugEnabled()) console.warn(...args);
}

module.exports = { attendanceDebug, attendanceWarn, attendanceDebugEnabled };
