'use strict';

/**
 * Default A2 rubric used when an A2 module has no rubric configured.
 * 15 points total: 5 pts per Teil.
 */
const DEFAULT_A2_RUBRIC = {
  teil1: {
    maxPoints: 5,
    criteria: [
      {
        id: 'a2t1_question',
        label: 'Forms a W-question',
        points: 2.5,
        prompt:
          'Did the student form a clear W-question (Wann, Wo, Was, etc.) in German based on the keyword card shown? ' +
          'Award 2.5 for a grammatically sound A2 question, 1.5 for understandable but imperfect, 0 for none.',
        turnType: 'a2t1_student_ask',
      },
      {
        id: 'a2t1_answer',
        label: 'Answers the partner\'s question',
        points: 2.5,
        prompt:
          'Did the student understand and answer the question from the bot? ' +
          'Award 2.5 for a clear, relevant A2-level German answer, 1.5 for partial, 0 for no response.',
        turnType: 'a2t1_student_answer',
      },
    ],
  },
  teil2: {
    maxPoints: 5,
    criteria: [
      {
        id: 'a2t2_topic',
        label: 'Addresses main topic',
        points: 2.5,
        prompt:
          'Did the student speak coherently about the main card topic in their monologue? ' +
          'Award 2.5 for coherent and topic-relevant speech, 1.5 for partial, 0 for off-topic or no speech.',
        turnType: 'a2t2_monologue',
      },
      {
        id: 'a2t2_subprompts',
        label: 'Covers sub-prompts',
        points: 2.5,
        prompt:
          'Did the student touch on at least 2 of the sub-prompt aspects shown? ' +
          'Award 2.5 for 3+ sub-prompts, 1.5 for 1-2, 0 for none.',
        turnType: 'a2t2_monologue',
      },
    ],
  },
  teil3: {
    maxPoints: 5,
    criteria: [
      {
        id: 'a2t3_propose',
        label: 'Proposes time slots',
        points: 2.5,
        prompt:
          'Did the student propose a specific time in German that fits their schedule? ' +
          'Award 2.5 for a clear time-specific proposal, 1.5 for vague, 0 for none.',
        turnType: 'a2t3_dialogue',
      },
      {
        id: 'a2t3_negotiate',
        label: 'Responds to conflicts and negotiates',
        points: 2.5,
        prompt:
          'Did the student respond to the bot\'s scheduling conflicts and continue negotiating? ' +
          'Award 2.5 for clear negotiation with resolution attempt, 1.5 for minimal response, 0 for none.',
        turnType: 'a2t3_dialogue',
      },
    ],
  },
};

module.exports = { DEFAULT_A2_RUBRIC };
