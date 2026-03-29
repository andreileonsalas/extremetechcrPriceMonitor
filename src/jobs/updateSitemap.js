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
const { closeBrowser } = require('../scraper/browser');

/**
 * Runs the sitemap update job.
 * Fetches all product URLs from the sitemap, compares against what is
 * already tracked in the database, and inserts new products.
 * Logs a detailed comparison so gaps are immediately visible in CI logs.
 * @returns {Promise<void>}
 */
async function runSitemapUpdate() {
  console.log('Starting sitemap update job');

  const sitemapUrls = await getProductUrlsFromSitemap();
  const existingUrls = new Set(getAllProductUrls());

  const newUrls = sitemapUrls.filter((url) => !existingUrls.has(url));
  const orphanedUrls = [...existingUrls].filter((url) => !sitemapUrls.includes(url));

  console.log('=== SITEMAP vs DATABASE COMPARISON ===');
  console.log(`  Sitemap product URLs : ${sitemapUrls.length}`);
  console.log(`  Database tracked URLs: ${existingUrls.size}`);
  console.log(`  New (in sitemap, not in DB): ${newUrls.length}`);
  console.log(`  Orphaned (in DB, not in sitemap — possibly deleted from site): ${orphanedUrls.length}`);
  console.log('======================================');

  if (newUrls.length > 0) {
    console.log('New URLs being added:');
    newUrls.forEach((url) => console.log(`  + ${url}`));
  }

  if (orphanedUrls.length > 0) {
    console.log('Orphaned URLs (in DB but missing from sitemap — may have been removed from the site):');
    orphanedUrls.forEach((url) => console.log(`  ? ${url}`));
  }

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
  await closeBrowser();
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
