'use strict';

/**
 * Lightweight HTTP-based page fetcher using axios.
 *
 * The site (extremetechcr.com) does not block automated requests, so a plain
 * HTTP GET is sufficient and significantly faster than launching a Playwright
 * browser (no browser startup overhead, no JavaScript execution).
 *
 * Use this module when USE_HTTP_FETCHER = true in src/config.js.
 * If Cloudflare starts blocking, set USE_HTTP_FETCHER = false to fall back
 * to the Playwright browser (browser.js).
 */

const axios = require('axios');
const { REQUEST_TIMEOUT_MS } = require('../config');

/** Headers that mimic a real Chrome browser to avoid trivial bot-detection heuristics. */
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-CR,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

/** Shared axios instance with defaults applied once. */
const httpClient = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  headers: BROWSER_HEADERS,
  maxRedirects: 5,
  // Return string so cheerio can parse it as HTML.
  responseType: 'text',
  // Don't throw on non-2xx so we can return the status code to the caller.
  validateStatus: () => true,
});

/**
 * Fetches a product page URL using a plain HTTP GET.
 * Returns the raw HTML and the HTTP status code.
 *
 * @param {string} url - Product or page URL to fetch.
 * @returns {Promise<{html: string, statusCode: number}>}
 */
async function fetchPageHttp(url) {
  const response = await httpClient.get(url);
  return {
    html: response.data || '',
    statusCode: response.status,
  };
}

/**
 * Fetches raw text from a URL (used for XML sitemaps).
 *
 * @param {string} url - Sitemap or XML URL to fetch.
 * @returns {Promise<string>} Raw response text.
 */
async function fetchTextHttp(url) {
  const response = await httpClient.get(url, {
    headers: {
      ...BROWSER_HEADERS,
      Accept: 'application/xml,text/xml,*/*;q=0.8',
    },
  });
  return response.data || '';
}

/**
 * No-op: HTTP fetcher is stateless; nothing to close.
 * Provided so callers can call closeBrowser() without branching.
 * @returns {Promise<void>}
 */
async function closeHttpClient() {
  // nothing to do
}

module.exports = { fetchPageHttp, fetchTextHttp, closeHttpClient };
