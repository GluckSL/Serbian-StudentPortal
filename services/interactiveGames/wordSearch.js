// services/interactiveGames/wordSearch.js
// GlückArena: word search grid generation and question sanitization

const { germanUppercase } = require('../../utils/germanText');

const DEFAULT_SIZE = 10;
const MAX_ROWS = 20;
const MAX_COLS = 20;
const MIN_ROWS = 4;
const MIN_COLS = 4;

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

function normalizeGridDimensions(gridRows, gridCols) {
  const rows = parseInt(gridRows, 10);
  const cols = parseInt(gridCols, 10);
  if (!Number.isFinite(rows) || !Number.isFinite(cols)) return null;
  if (rows < MIN_ROWS || rows > MAX_ROWS || cols < MIN_COLS || cols > MAX_COLS) {
    return null;
  }
  return { rows, cols };
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

function pickAutoGridSize(wordCount, longestWordLen) {
  const base = Math.max(DEFAULT_SIZE, Math.ceil(Math.sqrt(wordCount * 10)));
  const size = Math.min(MAX_ROWS, Math.max(MIN_ROWS, base, longestWordLen + 2));
  return { rows: size, cols: size };
}

function resolveGridDimensions(question, wordCount, longestWordLen) {
  const custom = normalizeGridDimensions(question?.gridRows, question?.gridCols);
  if (custom) return custom;
  return pickAutoGridSize(wordCount, longestWordLen);
}

function canPlace(grid, word, row, col, dr, dc) {
  const rows = grid.length;
  const cols = grid[0]?.length || 0;
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    if (r < 0 || c < 0 || r >= rows || c >= cols) return false;
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
 * Build a letter grid with words placed in 8 directions.
 * @param {string[]} words
 * @param {string|number} seed
 * @param {{ gridRows?: number, gridCols?: number }} [options]
 */
function generatePuzzle(words, seed = '0', options = {}) {
  const cleaned = [...new Set(words.map(normalizeSearchWord).filter(w => w.length >= 2))]
    .sort((a, b) => b.length - a.length);
  if (!cleaned.length) {
    return { gridRows: DEFAULT_SIZE, gridCols: DEFAULT_SIZE, gridSize: DEFAULT_SIZE, grid: [], placements: [] };
  }

  const rng = createRng(seed);
  const longest = Math.max(...cleaned.map(w => w.length));
  const { rows, cols } = resolveGridDimensions(options, cleaned.length, longest);
  const grid = Array.from({ length: rows }, () => Array(cols).fill(''));
  const placements = [];

  for (let wi = 0; wi < cleaned.length; wi++) {
    const word = cleaned[wi];
    let placed = false;
    const attempts = rows * cols * 8 * 4;
    for (let a = 0; a < attempts && !placed; a++) {
      const dir = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)];
      const [dr, dc] = dir;
      const row = Math.floor(rng() * rows);
      const col = Math.floor(rng() * cols);
      if (!canPlace(grid, word, row, col, dr, dc)) continue;
      const cells = placeWord(grid, word, row, col, dr, dc);
      placements.push({ id: String(wi), cells });
      placed = true;
    }
    if (!placed) {
      throw new Error(
        `Could not place word "${word}" on a ${rows}×${cols} grid — try fewer or shorter words, or use a larger grid`,
      );
    }
  }

  fillEmpty(grid, rng);

  return {
    gridRows: rows,
    gridCols: cols,
    gridSize: Math.max(rows, cols),
    grid: grid.map(row => row.map(ch => ch || ' ')),
    placements,
    wordCount: cleaned.length,
  };
}

function attachPuzzle(question) {
  const words = collectWords(question);
  const seed = question._id ? String(question._id) : String(question.order ?? 0);
  const puzzle = generatePuzzle(words, seed, {
    gridRows: question.gridRows,
    gridCols: question.gridCols,
  });
  const { searchWords: _sw, word: _w, ...safe } = question;
  return {
    ...safe,
    gameType: 'word_search',
    gridRows: puzzle.gridRows,
    gridCols: puzzle.gridCols,
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
  normalizeGridDimensions,
  generatePuzzle,
  attachPuzzle,
  sanitizeQuestions,
  MIN_ROWS,
  MIN_COLS,
  MAX_ROWS,
  MAX_COLS,
};
