'use strict';

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const { REQUEST_TIMEOUT_MS } = require('../config');

// Apply all stealth patches so Cloudflare's bot detection does not block the browser.
chromium.use(stealth());

/** @type {import('playwright-extra').Browser|null} */
let browserInstance = null;

/** @type {import('playwright-extra').BrowserContext|null} */
let contextInstance = null;

/**
 * Returns a shared stealth Chromium browser context, launching the browser if
 * needed.  Reusing the same context preserves Cloudflare clearance cookies
 * across requests so the managed challenge only has to be solved once per
 * job run.
 * @returns {Promise<import('playwright-extra').BrowserContext>}
 */
async function getBrowserContext() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless: true });
    contextInstance = await browserInstance.newContext({
      // Use a real Chrome UA so Cloudflare does not immediately flag the request.
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
  }
  return contextInstance;
}

/**
 * Fetches an HTML page using a real browser, automatically handling
 * Cloudflare managed challenges before returning the rendered content.
 *
 * @param {string} url - The product or page URL to fetch.
 * @returns {Promise<{html: string, statusCode: number}>} Rendered HTML and HTTP status.
 */
async function fetchPage(url) {
  const context = await getBrowserContext();
  const page = await context.newPage();
  // Track main-frame navigation responses so we end up with the final
  // status code after any Cloudflare challenge redirect (403 → 200).
  // Only the main frame is tracked to avoid 4xx responses from ad/analytics
  // iframes polluting the status.
  let finalStatusCode = 200;
  page.on('response', (response) => {
    if (
      response.request().isNavigationRequest() &&
      response.request().frame() === page.mainFrame()
    ) {
      finalStatusCode = response.status();
    }
  });
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: REQUEST_TIMEOUT_MS,
    });
    // If Cloudflare shows a "Just a moment..." challenge page, its orchestration
    // script solves the challenge and then submits a hidden form POST, which
    // triggers a real browser navigation back to the original URL.
    // We wait for that navigation here so we end up with the real page.
    const title = await page.title().catch(() => '');
    if (title === 'Just a moment...') {
      await page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      }).catch(() => {});
      // Let the actual product page settle after the CF redirect.
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
    return {
      html: await page.content(),
      statusCode: finalStatusCode,
    };
  } finally {
    await page.close();
  }
}

/**
 * Fetches raw text from a URL (used for XML sitemaps).
 *
 * With the stealth browser the Cloudflare challenge is typically bypassed and
 * the response is returned directly as a 200.  The raw response body is read
 * from the Playwright Response object, which avoids the browser XML viewer's
 * restricted JavaScript context that would block a page.evaluate(fetch) call.
 *
 * If a CF challenge is still shown, the browser solves it via a form-POST
 * navigation, and then a page-context fetch() is used to retrieve the clean
 * text body (cookies are already set at that point).
 *
 * @param {string} url - The sitemap or XML URL to fetch.
 * @returns {Promise<string>} Raw response text.
 */
async function fetchText(url) {
  const context = await getBrowserContext();
  const page = await context.newPage();
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: REQUEST_TIMEOUT_MS,
    });
    // Check whether we hit a CF challenge page.
    const title = await page.title().catch(() => '');
    if (title === 'Just a moment...') {
      // CF challenge completes via a form-POST navigation; wait for it.
      await page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      }).catch(() => {});
      // At this point cf_clearance is set; re-fetch the URL using the
      // browser's fetch() API so we get the raw XML text.
      return await page.evaluate(async (targetUrl) => {
        const res = await fetch(targetUrl);
        return res.text();
      }, url);
    }
    // No challenge: read the response body directly from the navigation response.
    // This avoids the XML viewer's restricted JS context.
    if (response) {
      return await response.text();
    }
    return '';
  } finally {
    await page.close();
  }
}

/**
 * Closes the shared browser instance.
 * Call this once all scraping for a job run is complete so that the
 * Node.js process can exit cleanly.
 * @returns {Promise<void>}
 */
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    contextInstance = null;
  }
}

module.exports = { fetchPage, fetchText, closeBrowser };
