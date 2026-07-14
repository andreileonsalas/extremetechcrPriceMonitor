'use strict';

/**
 * Weekly job: reads the sitemap to discover new product URLs
 * and adds them to the database without scraping prices yet.
 *
 * Configuration variables are sourced from src/config.js.
 * Modify that file to change behavior (sitemap URL, concurrency, etc.)
 */

const { getProductUrlsFromSitemap, getProductUrlsFromDiscoveryPages } = require('../scraper/sitemapReader');
const { upsertProduct, getAllProductUrls, exportDatabaseToZip } = require('../database/db');
const { closeBrowser } = require('../scraper/browser');
const { SITEMAP_MIN_EXPECTED_URLS, DISCOVERY_FALLBACK_URLS } = require('../config');

/**
 * Runs the sitemap update job.
 * Fetches all product URLs from the sitemap, compares against what is
 * already tracked in the database, and inserts new products.
 * Logs a detailed comparison so gaps are immediately visible in CI logs.
 *
 * When the sitemap returns fewer than SITEMAP_MIN_EXPECTED_URLS product URLs
 * (e.g. because the sitemap is returning a Cloudflare challenge page), the job
 * falls back to crawling the shop/category pages listed in DISCOVERY_FALLBACK_URLS
 * to discover new products by scraping links directly from the store front-end.
 *
 * @returns {Promise<void>}
 */
async function runSitemapUpdate() {
  console.log('Starting sitemap update job');

  let sitemapUrls = await getProductUrlsFromSitemap();
  let discoverySource = 'sitemap';

  // ── Fallback: category/shop page crawling ────────────────────────────────────
  // When the sitemap is broken or returns far fewer URLs than expected (e.g. because
  // the site returned a Cloudflare challenge page instead of XML), fall back to
  // extracting product links directly from the shop/category pages.
  if (sitemapUrls.length < SITEMAP_MIN_EXPECTED_URLS) {
    console.error(
      `[SITEMAP] CRITICAL: Sitemap returned only ${sitemapUrls.length} product URLs ` +
      `(minimum expected: ${SITEMAP_MIN_EXPECTED_URLS}). ` +
      'This likely means the sitemap is returning a Cloudflare challenge page or is empty. ' +
      'Falling back to category-page discovery.'
    );

    if (DISCOVERY_FALLBACK_URLS.length > 0) {
      const fallbackUrls = await getProductUrlsFromDiscoveryPages(DISCOVERY_FALLBACK_URLS);

      if (fallbackUrls.length > 0) {
        // Merge sitemap URLs (if any partial results) with fallback, deduplicating.
        const merged = new Set([...sitemapUrls, ...fallbackUrls]);
        sitemapUrls = [...merged];
        discoverySource = `sitemap+discovery-pages (${fallbackUrls.length} from discovery)`;
        console.log(`[DISCOVERY] Discovery fallback complete. Total combined URLs: ${sitemapUrls.length}`);
      } else {
        console.error('[DISCOVERY] CRITICAL: Discovery page fallback also returned 0 product URLs. ' +
          'No new products can be discovered this run. Check that extremetechcr.com is accessible ' +
          'from the GitHub Actions runner and that Playwright stealth is working.');
        discoverySource = 'none (all sources failed)';
      }
    } else {
      console.warn('[DISCOVERY] No DISCOVERY_FALLBACK_URLS configured — skipping fallback.');
    }
  }

  const existingUrls = new Set(getAllProductUrls());

  const newUrls = sitemapUrls.filter((url) => !existingUrls.has(url));
  const orphanedUrls = [...existingUrls].filter((url) => !sitemapUrls.includes(url));

  console.log('=== SITEMAP vs DATABASE COMPARISON ===');
  console.log(`  Discovery source         : ${discoverySource}`);
  console.log(`  Discovered product URLs  : ${sitemapUrls.length}`);
  console.log(`  Database tracked URLs    : ${existingUrls.size}`);
  console.log(`  New (discovered, not in DB)   : ${newUrls.length}`);
  console.log(`  Orphaned (in DB, not discovered): ${orphanedUrls.length}`);
  console.log('======================================');

  if (newUrls.length > 0) {
    console.log('New URLs being added:');
    newUrls.forEach((url) => console.log(`  + ${url}`));
  }

  if (orphanedUrls.length > 0) {
    console.log('Orphaned URLs (in DB but missing from discovery — may have been removed from the site):');
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
