'use strict';

/* =========================================================
   SEARCH HELPERS
   Pure functions with no DOM dependencies.
   Loaded as a plain <script> in the browser (globals) and
   required via module.exports in Node.js tests.
   ========================================================= */

/**
 * Lowercases a string and strips diacritical marks (accents).
 * @param {string} str
 * @returns {string}
 */
function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Splits a normalized string into tokens on whitespace, hyphens, slashes, and dots.
 * @param {string} str
 * @returns {string[]}
 */
function tokenize(str) {
  return normalizeText(str)
    .split(/[\s\-/.]+/)
    .filter((t) => t.length > 0);
}

/**
 * Computes the Levenshtein edit distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/** Minimum token length required to apply fuzzy (Levenshtein) matching. */
const FUZZY_MIN_TOKEN_LENGTH = 5;

/** Maximum allowed edit distance when fuzzy-matching two tokens. */
const FUZZY_MAX_EDIT_DISTANCE = 1;

/**
 * Scores a query token against a single data token.
 * Returns 2 for exact/substring match, 1 for fuzzy match (edit distance ≤ FUZZY_MAX_EDIT_DISTANCE
 * on tokens longer than FUZZY_MIN_TOKEN_LENGTH chars), 0 otherwise.
 * @param {string} queryToken
 * @param {string} dataToken
 * @returns {number}
 */
function tokenMatchScore(queryToken, dataToken) {
  if (queryToken === dataToken) return 2;
  if (dataToken.includes(queryToken)) return 2;
  if (
    queryToken.length >= FUZZY_MIN_TOKEN_LENGTH &&
    Math.abs(queryToken.length - dataToken.length) <= FUZZY_MAX_EDIT_DISTANCE
  ) {
    if (levenshtein(queryToken, dataToken) <= FUZZY_MAX_EDIT_DISTANCE) return 1;
  }
  return 0;
}

/**
 * Returns the best match score of a query token against all tokens of a field.
 * @param {string} queryToken
 * @param {string[]} dataTokens
 * @returns {number}
 */
function fieldTokenScore(queryToken, dataTokens) {
  let best = 0;
  for (const dt of dataTokens) {
    const s = tokenMatchScore(queryToken, dt);
    if (s > best) best = s;
    if (best === 2) break; // can't do better
  }
  return best;
}

/**
 * Synonym dictionary: maps a normalized token to a list of related tokens.
 * Expands the search so e.g. "ram" also matches products mentioning "memoria".
 */
const SYNONYMS = {
  ram: ['memoria'],
  memoria: ['ram'],
  ssd: ['solido', 'solid', 'nvme'],
  nvme: ['ssd', 'm2'],
  hdd: ['disco', 'duro'],
  disco: ['hdd'],
  gpu: ['grafica', 'video', 'tarjeta'],
  cpu: ['procesador'],
  procesador: ['cpu'],
  monitor: ['pantalla', 'display'],
  pantalla: ['monitor', 'display'],
  display: ['monitor', 'pantalla'],
  teclado: ['keyboard'],
  keyboard: ['teclado'],
  mouse: ['raton'],
  raton: ['mouse'],
  laptop: ['portatil', 'notebook'],
  portatil: ['laptop', 'notebook'],
  notebook: ['laptop', 'portatil'],
};

/**
 * Returns all tokens to try for a given query token (original + synonyms).
 * @param {string} token
 * @returns {string[]}
 */
function expandToken(token) {
  const extras = SYNONYMS[token] || [];
  return [token, ...extras];
}

/** Field weights used when scoring a product against search tokens. */
const SEARCH_FIELD_WEIGHTS = { name: 10, sku: 8, category: 5, description: 3, url: 2 };

/**
 * Computes a relevance score for a product against an array of query tokens.
 * Implements AND logic: if ANY token finds no match in ANY field, returns 0 (product excluded).
 * Supports multi-field search, synonym expansion, and fuzzy matching.
 * @param {Object} product
 * @param {string[]} queryTokens - Already normalized & tokenized query.
 * @returns {number} Score ≥ 0; 0 means no match.
 */
function computeSearchScore(product, queryTokens) {
  const fields = {
    name: tokenize(product.name),
    sku: tokenize(product.sku),
    category: tokenize(product.category),
    description: tokenize(product.description),
    url: tokenize(product.url),
  };

  let totalScore = 0;

  for (const qToken of queryTokens) {
    const candidates = expandToken(qToken);
    let tokenBestScore = 0;

    for (const candidate of candidates) {
      for (const [field, weight] of Object.entries(SEARCH_FIELD_WEIGHTS)) {
        const matchScore = fieldTokenScore(candidate, fields[field]);
        if (matchScore > 0) {
          const weighted = matchScore * weight;
          if (weighted > tokenBestScore) tokenBestScore = weighted;
        }
      }
    }

    // AND logic: every query token must match somewhere
    if (tokenBestScore === 0) return 0;
    totalScore += tokenBestScore;
  }

  return totalScore;
}

// Allow requiring in Node.js (e.g. for unit tests) while still working as a
// plain browser <script> where `module` is not defined.
if (typeof module !== 'undefined') {
  module.exports = {
    normalizeText,
    tokenize,
    levenshtein,
    tokenMatchScore,
    fieldTokenScore,
    expandToken,
    computeSearchScore,
    SYNONYMS,
    SEARCH_FIELD_WEIGHTS,
    FUZZY_MIN_TOKEN_LENGTH,
    FUZZY_MAX_EDIT_DISTANCE,
  };
}
