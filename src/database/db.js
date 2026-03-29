'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const { DB_PATH, DB_ZIP_PATH } = require('../config');

/**
 * @typedef {Object} Product
 * @property {number} id
 * @property {string} url
 * @property {string|null} name
 * @property {string|null} sku
 * @property {string|null} category
 * @property {string|null} description
 * @property {string|null} imageUrl
 * @property {string} firstSeenAt
 * @property {string} lastCheckedAt
 * @property {number} isActive
 */

/**
 * @typedef {Object} PriceRecord
 * @property {number} id
 * @property {number} productId
 * @property {number|null} price
 * @property {string|null} currency
 * @property {string} startDate
 * @property {string|null} endDate
 */

let dbInstance = null;

/**
 * Opens (or creates) the SQLite database at the configured path.
 * Initializes the schema if the database is new.
 * @returns {Database} The better-sqlite3 Database instance.
 */
function openDatabase() {
  if (dbInstance) return dbInstance;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  dbInstance = new Database(DB_PATH);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  initializeSchema(dbInstance);
  return dbInstance;
}

/**
 * Creates the database tables if they do not already exist.
 * Also adds columns introduced in schema updates (originalPrice, stockLocations)
 * to databases that were created before those columns existed.
 * @param {Database} db - The better-sqlite3 Database instance.
 */
function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      name TEXT,
      sku TEXT,
      category TEXT,
      description TEXT,
      imageUrl TEXT,
      stockLocations TEXT,
      firstSeenAt TEXT NOT NULL,
      lastCheckedAt TEXT NOT NULL,
      isActive INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS priceHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId INTEGER NOT NULL,
      price REAL,
      originalPrice REAL,
      currency TEXT,
      startDate TEXT NOT NULL,
      endDate TEXT,
      FOREIGN KEY (productId) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_products_url ON products(url);
    CREATE INDEX IF NOT EXISTS idx_price_history_product ON priceHistory(productId);
    CREATE INDEX IF NOT EXISTS idx_price_history_dates ON priceHistory(startDate, endDate);
  `);

  // Migrate older databases that may not have these columns yet
  addColumnIfMissing(db, 'products', 'stockLocations', 'TEXT');
  addColumnIfMissing(db, 'priceHistory', 'originalPrice', 'REAL');
}

/**
 * Adds a column to a table only if it does not already exist.
 * Used for non-destructive schema migrations on existing databases.
 * @param {Database} db - The better-sqlite3 Database instance.
 * @param {string} table - Table name.
 * @param {string} column - Column name to add.
 * @param {string} type - SQLite column type (e.g. "TEXT", "REAL").
 */
function addColumnIfMissing(db, table, column, type) {
  const existing = db.pragma(`table_info(${table})`);
  const exists = existing.some((col) => col.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * Upserts a product record. If the URL already exists, updates metadata.
 * If new, inserts with the current timestamp as firstSeenAt.
 * @param {Object} productData - Scraped product data.
 * @param {string} productData.url
 * @param {string|null} productData.name
 * @param {string|null} productData.sku
 * @param {string|null} productData.category
 * @param {string|null} productData.description
 * @param {string|null} productData.imageUrl
 * @param {Array} [productData.stockLocations]
 * @param {boolean} productData.isAvailable
 * @returns {number} The product ID.
 */
function upsertProduct(productData) {
  const db = openDatabase();
  const now = new Date().toISOString();
  const stockJson = productData.stockLocations && productData.stockLocations.length > 0
    ? JSON.stringify(productData.stockLocations)
    : null;

  const existing = db.prepare('SELECT id FROM products WHERE url = ?').get(productData.url);

  if (existing) {
    db.prepare(`
      UPDATE products
      SET name = ?, sku = ?, category = ?, description = ?, imageUrl = ?,
          stockLocations = ?, lastCheckedAt = ?, isActive = ?
      WHERE url = ?
    `).run(
      productData.name,
      productData.sku,
      productData.category,
      productData.description,
      productData.imageUrl,
      stockJson,
      now,
      1,
      productData.url
    );
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO products (url, name, sku, category, description, imageUrl, stockLocations, firstSeenAt, lastCheckedAt, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    productData.url,
    productData.name,
    productData.sku,
    productData.category,
    productData.description,
    productData.imageUrl,
    stockJson,
    now,
    now,
    1
  );

  return result.lastInsertRowid;
}

/**
 * Records a price observation for a product.
 * If the latest open price record has the same price and originalPrice,
 * updates its endDate (extending the range) rather than inserting a new row.
 * If the price or originalPrice changed, closes the old record and opens a new one.
 * @param {number} productId - The product's database ID.
 * @param {number|null} price - The observed (sale or regular) price.
 * @param {string|null} currency - The currency code/symbol.
 * @param {number|null} [originalPrice=null] - The pre-discount price when on sale.
 */
function recordPrice(productId, price, currency, originalPrice = null) {
  const db = openDatabase();
  const now = new Date().toISOString();

  const latest = db.prepare(`
    SELECT id, price, originalPrice, currency FROM priceHistory
    WHERE productId = ? AND endDate IS NULL
    ORDER BY startDate DESC
    LIMIT 1
  `).get(productId);

  const unchanged = latest
    && latest.price === price
    && latest.currency === currency
    && latest.originalPrice === originalPrice;

  if (unchanged) {
    db.prepare('UPDATE priceHistory SET endDate = ? WHERE id = ?').run(now, latest.id);
  } else {
    if (latest) {
      db.prepare('UPDATE priceHistory SET endDate = ? WHERE id = ?').run(now, latest.id);
    }
    db.prepare(`
      INSERT INTO priceHistory (productId, price, originalPrice, currency, startDate)
      VALUES (?, ?, ?, ?, ?)
    `).run(productId, price, originalPrice, currency, now);
  }
}

/**
 * Marks a product as inactive (e.g., returned 404).
 * @param {string} url - The product URL to mark inactive.
 */
function markProductInactive(url) {
  const db = openDatabase();
  const now = new Date().toISOString();
  db.prepare('UPDATE products SET isActive = 0, lastCheckedAt = ? WHERE url = ?').run(now, url);
}

/**
 * Returns all active products with their current price (latest open price record).
 * @returns {Array<Product & { price: number|null, originalPrice: number|null, currency: string|null }>}
 */
function getAllProductsWithCurrentPrice() {
  const db = openDatabase();
  return db.prepare(`
    SELECT p.*, ph.price, ph.originalPrice, ph.currency
    FROM products p
    LEFT JOIN priceHistory ph ON ph.productId = p.id AND ph.endDate IS NULL
    WHERE p.isActive = 1
    ORDER BY p.name ASC
  `).all();
}

/**
 * Returns the price history for a given product URL.
 * @param {string} url - The product URL.
 * @returns {PriceRecord[]} Array of price history records.
 */
function getPriceHistory(url) {
  const db = openDatabase();
  const product = db.prepare('SELECT id FROM products WHERE url = ?').get(url);
  if (!product) return [];
  return db.prepare(`
    SELECT * FROM priceHistory WHERE productId = ? ORDER BY startDate ASC
  `).all(product.id);
}

/**
 * Returns a product record by URL.
 * @param {string} url - The product URL.
 * @returns {Product|null}
 */
function getProductByUrl(url) {
  const db = openDatabase();
  return db.prepare('SELECT * FROM products WHERE url = ?').get(url) || null;
}

/**
 * Returns all product URLs currently tracked in the database.
 * @returns {string[]} Array of product URLs.
 */
function getAllProductUrls() {
  const db = openDatabase();
  return db.prepare('SELECT url FROM products').all().map((r) => r.url);
}

/**
 * Returns up to `limit` active product URLs ordered by lastCheckedAt ascending
 * (stale-first). This is used by the daily price-update job to process the
 * least-recently-checked products first and respect MAX_URLS_PER_RUN.
 * @param {number} limit - Maximum number of URLs to return.
 * @returns {string[]} Array of product URLs, stale ones first.
 */
function getStaleProductUrls(limit) {
  const db = openDatabase();
  return db.prepare(
    'SELECT url FROM products WHERE isActive = 1 ORDER BY lastCheckedAt ASC LIMIT ?'
  ).all(limit).map((r) => r.url);
}

/**
 * Checks the database for data quality issues that indicate a failed or partial
 * crawl run.  Returns an object with a boolean `ok` flag and a `warnings` array.
 * Callers should log warnings and, for critical issues, halt the job.
 *
 * Checks performed:
 *  - nullPriceRatio  : fraction of active products with no price record (alert > 0.8)
 *  - nullNameRatio   : fraction of active products with null name       (alert > 0.8)
 *  - dominantName    : most-common non-null name covers > 80% of rows   (alert)
 *
 * @returns {{ ok: boolean, warnings: string[] }}
 */
function validateDatabaseIntegrity() {
  const db = openDatabase();
  const warnings = [];

  const totalRow = db.prepare("SELECT COUNT(*) AS n FROM products WHERE isActive = 1").get();
  const total = totalRow ? totalRow.n : 0;

  if (total === 0) {
    return { ok: true, warnings: [] };
  }

  // Fraction with no open price record
  const noPriceRow = db.prepare(`
    SELECT COUNT(*) AS n FROM products p
    WHERE p.isActive = 1
      AND NOT EXISTS (
        SELECT 1 FROM priceHistory ph WHERE ph.productId = p.id AND ph.endDate IS NULL
      )
  `).get();
  const noPriceRatio = (noPriceRow ? noPriceRow.n : 0) / total;
  if (noPriceRatio >= 0.8) {
    warnings.push(
      `CRITICAL: ${Math.round(noPriceRatio * 100)}% of products have no price (${noPriceRow.n}/${total}). ` +
      'Price crawler may have failed or not run yet.'
    );
  }

  // Fraction with null name
  const nullNameRow = db.prepare(
    "SELECT COUNT(*) AS n FROM products WHERE isActive = 1 AND name IS NULL"
  ).get();
  const nullNameRatio = (nullNameRow ? nullNameRow.n : 0) / total;
  if (nullNameRatio >= 0.8) {
    warnings.push(
      `CRITICAL: ${Math.round(nullNameRatio * 100)}% of products have no name (${nullNameRow.n}/${total}). ` +
      'Price crawler may not have run after the sitemap crawl.'
    );
  }

  // Most-common name covering > 80% of named rows
  const dominantRow = db.prepare(`
    SELECT name, COUNT(*) AS n FROM products
    WHERE isActive = 1 AND name IS NOT NULL
    GROUP BY name ORDER BY n DESC LIMIT 1
  `).get();
  if (dominantRow && dominantRow.n / total >= 0.8) {
    warnings.push(
      `WARNING: Name "${dominantRow.name}" appears in ${dominantRow.n}/${total} products (>80%). ` +
      'This may indicate a scraper selector issue.'
    );
  }

  return { ok: warnings.length === 0, warnings };
}

/**
 * Exports the SQLite database to a ZIP file at DB_ZIP_PATH.
 * The ZIP contains a single file named "prices.db".
 * @returns {void}
 */
function exportDatabaseToZip() {
  const db = openDatabase();

  // Create a checkpoint to ensure WAL is flushed to main DB file
  db.pragma('wal_checkpoint(FULL)');

  const publicDir = path.dirname(DB_ZIP_PATH);
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const zip = new AdmZip();
  zip.addLocalFile(DB_PATH, '', 'prices.db');
  zip.writeZip(DB_ZIP_PATH);
  console.log(`Database exported to ${DB_ZIP_PATH}`);
}

/**
 * Closes the database connection. Used for testing and cleanup.
 */
function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  openDatabase,
  initializeSchema,
  addColumnIfMissing,
  upsertProduct,
  recordPrice,
  markProductInactive,
  getAllProductsWithCurrentPrice,
  getPriceHistory,
  getProductByUrl,
  getAllProductUrls,
  getStaleProductUrls,
  validateDatabaseIntegrity,
  exportDatabaseToZip,
  closeDatabase,
};
