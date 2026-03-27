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
        isAvailable: true,
      });
      db.recordPrice(id, 15000, 'CRC');
      const history = db.getPriceHistory('https://extremetechcr.com/producto/mouse-test');
      expect(history.length).toBe(1);
      expect(history[0].price).toBe(15000);
    });

    test('extends endDate when price is unchanged', () => {
      const id = db.upsertProduct({
        url: 'https://extremetechcr.com/producto/mouse-test',
        name: 'Test Mouse',
        sku: null,
        category: null,
        description: null,
        imageUrl: null,
        isAvailable: true,
      });
      db.recordPrice(id, 15000, 'CRC');
      db.recordPrice(id, 15000, 'CRC');
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
        isAvailable: true,
      });
      db.recordPrice(id, 15000, 'CRC');
      db.recordPrice(id, 18000, 'CRC');
      const history = db.getPriceHistory('https://extremetechcr.com/producto/mouse-test');
      expect(history.length).toBe(2);
      expect(history[0].price).toBe(15000);
      expect(history[1].price).toBe(18000);
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
        isAvailable: true,
      });
      db.markProductInactive('https://extremetechcr.com/producto/discontinued');
      const product = db.getProductByUrl('https://extremetechcr.com/producto/discontinued');
      expect(product.isActive).toBe(0);
    });
  });

  describe('getAllProductUrls', () => {
    test('returns all tracked product URLs', () => {
      db.upsertProduct({ url: 'https://extremetechcr.com/producto/a', name: 'A', sku: null, category: null, description: null, imageUrl: null, isAvailable: true });
      db.upsertProduct({ url: 'https://extremetechcr.com/producto/b', name: 'B', sku: null, category: null, description: null, imageUrl: null, isAvailable: true });
      const urls = db.getAllProductUrls();
      expect(urls).toContain('https://extremetechcr.com/producto/a');
      expect(urls).toContain('https://extremetechcr.com/producto/b');
    });
  });
});
