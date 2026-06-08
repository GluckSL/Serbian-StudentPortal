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
  const t = normalizeTrack(track);
  const base = { role: 'STUDENT', goStatus: 'GO', subscription: 'SILVER' };
  if (t === 'sinhala') {
    return {
      ...base,
      $or: [
        { goLanguage: 'Sinhala' },
        { goLanguage: { $exists: false }, medium: 'Sinhala' },
        { goLanguage: { $exists: false }, medium: { $in: ['Sinhala'] } }
      ]
    };
  }
  return {
    ...base,
    $or: [
      { goLanguage: 'Tamil' },
      {
        $and: [
          { $or: [{ goLanguage: { $exists: false } }, { goLanguage: null }] },
          { medium: { $nin: ['Sinhala'] } }
        ]
      }
    ]
  };
}

/** Silver students not yet in GO for this track (by medium / language). */
function silverPoolQuery(track) {
  const cfg = getTrackConfig(track);
  const base = {
    role: 'STUDENT',
    subscription: 'SILVER',
    $or: [{ goStatus: { $exists: false } }, { goStatus: { $ne: 'GO' } }]
  };
  if (normalizeTrack(track) === 'sinhala') {
    return { ...base, medium: { $in: [cfg.language] } };
  }
  return {
    ...base,
    $and: [
      {
        $or: [
          { medium: { $in: [cfg.language] } },
          { medium: { $size: 0 } },
          { medium: { $exists: false } }
        ]
      },
      { medium: { $nin: ['Sinhala'] } }
    ]
  };
}

function primaryGoBatchFromKeys(batchKeys) {
  const keys = batchKeys || [];
  if (keys.includes(GO_BATCH_SINHALA)) return GO_BATCH_SINHALA;
  if (keys.includes(GO_BATCH_TAMIL)) return GO_BATCH_TAMIL;
  return keys[0] || '';
}

/**
 * Batch keys for Silver GO class-recording completion (this student's class batch, else GO track).
 * Avoids requiring every GO-SINHALA / GO-SILVER-tagged upload when the student has a class batch.
 */
function silverGoRecordingBatchKeys(student) {
  const legacy = String(student?.batch || '').trim();
  const goBatch = goBatchForStudent(student);
  if (legacy) return [legacy];
  if (goBatch) return [goBatch];
  return [];
}

/** Mongoose .select() fields required to resolve Tamil vs Sinhala GO batch keys. */
const SILVER_GO_STUDENT_SELECT =
  'role batch goStatus subscription level currentCourseDay goLanguage medium pendingJourneyDayAdvance pendingJourneyDayAdvanceForDay';

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
  primaryGoBatchFromKeys,
  silverGoRecordingBatchKeys,
  SILVER_GO_STUDENT_SELECT
};
