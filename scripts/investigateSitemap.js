'use strict';

/**
 * Sitemap investigation script.
 *
 * Fetches every sub-sitemap from the configured sitemap index using Playwright
 * (required because extremetechcr.com is behind Cloudflare), then:
 *
 *  1. Reports how many total / product URLs were found.
 *  2. Searches for TARGET_URL (env var) and prints whether it was found and in
 *     which sub-sitemap.
 *  3. Lists all product URLs whose slug ends with "-N" (WooCommerce
 *     disambiguation duplicates) so you can see which ones the site exposes.
 *
 * Run via:
 *   node scripts/investigateSitemap.js
 *   TARGET_URL=https://extremetechcr.com/producto/some-slug-2/ node scripts/investigateSitemap.js
 */

const { fetchUrl, extractUrlsFromSitemap, isProductUrl } = require('../src/scraper/sitemapReader');
const { closeBrowser } = require('../src/scraper/browser');
const { load } = require('cheerio');
const { SITEMAP_URL, PRODUCT_URL_PATTERNS } = require('../src/config');

const TARGET_URL = (process.env.TARGET_URL || 'https://extremetechcr.com/producto/adata-8gb-ddr5-4800-so-dimm-2/').trim();

// Matches WooCommerce disambiguation slugs like /some-product-2/ or /some-product-3/
const DISAMBIGUATION_RE = /-\d+\/$/;

async function fetchChildSitemapUrls(indexXml) {
  const $ = load(indexXml, { xmlMode: true });
  const childLocs = [];
  $('sitemapindex > sitemap > loc').each((_, el) => {
    childLocs.push($(el).text().trim());
  });
  return childLocs;
}

async function main() {
  console.log('=== SITEMAP INVESTIGATION ===');
  console.log(`Target URL : ${TARGET_URL}`);
  console.log(`Sitemap    : ${SITEMAP_URL}`);
  console.log('');

  console.log('Fetching sitemap index...');
  const indexXml = await fetchUrl(SITEMAP_URL);
  const childSitemapUrls = await fetchChildSitemapUrls(indexXml);

  if (childSitemapUrls.length === 0) {
    // Not a sitemap index — treat it as a regular sitemap
    console.log('(Not a sitemap index — treating as a single sitemap)');
    const urls = extractUrlsFromSitemap(indexXml);
    childSitemapUrls.length = 0;
    analyzeAndReport([{ loc: SITEMAP_URL, urls }]);
    return;
  }

  console.log(`Found ${childSitemapUrls.length} child sitemaps. Fetching each one...`);
  console.log('');

  const sitemapData = [];
  for (const loc of childSitemapUrls) {
    process.stdout.write(`  Fetching ${loc} ... `);
    try {
      const xml = await fetchUrl(loc);
      const urls = extractUrlsFromSitemap(xml);
      const productUrls = urls.filter(isProductUrl);
      console.log(`${urls.length} URLs (${productUrls.length} product URLs)`);
      sitemapData.push({ loc, urls, productUrls });
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      sitemapData.push({ loc, urls: [], productUrls: [], error: err.message });
    }
  }

  analyzeAndReport(sitemapData);
}

function analyzeAndReport(sitemapData) {
  const allProductUrls = [];
  for (const { productUrls } of sitemapData) {
    if (productUrls) allProductUrls.push(...productUrls);
  }

  const totalUrls = sitemapData.reduce((s, d) => s + (d.urls ? d.urls.length : 0), 0);

  console.log('');
  console.log('=== TOTALS ===');
  console.log(`Total URLs across all sitemaps : ${totalUrls}`);
  console.log(`Total product URLs             : ${allProductUrls.length}`);
  console.log('');

  // ── 1. Check for TARGET_URL ────────────────────────────────────────────────
  console.log('=== TARGET URL SEARCH ===');
  const targetNorm = TARGET_URL.toLowerCase().replace(/\/$/, '');
  let found = false;
  for (const { loc, productUrls } of sitemapData) {
    if (!productUrls) continue;
    const match = productUrls.find((u) => u.toLowerCase().replace(/\/$/, '') === targetNorm);
    if (match) {
      console.log(`✅ FOUND in: ${loc}`);
      console.log(`   Exact URL: ${match}`);
      found = true;
    }
  }
  if (!found) {
    console.log(`❌ NOT FOUND in any sitemap: ${TARGET_URL}`);
    // Try a partial slug match to catch slightly different variants
    const slug = TARGET_URL.replace(/^https?:\/\/[^/]+\/producto\//, '').replace(/\/$/, '');
    console.log(`   Searching for slug fragment: "${slug}"`);
    const partials = allProductUrls.filter((u) => u.toLowerCase().includes(slug.toLowerCase()));
    if (partials.length > 0) {
      console.log(`   Similar URLs found (${partials.length}):`);
      partials.forEach((u) => console.log(`     ${u}`));
    } else {
      // Also try without the trailing -2
      const baseSlug = slug.replace(/-\d+$/, '');
      if (baseSlug !== slug) {
        console.log(`   Also searching without disambiguation suffix: "${baseSlug}"`);
        const baseMatches = allProductUrls.filter((u) => u.toLowerCase().includes(baseSlug.toLowerCase()));
        if (baseMatches.length > 0) {
          console.log(`   URLs matching base slug "${baseSlug}" (${baseMatches.length}):`);
          baseMatches.forEach((u) => console.log(`     ${u}`));
        } else {
          console.log(`   No similar URLs found at all.`);
        }
      } else {
        console.log(`   No similar URLs found.`);
      }
    }
  }
  console.log('');

  // ── 2. List disambiguation (-N) product URLs ───────────────────────────────
  const disambigUrls = allProductUrls.filter((u) => DISAMBIGUATION_RE.test(u));
  console.log(`=== DISAMBIGUATION URLs (slug ends in -N/) — ${disambigUrls.length} found ===`);
  if (disambigUrls.length === 0) {
    console.log('  (none — the sitemap does not expose any -N duplicate slugs)');
  } else {
    // Group by sub-sitemap for readability
    for (const { loc, productUrls } of sitemapData) {
      if (!productUrls) continue;
      const inThis = productUrls.filter((u) => DISAMBIGUATION_RE.test(u));
      if (inThis.length > 0) {
        console.log(`  In ${loc} (${inThis.length}):`);
        inThis.forEach((u) => console.log(`    ${u}`));
      }
    }
  }
  console.log('');
  console.log('=== INVESTIGATION COMPLETE ===');
}

main()
  .catch((err) => {
    console.error('Investigation failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
