/**
 * Silver GO journey tracks: Tamil (GO-SILVER) and Sinhala (GO-SINHALA).
 */

const GO_BATCH_TAMIL = 'GO-SILVER';
const GO_BATCH_SINHALA = 'GO-SINHALA';

const TRACKS = {
  tamil: {
    language: 'Tamil',
    batchName: GO_BATCH_TAMIL,
    label: 'GO Students (Tamil)',
    shortLabel: 'Tamil'
  },
  sinhala: {
    language: 'Sinhala',
    batchName: GO_BATCH_SINHALA,
    label: 'GO Sinhala Students',
    shortLabel: 'Sinhala'
  }
};

function normalizeTrack(value) {
  const v = String(value || '').toLowerCase().trim();
  if (v === 'sinhala' || v === 'go-sinhala') return 'sinhala';
  return 'tamil';
}

function getTrackConfig(track) {
  return TRACKS[normalizeTrack(track)];
}

function goLanguageForStudent(student) {
  const explicit = String(student?.goLanguage || '').trim();
  if (explicit === 'Tamil' || explicit === 'Sinhala') return explicit;
  const medium = Array.isArray(student?.medium) ? student.medium : [];
  if (medium.some((m) => String(m).toLowerCase() === 'sinhala')) return 'Sinhala';
  if (medium.some((m) => String(m).toLowerCase() === 'tamil')) return 'Tamil';
  return 'Tamil';
}

function goBatchForStudent(student) {
  if (!student) return '';
  if (String(student.goStatus || '').toUpperCase() !== 'GO') return '';
  if (String(student.subscription || '').toUpperCase() !== 'SILVER') return '';
  const lang = goLanguageForStudent(student);
  return lang === 'Sinhala' ? GO_BATCH_SINHALA : GO_BATCH_TAMIL;
}

function isSilverGoStudent(student) {
  return (
    String(student?.goStatus || '').toUpperCase() === 'GO' &&
    String(student?.subscription || '').toUpperCase() === 'SILVER'
  );
}

/** Mongo filter for GO students on a track. */
function goStudentQuery(track) {
  const cfg = getTrackConfig(track);
  return {
    role: 'STUDENT',
    goStatus: 'GO',
    subscription: 'SILVER',
    $or: [
      { goLanguage: cfg.language },
      { goLanguage: { $exists: false }, medium: cfg.language },
      { goLanguage: { $exists: false }, medium: { $in: [cfg.language] } }
    ]
  };
}

/** Silver students not yet in GO for this track (by medium / language). */
function silverPoolQuery(track) {
  const cfg = getTrackConfig(track);
  return {
    role: 'STUDENT',
    subscription: 'SILVER',
    $or: [{ goStatus: { $exists: false } }, { goStatus: { $ne: 'GO' } }],
    medium: cfg.language
  };
}

function primaryGoBatchFromKeys(batchKeys) {
  const keys = batchKeys || [];
  if (keys.includes(GO_BATCH_SINHALA)) return GO_BATCH_SINHALA;
  if (keys.includes(GO_BATCH_TAMIL)) return GO_BATCH_TAMIL;
  return keys[0] || '';
}

module.exports = {
  GO_BATCH_TAMIL,
  GO_BATCH_SINHALA,
  TRACKS,
  normalizeTrack,
  getTrackConfig,
  goLanguageForStudent,
  goBatchForStudent,
  isSilverGoStudent,
  goStudentQuery,
  silverPoolQuery,
  primaryGoBatchFromKeys
};
