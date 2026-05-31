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

function parseMatching(blockText) {
  const lines = normalizeLines(blockText);
  const pairs = [];

  for (const line of lines) {
    let m = line.match(/^\d+[.)]\s*(.+?)\s*(?:→|->)\s*(.+)$/);
    if (m) {
      pairs.push({
        left: m[1].trim(),
        right: m[2].trim(),
      });
      continue;
    }

    m = line.match(/^\d+[.)]\s*(.+?)\s+[a-z][.)]\s*(.+)$/i);
    if (m) {
      pairs.push({
        left: m[1].trim(),
        right: m[2].trim(),
      });
      continue;
    }

    m = line.match(/^\d+[.)]\s*(.+?)\s{2,}(.+)$/);
    if (m) {
      pairs.push({
        left: m[1].trim(),
        right: m[2].trim(),
      });
      continue;
    }

    m = line.match(/^\d+[.)]\s*(.+?)\s+(.+)$/);
    if (m && m[2].split(" ").length <= 3) {
      pairs.push({ left: m[1].trim(), right: m[2].trim() });
    }
  }

  return pairs;
}

module.exports = { parseMatching };
