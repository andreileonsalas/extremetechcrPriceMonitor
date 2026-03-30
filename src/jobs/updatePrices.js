'use strict';

/**
 * Daily job: visits all tracked product URLs and updates their prices.
 * Also marks products as inactive if they return a 404.
 *
 * ALL CONFIGURATION IS AT THE TOP OF src/config.js - edit that file
 * to change: sitemap URL, concurrency, delay, timeouts, DB paths, selectors.
 *
 * Environment variables (workflow runtime controls, not configuration):
 *   PRICE_UPDATE_URLS       Comma-separated list of URLs to process instead of the
 *                           full database. Useful for quick one-off tests.
 *   PRICE_UPDATE_CHUNK_FILE Path to a JSON file containing an array of URLs to
 *                           process (written by the prepare stage of the parallel
 *                           pipeline). Takes priority over DB stale-first selection
 *                           but lower priority than PRICE_UPDATE_URLS.
 *   FAIL_ON_NULL_PRICE      Set to 'true' to fail the job when too many null prices
 *                           are detected (threshold: NULL_PRICE_FAIL_THRESHOLD in config.js).
 *   INCLUDE_INACTIVE        Set to 'true' to also process products marked inactive
 *                           (isActive = 0).  Used by the weekly full-database review
 *                           job to detect re-listed products and re-check 404 pages.
 */

const fs = require('fs');
const { scrapeProduct } = require('../scraper/productScraper');
const {
  upsertProduct,
  recordPrice,
  markProductInactive,
  getStaleProductUrls,
  exportDatabaseToZip,
  validateDatabaseIntegrity,
  closeDatabase,
} = require('../database/db');
const { fetchUrlsInBatches, delay } = require('../scraper/sitemapReader');
const { closeBrowser } = require('../scraper/browser');
const { MAX_URLS_PER_RUN, NULL_PRICE_RETRY_ATTEMPTS, NULL_PRICE_RETRY_DELAY_MS, NULL_PRICE_RETRY_BACKOFF_MULTIPLIER, NULL_PRICE_FAIL_THRESHOLD } = require('../config');

/** How often (in products processed) to export an intermediate db.zip snapshot. */
const EXPORT_INTERVAL = 50;

/** Running count of successfully processed products in this run. */
let processedCount = 0;

/** Running count of products whose price could not be determined in this run. */
let nullPriceCount = 0;

/**
 * Processes a single product URL: scrapes it and updates the database.
 * Exports an intermediate db.zip snapshot every EXPORT_INTERVAL products so
 * that progress is preserved even if the job is cancelled mid-run.
 * @param {string} url - Product URL to process.
 * @returns {Promise<void>}
 */
async function processProductUrl(url) {
  try {
    let data = await scrapeProduct(url);

    if (data.statusCode === 404) {
      console.log(`Product 404, marking inactive: ${url}`);
      markProductInactive(url);
      return;
    }

    // Unified retry loop with exponential backoff.
    // Retries when:
    //   - Cloudflare served a challenge page (isCloudflarePage)
    //   - Page loaded fine but price could not be extracted (price === null)
    // Exponential backoff spaces attempts further apart each time to avoid
    // triggering rate-limits: base=10 s, multiplier=2 → 10 s, 20 s, 40 s, …
    let attempt = 0;
    while (
      (data.isCloudflarePage || (data.isProduct && data.price === null)) &&
      attempt < NULL_PRICE_RETRY_ATTEMPTS
    ) {
      attempt += 1;
      const tag = data.isCloudflarePage ? '[CLOUDFLARE]' : '[NULL PRICE]';
      const reason = data.isCloudflarePage
        ? 'Cloudflare challenge page — browser clearance may need more time'
        : (data.priceDebug || 'unknown reason');
      const waitMs = NULL_PRICE_RETRY_DELAY_MS * Math.pow(NULL_PRICE_RETRY_BACKOFF_MULTIPLIER, attempt - 1);
      const delaySecs = Math.round(waitMs / 1000);
      console.warn(`  ${tag} ${url} | ${reason} | Retry ${attempt}/${NULL_PRICE_RETRY_ATTEMPTS} in ${delaySecs}s...`);
      await delay(waitMs);
      const retryData = await scrapeProduct(url);
      if (retryData.statusCode === 404) {
        console.warn(`  Retry ${attempt} returned 404, stopping retries`);
        data = retryData;
        break;
      }
      data = retryData;
    }

    // Handle terminal states after retries
    if (data.statusCode === 404) {
      console.log(`Product 404 on retry, marking inactive: ${url}`);
      markProductInactive(url);
      return;
    }

    if (data.isCloudflarePage) {
      console.warn(`  [CLOUDFLARE] ${url} | Challenge not resolved after ${NULL_PRICE_RETRY_ATTEMPTS} retries, skipping.`);
      return;
    }

    if (!data.isProduct) {
      console.log(`Not a product page, skipping: ${url}`);
      return;
    }

    const productId = upsertProduct(data);
    recordPrice(productId, data.price, data.currency, data.originalPrice);

    if (data.price === null) {
      nullPriceCount += 1;
      const reason = data.priceDebug || 'unknown reason';
      const htmlInfo = data.htmlDebug ? `\n    ${data.htmlDebug}` : '';
      console.warn(`  [NULL PRICE] ${url} | Reason: ${reason}${htmlInfo}`);
    }

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
 *  1. PRICE_UPDATE_URLS env var      (comma-separated, for targeted/test runs)
 *  2. PRICE_UPDATE_CHUNK_FILE env var (JSON array file, written by prepare stage)
 *  3. Stale-first selection from the database, capped at MAX_URLS_PER_RUN.
 *     When INCLUDE_INACTIVE=true, inactive products (isActive=0) are also
 *     included so the weekly review job can detect re-listed products.
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
  if (process.env.PRICE_UPDATE_CHUNK_FILE) {
    const chunkPath = process.env.PRICE_UPDATE_CHUNK_FILE;
    const urls = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
    console.log(`Using chunk file ${chunkPath}: ${urls.length} URLs`);
    return urls;
  }
  const includeInactive = process.env.INCLUDE_INACTIVE === 'true';
  if (includeInactive) {
    console.log('INCLUDE_INACTIVE=true: processing active AND inactive products');
  }
  return getStaleProductUrls(MAX_URLS_PER_RUN, includeInactive);
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
  closeDatabase();
  console.log(`Price update job complete. Processed ${processedCount} products.`);

  if (nullPriceCount > 0) {
    console.warn(`[NULL PRICES] ${nullPriceCount} product(s) had a null price in this run.`);
    if (process.env.FAIL_ON_NULL_PRICE === 'true' && nullPriceCount > NULL_PRICE_FAIL_THRESHOLD) {
      throw new Error(
        `Job failed: ${nullPriceCount} null-price product(s) exceeded the allowed threshold of ${NULL_PRICE_FAIL_THRESHOLD}. ` +
        `To allow null prices, set the workflow input 'fail_on_null_price' to 'false'.`
      );
    }
  }
}

// Run when executed directly
if (require.main === module) {
  runPriceUpdate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Price update job failed:', err);
      process.exit(1);
    });
}

module.exports = { runPriceUpdate, processProductUrl, resolveUrlsToProcess };
