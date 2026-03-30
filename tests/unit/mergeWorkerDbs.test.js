'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

// ── Config mock ──────────────────────────────────────────────────────────────
const TEST_DB_PATH = path.join(__dirname, '../../tmp/test-merge-main.db');
const TEST_DB_ZIP_PATH = path.join(__dirname, '../../tmp/test-merge.zip');

jest.mock('../../src/config', () => {
  const p = require('path');
  return {
    ...jest.requireActual('../../src/config'),
    DB_PATH: p.join(__dirname, '../../tmp/test-merge-main.db'),
    DB_ZIP_PATH: p.join(__dirname, '../../tmp/test-merge.zip'),
    WORKER_COUNT: 4,
  };
});

const db = require('../../src/database/db');
const { mergeFromWorkerDb, runMerge } = require('../../src/jobs/mergeWorkerDbs');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a fresh copy of the main DB file at destPath.
 * Performs a full WAL checkpoint first to flush all data into the main file,
 * then copies the file synchronously.
 */
function cloneMainDbToFile(destPath) {
  const mainDb = db.openDatabase();
  mainDb.pragma('wal_checkpoint(FULL)');
  fs.copyFileSync(TEST_DB_PATH, destPath);
}

function tmpWorkerPath() {
  return path.join(os.tmpdir(), `worker-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function tmpWorkersDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'merge-workers-'));
}

function makeProduct(n, extra = {}) {
  return {
    url: `https://extremetechcr.com/producto/p${n}`,
    name: `Product ${n}`,
    sku: `SKU-${n}`,
    category: 'Laptops',
    description: null,
    imageUrl: null,
    stockLocations: [],
    isAvailable: true,
    ...extra,
  };
}

/**
 * Opens a worker DB at workerDbPath, calls the callback with it, then closes.
 * The callback receives the Database instance and the product row matching url.
 */
function withWorkerDb(workerDbPath, fn) {
  const wDb = new Database(workerDbPath);
  wDb.pragma('journal_mode = WAL');
  wDb.pragma('foreign_keys = ON');
  try {
    fn(wDb);
  } finally {
    wDb.close();
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  db.closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(TEST_DB_ZIP_PATH)) fs.unlinkSync(TEST_DB_ZIP_PATH);
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  // Re-open to initialize schema
  db.openDatabase();
});

afterEach(() => {
  db.closeDatabase();
});

// ── mergeFromWorkerDb ────────────────────────────────────────────────────────

describe('mergeFromWorkerDb', () => {
  describe('price unchanged — extends endDate only', () => {
    test('updates product lastCheckedAt and extends open price endDate', () => {
      const productId = db.upsertProduct(makeProduct(1));
      db.recordPrice(productId, 15000, 'CRC', null);

      const workerPath = tmpWorkerPath();
      cloneMainDbToFile(workerPath);

      // Simulate worker scraping: same price → update lastCheckedAt + extend endDate
      withWorkerDb(workerPath, (wDb) => {
        const now = new Date().toISOString();
        wDb.prepare('UPDATE products SET lastCheckedAt = ? WHERE url = ?')
          .run(now, 'https://extremetechcr.com/producto/p1');
        wDb.prepare('UPDATE priceHistory SET endDate = ? WHERE productId = ? AND endDate IS NULL')
          .run(now, productId);
      });

      const mainDb = db.openDatabase();
      const count = mergeFromWorkerDb(mainDb, workerPath);

      expect(count).toBe(1);
      const history = db.getPriceHistory('https://extremetechcr.com/producto/p1');
      expect(history.length).toBe(1);
      expect(history[0].price).toBe(15000);
      expect(history[0].endDate).not.toBeNull(); // endDate was extended

      fs.unlinkSync(workerPath);
    });

    test('does not duplicate price records', () => {
      const productId = db.upsertProduct(makeProduct(2));
      db.recordPrice(productId, 20000, 'CRC', null);

      const workerPath = tmpWorkerPath();
      cloneMainDbToFile(workerPath);

      withWorkerDb(workerPath, (wDb) => {
        const now = new Date().toISOString();
        wDb.prepare('UPDATE products SET lastCheckedAt = ? WHERE url = ?')
          .run(now, 'https://extremetechcr.com/producto/p2');
        wDb.prepare('UPDATE priceHistory SET endDate = ? WHERE productId = ? AND endDate IS NULL')
          .run(now, productId);
      });

      const mainDb = db.openDatabase();
      mergeFromWorkerDb(mainDb, workerPath);

      const history = db.getPriceHistory('https://extremetechcr.com/producto/p2');
      expect(history.length).toBe(1); // Must not duplicate

      fs.unlinkSync(workerPath);
    });
  });

  describe('price changed — closes old record, inserts new open record', () => {
    test('closes old open record and inserts new one', () => {
      const productId = db.upsertProduct(makeProduct(3));
      db.recordPrice(productId, 15000, 'CRC', null);

      const workerPath = tmpWorkerPath();
      cloneMainDbToFile(workerPath);

      // Simulate price change in worker
      withWorkerDb(workerPath, (wDb) => {
        const changeTime = new Date().toISOString();
        wDb.prepare('UPDATE products SET lastCheckedAt = ? WHERE url = ?')
          .run(changeTime, 'https://extremetechcr.com/producto/p3');
        // Close old open record
        wDb.prepare('UPDATE priceHistory SET endDate = ? WHERE productId = ? AND endDate IS NULL')
          .run(changeTime, productId);
        // Insert new open record
        wDb.prepare(
          'INSERT INTO priceHistory (productId, price, originalPrice, currency, startDate, endDate) VALUES (?, ?, ?, ?, ?, NULL)'
        ).run(productId, 18000, null, 'CRC', changeTime);
      });

      const mainDb = db.openDatabase();
      mergeFromWorkerDb(mainDb, workerPath);

      const history = db.getPriceHistory('https://extremetechcr.com/producto/p3');
      expect(history.length).toBe(2);
      const closedRecord = history.find((h) => h.price === 15000);
      const newRecord = history.find((h) => h.price === 18000);
      expect(closedRecord).toBeDefined();
      expect(closedRecord.endDate).not.toBeNull();
      expect(newRecord).toBeDefined();
      expect(newRecord.endDate).toBeNull(); // new record is open

      fs.unlinkSync(workerPath);
    });

    test('records sale price with originalPrice correctly', () => {
      const productId = db.upsertProduct(makeProduct(4));
      db.recordPrice(productId, 15000, 'CRC', null);

      const workerPath = tmpWorkerPath();
      cloneMainDbToFile(workerPath);

      withWorkerDb(workerPath, (wDb) => {
        const changeTime = new Date().toISOString();
        wDb.prepare('UPDATE products SET lastCheckedAt = ? WHERE url = ?')
          .run(changeTime, 'https://extremetechcr.com/producto/p4');
        wDb.prepare('UPDATE priceHistory SET endDate = ? WHERE productId = ? AND endDate IS NULL')
          .run(changeTime, productId);
        wDb.prepare(
          'INSERT INTO priceHistory (productId, price, originalPrice, currency, startDate, endDate) VALUES (?, ?, ?, ?, ?, NULL)'
        ).run(productId, 12000, 15000, 'CRC', changeTime);
      });

      const mainDb = db.openDatabase();
      mergeFromWorkerDb(mainDb, workerPath);

      const history = db.getPriceHistory('https://extremetechcr.com/producto/p4');
      const saleRecord = history.find((h) => h.price === 12000);
      expect(saleRecord).toBeDefined();
      expect(saleRecord.originalPrice).toBe(15000);
      expect(saleRecord.endDate).toBeNull();

      fs.unlinkSync(workerPath);
    });
  });

  describe('product marked inactive (404)', () => {
    test('sets isActive=0 on product and closes open price record', () => {
      const productId = db.upsertProduct(makeProduct(5));
      db.recordPrice(productId, 15000, 'CRC', null);

      const workerPath = tmpWorkerPath();
      cloneMainDbToFile(workerPath);

      withWorkerDb(workerPath, (wDb) => {
        const now = new Date().toISOString();
        // Simulate markProductInactive
        wDb.prepare('UPDATE products SET isActive = 0, lastCheckedAt = ? WHERE url = ?')
          .run(now, 'https://extremetechcr.com/producto/p5');
        // No new price record is written (product is gone)
      });

      const mainDb = db.openDatabase();
      mergeFromWorkerDb(mainDb, workerPath);

      const product = db.getProductByUrl('https://extremetechcr.com/producto/p5');
      expect(product.isActive).toBe(0);

      // Open price record must be closed
      const history = db.getPriceHistory('https://extremetechcr.com/producto/p5');
      expect(history.every((h) => h.endDate !== null)).toBe(true);

      fs.unlinkSync(workerPath);
    });

    test('handles 404 on product that had no price history yet', () => {
      db.upsertProduct(makeProduct(6));
      // No price recorded yet

      const workerPath = tmpWorkerPath();
      cloneMainDbToFile(workerPath);

      withWorkerDb(workerPath, (wDb) => {
        const now = new Date().toISOString();
        wDb.prepare('UPDATE products SET isActive = 0, lastCheckedAt = ? WHERE url = ?')
          .run(now, 'https://extremetechcr.com/producto/p6');
      });

      const mainDb = db.openDatabase();
      // Must not throw even with no price history
      expect(() => mergeFromWorkerDb(mainDb, workerPath)).not.toThrow();
      const product = db.getProductByUrl('https://extremetechcr.com/producto/p6');
      expect(product.isActive).toBe(0);

      fs.unlinkSync(workerPath);
    });
  });

  describe('worker skipped product (lastCheckedAt unchanged)', () => {
    test('does not update product or price when worker did not process it', () => {
      const productId = db.upsertProduct(makeProduct(7));
      db.recordPrice(productId, 15000, 'CRC', null);
      const originalProduct = db.getProductByUrl('https://extremetechcr.com/producto/p7');

      const workerPath = tmpWorkerPath();
      cloneMainDbToFile(workerPath);
      // Worker does NOT update lastCheckedAt — simulates a skipped URL

      const mainDb = db.openDatabase();
      const count = mergeFromWorkerDb(mainDb, workerPath);

      expect(count).toBe(0); // Nothing merged
      const afterProduct = db.getProductByUrl('https://extremetechcr.com/producto/p7');
      expect(afterProduct.lastCheckedAt).toBe(originalProduct.lastCheckedAt);

      fs.unlinkSync(workerPath);
    });
  });

  describe('missing or corrupt worker DB', () => {
    test('returns 0 and logs warning when worker DB file does not exist', () => {
      const mainDb = db.openDatabase();
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const count = mergeFromWorkerDb(mainDb, '/nonexistent/worker-99.db');
      expect(count).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
      consoleSpy.mockRestore();
    });

    test('returns 0 and logs error when worker DB file is corrupt/not a DB', () => {
      const badPath = tmpWorkerPath();
      fs.writeFileSync(badPath, 'this is not a sqlite database');
      const mainDb = db.openDatabase();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const count = mergeFromWorkerDb(mainDb, badPath);
      expect(count).toBe(0);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
      fs.unlinkSync(badPath);
    });
  });

  describe('multiple products in one worker', () => {
    test('merges all updated products from a single worker', () => {
      const id1 = db.upsertProduct(makeProduct(10));
      const id2 = db.upsertProduct(makeProduct(11));
      const id3 = db.upsertProduct(makeProduct(12));
      db.recordPrice(id1, 10000, 'CRC', null);
      db.recordPrice(id2, 20000, 'CRC', null);
      db.recordPrice(id3, 30000, 'CRC', null);

      const workerPath = tmpWorkerPath();
      cloneMainDbToFile(workerPath);

      withWorkerDb(workerPath, (wDb) => {
        const now = new Date().toISOString();
        // Worker updates p10 and p11 but NOT p12
        wDb.prepare('UPDATE products SET lastCheckedAt = ? WHERE url IN (?, ?)')
          .run(now, 'https://extremetechcr.com/producto/p10', 'https://extremetechcr.com/producto/p11');
        wDb.prepare('UPDATE priceHistory SET endDate = ? WHERE productId IN (?, ?) AND endDate IS NULL')
          .run(now, id1, id2);
      });

      const mainDb = db.openDatabase();
      const count = mergeFromWorkerDb(mainDb, workerPath);
      expect(count).toBe(2); // Only p10 and p11 merged

      const h1 = db.getPriceHistory('https://extremetechcr.com/producto/p10');
      const h2 = db.getPriceHistory('https://extremetechcr.com/producto/p11');
      const h3 = db.getPriceHistory('https://extremetechcr.com/producto/p12');
      expect(h1[0].endDate).not.toBeNull();
      expect(h2[0].endDate).not.toBeNull();
      expect(h3[0].endDate).toBeNull(); // p12 was not touched, still open

      fs.unlinkSync(workerPath);
    });
  });

  describe('two workers merging into main (parallel simulation)', () => {
    test('both workers merge their disjoint sets without conflict', () => {
      // Seed 4 products
      const ids = [];
      for (let i = 20; i < 24; i++) {
        ids.push(db.upsertProduct(makeProduct(i)));
        db.recordPrice(ids[ids.length - 1], 10000 + i * 100, 'CRC', null);
      }

      // Worker 0: processes p20 and p21
      const worker0 = tmpWorkerPath();
      cloneMainDbToFile(worker0);
      withWorkerDb(worker0, (wDb) => {
        const now = new Date().toISOString();
        wDb.prepare('UPDATE products SET lastCheckedAt = ? WHERE url IN (?, ?)')
          .run(now, 'https://extremetechcr.com/producto/p20', 'https://extremetechcr.com/producto/p21');
        wDb.prepare('UPDATE priceHistory SET endDate = ? WHERE productId IN (?, ?) AND endDate IS NULL')
          .run(now, ids[0], ids[1]);
      });

      // Worker 1: processes p22 with a price change, p23 marked inactive
      const worker1 = tmpWorkerPath();
      cloneMainDbToFile(worker1);
      withWorkerDb(worker1, (wDb) => {
        const now = new Date().toISOString();
        // p22 — price change
        wDb.prepare('UPDATE products SET lastCheckedAt = ? WHERE url = ?')
          .run(now, 'https://extremetechcr.com/producto/p22');
        wDb.prepare('UPDATE priceHistory SET endDate = ? WHERE productId = ? AND endDate IS NULL')
          .run(now, ids[2]);
        wDb.prepare(
          'INSERT INTO priceHistory (productId, price, originalPrice, currency, startDate, endDate) VALUES (?, ?, ?, ?, ?, NULL)'
        ).run(ids[2], 99999, null, 'CRC', now);
        // p23 — inactive
        wDb.prepare('UPDATE products SET isActive = 0, lastCheckedAt = ? WHERE url = ?')
          .run(now, 'https://extremetechcr.com/producto/p23');
      });

      const mainDb = db.openDatabase();
      const c0 = mergeFromWorkerDb(mainDb, worker0);
      const c1 = mergeFromWorkerDb(mainDb, worker1);
      expect(c0).toBe(2);
      expect(c1).toBe(2);

      // p20, p21 — unchanged price, endDate extended
      expect(db.getPriceHistory('https://extremetechcr.com/producto/p20')[0].endDate).not.toBeNull();
      expect(db.getPriceHistory('https://extremetechcr.com/producto/p21')[0].endDate).not.toBeNull();

      // p22 — two price records
      const h22 = db.getPriceHistory('https://extremetechcr.com/producto/p22');
      expect(h22.length).toBe(2);
      expect(h22[1].price).toBe(99999);
      expect(h22[1].endDate).toBeNull();

      // p23 — inactive, open record closed
      const p23 = db.getProductByUrl('https://extremetechcr.com/producto/p23');
      expect(p23.isActive).toBe(0);
      expect(db.getPriceHistory('https://extremetechcr.com/producto/p23').every((h) => h.endDate !== null)).toBe(true);

      fs.unlinkSync(worker0);
      fs.unlinkSync(worker1);
    });

    test('second merge does not re-merge already-applied worker (lastCheckedAt guard)', () => {
      const productId = db.upsertProduct(makeProduct(30));
      db.recordPrice(productId, 15000, 'CRC', null);

      const workerPath = tmpWorkerPath();
      cloneMainDbToFile(workerPath);

      withWorkerDb(workerPath, (wDb) => {
        const now = new Date().toISOString();
        wDb.prepare('UPDATE products SET lastCheckedAt = ? WHERE url = ?')
          .run(now, 'https://extremetechcr.com/producto/p30');
        wDb.prepare('UPDATE priceHistory SET endDate = ? WHERE productId = ? AND endDate IS NULL')
          .run(now, productId);
      });

      const mainDb = db.openDatabase();
      mergeFromWorkerDb(mainDb, workerPath); // First merge
      mergeFromWorkerDb(mainDb, workerPath); // Second merge (idempotent)

      const history = db.getPriceHistory('https://extremetechcr.com/producto/p30');
      expect(history.length).toBe(1); // No duplicate records

      fs.unlinkSync(workerPath);
    });
  });

  describe('product metadata update', () => {
    test('worker-updated name, sku and category are reflected in main after merge', () => {
      db.upsertProduct(makeProduct(40));

      const workerPath = tmpWorkerPath();
      cloneMainDbToFile(workerPath);

      withWorkerDb(workerPath, (wDb) => {
        const now = new Date().toISOString();
        wDb.prepare('UPDATE products SET name = ?, sku = ?, category = ?, lastCheckedAt = ? WHERE url = ?')
          .run('Updated Name', 'NEW-SKU', 'Monitors', now, 'https://extremetechcr.com/producto/p40');
      });

      const mainDb = db.openDatabase();
      mergeFromWorkerDb(mainDb, workerPath);

      const product = db.getProductByUrl('https://extremetechcr.com/producto/p40');
      expect(product.name).toBe('Updated Name');
      expect(product.sku).toBe('NEW-SKU');
      expect(product.category).toBe('Monitors');

      fs.unlinkSync(workerPath);
    });
  });
});

// ── runMerge ─────────────────────────────────────────────────────────────────

describe('runMerge', () => {
  test('exits process with code 1 when workers directory does not exist', () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => runMerge('/nonexistent/workers-dir')).toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    mockExit.mockRestore();
  });

  test('exits process with code 1 when workers dir exists but has no DB files', () => {
    const emptyDir = tmpWorkersDir();
    // Create a non-DB file that should be ignored
    fs.writeFileSync(path.join(emptyDir, 'README.txt'), 'not a db');

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => runMerge(emptyDir)).toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    mockExit.mockRestore();
    fs.rmSync(emptyDir, { recursive: true });
  });

  test('processes all worker-N.db files in the directory', () => {
    const productId = db.upsertProduct(makeProduct(50));
    db.recordPrice(productId, 10000, 'CRC', null);

    const workersDir = tmpWorkersDir();
    const workerPath = path.join(workersDir, 'worker-0.db');
    cloneMainDbToFile(workerPath);

    withWorkerDb(workerPath, (wDb) => {
      const now = new Date().toISOString();
      wDb.prepare('UPDATE products SET lastCheckedAt = ? WHERE url = ?')
        .run(now, 'https://extremetechcr.com/producto/p50');
      wDb.prepare('UPDATE priceHistory SET endDate = ? WHERE productId = ? AND endDate IS NULL')
        .run(now, productId);
    });

    // Add a non-DB file that should be ignored
    fs.writeFileSync(path.join(workersDir, 'README.txt'), 'ignored');

    runMerge(workersDir);

    const product = db.getProductByUrl('https://extremetechcr.com/producto/p50');
    expect(product.lastCheckedAt).not.toBe('1970-01-01T00:00:00.000Z');

    fs.rmSync(workersDir, { recursive: true });
  });

  test('continues merging remaining workers when one worker DB is corrupt', () => {
    const id1 = db.upsertProduct(makeProduct(60));
    const id2 = db.upsertProduct(makeProduct(61));
    db.recordPrice(id1, 10000, 'CRC', null);
    db.recordPrice(id2, 20000, 'CRC', null);

    const workersDir = tmpWorkersDir();

    // Worker 0: corrupt file
    fs.writeFileSync(path.join(workersDir, 'worker-0.db'), 'not a database');

    // Worker 1: valid DB with update
    const worker1Path = path.join(workersDir, 'worker-1.db');
    cloneMainDbToFile(worker1Path);
    withWorkerDb(worker1Path, (wDb) => {
      const now = new Date().toISOString();
      wDb.prepare('UPDATE products SET lastCheckedAt = ? WHERE url = ?')
        .run(now, 'https://extremetechcr.com/producto/p61');
      wDb.prepare('UPDATE priceHistory SET endDate = ? WHERE productId = ? AND endDate IS NULL')
        .run(now, id2);
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Should not throw — corrupt worker skipped, valid worker merged
    expect(() => runMerge(workersDir)).not.toThrow();

    // p61 (from valid worker) must be merged
    const h61 = db.getPriceHistory('https://extremetechcr.com/producto/p61');
    expect(h61[0].endDate).not.toBeNull();

    consoleSpy.mockRestore();
    fs.rmSync(workersDir, { recursive: true });
  });

  test('exports db.zip after merging', () => {
    const productId = db.upsertProduct(makeProduct(70));
    db.recordPrice(productId, 10000, 'CRC', null);

    const workersDir = tmpWorkersDir();
    const workerPath = path.join(workersDir, 'worker-0.db');
    cloneMainDbToFile(workerPath);

    withWorkerDb(workerPath, (wDb) => {
      const now = new Date().toISOString();
      wDb.prepare('UPDATE products SET lastCheckedAt = ? WHERE url = ?')
        .run(now, 'https://extremetechcr.com/producto/p70');
      wDb.prepare('UPDATE priceHistory SET endDate = ? WHERE productId = ? AND endDate IS NULL')
        .run(now, productId);
    });

    runMerge(workersDir);

    expect(fs.existsSync(TEST_DB_ZIP_PATH)).toBe(true);

    fs.rmSync(workersDir, { recursive: true });
  });

  test('ignores files that do not match worker-N.db pattern', () => {
    db.upsertProduct(makeProduct(80));

    const workersDir = tmpWorkersDir();
    // Only non-matching files
    fs.writeFileSync(path.join(workersDir, 'backup.db'), 'not a worker db');
    fs.writeFileSync(path.join(workersDir, 'worker.db'), 'not matching pattern');
    fs.writeFileSync(path.join(workersDir, 'worker-extra-0.db'), 'not matching');

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => runMerge(workersDir)).toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    mockExit.mockRestore();
    fs.rmSync(workersDir, { recursive: true });
  });
});
