'use strict';

/**
 * Default A2 rubric using the 5-level A-E rating scale.
 * 23 points total.
 *
 * Per Teil:
 *   Aufgabenerfüllung (Task Fulfillment): A=4, B=3, C=2, D=1, E=0
 *   Sprache (Language):                 A=2, B=1.5, C=1, D=0.5, E=0
 *
 * Global:
 *   Aussprache (Pronunciation):         A=5, B=3.5, C=2, D=1, E=0
 */
const DEFAULT_A2_RUBRIC = {
  teil1: {
    maxPoints: 6,
    criteria: [
      {
        id: 'a2t1_aufgabe',
        label: 'Task Fulfillment (Part 1)',
        points: 4,
        levelMap: { A: 4, B: 3, C: 2, D: 1, E: 0 },
        prompt:
          'Rate the student\'s task fulfillment for asking and answering questions using the A-E scale:\n' +
          'A (4pt): Fully appropriate — asks and answers naturally, all required elements covered, errors do not impair understanding.\n' +
          'B (3pt): Predominantly appropriate — minor issues or gaps, but overall task is accomplished.\n' +
          'C (2pt): Partially appropriate — only some required elements addressed, errors partially impair understanding.\n' +
          'D (1pt): Barely appropriate — limited interaction, major gaps, errors considerably impair understanding.\n' +
          'E (0pt): Task not fulfilled — unintelligible, no response, or completely off-topic.',
        turnType: 'a2t1_student_ask|a2t1_student_answer',
        scoringMode: 'a2_level',
        isAufgabe: true,
      },
      {
        id: 'a2t1_sprache',
        label: 'Language (Part 1)',
        points: 2,
        levelMap: { A: 2, B: 1.5, C: 1, D: 0.5, E: 0 },
        prompt:
          'Rate the student\'s language quality (vocabulary range, grammatical accuracy) in Part 1 using the A-E scale:\n' +
          'A (2pt): Appropriate vocabulary and grammar for A2; errors do not impair understanding.\n' +
          'B (1.5pt): Predominantly appropriate; minor vocabulary/grammar issues do not impair understanding.\n' +
          'C (1pt): Partially appropriate; limited vocabulary or frequent grammar errors partially impair understanding.\n' +
          'D (0.5pt): Barely appropriate; very limited vocabulary and/or severe grammar errors considerably impair understanding.\n' +
          'E (0pt): Language insufficient to assess — unintelligible or no response.',
        turnType: 'a2t1_student_ask|a2t1_student_answer',
        scoringMode: 'a2_level',
        isAufgabe: false,
      },
    ],
  },
  teil2: {
    maxPoints: 6,
    criteria: [
      {
        id: 'a2t2_aufgabe',
        label: 'Task Fulfillment (Part 2)',
        points: 4,
        levelMap: { A: 4, B: 3, C: 2, D: 1, E: 0 },
        prompt:
          'Rate the student\'s monologue task fulfillment using the A-E scale:\n' +
          'A (4pt): Fully appropriate — coherent monologue on the topic, all sub-prompts addressed, natural flow.\n' +
          'B (3pt): Predominantly appropriate — addresses the topic, covers most sub-prompts, minor gaps.\n' +
          'C (2pt): Partially appropriate — touches on topic but limited coverage of sub-prompts, some coherence issues.\n' +
          'D (1pt): Barely appropriate — mostly off-topic or very fragmented, minimal sub-prompt coverage.\n' +
          'E (0pt): Task not fulfilled — silent, unintelligible, or completely unrelated.',
        turnType: 'a2t2_monologue',
        scoringMode: 'a2_level',
        isAufgabe: true,
      },
      {
        id: 'a2t2_sprache',
        label: 'Language (Part 2)',
        points: 2,
        levelMap: { A: 2, B: 1.5, C: 1, D: 0.5, E: 0 },
        prompt:
          'Rate the student\'s language quality (vocabulary, grammar, coherence) in the monologue using the A-E scale:\n' +
          'A (2pt): Appropriate vocabulary and grammar for A2; errors do not impair understanding.\n' +
          'B (1.5pt): Predominantly appropriate; minor issues do not impair understanding.\n' +
          'C (1pt): Partially appropriate; limited range or frequent errors partially impair understanding.\n' +
          'D (0.5pt): Barely appropriate; very limited range or severe errors considerably impair understanding.\n' +
          'E (0pt): Language insufficient to assess — unintelligible or no response.',
        turnType: 'a2t2_monologue',
        scoringMode: 'a2_level',
        isAufgabe: false,
      },
    ],
  },
  teil3: {
    maxPoints: 6,
    criteria: [
      {
        id: 'a2t3_aufgabe',
        label: 'Task Fulfillment (Part 3)',
        points: 4,
        levelMap: { A: 4, B: 3, C: 2, D: 1, E: 0 },
        prompt:
          'Rate the student\'s scheduling dialogue task fulfillment using the A-E scale:\n' +
          'A (4pt): Fully appropriate — proposes times, responds to conflicts, negotiates to a resolution.\n' +
          'B (3pt): Predominantly appropriate — makes proposals and responds, but negotiation is brief.\n' +
          'C (2pt): Partially appropriate — limited proposals or responses, interaction one-sided.\n' +
          'D (1pt): Barely appropriate — minimal participation, does not engage in negotiation.\n' +
          'E (0pt): Task not fulfilled — no response or completely off-topic.',
        turnType: 'a2t3_dialogue',
        scoringMode: 'a2_level',
        isAufgabe: true,
      },
      {
        id: 'a2t3_sprache',
        label: 'Language (Part 3)',
        points: 2,
        levelMap: { A: 2, B: 1.5, C: 1, D: 0.5, E: 0 },
        prompt:
          'Rate the student\'s language quality in the scheduling dialogue using the A-E scale:\n' +
          'A (2pt): Appropriate vocabulary and grammar for A2; errors do not impair understanding.\n' +
          'B (1.5pt): Predominantly appropriate; minor issues do not impair understanding.\n' +
          'C (1pt): Partially appropriate; limited range or frequent errors partially impair understanding.\n' +
          'D (0.5pt): Barely appropriate; very limited range or severe errors considerably impair understanding.\n' +
          'E (0pt): Language insufficient to assess — unintelligible or no response.',
        turnType: 'a2t3_dialogue',
        scoringMode: 'a2_level',
        isAufgabe: false,
      },
    ],
  },
  global: {
    maxPoints: 5,
    criteria: [
      {
        id: 'a2_pronunciation',
        label: 'Pronunciation (Global)',
        points: 5,
        levelMap: { A: 5, B: 3.5, C: 2, D: 1, E: 0 },
        prompt:
          'Rate the student\'s overall pronunciation (intonation, word stress, individual sounds) across the entire exam using the A-E scale:\n' +
          'A (5pt): Clear and natural intonation and stress; errors do not impair understanding.\n' +
          'B (3.5pt): Predominantly clear; minor intonation/stress issues do not impair understanding.\n' +
          'C (2pt): Partially clear; intonation/stress issues partially impair understanding.\n' +
          'D (1pt): Often unclear; intonation/stress issues considerably impair understanding.\n' +
          'E (0pt): Unintelligible — pronunciation makes comprehension impossible.',
        turnType: 'global',
        scoringMode: 'a2_level',
        isAufgabe: false,
        evaluatedAtEnd: true,
      },
    ],
  },
};

module.exports = { DEFAULT_A2_RUBRIC };
