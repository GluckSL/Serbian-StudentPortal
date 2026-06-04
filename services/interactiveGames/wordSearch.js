// services/interactiveGames/wordSearch.js
// GlückArena: word search grid generation and question sanitization

const { germanUppercase } = require('../../utils/germanText');

const DEFAULT_SIZE = 11;
const MAX_SIZE = 15;
const MIN_SIZE = 8;

const DIRECTIONS = [
  [0, 1], [1, 0], [1, 1], [1, -1],
  [0, -1], [-1, 0], [-1, -1], [-1, 1],
];

const FILL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function normalizeSearchWord(raw) {
  return germanUppercase(String(raw || '')).replace(/[^A-ZÄÖÜß]/g, '');
}

function collectWords(question) {
  if (Array.isArray(question.searchWords) && question.searchWords.length) {
    return question.searchWords.map(normalizeSearchWord).filter(w => w.length >= 2);
  }
  const single = normalizeSearchWord(question.word);
  return single.length >= 2 ? [single] : [];
}

/** Simple LCG for reproducible grids per question id */
function createRng(seed) {
  let s = Math.abs(parseInt(String(seed).replace(/\D/g, '').slice(-9), 10) || 1) % 2147483646;
  if (s === 0) s = 1;
  return () => {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function pickGridSize(wordCount, longestWordLen) {
  const base = Math.max(DEFAULT_SIZE, Math.ceil(Math.sqrt(wordCount * 12)));
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, base, longestWordLen + 3));
}

function canPlace(grid, word, row, col, dr, dc) {
  const size = grid.length;
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    if (r < 0 || c < 0 || r >= size || c >= size) return false;
    const cell = grid[r][c];
    if (cell && cell !== word[i]) return false;
  }
  return true;
}

function placeWord(grid, word, row, col, dr, dc) {
  const cells = [];
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    grid[r][c] = word[i];
    cells.push({ row: r, col: c });
  }
  return cells;
}

function fillEmpty(grid, rng) {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (!grid[r][c]) {
        grid[r][c] = FILL_CHARS[Math.floor(rng() * FILL_CHARS.length)];
      }
    }
  }
}

/**
 * Build an 11×11 (or larger) letter grid with words placed in 8 directions.
 * @param {string[]} words
 * @param {string|number} seed
 */
function generatePuzzle(words, seed = '0') {
  const cleaned = [...new Set(words.map(normalizeSearchWord).filter(w => w.length >= 2))]
    .sort((a, b) => b.length - a.length);
  if (!cleaned.length) {
    return { gridSize: DEFAULT_SIZE, grid: [], placements: [] };
  }

  const rng = createRng(seed);
  const longest = Math.max(...cleaned.map(w => w.length));
  const size = pickGridSize(cleaned.length, longest);
  const grid = Array.from({ length: size }, () => Array(size).fill(''));
  const placements = [];

  for (let wi = 0; wi < cleaned.length; wi++) {
    const word = cleaned[wi];
    let placed = false;
    const attempts = size * size * 8 * 4;
    for (let a = 0; a < attempts && !placed; a++) {
      const dir = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)];
      const [dr, dc] = dir;
      const row = Math.floor(rng() * size);
      const col = Math.floor(rng() * size);
      if (!canPlace(grid, word, row, col, dr, dc)) continue;
      const cells = placeWord(grid, word, row, col, dr, dc);
      placements.push({ id: String(wi), cells });
      placed = true;
    }
    if (!placed) {
      throw new Error(`Could not place word "${word}" on the grid — try fewer or shorter words`);
    }
  }

  fillEmpty(grid, rng);

  return {
    gridSize: size,
    grid: grid.map(row => row.map(ch => ch || ' ')),
    placements,
    wordCount: cleaned.length,
  };
}

function attachPuzzle(question) {
  const words = collectWords(question);
  const seed = question._id ? String(question._id) : String(question.order ?? 0);
  const puzzle = generatePuzzle(words, seed);
  const { searchWords: _sw, word: _w, ...safe } = question;
  return {
    ...safe,
    gameType: 'word_search',
    gridSize: puzzle.gridSize,
    grid: puzzle.grid,
    placements: puzzle.placements,
    totalWords: puzzle.wordCount,
  };
}

function sanitizeQuestions(questions) {
  return (questions || []).map(q => attachPuzzle(q));
}

module.exports = {
  normalizeSearchWord,
  collectWords,
  generatePuzzle,
  attachPuzzle,
  sanitizeQuestions,
};
