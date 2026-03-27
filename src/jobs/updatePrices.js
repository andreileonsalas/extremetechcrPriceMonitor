'use strict';

/**
 * Daily job: visits all tracked product URLs and updates their prices.
 * Also marks products as inactive if they return a 404.
 *
 * ALL CONFIGURATION IS AT THE TOP OF src/config.js - edit that file
 * to change: sitemap URL, concurrency, delay, timeouts, DB paths, selectors.
 */

const { scrapeProduct } = require('../scraper/productScraper');
const {
  upsertProduct,
  recordPrice,
  markProductInactive,
  getAllProductUrls,
  exportDatabaseToZip,
} = require('../database/db');
const { fetchUrlsInBatches } = require('../scraper/sitemapReader');

/**
 * Processes a single product URL: scrapes it and updates the database.
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
  } catch (err) {
    console.error(`Error processing ${url}: ${err.message}`);
  }
}

/**
 * Runs the daily price update job.
 * Loads all tracked product URLs from the database and processes them
 * in rate-limited batches.
 * @returns {Promise<void>}
 */
async function runPriceUpdate() {
  console.log('Starting price update job');

  const urls = getAllProductUrls();
  console.log(`Processing ${urls.length} product URLs`);

  await fetchUrlsInBatches(urls, processProductUrl);

  exportDatabaseToZip();
  console.log('Price update job complete');
}

// Run when executed directly
if (require.main === module) {
  runPriceUpdate().catch((err) => {
    console.error('Price update job failed:', err);
    process.exit(1);
  });
}

module.exports = { runPriceUpdate, processProductUrl };
