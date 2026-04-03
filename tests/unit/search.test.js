'use strict';

const {
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
} = require('../../public/search');

/* =========================================================
   Helper to build minimal product objects for score tests
   ========================================================= */
function makeProduct(overrides = {}) {
  return {
    id: 1,
    name: null,
    sku: null,
    category: null,
    description: null,
    url: null,
    ...overrides,
  };
}

/* =========================================================
   normalizeText
   ========================================================= */
describe('normalizeText', () => {
  test('converts uppercase to lowercase', () => {
    expect(normalizeText('DDR4')).toBe('ddr4');
  });

  test('removes acute accents (é, á, ó, ú, í)', () => {
    expect(normalizeText('Procesador')).toBe('procesador');
    expect(normalizeText('Gráfica')).toBe('grafica');
    expect(normalizeText('Memoría')).toBe('memoria');
    expect(normalizeText('Portátil')).toBe('portatil');
    expect(normalizeText('Ratón')).toBe('raton');
  });

  test('removes tilde on ñ — normalizes to n', () => {
    // ñ → n after NFD + diacritic strip
    expect(normalizeText('Año')).toBe('ano');
  });

  test('handles null input without throwing', () => {
    expect(normalizeText(null)).toBe('');
  });

  test('handles undefined input without throwing', () => {
    expect(normalizeText(undefined)).toBe('');
  });

  test('handles empty string', () => {
    expect(normalizeText('')).toBe('');
  });

  test('leaves already-lowercase ASCII untouched', () => {
    expect(normalizeText('ddr4 16gb')).toBe('ddr4 16gb');
  });
});

/* =========================================================
   tokenize
   ========================================================= */
describe('tokenize', () => {
  test('splits on spaces', () => {
    expect(tokenize('ddr4 16gb')).toEqual(['ddr4', '16gb']);
  });

  test('splits on hyphens', () => {
    expect(tokenize('DDR4-3200')).toEqual(['ddr4', '3200']);
  });

  test('splits on slashes', () => {
    expect(tokenize('SSD/NVMe')).toEqual(['ssd', 'nvme']);
  });

  test('splits on dots', () => {
    expect(tokenize('M.2 NVMe')).toEqual(['m', '2', 'nvme']);
  });

  test('splits on mixed delimiters', () => {
    expect(tokenize('Memoria RAM DDR4-3200 16GB')).toEqual(['memoria', 'ram', 'ddr4', '3200', '16gb']);
  });

  test('normalizes accents while tokenizing', () => {
    expect(tokenize('Ratón Inalámbrico')).toEqual(['raton', 'inalambrico']);
  });

  test('filters out empty tokens from consecutive delimiters', () => {
    expect(tokenize('a--b')).toEqual(['a', 'b']);
  });

  test('returns empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
  });

  test('returns empty array for null', () => {
    expect(tokenize(null)).toEqual([]);
  });
});

/* =========================================================
   levenshtein
   ========================================================= */
describe('levenshtein', () => {
  test('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  test('returns string length when other string is empty', () => {
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('', 'xyz')).toBe(3);
  });

  test('single substitution', () => {
    expect(levenshtein('kitten', 'sitten')).toBe(1);
  });

  test('single insertion', () => {
    expect(levenshtein('abc', 'abcd')).toBe(1);
  });

  test('single deletion', () => {
    expect(levenshtein('abcd', 'abc')).toBe(1);
  });

  test('classic kitten→sitting (distance 3)', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  test('typical typo: procesaor vs procesador (distance 1)', () => {
    expect(levenshtein('procesaor', 'procesador')).toBe(1);
  });
});

/* =========================================================
   tokenMatchScore
   ========================================================= */
describe('tokenMatchScore', () => {
  test('returns 2 for exact match', () => {
    expect(tokenMatchScore('ddr4', 'ddr4')).toBe(2);
  });

  test('returns 2 when query is a substring of data token', () => {
    expect(tokenMatchScore('ddr', 'ddr4')).toBe(2);
  });

  test('returns 1 for fuzzy match within edit distance 1 on long tokens', () => {
    // 'procesaor' vs 'procesador' — distance 1, both > FUZZY_MIN_TOKEN_LENGTH
    expect(tokenMatchScore('procesaor', 'procesador')).toBe(1);
  });

  test('returns 0 for no match', () => {
    expect(tokenMatchScore('gpu', 'memoria')).toBe(0);
  });

  test('does NOT apply fuzzy to short tokens (< FUZZY_MIN_TOKEN_LENGTH)', () => {
    // 'abcd' length 4 < FUZZY_MIN_TOKEN_LENGTH=5 — no fuzzy
    expect(tokenMatchScore('abce', 'abcd')).toBe(0);
  });

  test('does NOT apply fuzzy when edit distance > FUZZY_MAX_EDIT_DISTANCE', () => {
    // 'procesadora' vs 'procesador' — length diff 1, but edit distance 1 actually matches
    // Use something with distance 2
    expect(tokenMatchScore('procesadra', 'procesador')).toBe(0);
  });
});

/* =========================================================
   fieldTokenScore
   ========================================================= */
describe('fieldTokenScore', () => {
  test('returns best score across all data tokens', () => {
    expect(fieldTokenScore('ddr4', ['memoria', 'ram', 'ddr4', '16gb'])).toBe(2);
  });

  test('returns 0 when no data tokens match', () => {
    expect(fieldTokenScore('nvme', ['memoria', 'ram', 'ddr4'])).toBe(0);
  });

  test('returns fuzzy score when only fuzzy match exists', () => {
    expect(fieldTokenScore('memorja', ['memoria', 'ram'])).toBe(1);
  });
});

/* =========================================================
   expandToken (synonym expansion)
   ========================================================= */
describe('expandToken', () => {
  test('returns token + synonyms for known tokens', () => {
    expect(expandToken('ram')).toEqual(['ram', 'memoria']);
  });

  test('returns only the token itself for unknown tokens', () => {
    expect(expandToken('ddr4')).toEqual(['ddr4']);
  });

  test('synonym relationships are bidirectional: ram↔memoria', () => {
    expect(expandToken('memoria')).toContain('ram');
    expect(expandToken('ram')).toContain('memoria');
  });

  test('synonym relationships are bidirectional: cpu↔procesador', () => {
    expect(expandToken('cpu')).toContain('procesador');
    expect(expandToken('procesador')).toContain('cpu');
  });

  test('synonym relationships are bidirectional: ssd↔nvme', () => {
    expect(expandToken('ssd')).toContain('nvme');
    expect(expandToken('nvme')).toContain('ssd');
  });

  test('synonym relationships are bidirectional: monitor↔pantalla↔display', () => {
    expect(expandToken('monitor')).toContain('pantalla');
    expect(expandToken('monitor')).toContain('display');
    expect(expandToken('pantalla')).toContain('monitor');
    expect(expandToken('display')).toContain('monitor');
  });

  test('synonym relationships are bidirectional: teclado↔keyboard', () => {
    expect(expandToken('teclado')).toContain('keyboard');
    expect(expandToken('keyboard')).toContain('teclado');
  });

  test('synonym relationships are bidirectional: mouse↔raton', () => {
    expect(expandToken('mouse')).toContain('raton');
    expect(expandToken('raton')).toContain('mouse');
  });

  test('synonym relationships are bidirectional: laptop↔portatil↔notebook', () => {
    expect(expandToken('laptop')).toContain('portatil');
    expect(expandToken('portatil')).toContain('laptop');
    expect(expandToken('notebook')).toContain('laptop');
  });
});

/* =========================================================
   computeSearchScore — single-token basics
   ========================================================= */
describe('computeSearchScore — single token', () => {
  test('matches token in product name (highest weight field)', () => {
    const p = makeProduct({ name: 'Memoria RAM DDR4 16GB' });
    const score = computeSearchScore(p, ['ddr4']);
    expect(score).toBeGreaterThan(0);
  });

  test('returns 0 when token not found in any field', () => {
    const p = makeProduct({ name: 'Monitor 4K 27 pulgadas' });
    expect(computeSearchScore(p, ['ddr4'])).toBe(0);
  });

  test('empty query tokens returns 0', () => {
    const p = makeProduct({ name: 'Anything' });
    expect(computeSearchScore(p, [])).toBe(0);
  });

  test('handles product with all null fields gracefully', () => {
    const p = makeProduct();
    expect(computeSearchScore(p, ['ddr4'])).toBe(0);
  });
});

/* =========================================================
   computeSearchScore — AND logic (multi-token)
   ========================================================= */
describe('computeSearchScore — AND logic', () => {
  test('returns > 0 when ALL tokens match', () => {
    const p = makeProduct({ name: 'Memoria RAM DDR4 16GB' });
    const score = computeSearchScore(p, ['ddr4', '16gb']);
    expect(score).toBeGreaterThan(0);
  });

  test('returns 0 when at least ONE token does not match', () => {
    const p = makeProduct({ name: 'Memoria RAM DDR4 16GB' });
    expect(computeSearchScore(p, ['ddr4', 'nvme'])).toBe(0);
  });

  test('three tokens all matching is still > 0', () => {
    const p = makeProduct({ name: 'Memoria RAM DDR4-3200 16GB Kingston' });
    const score = computeSearchScore(p, ['ddr4', '16gb', 'kingston']);
    expect(score).toBeGreaterThan(0);
  });

  test('three tokens with one missing returns 0', () => {
    const p = makeProduct({ name: 'Memoria RAM DDR4-3200 16GB Kingston' });
    expect(computeSearchScore(p, ['ddr4', '16gb', 'corsair'])).toBe(0);
  });
});

/* =========================================================
   computeSearchScore — multi-field search
   ========================================================= */
describe('computeSearchScore — multi-field search', () => {
  test('matches token found only in SKU field', () => {
    const p = makeProduct({ name: 'Memoria RAM', sku: 'KVR32N22S8-16' });
    expect(computeSearchScore(p, ['kvr32n22s8'])).toBeGreaterThan(0);
  });

  test('matches token found only in category field', () => {
    const p = makeProduct({ name: 'Producto X', category: 'Almacenamiento > SSD' });
    expect(computeSearchScore(p, ['almacenamiento'])).toBeGreaterThan(0);
  });

  test('matches token found only in description field', () => {
    const p = makeProduct({ name: 'Monitor', description: 'Pantalla de alto contraste para gamers' });
    expect(computeSearchScore(p, ['gamers'])).toBeGreaterThan(0);
  });

  test('matches token found only in URL field', () => {
    const p = makeProduct({ url: 'https://extremetechcr.com/product/ssd-samsung-870-evo' });
    expect(computeSearchScore(p, ['samsung'])).toBeGreaterThan(0);
  });

  test('tokens can be split across different fields (each token matched in different field)', () => {
    const p = makeProduct({
      name: 'SSD Samsung',
      category: 'Almacenamiento',
      description: 'Alta velocidad NVMe',
    });
    // "samsung" in name, "nvme" in description
    expect(computeSearchScore(p, ['samsung', 'nvme'])).toBeGreaterThan(0);
  });
});

/* =========================================================
   computeSearchScore — scoring weights
   ========================================================= */
describe('computeSearchScore — scoring weights', () => {
  const nameWeight = SEARCH_FIELD_WEIGHTS.name;
  const descriptionWeight = SEARCH_FIELD_WEIGHTS.description;

  test('name field scores higher than description field for the same match', () => {
    const pNameMatch = makeProduct({ name: 'DDR4 Memory' });
    const pDescMatch = makeProduct({ description: 'DDR4 Memory' });
    const scoreInName = computeSearchScore(pNameMatch, ['ddr4']);
    const scoreInDesc = computeSearchScore(pDescMatch, ['ddr4']);
    expect(scoreInName).toBeGreaterThan(scoreInDesc);
  });

  test('name weight is higher than description weight in constants', () => {
    expect(nameWeight).toBeGreaterThan(descriptionWeight);
  });

  test('sku weight is higher than category weight', () => {
    expect(SEARCH_FIELD_WEIGHTS.sku).toBeGreaterThan(SEARCH_FIELD_WEIGHTS.category);
  });

  test('category weight is higher than description weight', () => {
    expect(SEARCH_FIELD_WEIGHTS.category).toBeGreaterThan(SEARCH_FIELD_WEIGHTS.description);
  });

  test('description weight is higher than url weight', () => {
    expect(SEARCH_FIELD_WEIGHTS.description).toBeGreaterThan(SEARCH_FIELD_WEIGHTS.url);
  });

  test('more tokens matched in name means higher total score', () => {
    const pFull = makeProduct({ name: 'Memoria RAM DDR4 16GB Kingston' });
    const pPartial = makeProduct({ name: 'Memoria RAM DDR4 8GB Kingston' });
    const scoreFullQuery = computeSearchScore(pFull, ['memoria', 'ram', 'ddr4', '16gb', 'kingston']);
    const scorePartial = computeSearchScore(pPartial, ['memoria', 'ram', 'ddr4', 'kingston']);
    // scoreFullQuery: 5 tokens matched; scorePartial: 4 tokens matched
    expect(scoreFullQuery).toBeGreaterThan(scorePartial);
  });
});

/* =========================================================
   computeSearchScore — accent/case normalization
   ========================================================= */
describe('computeSearchScore — accent and case normalization', () => {
  test('query with uppercase matches product with lowercase name', () => {
    const p = makeProduct({ name: 'memoria ram ddr4' });
    expect(computeSearchScore(p, tokenize('DDR4'))).toBeGreaterThan(0);
  });

  test('query with accented characters matches product without accents', () => {
    const p = makeProduct({ name: 'procesador ryzen' });
    expect(computeSearchScore(p, tokenize('Procesadór'))).toBeGreaterThan(0);
  });

  test('product name with accents matched by query without accents', () => {
    const p = makeProduct({ name: 'Gráfica Nvidia RTX 4060' });
    expect(computeSearchScore(p, tokenize('grafica nvidia'))).toBeGreaterThan(0);
  });

  test('mixed case query with hyphens matches hyphenated product name', () => {
    const p = makeProduct({ name: 'DDR4-3200 16GB' });
    expect(computeSearchScore(p, tokenize('ddr4 3200'))).toBeGreaterThan(0);
  });
});

/* =========================================================
   computeSearchScore — synonym expansion
   ========================================================= */
describe('computeSearchScore — synonym expansion', () => {
  test('searching "ram" matches product with "memoria" in name', () => {
    const p = makeProduct({ name: 'Memoria Kingston 16GB' });
    expect(computeSearchScore(p, tokenize('ram'))).toBeGreaterThan(0);
  });

  test('searching "memoria" matches product with "ram" in name', () => {
    const p = makeProduct({ name: 'RAM Corsair 32GB DDR4' });
    expect(computeSearchScore(p, tokenize('memoria'))).toBeGreaterThan(0);
  });

  test('searching "cpu" matches product with "procesador" in name', () => {
    const p = makeProduct({ name: 'Procesador AMD Ryzen 5600' });
    expect(computeSearchScore(p, tokenize('cpu'))).toBeGreaterThan(0);
  });

  test('searching "procesador" matches product with "cpu" in description', () => {
    const p = makeProduct({ description: 'CPU de alto rendimiento' });
    expect(computeSearchScore(p, tokenize('procesador'))).toBeGreaterThan(0);
  });

  test('searching "ssd" matches product with "nvme" in name', () => {
    const p = makeProduct({ name: 'NVMe Samsung 970 EVO 1TB' });
    expect(computeSearchScore(p, tokenize('ssd'))).toBeGreaterThan(0);
  });

  test('searching "nvme" matches product with "ssd" in name', () => {
    const p = makeProduct({ name: 'SSD Kingston 2TB' });
    expect(computeSearchScore(p, tokenize('nvme'))).toBeGreaterThan(0);
  });

  test('searching "monitor" matches product with "pantalla" in category', () => {
    const p = makeProduct({ category: 'Pantallas y Displays' });
    expect(computeSearchScore(p, tokenize('monitor'))).toBeGreaterThan(0);
  });

  test('searching "keyboard" matches product with "teclado" in name', () => {
    const p = makeProduct({ name: 'Teclado Mecánico Logitech' });
    expect(computeSearchScore(p, tokenize('keyboard'))).toBeGreaterThan(0);
  });

  test('searching "raton" matches product with "mouse" in name', () => {
    const p = makeProduct({ name: 'Mouse Razer Gaming' });
    expect(computeSearchScore(p, tokenize('raton'))).toBeGreaterThan(0);
  });

  test('searching "laptop" matches product with "portatil" in name', () => {
    const p = makeProduct({ name: 'Portátil HP 15 pulgadas' });
    expect(computeSearchScore(p, tokenize('laptop'))).toBeGreaterThan(0);
  });
});

/* =========================================================
   computeSearchScore — fuzzy matching
   ========================================================= */
describe('computeSearchScore — fuzzy matching', () => {
  test('tolerates single character typo in a long token', () => {
    // "procesaor" is a typo for "procesador" — distance 1
    const p = makeProduct({ name: 'Procesador AMD Ryzen' });
    expect(computeSearchScore(p, ['procesaor'])).toBeGreaterThan(0);
  });

  test('does NOT match with typo in a short token (< FUZZY_MIN_TOKEN_LENGTH)', () => {
    // Tokens must be >= FUZZY_MIN_TOKEN_LENGTH (5) chars to get fuzzy matching.
    // "abce" (4 chars) vs "abcd" (4 chars): no exact/substring match and fuzzy is disabled.
    const p = makeProduct({ name: 'abcd' });
    expect(computeSearchScore(p, ['abce'])).toBe(0);
  });

  test('does NOT apply fuzzy when edit distance is 2', () => {
    // "procesadora" → 'procesador' (edit 1 — still matches? Let's use "procesadra" distance 2
    const p = makeProduct({ name: 'Procesador Intel' });
    // "procesadra" vs "procesador" — one transpose + delete = distance > 1
    expect(computeSearchScore(p, ['procesadra'])).toBe(0);
  });
});

/* =========================================================
   computeSearchScore — real-world search queries
   ========================================================= */
describe('computeSearchScore — real-world queries', () => {
  const memoriaProduct = makeProduct({
    name: 'Memoria RAM DDR4-3200 16GB Kingston HyperX',
    sku: 'HX432C16FB3/16',
    category: 'Memorias RAM',
    description: 'Módulo de memoria DDR4 3200MHz 16GB para PC escritorio',
  });

  const ssdProduct = makeProduct({
    name: 'SSD Samsung 870 EVO 1TB SATA',
    sku: 'MZ-77E1T0B',
    category: 'Almacenamiento > SSD',
    description: 'Disco de estado sólido SATA 2.5 pulgadas 550MB/s',
  });

  const ryzenProduct = makeProduct({
    name: 'Procesador AMD Ryzen 5 5600X',
    sku: '100-100000065BOX',
    category: 'Procesadores',
    description: 'CPU AM4 6 núcleos 12 hilos 3.7GHz base 4.6GHz boost',
  });

  test('"ddr4 16gb" matches DDR4 16GB memory product', () => {
    expect(computeSearchScore(memoriaProduct, tokenize('ddr4 16gb'))).toBeGreaterThan(0);
  });

  test('"ddr4 32gb" does NOT match 16GB memory product', () => {
    expect(computeSearchScore(memoriaProduct, tokenize('ddr4 32gb'))).toBe(0);
  });

  test('"ram ddr4" matches via synonym: "memoria" → "ram"', () => {
    // tokenize("ram ddr4") → ["ram","ddr4"]
    // "ram" expands to include "memoria" which is in name + category
    expect(computeSearchScore(memoriaProduct, tokenize('ram ddr4'))).toBeGreaterThan(0);
  });

  test('"ssd samsung 1tb" matches the Samsung SSD product', () => {
    expect(computeSearchScore(ssdProduct, tokenize('ssd samsung 1tb'))).toBeGreaterThan(0);
  });

  test('"ssd samsung 2tb" does NOT match the 1TB Samsung SSD', () => {
    expect(computeSearchScore(ssdProduct, tokenize('ssd samsung 2tb'))).toBe(0);
  });

  test('"ryzen 5600" matches the Ryzen 5600X CPU product', () => {
    expect(computeSearchScore(ryzenProduct, tokenize('ryzen 5600'))).toBeGreaterThan(0);
  });

  test('"procesador ryzen" matches via direct name match', () => {
    expect(computeSearchScore(ryzenProduct, tokenize('procesador ryzen'))).toBeGreaterThan(0);
  });

  test('"cpu ryzen" matches via cpu→procesador synonym', () => {
    expect(computeSearchScore(ryzenProduct, tokenize('cpu ryzen'))).toBeGreaterThan(0);
  });

  test('DDR4 memory scores higher than SSD when searching "ddr4"', () => {
    const scoreMemoria = computeSearchScore(memoriaProduct, tokenize('ddr4'));
    const scoreSSD = computeSearchScore(ssdProduct, tokenize('ddr4'));
    expect(scoreMemoria).toBeGreaterThan(scoreSSD);
  });

  test('product with match in name ranks higher than product with match only in description', () => {
    const pNameMatch = makeProduct({ name: 'Teclado Mecánico RGB' });
    const pDescMatch = makeProduct({ name: 'Accesorio PC', description: 'Incluye teclado mecánico' });
    const scoreInName = computeSearchScore(pNameMatch, tokenize('teclado'));
    const scoreInDesc = computeSearchScore(pDescMatch, tokenize('teclado'));
    expect(scoreInName).toBeGreaterThan(scoreInDesc);
  });
});
