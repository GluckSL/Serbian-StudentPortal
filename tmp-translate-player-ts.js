/**
 * Translate student-facing English strings in digital-exercise-player.component.ts to sr-Latn.
 * Also adds displayTitle() using localizeDayInText.
 */
const fs = require('fs');
const path = require('path');
const tsPath = path.join(__dirname, 'src/app/components/digital-exercise-player/digital-exercise-player.component.ts');
let ts = fs.readFileSync(tsPath, 'utf8');

// Add import if missing
if (!ts.includes('localizeDayInText')) {
  ts = ts.replace(
    /from '\.\.\/\.\.\/utils\/digital-exercise-id\.util';/,
    `from '../../utils/digital-exercise-id.util';\nimport { localizeDayInText } from '../../utils/journey-day.util';`
  );
}

// Add displayTitle method near other public helpers — after getScoreMessage or before it
if (!ts.includes('displayTitle(')) {
  ts = ts.replace(
    /getScoreMessage\(score: number\): string \{/,
    `/** Localize Day/Trial labels in exercise titles for student display. */\n  displayTitle(title: string | null | undefined): string {\n    return localizeDayInText(title);\n  }\n\n  getScoreMessage(score: number): string {`
  );
}

const pairs = [
  // Confidence / silence
  ["'Almost there, try again for a perfect score.'", "'Skoro — pokušajte ponovo za savršen rezultat.'"],
  ["'We might have misheard you. Try speaking clearly.'", "'Možda smo vas pogrešno čuli. Govorite jasnije.'"],
  ["'Marked as correct. You can continue.'", "'Označeno kao tačno. Možete nastaviti.'"],
  ["'That was very quick — hold the button a little longer and speak clearly.'", "'To je bilo veoma brzo — držite dugme malo duže i govorite jasno.'"],
  ["'We couldn’t hear you — please speak a bit louder and try again.'", "'Nismo vas čuli — govorite malo glasnije i pokušajte ponovo.'"],
  ["'We couldn\\'t hear you — please speak a bit louder and try again.'", "'Nismo vas čuli — govorite malo glasnije i pokušajte ponovo.'"],
  ["'Great job!'", "'Odlično!'"],
  ["'Almost there — try once more'", "'Skoro — pokušajte još jednom'"],
  ['"Let\'s try again"', '"Pokušajmo ponovo"'],

  // Snackbars — Close -> Zatvori, OK -> U redu
  ["'Microphone access denied. Please allow microphone access.', 'Close'", "'Pristup mikrofonu je odbijen. Dozvolite pristup mikrofonu.', 'Zatvori'"],
  ["'This exercise is not available for your account.', 'OK'", "'Ova vežba nije dostupna za vaš nalog.', 'U redu'"],
  ["'Feedback audio could not be loaded.', 'Close'", "'Audio povratne informacije nije moguće učitati.', 'Zatvori'"],
  ["'Failed to submit.', 'Close'", "'Slanje nije uspelo.', 'Zatvori'"],
  ["'Failed to start exercise', 'Close'", "'Pokretanje vežbe nije uspelo', 'Zatvori'"],
  ["'Your answers were restored from this browser (kept for 30 minutes after your last change).'", "'Vaši odgovori su vraćeni iz ovog pregledača (čuvaju se 30 minuta nakon poslednje izmene).'"],
  ["'Saved answers were found but could not all be synced. Continue and submit as usual.'", "'Pronađeni su sačuvani odgovori, ali nisu svi mogli da se sinhronizuju. Nastavite i pošaljite kao obično.'"],
  ["'Audio recording is not supported in this browser. Try Chrome, Edge, or Safari 14.3+.', 'Close'", "'Snimanje audija nije podržano u ovom pregledaču. Probajte Chrome, Edge ili Safari 14.3+.', 'Zatvori'"],
  ["'Unsupported browser'", "'Nepodržan pregledač'"],
  ["'🎤 Listening…'", "'🎤 Slušanje…'"],
  ["'No microphone was detected on this device/browser.', 'Close'", "'Mikrofon nije pronađen na ovom uređaju/pregledaču.', 'Zatvori'"],
  ["'No speech detected, try again'", "'Govor nije detektovan, pokušajte ponovo'"],
  ["'No speech detected. Please try again.', 'Close'", "'Govor nije detektovan. Pokušajte ponovo.', 'Zatvori'"],
  ["'Text-to-speech is not supported in this browser.', 'Close'", "'Sinteza govora nije podržana u ovom pregledaču.', 'Zatvori'"],
  ["'Excellent pronunciation!'", "'Odličan izgovor!'"],
  ["'Good job! Almost perfect.'", "'Bravo! Skoro savršeno.'"],
  ["'Keep practicing.'", "'Nastavite da vežbate.'"],
  ["'Try again — listen to the correct pronunciation first.'", "'Pokušajte ponovo — prvo poslušajte tačan izgovor.'"],
  ["'Please answer the question before submitting.', 'Close'", "'Odgovorite na pitanje pre slanja.', 'Zatvori'"],
  ["'Failed to submit. Please try again.'", "'Slanje nije uspelo. Pokušajte ponovo.'"],
  ["'Correct answers: '", "'Tačni odgovori: '"],
  ["'Correct plurals: '", "'Tačne množine: '"],
  ["'Correct word: '", "'Tačna reč: '"],
  ['"Time\'s up — submitting your exercise.", \'Close\'', '"Vreme je isteklo — šaljemo vašu vežbu.", \'Zatvori\''],
  ["'Not answered'", "'Nije odgovoreno'"],
  ["'True/False'", "'Tačno / Netačno'"],
  ["return 'Questions'", "return 'Pitanja'"],
  ["'Outstanding! 🎉'", "'Izvanredno! 🎉'"],
  ["'Excellent work! ⭐'", "'Odličan rad! ⭐'"],
  ["'Great job! 👍'", "'Bravo! 👍'"],
  ["'Good effort! Keep going!'", "'Dobar trud! Nastavite!'"],
  ["'Keep practicing!'", "'Nastavite da vežbate!'"],
  ["'Don\\'t give up — try again!'", "'Ne odustajte — pokušajte ponovo!'"],
  ["'Play limit reached for this attempt.', 'Close'", "'Dostignuto je ograničenje reprodukcije za ovaj pokušaj.', 'Zatvori'"],
  ["'Could not play audio.', 'Close'", "'Audio nije moguće reprodukovati.', 'Zatvori'"],
  ["'Speech recognition not supported in this browser', 'Close'", "'Prepoznavanje govora nije podržano u ovom pregledaču', 'Zatvori'"],
  ["'Finish watching the clip first, then tap Speak.', 'Close'", "'Prvo završite gledanje klipa, zatim dodirnite Govori.', 'Zatvori'"],
  ["'Speech recognition not supported in this browser. Try Chrome or Edge.', 'Close'", "'Prepoznavanje govora nije podržano u ovom pregledaču. Probajte Chrome ili Edge.', 'Zatvori'"],
  ["'Microphone could not be started. Please try again.', 'Close'", "'Mikrofon nije moguće pokrenuti. Pokušajte ponovo.', 'Zatvori'"],
  ["'I could not hear your full sentence. Please tap Speak and try again.'", "'Nisam čuo celulu rečenicu. Dodirnite Govori i pokušajte ponovo.'"],
  ["'Great job!'", "'Odlično!'"],
  ["'Almost there — try once more for a perfect score!'", "'Skoro — pokušajte još jednom za savršen rezultat!'"],
  ["'Speak now'", "'Govorite sada'"],
  ["'Main question'", "'Glavno pitanje'"],
  ["`Sub-part Q ${qPart}`", "`Poddeo P ${qPart}`"],
  ["return `Q ${qPart}`", "return `P ${qPart}`"],
  ["'Click to Speak'", "'Kliknite da govorite'"],
  ["'Processing…'", "'Obrada…'"],
  ["'Microphone unavailable'", "'Mikrofon nedostupan'"],
  ["'Microphone could not be started. Please check your mic and try again.'", "'Mikrofon nije moguće pokrenuti. Proverite mikrofon i pokušajte ponovo.'"],
  ["'Recording failed, try again'", "'Snimanje nije uspelo, pokušajte ponovo'"],
  ["'Could not capture audio. Please try again.', 'Close'", "'Audio nije moguće snimiti. Pokušajte ponovo.', 'Zatvori'"],
  ["'No audio captured, try again'", "'Audio nije snimljen, pokušajte ponovo'"],
  ["'Network issue. Please try again.'", "'Problem sa mrežom. Pokušajte ponovo.'"],
  ["'Network issue — could not reach the server. Please try again.', 'Close'", "'Problem sa mrežom — server nije dostupan. Pokušajte ponovo.', 'Zatvori'"],
  ["'Could not reach the pronunciation grader. Please try again.', 'Close'", "'Ocena izgovora nije dostupna. Pokušajte ponovo.', 'Zatvori'"],
  ["'Scoring failed, try again'", "'Ocena nije uspela, pokušajte ponovo'"],
  ["'Try speaking a bit slower and more clearly.', 'Close'", "'Govorite malo sporije i jasnije.', 'Zatvori'"],
  ["'(no audio)'", "'(nema audija)'"],
  ["'Not quite'", "'Nije baš'"],
  ["'Network issue — please tap Speak once your connection is stable.'", "'Problem sa mrežom — dodirnite Govori kada veza bude stabilna.'"],
  ["'Sentence Transformation'", "'Transformacija rečenice'"],
  ["'Singular → Plural'", "'Jednina → Množina'"],
  ["'Table / Profile Fill-in'", "'Tabela / Popunjavanje profila'"],
  ["'Free Writing / Own Sentences'", "'Slobodno pisanje / Sopstvene rečenice'"],
  ["'Free Writing – profile'", "'Slobodno pisanje – profil'"],
  ["'Error Correction'", "'Ispravljanje grešaka'"],
  ["'this lesson'", "'ova lekcija'"],
  ["`The video clip says: \"${", "`Video klip kaže: \"${"],
  ["`Now it says: \"${", "`Sada kaže: \"${"],
  ["`Now your turn says: \"${", "`Sada je vaš red: \"${"],
  ["hasSubQuestions ? 'Main question'", "hasSubQuestions ? 'Glavno pitanje'"],
  ["`Q ${this.getQuestionPartLabel", "`P ${this.getQuestionPartLabel"],
];

// Handle dynamic template strings that need careful replacement
const dynamicPairs = [
  [
    'I could not hear enough input after ${DigitalExercisePlayerComponent.VP_MAX_FAILED_ATTEMPTS_PER_CLIP} tries. You can retry or move to the next clip.',
    'Nisam čuo dovoljno nakon ${DigitalExercisePlayerComponent.VP_MAX_FAILED_ATTEMPTS_PER_CLIP} pokušaja. Možete ponoviti ili preći na sledeći klip.'
  ],
  [
    'Not quite — target is ${passThreshold}%+. Choose retry or next clip.',
    'Nije baš — cilj je ${passThreshold}%+. Izaberite ponavljanje ili sledeći klip.'
  ],
  [
    '${headline} — target is ${threshold}%+. Choose retry or next clip.',
    '${headline} — cilj je ${threshold}%+. Izaberite ponavljanje ili sledeći klip.'
  ],
  [
    "Restored ${updated} media link(s) from cloud storage.",
    "Vraćeno ${updated} medijskih linkova iz cloud skladišta."
  ],
  [
    'Checked cloud storage; links already current.',
    'Cloud skladište provereno; linkovi su već ažurni.'
  ],
  [
    'No uploaded audio paths to recover in this exercise.',
    'Nema uploadovanih audio putanja za oporavak u ovoj vežbi.'
  ],
  [
    'No matching files found in cloud storage.',
    'Nisu pronađeni odgovarajući fajlovi u cloud skladištu.'
  ],
  [
    'Could not recover media.',
    'Mediji nisu mogli da se oporave.'
  ],
  [
    "This exercise is not unlocked on your current journey day yet.",
    "Ova vežba još nije otključana za vaš trenutni dan putovanja."
  ],
];

let total = 0;
const missed = [];
for (const [from, to] of [...pairs, ...dynamicPairs]) {
  const n = ts.split(from).length - 1;
  if (!n) missed.push(from.slice(0, 70));
  else {
    ts = ts.split(from).join(to);
    total += n;
    console.log(`OK x${n}: ${from.slice(0, 60)}`);
  }
}

fs.writeFileSync(tsPath, ts);
console.log('\nTotal TS replacements:', total);
console.log('Missed:', missed.length);
missed.slice(0, 40).forEach((m) => console.log('  MISS:', m));
