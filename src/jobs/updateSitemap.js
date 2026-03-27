'use strict';

/**
 * Weekly job: reads the sitemap to discover new product URLs
 * and adds them to the database without scraping prices yet.
 *
 * Configuration variables are sourced from src/config.js.
 * Modify that file to change behavior (sitemap URL, concurrency, etc.)
 */

const { getProductUrlsFromSitemap } = require('../scraper/sitemapReader');
const { upsertProduct, getAllProductUrls, exportDatabaseToZip } = require('../database/db');

/**
 * Runs the sitemap update job.
 * Fetches all product URLs from the sitemap, compares against what is
 * already tracked in the database, and inserts new products.
 * @returns {Promise<void>}
 */
async function runSitemapUpdate() {
  console.log('Starting sitemap update job');

  const sitemapUrls = await getProductUrlsFromSitemap();
  const existingUrls = new Set(getAllProductUrls());

  const newUrls = sitemapUrls.filter((url) => !existingUrls.has(url));
  console.log(`Found ${newUrls.length} new product URLs to add`);

  for (const url of newUrls) {
    upsertProduct({
      url,
      name: null,
      sku: null,
      category: null,
      description: null,
      imageUrl: null,
      isAvailable: true,
    });
  }

  exportDatabaseToZip();
  console.log('Sitemap update job complete');
}

// Run when executed directly
if (require.main === module) {
  runSitemapUpdate().catch((err) => {
    console.error('Sitemap update job failed:', err);
    process.exit(1);
  });
}

module.exports = { runSitemapUpdate };
