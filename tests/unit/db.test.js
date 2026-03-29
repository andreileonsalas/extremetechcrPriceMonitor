'use strict';

const fs = require('fs');
const path = require('path');

// Override DB_PATH to use a temp location for tests
const TEST_DB_PATH = path.join(__dirname, '../../tmp/test-prices.db');

jest.mock('../../src/config', () => {
  const p = require('path');
  return {
    ...jest.requireActual('../../src/config'),
    DB_PATH: p.join(__dirname, '../../tmp/test-prices.db'),
    DB_ZIP_PATH: p.join(__dirname, '../../tmp/test-db.zip'),
  };
});

const db = require('../../src/database/db');

beforeEach(() => {
  // Ensure a fresh database for each test
  db.closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  const dir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  db.closeDatabase();
});

describe('database', () => {
  describe('upsertProduct', () => {
    test('new product gets lastCheckedAt set to epoch so it is immediately stale', () => {
      db.upsertProduct({
        url: 'https://extremetechcr.com/producto/brand-new',
        name: null,
        sku: null,
        category: null,
        description: null,
        imageUrl: null,
        isAvailable: true,
      });
      const product = db.getProductByUrl('https://extremetechcr.com/producto/brand-new');
      expect(product.lastCheckedAt).toBe('1970-01-01T00:00:00.000Z');
    });

    test('updating an existing product sets lastCheckedAt to now (not epoch)', () => {
      const before = new Date().toISOString();
      db.upsertProduct({ url: 'https://extremetechcr.com/producto/existing', name: 'Old', sku: null, category: null, description: null, imageUrl: null, isAvailable: true });
      // Second call simulates a price-scrape update
      db.upsertProduct({ url: 'https://extremetechcr.com/producto/existing', name: 'Updated', sku: null, category: null, description: null, imageUrl: null, isAvailable: true });
      const after = new Date().toISOString();
      const product = db.getProductByUrl('https://extremetechcr.com/producto/existing');
      expect(product.lastCheckedAt >= before).toBe(true);
      expect(product.lastCheckedAt <= after).toBe(true);
    });

    test('new products from sitemap are stale-first vs already-scraped products', () => {
      // Simulate sitemap inserting a new URL (epoch lastCheckedAt)
      db.upsertProduct({ url: 'https://extremetechcr.com/producto/sitemap-new', name: null, sku: null, category: null, description: null, imageUrl: null, isAvailable: true });
      // Simulate price crawler already having scraped another URL (recent lastCheckedAt)
      const dbInstance = db.openDatabase();
      dbInstance.prepare(
        `INSERT INTO products (url, name, firstSeenAt, lastCheckedAt, isActive) VALUES (?, ?, ?, ?, 1)`
      ).run('https://extremetechcr.com/producto/already-scraped', 'Scraped', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');

      const urls = db.getStaleProductUrls(10);
      // The new sitemap product (epoch 1970) must come before the already-scraped one (2024)
      const newIdx = urls.indexOf('https://extremetechcr.com/producto/sitemap-new');
      const scrapedIdx = urls.indexOf('https://extremetechcr.com/producto/already-scraped');
      expect(newIdx).toBeGreaterThanOrEqual(0);
      expect(scrapedIdx).toBeGreaterThanOrEqual(0);
      expect(newIdx).toBeLessThan(scrapedIdx);
    });

    test('inserts a new product and returns an ID', () => {
      const id = db.upsertProduct({
        url: 'https://extremetechcr.com/producto/laptop-test',
        name: 'Test Laptop',
        sku: 'SKU001',
        category: 'Laptops',
        description: 'A test laptop',
        imageUrl: null,
        isAvailable: true,
      });
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    test('updates an existing product without changing firstSeenAt', () => {
      const id1 = db.upsertProduct({
        url: 'https://extremetechcr.com/producto/laptop-test',
        name: 'Old Name',
        sku: null,
        category: null,
        description: null,
        imageUrl: null,
        isAvailable: true,
      });
      const id2 = db.upsertProduct({
        url: 'https://extremetechcr.com/producto/laptop-test',
        name: 'New Name',
        sku: 'SKU002',
        category: 'Laptops',
        description: null,
        imageUrl: null,
        isAvailable: true,
      });
      expect(id1).toBe(id2);
      const product = db.getProductByUrl('https://extremetechcr.com/producto/laptop-test');
      expect(product.name).toBe('New Name');
    });
  });

  describe('recordPrice', () => {
    test('creates a new price record on first call', () => {
      const id = db.upsertProduct({
        url: 'https://extremetechcr.com/producto/mouse-test',
        name: 'Test Mouse',
        sku: null,
        category: null,
        description: null,
        imageUrl: null,
        stockLocations: [],
        isAvailable: true,
      });
      db.recordPrice(id, 15000, 'CRC');
      const history = db.getPriceHistory('https://extremetechcr.com/producto/mouse-test');
      expect(history.length).toBe(1);
      expect(history[0].price).toBe(15000);
    });

    test('extends endDate when price and originalPrice are unchanged', () => {
      const id = db.upsertProduct({
        url: 'https://extremetechcr.com/producto/mouse-test',
        name: 'Test Mouse',
        sku: null,
        category: null,
        description: null,
        imageUrl: null,
        stockLocations: [],
        isAvailable: true,
      });
      db.recordPrice(id, 15000, 'CRC', null);
      db.recordPrice(id, 15000, 'CRC', null);
      const history = db.getPriceHistory('https://extremetechcr.com/producto/mouse-test');
      expect(history.length).toBe(1);
    });

    test('creates a new record when price changes', () => {
      const id = db.upsertProduct({
        url: 'https://extremetechcr.com/producto/mouse-test',
        name: 'Test Mouse',
        sku: null,
        category: null,
        description: null,
        imageUrl: null,
        stockLocations: [],
        isAvailable: true,
      });
      db.recordPrice(id, 15000, 'CRC', null);
      db.recordPrice(id, 18000, 'CRC', null);
      const history = db.getPriceHistory('https://extremetechcr.com/producto/mouse-test');
      expect(history.length).toBe(2);
      expect(history[0].price).toBe(15000);
      expect(history[1].price).toBe(18000);
    });

    test('creates a new record when originalPrice changes (sale starts)', () => {
      const id = db.upsertProduct({
        url: 'https://extremetechcr.com/producto/mouse-test',
        name: 'Test Mouse',
        sku: null,
        category: null,
        description: null,
        imageUrl: null,
        stockLocations: [],
        isAvailable: true,
      });
      db.recordPrice(id, 15000, 'CRC', null);
      db.recordPrice(id, 14550, 'CRC', 15000);
      const history = db.getPriceHistory('https://extremetechcr.com/producto/mouse-test');
      expect(history.length).toBe(2);
      expect(history[1].originalPrice).toBe(15000);
    });
  });

  describe('markProductInactive', () => {
    test('sets isActive to 0 for the given URL', () => {
      db.upsertProduct({
        url: 'https://extremetechcr.com/producto/discontinued',
        name: 'Discontinued',
        sku: null,
        category: null,
        description: null,
        imageUrl: null,
        stockLocations: [],
        isAvailable: true,
      });
      db.markProductInactive('https://extremetechcr.com/producto/discontinued');
      const product = db.getProductByUrl('https://extremetechcr.com/producto/discontinued');
      expect(product.isActive).toBe(0);
    });
  });

  describe('getAllProductUrls', () => {
    test('returns all tracked product URLs', () => {
      db.upsertProduct({ url: 'https://extremetechcr.com/producto/a', name: 'A', sku: null, category: null, description: null, imageUrl: null, stockLocations: [], isAvailable: true });
      db.upsertProduct({ url: 'https://extremetechcr.com/producto/b', name: 'B', sku: null, category: null, description: null, imageUrl: null, stockLocations: [], isAvailable: true });
      const urls = db.getAllProductUrls();
      expect(urls).toContain('https://extremetechcr.com/producto/a');
      expect(urls).toContain('https://extremetechcr.com/producto/b');
    });
  });

  describe('getStaleProductUrls', () => {
    test('returns URLs ordered by lastCheckedAt ascending (stale first)', () => {
      // Insert two products manually with different lastCheckedAt values
      const dbInstance = db.openDatabase();
      dbInstance.prepare(`
        INSERT INTO products (url, name, firstSeenAt, lastCheckedAt, isActive)
        VALUES (?, ?, ?, ?, 1)
      `).run('https://extremetechcr.com/producto/old', 'Old', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');
      dbInstance.prepare(`
        INSERT INTO products (url, name, firstSeenAt, lastCheckedAt, isActive)
        VALUES (?, ?, ?, ?, 1)
      `).run('https://extremetechcr.com/producto/new', 'New', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');

      const urls = db.getStaleProductUrls(10);
      expect(urls[0]).toBe('https://extremetechcr.com/producto/old');
      expect(urls[1]).toBe('https://extremetechcr.com/producto/new');
    });

    test('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        db.upsertProduct({
          url: `https://extremetechcr.com/producto/p${i}`,
          name: `Product ${i}`,
          sku: null, category: null, description: null, imageUrl: null,
          stockLocations: [], isAvailable: true,
        });
      }
      const urls = db.getStaleProductUrls(3);
      expect(urls.length).toBe(3);
    });

    test('excludes inactive products', () => {
      db.upsertProduct({
        url: 'https://extremetechcr.com/producto/active',
        name: 'Active', sku: null, category: null, description: null,
        imageUrl: null, stockLocations: [], isAvailable: true,
      });
      db.upsertProduct({
        url: 'https://extremetechcr.com/producto/inactive',
        name: 'Inactive', sku: null, category: null, description: null,
        imageUrl: null, stockLocations: [], isAvailable: false,
      });
      db.markProductInactive('https://extremetechcr.com/producto/inactive');
      const urls = db.getStaleProductUrls(100);
      expect(urls).toContain('https://extremetechcr.com/producto/active');
      expect(urls).not.toContain('https://extremetechcr.com/producto/inactive');
    });

    test('includes inactive products when includeInactive=true', () => {
      db.upsertProduct({
        url: 'https://extremetechcr.com/producto/active2',
        name: 'Active2', sku: null, category: null, description: null,
        imageUrl: null, stockLocations: [], isAvailable: true,
      });
      db.upsertProduct({
        url: 'https://extremetechcr.com/producto/inactive2',
        name: 'Inactive2', sku: null, category: null, description: null,
        imageUrl: null, stockLocations: [], isAvailable: false,
      });
      db.markProductInactive('https://extremetechcr.com/producto/inactive2');
      const urls = db.getStaleProductUrls(100, true);
      expect(urls).toContain('https://extremetechcr.com/producto/active2');
      expect(urls).toContain('https://extremetechcr.com/producto/inactive2');
    });
  });

  describe('validateDatabaseIntegrity', () => {
    test('returns ok=true for empty database', () => {
      const result = db.validateDatabaseIntegrity();
      expect(result.ok).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test('returns ok=true when all products have prices and names', () => {
      for (let i = 0; i < 5; i++) {
        const id = db.upsertProduct({
          url: `https://extremetechcr.com/producto/p${i}`,
          name: `Product ${i}`,
          sku: null, category: null, description: null, imageUrl: null,
          stockLocations: [], isAvailable: true,
        });
        db.recordPrice(id, 10000 + i * 1000, 'CRC');
      }
      const result = db.validateDatabaseIntegrity();
      expect(result.ok).toBe(true);
    });

    test('returns CRITICAL warning when >80% of products have no price', () => {
      // Insert 5 products, give price to only 1 (20% have price, 80% do not)
      for (let i = 0; i < 5; i++) {
        const id = db.upsertProduct({
          url: `https://extremetechcr.com/producto/p${i}`,
          name: `Product ${i}`,
          sku: null, category: null, description: null, imageUrl: null,
          stockLocations: [], isAvailable: true,
        });
        if (i === 0) db.recordPrice(id, 10000, 'CRC');
      }
      const result = db.validateDatabaseIntegrity();
      expect(result.ok).toBe(false);
      expect(result.warnings.some((w) => w.includes('no price'))).toBe(true);
    });

    test('returns CRITICAL warning when >80% of products have null name', () => {
      // Insert 5 products, only 1 has a name
      for (let i = 0; i < 5; i++) {
        db.upsertProduct({
          url: `https://extremetechcr.com/producto/p${i}`,
          name: i === 0 ? 'Only Named Product' : null,
          sku: null, category: null, description: null, imageUrl: null,
          stockLocations: [], isAvailable: true,
        });
      }
      const result = db.validateDatabaseIntegrity();
      expect(result.ok).toBe(false);
      expect(result.warnings.some((w) => w.includes('no name'))).toBe(true);
    });

    test('returns WARNING when one name dominates >80% of products', () => {
      // Insert 5 products all with the same name (simulates selector bug)
      for (let i = 0; i < 5; i++) {
        const id = db.upsertProduct({
          url: `https://extremetechcr.com/producto/p${i}`,
          name: 'ExtremeTechCR',
          sku: null, category: null, description: null, imageUrl: null,
          stockLocations: [], isAvailable: true,
        });
        db.recordPrice(id, 10000, 'CRC');
      }
      const result = db.validateDatabaseIntegrity();
      expect(result.ok).toBe(false);
      expect(result.warnings.some((w) => w.includes('ExtremeTechCR'))).toBe(true);
    });
  });
});
