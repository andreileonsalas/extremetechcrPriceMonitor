'use strict';

/**
 * Merge stage for the parallel price-crawl pipeline.
 *
 * After all worker jobs finish, each worker has written its results to a
 * copy of the main database.  This script merges every worker database
 * back into the main database by:
 *
 *  1. Detecting which products a worker actually processed (its copy has
 *     a newer lastCheckedAt than the baseline main DB).
 *  2. Copying the updated product row (name, sku, isActive, lastCheckedAt, …).
 *  3. Reconciling price history:
 *       - Price unchanged  → update endDate of the existing latest record.
 *       - Price changed    → close the old open record, insert the new one.
 *       - Product 404      → close the open record; isActive set to 0.
 *
 * Workers start as exact copies of the main DB (same product IDs), so IDs
 * are stable and no ID mapping is required.
 *
 * NOTE on recordPrice() behavior:
 *   recordPrice() always sets endDate = now on the latest open record, even
 *   when the price is unchanged.  So after a price check the latest record
 *   may have endDate set (not NULL).  We therefore compare by startDate DESC
 *   rather than by endDate IS NULL when identifying "the current record".
 *
 * Environment variables:
 *   WORKERS_DIR   Directory containing worker-N.db files.
 *                 Default: data/workers
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('../config');
const { openDatabase, exportDatabaseToZip, validateDatabaseIntegrity } = require('../database/db');

const DEFAULT_WORKERS_DIR = path.join('data', 'workers');

/**
 * Merges one worker database file into an already-open main database.
 *
 * @param {import('better-sqlite3').Database} mainDb - Open writable main DB.
 * @param {string} workerDbPath - Absolute or relative path to the worker DB.
 * @returns {number} Count of products merged from this worker.
 */
function mergeFromWorkerDb(mainDb, workerDbPath) {
  if (!fs.existsSync(workerDbPath)) {
    console.warn(`[MERGE] Worker DB not found, skipping: ${workerDbPath}`);
    return 0;
  }

  let workerDb;
  try {
    workerDb = new Database(workerDbPath, { readonly: true });
  } catch (err) {
    console.error(`[MERGE] Failed to open worker DB ${workerDbPath}: ${err.message}`);
    return 0;
  }

  let mergedCount = 0;

  try {
    // Prepared statements reused across products for performance.
    const getMainProduct = mainDb.prepare(
      'SELECT id, lastCheckedAt FROM products WHERE url = ?'
    );
    const updateProduct = mainDb.prepare(`
      UPDATE products
      SET name = ?, sku = ?, category = ?, description = ?, imageUrl = ?,
          stockLocations = ?, lastCheckedAt = ?, isActive = ?
      WHERE url = ?
    `);
    // Get the most-recent price record regardless of endDate.
    // recordPrice() always closes the latest open record (sets endDate = now)
    // even when the price is unchanged, so we cannot rely on endDate IS NULL
    // to identify the "current" record — we use startDate DESC instead.
    const getMainLatestPrice = mainDb.prepare(
      'SELECT id, startDate FROM priceHistory WHERE productId = ? ORDER BY startDate DESC LIMIT 1'
    );
    const getMainOpenPrice = mainDb.prepare(
      'SELECT id FROM priceHistory WHERE productId = ? AND endDate IS NULL ORDER BY startDate DESC LIMIT 1'
    );
    const updateEndDate = mainDb.prepare(
      'UPDATE priceHistory SET endDate = ? WHERE id = ?'
    );
    const insertPriceRecord = mainDb.prepare(`
      INSERT INTO priceHistory (productId, price, originalPrice, currency, startDate, endDate)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const workerProducts = workerDb.prepare('SELECT * FROM products').all();

    // Wrap all writes in a single transaction for atomicity and speed.
    const applyMerge = mainDb.transaction(() => {
      for (const wp of workerProducts) {
        const mainProduct = getMainProduct.get(wp.url);
        if (!mainProduct) {
          // Product exists in worker but not main (edge case: added during this run).
          // Skip; the sitemap job owns product insertion.
          continue;
        }

        // Only process products the worker actually touched.
        if (wp.lastCheckedAt <= mainProduct.lastCheckedAt) continue;

        // Sync the product metadata row.
        updateProduct.run(
          wp.name, wp.sku, wp.category, wp.description, wp.imageUrl,
          wp.stockLocations, wp.lastCheckedAt, wp.isActive,
          wp.url
        );

        if (wp.isActive === 0) {
          // Worker marked product inactive (404).  markProductInactive() only
          // updates the products row — it never touches priceHistory — so we
          // must close main's open record here using the worker's lastCheckedAt.
          const mOpen = getMainOpenPrice.get(mainProduct.id);
          if (mOpen) {
            updateEndDate.run(wp.lastCheckedAt, mOpen.id);
          }
        } else {
          // Fetch the worker's most-recent price record (endDate may be set or NULL).
          const wLatest = workerDb.prepare(
            'SELECT * FROM priceHistory WHERE productId = ? ORDER BY startDate DESC LIMIT 1'
          ).get(wp.id);

          if (wLatest) {
            // Fetch main's most-recent price record.
            const mLatest = getMainLatestPrice.get(mainProduct.id);

            if (mLatest && mLatest.startDate === wLatest.startDate) {
              // Same latest record — worker updated its endDate (price unchanged).
              // Copy the endDate from worker into main.
              updateEndDate.run(wLatest.endDate, mLatest.id);
            } else {
              // Worker has a newer record (price changed).
              // Close main's open record at the timestamp the new price started.
              const mOpen = getMainOpenPrice.get(mainProduct.id);
              if (mOpen) {
                updateEndDate.run(wLatest.startDate, mOpen.id);
              }
              // Insert the worker's new record, using main's productId.
              insertPriceRecord.run(
                mainProduct.id,
                wLatest.price,
                wLatest.originalPrice,
                wLatest.currency,
                wLatest.startDate,
                wLatest.endDate
              );
            }
          }
          // If wLatest is null: product never had a price — nothing to sync.
        }

        mergedCount += 1;
      }
    });

    applyMerge();
  } catch (err) {
    console.error(`[MERGE] Failed to merge worker DB ${workerDbPath}: ${err.message}`);
    try { workerDb.close(); } catch (closeErr) { void closeErr; }
    return 0;
  }

  workerDb.close();
  console.log(`[MERGE] ${mergedCount} products merged from ${path.basename(workerDbPath)}`);
  return mergedCount;
}

/**
 * Reads all worker-N.db files from workersDir, merges each into the
 * main database, then exports db.zip and runs an integrity check.
 *
 * @param {string} [workersDir] - Directory containing worker DB files.
 *                                Defaults to WORKERS_DIR env var or 'data/workers'.
 */
function runMerge(workersDir) {
  const dir = workersDir || process.env.WORKERS_DIR || DEFAULT_WORKERS_DIR;

  if (!fs.existsSync(dir)) {
    console.error(`[MERGE] Workers directory not found: ${dir}`);
    process.exit(1);
  }

  const workerDbs = fs.readdirSync(dir)
    .filter((f) => /^worker-\d+\.db$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));

  if (workerDbs.length === 0) {
    console.error(`[MERGE] No worker-N.db files found in ${dir}`);
    process.exit(1);
  }

  console.log(`[MERGE] Merging ${workerDbs.length} worker DB(s) into ${DB_PATH}`);

  const mainDb = openDatabase();
  let totalMerged = 0;

  for (const workerDbPath of workerDbs) {
    try {
      totalMerged += mergeFromWorkerDb(mainDb, workerDbPath);
    } catch (err) {
      console.error(`[MERGE] Unrecoverable error merging ${workerDbPath}: ${err.message}`);
      // Continue with remaining workers rather than abandoning all progress.
    }
  }

  console.log(`[MERGE] Total products merged: ${totalMerged}`);

  exportDatabaseToZip();

  const integrity = validateDatabaseIntegrity();
  if (!integrity.ok) {
    integrity.warnings.forEach((w) => console.error(`[INTEGRITY] ${w}`));
  } else {
    console.log('[INTEGRITY] Database integrity check passed');
  }

  console.log('[MERGE] Done.');
}

// Run when executed directly (npm run merge-workers)
if (require.main === module) {
  runMerge();
}

module.exports = { mergeFromWorkerDb, runMerge };
