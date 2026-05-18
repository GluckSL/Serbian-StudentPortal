import type { SprechenExamModuleSummary } from './sprechen-exam.types';

/** Default exam content for new modules (matches placeholder seed). */
export function defaultSprechenExamContent(): Pick<
  SprechenExamModuleSummary,
  'teil1' | 'teil2' | 'teil3' | 'rubric' | 'passThreshold' | 'level'
> {
  return {
    level: 'A1',
    passThreshold: 10,
    teil1: {
      keywords: ['Name', 'Alter', 'Land', 'Wohnort', 'Sprachen', 'Beruf', 'Hobby'],
      spellPrompts: [
        'Buchstabieren Sie bitte Ihren Nachnamen.',
        'Buchstabieren Sie bitte Ihren Vornamen.',
      ],
      numberPrompts: [
        'Nennen Sie mir bitte Ihre Telefonnummer.',
        'Nennen Sie mir bitte Ihre Postleitzahl.',
      ],
    },
    teil2: {
      themes: [
        { name: 'Essen und Trinken', studentKeyword: 'Frühstück', botKeyword: 'Lieblingsessen' },
        { name: 'Freizeit', studentKeyword: 'Sport', botKeyword: 'Wochenende' },
      ],
    },
    teil3: {
      rounds: [
        {
          studentCard: { label: 'Stift', objectDe: 'einen Stift', imageUrl: '' },
          botCard: { label: 'Wasser', objectDe: 'ein Glas Wasser', imageUrl: '' },
        },
        {
          studentCard: { label: 'Buch', objectDe: 'ein Buch', imageUrl: '' },
          botCard: { label: 'Stuhl', objectDe: 'einen Stuhl', imageUrl: '' },
        },
      ],
    },
    rubric: {
      teil1: {
        maxPoints: 3,
        criteria: [
          {
            id: 't1_content',
            label: 'Introduces all topics',
            points: 1,
            prompt:
              'Did the student address at least 5 of the 7 prompt topics in their self-introduction?',
            turnType: 'teil1_card',
          },
          {
            id: 't1_spell',
            label: 'Spells correctly',
            points: 1,
            prompt: 'Did the student spell a word letter-by-letter in German when asked?',
            turnType: 'teil1_spell',
          },
          {
            id: 't1_number',
            label: 'Produces number correctly',
            points: 1,
            prompt: 'Did the student say numbers in German when asked?',
            turnType: 'teil1_number',
          },
        ],
      },
      teil2: {
        maxPoints: 6,
        criteria: [
          {
            id: 't2_question',
            label: 'Forms a question',
            points: 1.5,
            prompt: 'Did the student form a clear A1 question using the keyword on the card?',
            turnType: 'teil2_student_ask',
          },
          {
            id: 't2_answer',
            label: 'Answers the question',
            points: 1.5,
            prompt: 'Did the student answer the bot question understandably in German?',
            turnType: 'teil2_student_answer',
          },
        ],
      },
      teil3: {
        maxPoints: 6,
        criteria: [
          {
            id: 't3_request',
            label: 'Makes polite request',
            points: 1.5,
            prompt: 'Did the student make a polite request related to the card?',
            turnType: 'teil3_student_request',
          },
          {
            id: 't3_response',
            label: 'Responds to request',
            points: 1.5,
            prompt: 'Did the student accept or decline the bot request with a short reason?',
            turnType: 'teil3_student_response',
          },
        ],
      },
    },
  };
}
