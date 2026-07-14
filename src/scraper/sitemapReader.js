'use strict';

const { fetchText, fetchPage } = require('./browser');
const { load } = require('cheerio');
const {
  SITEMAP_URL,
  SITEMAP_FALLBACK_URLS,
  PRODUCT_URL_PATTERNS,
  SKIP_URL_PATTERNS,
  CONCURRENT_REQUESTS,
  REQUEST_DELAY_MS,
} = require('../config');

/**
 * Fetches the content of a URL using a real browser (handles Cloudflare challenges).
 * @param {string} url - The URL to fetch.
 * @returns {Promise<string>} The response body as a string.
 */
async function fetchUrl(url) {
  return fetchText(url);
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
 * Returns true when the fetched content appears to be a Cloudflare challenge or
 * error page rather than the real site content.  This is used to detect when the
 * sitemap fetch received a CF HTML page instead of XML, so the caller can log a
 * clear CRITICAL warning and fall back to an alternative discovery source.
 *
 * Covers all known CF challenge variants:
 *   - Managed challenge (invisible JS auto-solve): loads challenges.cloudflare.com
 *   - Interactive challenge (CAPTCHA): cf-browser-verification element
 *   - Legacy JS challenge: jschl-answer token
 *   - Turnstile (newer CF): "Verify you are human"
 *   - "Just a moment..." loading page
 * @param {string} content - Raw response text to inspect.
 * @returns {boolean}
 */
function isCloudflareContent(content) {
  return (
    content.includes('challenges.cloudflare.com') ||
    content.includes('cf-browser-verification') ||
    content.includes('__cf_chl_f_tk') ||
    content.includes('jschl-answer') ||
    content.includes('Just a moment...') ||
    (content.includes('cloudflare') && content.includes('Enable JavaScript'))
  );
}

/**
 * Extracts product page URLs from an HTML page (e.g. a WooCommerce shop or
 * category listing page). All <a href> links that match the product URL
 * patterns (and are not in the skip list) are returned.
 *
 * This is used by the fallback discovery path when the sitemap is unavailable.
 *
 * @param {string} html - Raw HTML string of the shop/category page.
 * @param {string} baseUrl - Absolute URL of the page (used to resolve relative hrefs).
 * @returns {string[]} Deduplicated array of absolute product page URLs.
 */
function extractProductUrlsFromHtml(html, baseUrl) {
  const $ = load(html);
  const urls = new Set();

  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    base = { origin: '' };
  }

  $('a[href]').each((_, el) => {
    let href = $(el).attr('href') || '';
    if (!href) return;

    // Resolve relative links to absolute
    try {
      if (!href.startsWith('http')) {
        href = new URL(href, base.origin || baseUrl).toString();
      }
    } catch {
      return;
    }

    // Strip query parameters to normalise the URL
    const clean = href.split('?')[0].replace(/\/?$/, '/');

    if (isProductUrl(clean)) {
      urls.add(clean);
    }
  });

  return [...urls];
}

/**
 * Crawls a list of shop/category page URLs to collect product URLs as a
 * fallback when the sitemap is empty or returning a Cloudflare challenge.
 *
 * For each base URL the function fetches successive paginated pages
 * (/page/2/, /page/3/, …) until either:
 *   - a page returns a 404 (no more pages), or
 *   - a page returns no product links (end of listing), or
 *   - the per-URL page limit (maxPagesPerUrl) is reached.
 *
 * @param {string[]} discoveryUrls - Shop/category page URLs to crawl.
 * @param {number} [maxPagesPerUrl=10] - Maximum paginated pages to crawl per URL.
 * @returns {Promise<string[]>} Deduplicated array of discovered product URLs.
 */
async function getProductUrlsFromDiscoveryPages(discoveryUrls, maxPagesPerUrl = 10) {
  const allUrls = new Set();

  for (const baseUrl of discoveryUrls) {
    console.log(`[DISCOVERY] Crawling ${baseUrl} for product URLs (max ${maxPagesPerUrl} pages)`);

    for (let pageNum = 1; pageNum <= maxPagesPerUrl; pageNum++) {
      // WooCommerce paginates as /page/N/ appended to the base URL (strip query
      // string first so page/2/?orderby=date is not doubled).
      const baseWithoutQuery = baseUrl.split('?')[0].replace(/\/?$/, '/');
      const queryString = baseUrl.includes('?') ? `?${baseUrl.split('?')[1]}` : '';
      const pageUrl = pageNum === 1 ? baseUrl : `${baseWithoutQuery}page/${pageNum}/${queryString}`;

      try {
        const { html, statusCode } = await fetchPage(pageUrl);

        if (statusCode === 404) {
          console.log(`[DISCOVERY] ${pageUrl} → 404, stopping pagination for ${baseUrl}`);
          break;
        }

        const pageUrls = extractProductUrlsFromHtml(html, pageUrl);
        const newCount = pageUrls.filter((u) => !allUrls.has(u)).length;
        pageUrls.forEach((u) => allUrls.add(u));
        console.log(`[DISCOVERY] Page ${pageNum}: ${pageUrls.length} products found (+${newCount} new, total ${allUrls.size})`);

        if (pageUrls.length === 0) {
          console.log(`[DISCOVERY] No products on page ${pageNum}, stopping pagination`);
          break;
        }

        if (pageNum < maxPagesPerUrl) {
          await delay(REQUEST_DELAY_MS);
        }
      } catch (err) {
        console.error(`[DISCOVERY] Error fetching ${pageUrl}: ${err.message}`);
        break;
      }
    }
  }

  const result = [...allUrls];
  console.log(`[DISCOVERY] Total product URLs found from discovery pages: ${result.length}`);
  return result;
}

/**
 * Tries to fetch and parse a single sitemap URL.
 * Returns the array of product URLs found, or null if the fetch failed or
 * returned a Cloudflare challenge page.
 * @param {string} sitemapUrl - URL of the sitemap to try.
 * @returns {Promise<string[]|null>}
 */
async function tryFetchSitemap(sitemapUrl) {
  console.log(`[SITEMAP] Fetching ${sitemapUrl}`);
  let xml;
  try {
    xml = await fetchUrl(sitemapUrl);
  } catch (err) {
    console.error(`[SITEMAP] Failed to fetch ${sitemapUrl}: ${err.message}`);
    return null;
  }

  // Log a content snippet to make future debugging straightforward.
  const snippet = xml.slice(0, 300).replace(/\s+/g, ' ');
  console.log(`[SITEMAP] Response from ${sitemapUrl} — ${xml.length} bytes. Snippet: ${snippet}`);

  if (!xml || xml.trim().length === 0) {
    console.error(`[SITEMAP] ${sitemapUrl} returned an empty response.`);
    return null;
  }

  if (isCloudflareContent(xml)) {
    console.error(
      `[SITEMAP] CRITICAL: ${sitemapUrl} returned a Cloudflare challenge page instead of XML. ` +
      'Playwright stealth may not be bypassing the CF managed challenge for this URL. ' +
      'Run `node experiments/cloudflare-bypass/probe.js` to diagnose.'
    );
    return null;
  }

  const allUrls = await parseSitemap(xml);
  const productUrls = allUrls.filter(isProductUrl);
  console.log(`[SITEMAP] ${sitemapUrl} → ${allUrls.length} total URLs, ${productUrls.length} product URLs`);
  return productUrls;
}

/**
 * Main entry point: fetches the configured sitemap (and fallback sitemaps if
 * the primary returns 0 product URLs), parses it, and returns only URLs that
 * appear to be product pages.
 *
 * If ALL sitemap sources return 0 product URLs (e.g. because the sitemap is
 * returning a Cloudflare challenge page), a CRITICAL warning is logged so the
 * failure is immediately visible in Actions logs.  Callers (updateSitemap.js)
 * should then fall back to the category-page discovery path.
 *
 * @returns {Promise<string[]>} Array of product URLs discovered from the sitemap(s).
 */
async function getProductUrlsFromSitemap() {
  const sitemapUrlsToTry = [SITEMAP_URL, ...SITEMAP_FALLBACK_URLS];

  for (const sitemapUrl of sitemapUrlsToTry) {
    const productUrls = await tryFetchSitemap(sitemapUrl);

    if (productUrls && productUrls.length > 0) {
      console.log(`Found ${productUrls.length} product URLs from ${sitemapUrl}`);
      return productUrls;
    }

    if (productUrls !== null) {
      // Fetch succeeded but returned 0 product URLs — try next source.
      console.warn(`[SITEMAP] ${sitemapUrl} returned 0 product URLs. Trying next source.`);
    }
    // productUrls === null means fetch failed or CF challenge — already logged above.
  }

  console.error(
    '[SITEMAP] CRITICAL: All sitemap sources returned 0 product URLs. ' +
    'No new products will be discovered via sitemap this run. ' +
    'Callers should fall back to category-page discovery.'
  );
  return [];
}

module.exports = {
  fetchUrl,
  parseSitemap,
  extractUrlsFromSitemap,
  isProductUrl,
  isCloudflareContent,
  extractProductUrlsFromHtml,
  getProductUrlsFromDiscoveryPages,
  fetchUrlsInBatches,
  delay,
  getProductUrlsFromSitemap,
};
