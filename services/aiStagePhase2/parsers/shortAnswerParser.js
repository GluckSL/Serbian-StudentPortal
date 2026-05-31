function normalizeLines(blockText) {
  const lines = blockText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^Übung/i.test(line) &&
        !/^STUFE/i.test(line) &&
        !/^Seite/i.test(line) &&
        !/^Hinweis/i.test(line) &&
        !/^[-–—_=*•·.,;:()[\]{}|/\\\s]+$/.test(line)
    );

  const firstContentLine = lines.findIndex((line) => /^\d+[.)]/.test(line));
  return firstContentLine === -1 ? lines : lines.slice(firstContentLine);
}

function parseShortAnswer(blockText) {
  const lines = normalizeLines(blockText);
  const questions = [];

  for (const line of lines) {
    const m = line.match(/^\d+[.)]\s*(.+)$/);

    if (m) {
      questions.push({ question: m[1].trim() });
    }
  }

  return questions;
}

module.exports = { parseShortAnswer };
