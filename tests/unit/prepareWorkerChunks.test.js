'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config mock ──────────────────────────────────────────────────────────────
const TEST_DB_PATH = path.join(__dirname, '../../tmp/test-chunks.db');

jest.mock('../../src/config', () => {
  const p = require('path');
  return {
    ...jest.requireActual('../../src/config'),
    DB_PATH: p.join(__dirname, '../../tmp/test-chunks.db'),
    DB_ZIP_PATH: p.join(__dirname, '../../tmp/test-chunks.zip'),
    WORKER_COUNT: 4,
    MAX_URLS_PER_RUN: 100,
  };
});

const db = require('../../src/database/db');
const { prepareChunks, getUrlsToDistribute } = require('../../src/jobs/prepareWorkerChunks');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProduct(n) {
  return {
    url: `https://extremetechcr.com/producto/p${n}`,
    name: `Product ${n}`,
    sku: null, category: null, description: null, imageUrl: null,
    stockLocations: [], isAvailable: true,
  };
}

function seedProducts(count) {
  for (let i = 0; i < count; i++) db.upsertProduct(makeProduct(i));
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chunks-test-'));
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  db.closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

  // Clear env overrides before each test
  delete process.env.PRICE_UPDATE_URLS;
  delete process.env.INCLUDE_INACTIVE;
  delete process.env.CHUNKS_DIR;
});

afterEach(() => {
  db.closeDatabase();
  delete process.env.PRICE_UPDATE_URLS;
  delete process.env.INCLUDE_INACTIVE;
  delete process.env.CHUNKS_DIR;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('prepareWorkerChunks', () => {
  describe('prepareChunks — splitting', () => {
    test('creates exactly WORKER_COUNT chunk files', () => {
      seedProducts(10);
      const dir = tmpDir();
      prepareChunks(dir);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      expect(files.length).toBe(4);
    });

    test('each chunk file is a valid JSON array', () => {
      seedProducts(8);
      const dir = tmpDir();
      prepareChunks(dir);
      for (let i = 0; i < 4; i++) {
        const content = fs.readFileSync(path.join(dir, `chunk-${i}.json`), 'utf8');
        expect(() => JSON.parse(content)).not.toThrow();
        expect(Array.isArray(JSON.parse(content))).toBe(true);
      }
    });

    test('all URLs appear in exactly one chunk (no duplicates, no omissions)', () => {
      seedProducts(12);
      const dir = tmpDir();
      prepareChunks(dir);
      const all = [];
      for (let i = 0; i < 4; i++) {
        const chunk = JSON.parse(fs.readFileSync(path.join(dir, `chunk-${i}.json`), 'utf8'));
        all.push(...chunk);
      }
      const dbUrls = db.getStaleProductUrls(100);
      expect(all).toHaveLength(dbUrls.length);
      expect(new Set(all).size).toBe(dbUrls.length); // no duplicates
      dbUrls.forEach((u) => expect(all).toContain(u));
    });

    test('chunks are as even as possible (differ by at most 1)', () => {
      seedProducts(9); // 9 URLs across 4 workers → [3,2,2,2] or [3,3,2,1] etc.
      const dir = tmpDir();
      prepareChunks(dir);
      const sizes = [];
      for (let i = 0; i < 4; i++) {
        sizes.push(JSON.parse(fs.readFileSync(path.join(dir, `chunk-${i}.json`), 'utf8')).length);
      }
      const max = Math.max(...sizes);
      const min = Math.min(...sizes);
      expect(max - min).toBeLessThanOrEqual(1);
    });

    test('handles more URLs than WORKER_COUNT (12 → 4 chunks of 3)', () => {
      seedProducts(12);
      const dir = tmpDir();
      prepareChunks(dir);
      for (let i = 0; i < 4; i++) {
        const chunk = JSON.parse(fs.readFileSync(path.join(dir, `chunk-${i}.json`), 'utf8'));
        expect(chunk.length).toBe(3);
      }
    });
  });

  describe('prepareChunks — edge cases', () => {
    test('empty DB produces empty chunk files for all workers', () => {
      // No products seeded
      const dir = tmpDir();
      prepareChunks(dir);
      for (let i = 0; i < 4; i++) {
        const chunk = JSON.parse(fs.readFileSync(path.join(dir, `chunk-${i}.json`), 'utf8'));
        expect(chunk).toEqual([]);
      }
    });

    test('fewer URLs than workers leaves last chunks empty', () => {
      seedProducts(2); // Only 2 products, 4 workers
      const dir = tmpDir();
      prepareChunks(dir);
      const allChunks = [];
      for (let i = 0; i < 4; i++) {
        allChunks.push(JSON.parse(fs.readFileSync(path.join(dir, `chunk-${i}.json`), 'utf8')));
      }
      const total = allChunks.reduce((sum, c) => sum + c.length, 0);
      expect(total).toBe(2); // All URLs must appear somewhere
    });

    test('exactly WORKER_COUNT URLs → each chunk gets exactly one URL', () => {
      seedProducts(4);
      const dir = tmpDir();
      prepareChunks(dir);
      for (let i = 0; i < 4; i++) {
        const chunk = JSON.parse(fs.readFileSync(path.join(dir, `chunk-${i}.json`), 'utf8'));
        expect(chunk.length).toBe(1);
      }
    });

    test('creates output directory if it does not exist', () => {
      const dir = path.join(os.tmpdir(), `chunks-mkdir-${Date.now()}`);
      expect(fs.existsSync(dir)).toBe(false);
      prepareChunks(dir, []);
      expect(fs.existsSync(dir)).toBe(true);
    });

    test('accepts an explicit URL array without touching the DB', () => {
      // Do NOT seed DB — explicit array is used instead
      const urls = ['https://extremetechcr.com/producto/a', 'https://extremetechcr.com/producto/b'];
      const dir = tmpDir();
      const { chunks } = prepareChunks(dir, urls);
      const all = chunks.flat();
      expect(all).toContain('https://extremetechcr.com/producto/a');
      expect(all).toContain('https://extremetechcr.com/producto/b');
    });
  });

  describe('prepareChunks — PRICE_UPDATE_URLS override', () => {
    test('uses PRICE_UPDATE_URLS env var instead of DB when set', () => {
      seedProducts(10); // These should be ignored
      process.env.PRICE_UPDATE_URLS = 'https://extremetechcr.com/producto/override-1,https://extremetechcr.com/producto/override-2';
      const dir = tmpDir();
      prepareChunks(dir);
      const all = [];
      for (let i = 0; i < 4; i++) {
        all.push(...JSON.parse(fs.readFileSync(path.join(dir, `chunk-${i}.json`), 'utf8')));
      }
      expect(all).toContain('https://extremetechcr.com/producto/override-1');
      expect(all).toContain('https://extremetechcr.com/producto/override-2');
      expect(all.length).toBe(2); // Only the 2 override URLs, not the 10 DB ones
    });

    test('trims and filters blank entries from PRICE_UPDATE_URLS', () => {
      process.env.PRICE_UPDATE_URLS = ' https://extremetechcr.com/producto/a , , https://extremetechcr.com/producto/b ';
      const dir = tmpDir();
      prepareChunks(dir);
      const all = [];
      for (let i = 0; i < 4; i++) {
        all.push(...JSON.parse(fs.readFileSync(path.join(dir, `chunk-${i}.json`), 'utf8')));
      }
      expect(all.length).toBe(2);
      expect(all).toContain('https://extremetechcr.com/producto/a');
    });
  });

  describe('prepareChunks — INCLUDE_INACTIVE', () => {
    test('excludes inactive products when INCLUDE_INACTIVE is not set', () => {
      db.upsertProduct(makeProduct(0));
      db.upsertProduct(makeProduct(1));
      db.markProductInactive(`https://extremetechcr.com/producto/p1`);

      const dir = tmpDir();
      prepareChunks(dir);
      const all = [];
      for (let i = 0; i < 4; i++) {
        all.push(...JSON.parse(fs.readFileSync(path.join(dir, `chunk-${i}.json`), 'utf8')));
      }
      expect(all).toContain('https://extremetechcr.com/producto/p0');
      expect(all).not.toContain('https://extremetechcr.com/producto/p1');
    });

    test('includes inactive products when INCLUDE_INACTIVE=true', () => {
      db.upsertProduct(makeProduct(0));
      db.upsertProduct(makeProduct(1));
      db.markProductInactive('https://extremetechcr.com/producto/p1');

      process.env.INCLUDE_INACTIVE = 'true';
      const dir = tmpDir();
      prepareChunks(dir);
      const all = [];
      for (let i = 0; i < 4; i++) {
        all.push(...JSON.parse(fs.readFileSync(path.join(dir, `chunk-${i}.json`), 'utf8')));
      }
      expect(all).toContain('https://extremetechcr.com/producto/p0');
      expect(all).toContain('https://extremetechcr.com/producto/p1');
    });
  });

  describe('getUrlsToDistribute', () => {
    test('reads from DB when no env overrides', () => {
      seedProducts(5);
      const urls = getUrlsToDistribute();
      expect(urls.length).toBe(5);
    });

    test('returns PRICE_UPDATE_URLS when set', () => {
      seedProducts(5);
      process.env.PRICE_UPDATE_URLS = 'https://extremetechcr.com/producto/override';
      const urls = getUrlsToDistribute();
      expect(urls).toEqual(['https://extremetechcr.com/producto/override']);
    });

    test('returns empty array when DB is empty', () => {
      const urls = getUrlsToDistribute();
      expect(urls).toEqual([]);
    });
  });
});
