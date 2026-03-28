'use strict';

/**
 * Daily job: visits all tracked product URLs and updates their prices.
 * Also marks products as inactive if they return a 404.
 *
 * ALL CONFIGURATION IS AT THE TOP OF src/config.js - edit that file
 * to change: sitemap URL, concurrency, delay, timeouts, DB paths, selectors.
 *
 * Environment variables:
 *   PRICE_UPDATE_URLS  Comma-separated list of URLs to process instead of the
 *                      full database. Useful for quick one-off tests.
 */

const { scrapeProduct } = require('../scraper/productScraper');
const {
  upsertProduct,
  recordPrice,
  markProductInactive,
  getStaleProductUrls,
  exportDatabaseToZip,
  validateDatabaseIntegrity,
} = require('../database/db');
const { fetchUrlsInBatches } = require('../scraper/sitemapReader');
const { closeBrowser } = require('../scraper/browser');
const { MAX_URLS_PER_RUN } = require('../config');

/** How often (in products processed) to export an intermediate db.zip snapshot. */
const EXPORT_INTERVAL = 50;

/** Running count of successfully processed products in this run. */
let processedCount = 0;

/**
 * Processes a single product URL: scrapes it and updates the database.
 * Exports an intermediate db.zip snapshot every EXPORT_INTERVAL products so
 * that progress is preserved even if the job is cancelled mid-run.
 * @param {string} url - Product URL to process.
 * @returns {Promise<void>}
 */
async function processProductUrl(url) {
  try {
    const data = await scrapeProduct(url);

    if (data.statusCode === 404) {
      console.log(`Product 404, marking inactive: ${url}`);
      markProductInactive(url);
      return;
    }

    if (!data.isProduct) {
      console.log(`Not a product page, skipping: ${url}`);
      return;
    }

    const productId = upsertProduct(data);
    recordPrice(productId, data.price, data.currency, data.originalPrice);
    console.log(`Updated: ${url} | Price: ${data.price} ${data.currency}`);

    processedCount += 1;
    if (processedCount % EXPORT_INTERVAL === 0) {
      exportDatabaseToZip();
      console.log(`Progress snapshot exported after ${processedCount} products`);
    }
  } catch (err) {
    console.error(`Error processing ${url}: ${err.message}`);
  }
}

/**
 * Resolves the list of product URLs to process for this run.
 * Priority order:
 *  1. PRICE_UPDATE_URLS env var  (comma-separated, for targeted/test runs)
 *  2. Stale-first selection from the database, capped at MAX_URLS_PER_RUN
 * @returns {string[]}
 */
function resolveUrlsToProcess() {
  if (process.env.PRICE_UPDATE_URLS) {
    const overrideUrls = process.env.PRICE_UPDATE_URLS
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    console.log(`Using PRICE_UPDATE_URLS override: ${overrideUrls.length} URLs`);
    return overrideUrls;
  }
  return getStaleProductUrls(MAX_URLS_PER_RUN);
}

/**
 * Runs the daily price update job.
 * Processes up to MAX_URLS_PER_RUN product URLs (stale-first) and exports
 * the database to a ZIP on completion.  Runs a data-integrity check at the
 * end and logs any warnings found.
 * @returns {Promise<void>}
 */
async function runPriceUpdate() {
  console.log('Starting price update job');

  const urls = resolveUrlsToProcess();
  console.log(`Processing ${urls.length} product URLs (limit: ${MAX_URLS_PER_RUN})`);

  await fetchUrlsInBatches(urls, processProductUrl);

  exportDatabaseToZip();

  const integrity = validateDatabaseIntegrity();
  if (!integrity.ok) {
    integrity.warnings.forEach((w) => console.error(`[INTEGRITY] ${w}`));
  } else {
    console.log('[INTEGRITY] Database integrity check passed');
  }

  await closeBrowser();
  console.log(`Price update job complete. Processed ${processedCount} products.`);
}

// Run when executed directly
if (require.main === module) {
  runPriceUpdate().catch((err) => {
    console.error('Price update job failed:', err);
    process.exit(1);
  });
}

module.exports = { runPriceUpdate, processProductUrl, resolveUrlsToProcess };
