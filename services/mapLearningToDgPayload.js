const DGCharacter = require('../models/DGCharacter');
const DGModule = require('../models/DGModule');

function uniqStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr || []) {
    const t = String(s || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function mergeRolePlayScenario(lm) {
  const c = lm.content || {};
  const rp = { ...(c.rolePlayScenario || {}) };
  const instr = (lm.aiTutorConfig && lm.aiTutorConfig.rolePlayInstructions) || {};

  const pick = (a, b) => {
    const x = a != null ? String(a).trim() : '';
    if (x) return x;
    const y = b != null ? String(b).trim() : '';
    return y || '';
  };

  return {
    situation: pick(rp.situation, ''),
    setting: pick(rp.setting, ''),
    studentRole: pick(rp.studentRole, instr.studentRole),
    aiRole: pick(rp.aiRole, instr.aiRole),
    objective: pick(rp.objective, ''),
    aiPersonality: pick(rp.aiPersonality, instr.aiPersonality),
    studentGuidance: pick(rp.studentGuidance, instr.studentGuidance),
    aiOpeningLines: uniqStrings([...(rp.aiOpeningLines || []), ...(instr.openingLines || [])]),
    suggestedStudentResponses: uniqStrings([
      ...(rp.suggestedStudentResponses || []),
      ...(instr.suggestedResponses || []),
    ]),
  };
}

function mapStudentVocab(entries) {
  return (entries || []).map((e) => ({
    word: e.word || '',
    translation: e.translation || '',
    category: e.category || '',
    usage: '',
  }));
}

function mapAiVocab(entries) {
  return (entries || []).map((e) => ({
    word: e.word || '',
    translation: e.translation || '',
    category: e.category || '',
    usage: e.usage || '',
  }));
}

function mapGrammar(entries) {
  return (entries || []).map((g) => ({
    structure: g.structure || '',
    examples: [...(g.examples || [])],
    level: g.level || '',
  }));
}

function mapConversationFlow(entries) {
  return (entries || []).map((f) => ({
    stage: f.stage || '',
    aiPrompts: [...(f.aiPrompts || [])],
    expectedResponses: [...(f.expectedResponses || [])],
    helpfulPhrases: [...(f.helpfulPhrases || [])],
  }));
}

function buildScenes(allowedVocabulary, rolePlayScenario) {
  const intro = {
    type: 'intro',
    text: "Hi! I'm your digital guide. Let's learn together.",
    audioUrl: '',
    expectedAnswer: '',
    translation: '',
    hint: '',
    order: 0,
  };

  if (allowedVocabulary.length > 0) {
    const generated = [intro];
    const teachWords = allowedVocabulary.slice(0, 8);
    for (const v of teachWords) {
      generated.push({
        type: 'teach',
        text: `${v.word} — ${v.translation || ''}`,
        audioUrl: '',
        expectedAnswer: '',
        translation: v.translation || '',
        hint: '',
        order: generated.length,
      });
    }
    const practiceWords = allowedVocabulary.slice(0, Math.min(4, allowedVocabulary.length));
    for (const v of practiceWords) {
      generated.push({
        type: 'practice',
        text: `Say: ${v.word}`,
        audioUrl: '',
        expectedAnswer: v.word,
        translation: v.translation || '',
        hint: v.word,
        order: generated.length,
      });
    }
    generated.push({
      type: 'feedback',
      text: "Great work! You have completed this lesson.",
      audioUrl: '',
      expectedAnswer: '',
      translation: '',
      hint: '',
      order: generated.length,
    });
    return generated;
  }

  const rp = rolePlayScenario || {};
  const firstLine =
    (rp.aiOpeningLines && rp.aiOpeningLines[0]) || rp.objective || rp.situation || '';
  const practicePhrase = String(firstLine || '').slice(0, 200);

  return [
    intro,
    {
      type: 'practice',
      text: practicePhrase
        ? `Respond with something like: ${practicePhrase}`
        : 'Practice speaking aloud with your tutor.',
      audioUrl: '',
      expectedAnswer: '',
      translation: '',
      hint: practicePhrase.slice(0, 120),
      order: 1,
    },
    {
      type: 'feedback',
      text: "Great work! You have completed this lesson.",
      audioUrl: '',
      expectedAnswer: '',
      translation: '',
      hint: '',
      order: 2,
    },
  ];
}

async function uniqueDgTitle(baseTitle) {
  let t = String(baseTitle || 'Untitled').trim() || 'Untitled';
  let suffix = '';
  for (let i = 0; i < 20; i++) {
    const candidate = t + suffix;
    const exists = await DGModule.exists({ title: candidate, isActive: true });
    if (!exists) return candidate;
    suffix = i === 0 ? ' (DG)' : ` (DG ${i + 1})`;
  }
  return `${t} (${Date.now()})`;
}

async function resolveDefaultCharacterId() {
  let ch = await DGCharacter.findOne({ isActive: true, isDefault: true }).select('_id').lean();
  if (ch) return ch._id;
  ch = await DGCharacter.findOne({ isActive: true }).sort({ name: 1 }).select('_id').lean();
  if (!ch) {
    throw new Error('No DG character configured. Create a character in DG Bot admin first.');
  }
  return ch._id;
}

/**
 * Build a DGModule-compatible plain payload (before normalizePracticeWindow / sortScenes).
 */
async function buildDgModulePayloadFromLearning(lm, characterId) {
  const c = lm.content || {};
  const rolePlayScenario = mergeRolePlayScenario(lm);
  const allowedVocabulary = mapStudentVocab(c.allowedVocabulary);
  const aiTutorVocabulary = mapAiVocab(
    (lm.aiTutorConfig && lm.aiTutorConfig.allowedVocabulary) || [],
  );

  let mct = Number(lm.minimumCompletionTime);
  if (!Number.isFinite(mct)) mct = 10;
  mct = Math.min(60, Math.max(5, mct));

  const minPracticeMinutes = Math.min(120, Math.max(5, mct));

  const title = await uniqueDgTitle(lm.title);

  let courseDay = lm.courseDay;
  if (courseDay != null) {
    const cd = Number(courseDay);
    courseDay = Number.isFinite(cd) && cd >= 1 && cd <= 200 ? cd : undefined;
  } else {
    courseDay = undefined;
  }

  return {
    title,
    description: lm.description != null ? String(lm.description) : '',
    characterId,
    language: lm.targetLanguage || 'German',
    nativeLanguage: lm.nativeLanguage || 'English',
    level: lm.level || 'A1',
    minimumCompletionTime: mct,
    minPracticeMinutes,
    maxPracticeMinutes: null,
    courseDay,
    visibleToStudents: false,
    isActive: true,
    rolePlayScenario,
    allowedVocabulary,
    aiTutorVocabulary,
    allowedGrammar: mapGrammar(c.allowedGrammar),
    conversationFlow: mapConversationFlow(c.conversationFlow),
    scenes: buildScenes(allowedVocabulary, rolePlayScenario),
  };
}

module.exports = {
  buildDgModulePayloadFromLearning,
  resolveDefaultCharacterId,
};
