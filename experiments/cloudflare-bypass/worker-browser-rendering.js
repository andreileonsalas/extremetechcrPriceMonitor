/**
 * Cloudflare Worker: Browser Rendering Proxy
 * ============================================
 * This Worker uses the Cloudflare Browser Rendering API (paid feature on Workers Paid
 * plan, ~$5/month) to fetch a remote URL using a real headless Chromium browser running
 * on Cloudflare's edge network.
 *
 * Because the browser runs on Cloudflare's infrastructure, it:
 *  - Executes JavaScript (solves CF JS challenges and managed challenges)
 *  - Has a proper browser TLS fingerprint
 *  - Comes from a well-regarded IP range (not flagged as cloud/bot)
 *
 * This is the ONLY Cloudflare product that bypasses Cloudflare Bot Management.
 * A plain Worker fetch() (without puppeteer) does NOT - see README.md for details.
 *
 * Deployment:
 *   1. Enable Browser Rendering in the Cloudflare dashboard (Workers Paid plan)
 *   2. Add binding "MYBROWSER" of type "Browser Rendering" in the Worker settings
 *   3. Deploy with: npx wrangler deploy
 *
 * Usage from the Node.js scraper:
 *   const html = await fetch(
 *     `https://your-worker.workers.dev/?url=${encodeURIComponent(productUrl)}`
 *   ).then(r => r.text());
 *
 * wrangler.toml (put in this folder):
 *
 *   name = "extremetechcr-proxy"
 *   main = "worker-browser-rendering.js"
 *   compatibility_date = "2024-01-01"
 *
 *   [[browser]]
 *   binding = "MYBROWSER"
 *
 * NOTE: This is an EXAMPLE file, not currently deployed. It is here for reference if
 * the probe experiment confirms that the plain Playwright approach is blocked.
 */

import puppeteer from '@cloudflare/puppeteer';

export default {
  /**
   * Handles incoming requests.  Expects a "url" query parameter containing the
   * target product page URL to fetch.
   * @param {Request} request
   * @param {{ MYBROWSER: import('@cloudflare/puppeteer').BrowserWorker }} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const targetUrl = new URL(request.url).searchParams.get('url');

    if (!targetUrl) {
      return new Response('Missing ?url= parameter', { status: 400 });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (_) {
      return new Response('Invalid URL', { status: 400 });
    }

    // Strict allowlist: hostname must be exactly extremetechcr.com or a subdomain of it
    const allowedBase = 'extremetechcr.com';
    if (parsed.hostname !== allowedBase && !parsed.hostname.endsWith('.' + allowedBase)) {
      return new Response('Target domain not allowed', { status: 403 });
    }

    let browser;
    try {
      browser = await puppeteer.launch(env.MYBROWSER);
      const page = await browser.newPage();

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

      // If CF challenge fires, wait for it to resolve
      const title = await page.title().catch(() => '');
      if (title === 'Just a moment...') {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }

      const html = await page.content();

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      return new Response(`Error fetching page: ${err.message}`, { status: 500 });
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  },
};
