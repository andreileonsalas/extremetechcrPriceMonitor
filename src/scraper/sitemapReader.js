'use strict';

const axios = require('axios');
const { load } = require('cheerio');
const {
  SITEMAP_URL,
  USER_AGENT,
  REQUEST_TIMEOUT_MS,
  PRODUCT_URL_PATTERNS,
  SKIP_URL_PATTERNS,
  CONCURRENT_REQUESTS,
  REQUEST_DELAY_MS,
} = require('../config');

/**
 * Fetches the content of a URL with a configured user-agent and timeout.
 * @param {string} url - The URL to fetch.
 * @returns {Promise<string>} The response body as a string.
 */
async function fetchUrl(url) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: REQUEST_TIMEOUT_MS,
    responseType: 'text',
  });
  return response.data;
}

/**
 * Parses a sitemap XML string and returns all <loc> URLs found.
 * Handles both sitemap index files (containing nested sitemaps) and regular sitemaps.
 * @param {string} xml - Raw XML content of a sitemap.
 * @returns {Promise<string[]>} Array of all product URLs discovered.
 */
async function parseSitemap(xml) {
  const $ = load(xml, { xmlMode: true });
  const urls = [];

  // Check if this is a sitemap index (contains <sitemap> elements)
  const sitemapLocs = [];
  $('sitemapindex > sitemap > loc').each((_, el) => {
    sitemapLocs.push($(el).text().trim());
  });

  if (sitemapLocs.length > 0) {
    // It is a sitemap index - fetch each child sitemap in batches
    const allUrls = await fetchUrlsInBatches(sitemapLocs, async (loc) => {
      try {
        const childXml = await fetchUrl(loc);
        return extractUrlsFromSitemap(childXml);
      } catch (err) {
        console.error(`Failed to fetch child sitemap ${loc}: ${err.message}`);
        return [];
      }
    });
    return allUrls.flat();
  }

  // Regular sitemap: collect all <loc> URLs
  $('urlset > url > loc').each((_, el) => {
    urls.push($(el).text().trim());
  });

  return urls;
}

/**
 * Extracts <loc> URLs from a regular (non-index) sitemap XML string.
 * @param {string} xml - Raw XML content of a sitemap.
 * @returns {string[]} Array of URLs found in the sitemap.
 */
function extractUrlsFromSitemap(xml) {
  const $ = load(xml, { xmlMode: true });
  const urls = [];
  $('urlset > url > loc').each((_, el) => {
    urls.push($(el).text().trim());
  });
  return urls;
}

/**
 * Determines if a given URL is likely a WooCommerce product page,
 * based on URL path patterns and skip-list patterns.
 * @param {string} url - The URL to evaluate.
 * @returns {boolean} True if the URL appears to be a product page.
 */
function isProductUrl(url) {
  const lower = url.toLowerCase();

  // Skip known non-product patterns
  for (const pattern of SKIP_URL_PATTERNS) {
    if (lower.includes(pattern)) {
      return false;
    }
  }

  // Accept if it matches a known product path pattern
  for (const pattern of PRODUCT_URL_PATTERNS) {
    if (lower.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Processes an array of items in batches with a delay between batches.
 * Limits concurrency to CONCURRENT_REQUESTS items processed at a time.
 * @template T
 * @template R
 * @param {T[]} items - Array of items to process.
 * @param {function(T): Promise<R>} processor - Async function to process each item.
 * @returns {Promise<R[]>} Array of results from each processed item.
 */
async function fetchUrlsInBatches(items, processor) {
  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENT_REQUESTS) {
    const batch = items.slice(i, i + CONCURRENT_REQUESTS);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
    if (i + CONCURRENT_REQUESTS < items.length) {
      await delay(REQUEST_DELAY_MS);
    }
  }
  return results;
}

/**
 * Returns a promise that resolves after the given number of milliseconds.
 * @param {number} ms - Duration to wait in milliseconds.
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main entry point: fetches the configured sitemap, parses it (handling nested sitemaps),
 * and returns only URLs that appear to be product pages.
 * @returns {Promise<string[]>} Array of product URLs discovered from the sitemap.
 */
async function getProductUrlsFromSitemap() {
  console.log(`Fetching sitemap from ${SITEMAP_URL}`);
  const xml = await fetchUrl(SITEMAP_URL);
  const allUrls = await parseSitemap(xml);
  const productUrls = allUrls.filter(isProductUrl);
  console.log(`Found ${allUrls.length} total URLs, ${productUrls.length} product URLs`);
  return productUrls;
}

module.exports = {
  fetchUrl,
  parseSitemap,
  extractUrlsFromSitemap,
  isProductUrl,
  fetchUrlsInBatches,
  delay,
  getProductUrlsFromSitemap,
};
