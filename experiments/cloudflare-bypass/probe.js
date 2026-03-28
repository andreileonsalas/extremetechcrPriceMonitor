'use strict';

/**
 * Cloudflare / Bot-Detection Experiment
 * =======================================
 * Tries multiple HTTP strategies against a target URL and records:
 *   - HTTP status code
 *   - Response time (ms)
 *   - Whether the response looks like a real product page
 *   - Key response headers (CF-Ray, Server, x-cache, etc.)
 *
 * This helps identify WHO is blocking requests and HOW, before deciding
 * on the right bypass strategy.
 *
 * Usage:
 *   node experiments/cloudflare-bypass/probe.js [url]
 *
 * Default target: https://extremetechcr.com/producto/lenovo-ideapad-slim-3-ryzen-7-7735hs-16gb-cosmic-blue-83k700b8gj/
 *
 * Results are printed to stdout as a markdown table and written to
 * experiments/cloudflare-bypass/results.md
 *
 * Requirements (install from repo root):
 *   npm ci   (axios and playwright-extra are already in package.json)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const TARGET_URL = process.argv[2]
  || 'https://extremetechcr.com/producto/lenovo-ideapad-slim-3-ryzen-7-7735hs-16gb-cosmic-blue-83k700b8gj/';

const RESULTS_PATH = path.join(__dirname, 'results.md');

/** Maximum bytes of response body to sample for diagnostics (keeps memory low). */
const MAX_BODY_SAMPLE_SIZE = 4096;

/** Milliseconds to wait between consecutive probes to avoid rate-limiting. */
const PROBE_DELAY_MS = 2000;

/**
 * Returns the current high-resolution timestamp in milliseconds.
 * @returns {number}
 */
function now() {
  return Date.now();
}

/**
 * Extracts a subset of interesting response headers for diagnostic purposes.
 * @param {Record<string,string>} headers - Raw headers object.
 * @returns {Record<string,string>} Filtered headers.
 */
function pickHeaders(headers) {
  const interesting = [
    'server', 'cf-ray', 'cf-cache-status', 'x-cache',
    'x-powered-by', 'content-type', 'location',
    'set-cookie', 'x-frame-options', 'via',
  ];
  const result = {};
  for (const key of interesting) {
    const val = headers[key] || headers[key.toLowerCase()];
    if (val) result[key] = Array.isArray(val) ? val[0] : String(val).slice(0, 120);
  }
  return result;
}

/**
 * Returns a short diagnosis string based on status code and body content.
 * @param {number} status
 * @param {string} body
 * @returns {string}
 */
function diagnose(status, body) {
  if (status === 0) return 'TIMEOUT or CONNECTION ERROR';
  if (status === 403) return 'BLOCKED (403 Forbidden)';
  if (status === 429) return 'RATE LIMITED (429)';
  if (status === 503) return 'SERVICE UNAVAILABLE / CF challenge (503)';
  if (body.includes('Just a moment') || body.includes('cf-browser-verification')) {
    return 'CF JS CHALLENGE PAGE';
  }
  if (body.includes('Enable JavaScript') || body.includes('enable javascript')) {
    return 'CF JS CHALLENGE (no-script fallback)';
  }
  if (body.includes('Access denied') || body.includes('access denied')) {
    return 'ACCESS DENIED';
  }
  if (body.includes('product_title') || body.includes('woocommerce') || body.includes('add to cart')) {
    return 'SUCCESS - real product page';
  }
  if (status === 200) return `HTTP 200 but body unrecognized (${body.length} bytes)`;
  return `HTTP ${status}`;
}

/**
 * Performs a raw HTTPS GET request using Node's built-in https module.
 * No browser, no special headers beyond what is configured.
 * @param {string} url
 * @param {Record<string,string>} extraHeaders
 * @returns {Promise<{status: number, headers: object, body: string, ms: number}>}
 */
function rawHttpsGet(url, extraHeaders = {}) {
  return new Promise((resolve) => {
    const t = now();
    const defaultHeaders = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-CR,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      ...extraHeaders,
    };

    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: defaultHeaders,
      timeout: 15000,
    };

    const req = (parsedUrl.protocol === 'https:' ? https : http).request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8', 0, MAX_BODY_SAMPLE_SIZE);
        resolve({
          status: res.statusCode,
          headers: pickHeaders(res.headers),
          body,
          ms: now() - t,
        });
      });
    });

    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, body: '', ms: now() - t }); });
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: e.message, ms: now() - t }));
    req.end();
  });
}

/**
 * Fetches a URL using axios with a configurable User-Agent.
 * @param {string} url
 * @param {string} userAgent
 * @returns {Promise<{status: number, headers: object, body: string, ms: number}>}
 */
async function axiosGet(url, userAgent) {
  const axios = require('axios');
  const t = now();
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CR,es;q=0.9,en;q=0.8',
      },
      responseType: 'text',
    });
    return {
      status: res.status,
      headers: pickHeaders(res.headers),
      body: (res.data || '').slice(0, MAX_BODY_SAMPLE_SIZE),
      ms: now() - t,
    };
  } catch (err) {
    return { status: 0, headers: {}, body: err.message, ms: now() - t };
  }
}

/**
 * Fetches a URL using Playwright (real browser), optionally with the stealth plugin.
 * @param {string} url
 * @param {boolean} useStealth
 * @returns {Promise<{status: number, headers: object, body: string, ms: number}>}
 */
async function playwrightGet(url, useStealth) {
  let chromium;
  if (useStealth) {
    chromium = require('playwright-extra').chromium;
    const stealth = require('puppeteer-extra-plugin-stealth');
    chromium.use(stealth());
  } else {
    chromium = require('playwright').chromium;
  }

  const t = now();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    let finalStatus = 200;
    const responseHeaders = {};

    page.on('response', (response) => {
      if (
        response.request().isNavigationRequest() &&
        response.request().frame() === page.mainFrame()
      ) {
        finalStatus = response.status();
        Object.assign(responseHeaders, pickHeaders(response.headers()));
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const title = await page.title().catch(() => '');
    if (title === 'Just a moment...') {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    const body = (await page.content()).slice(0, MAX_BODY_SAMPLE_SIZE);
    return { status: finalStatus, headers: responseHeaders, body, ms: now() - t };
  } catch (err) {
    return { status: 0, headers: {}, body: err.message, ms: now() - t };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Runs all probe strategies in sequence and returns results.
 * Sequential (not parallel) to avoid rate limiting affecting comparisons.
 * @param {string} url
 * @returns {Promise<Array<{strategy: string, result: object}>>}
 */
async function runAllProbes(url) {
  const results = [];

  console.log(`\nProbing: ${url}\n`);

  const strategies = [
    {
      name: 'Raw HTTPS (no User-Agent)',
      fn: () => rawHttpsGet(url, {}),
    },
    {
      name: 'Raw HTTPS (curl User-Agent)',
      fn: () => rawHttpsGet(url, { 'User-Agent': 'curl/7.88.1' }),
    },
    {
      name: 'Raw HTTPS (Chrome User-Agent)',
      fn: () => rawHttpsGet(url, {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }),
    },
    {
      name: 'Axios (Chrome User-Agent)',
      fn: () => axiosGet(url,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ),
    },
    {
      name: 'Playwright headless (no stealth)',
      fn: () => playwrightGet(url, false),
    },
    {
      name: 'Playwright headless (with stealth)',
      fn: () => playwrightGet(url, true),
    },
  ];

  for (const strategy of strategies) {
    process.stdout.write(`  Testing: ${strategy.name} ... `);
    const result = await strategy.fn();
    const verdict = diagnose(result.status, result.body);
    process.stdout.write(`${result.status} / ${result.ms}ms -> ${verdict}\n`);
    results.push({ strategy: strategy.name, status: result.status, ms: result.ms, verdict, headers: result.headers });

    // Brief pause between probes so we do not trigger rate limiting
    await new Promise((r) => setTimeout(r, PROBE_DELAY_MS));
  }

  return results;
}

/**
 * Formats the probe results as a Markdown report.
 * @param {string} url
 * @param {Array} results
 * @returns {string}
 */
function formatMarkdownReport(url, results) {
  const lines = [
    '# Cloudflare / Bot-Detection Probe Results',
    '',
    `**Target URL:** ${url}`,
    `**Date:** ${new Date().toISOString()}`,
    '',
    '## Summary Table',
    '',
    '| Strategy | Status | Time (ms) | Verdict |',
    '|---|---|---|---|',
    ...results.map((r) =>
      `| ${r.strategy} | ${r.status} | ${r.ms} | ${r.verdict} |`
    ),
    '',
    '## Response Headers per Strategy',
    '',
    ...results.map((r) => [
      `### ${r.strategy}`,
      '',
      '```',
      JSON.stringify(r.headers, null, 2),
      '```',
      '',
    ].join('\n')),
    '## Analysis Guide',
    '',
    '- **`cf-ray` header present** = Cloudflare is in front of the site',
    '- **Status 403 / body "Just a moment..."** = Cloudflare Bot Management or JS Challenge',
    '- **Status 200 but body unrecognized** = Possible silent bot fingerprinting page',
    '- **Status 200 with product content** = Request was allowed through',
    '- **If only Playwright+stealth succeeds**: real browser fingerprinting is required',
    '- **If even Playwright+stealth fails**: IP reputation block (GitHub Actions IPs are cloud-flagged)',
    '',
    '## Bypass Options (in order of practicality)',
    '',
    '| Option | Cost | Effort | Notes |',
    '|---|---|---|---|',
    '| Playwright + stealth (current) | Free | Done | Works if IP not blocked |',
    '| Slower request rate (lower concurrency + longer delay) | Free | Low | Reduces bot-score triggers |',
    '| Cloudflare Worker `fetch()` proxy | Free | Medium | Does NOT bypass CF Bot Mgmt - same server-side request |',
    '| Cloudflare Browser Rendering API | ~$5/mo Workers Paid | Medium | Real Chromium on CF edge - bypasses most checks |',
    '| Residential proxy service (e.g. Bright Data, Oxylabs) | ~$15+/mo | Low | Bypasses IP-reputation blocks |',
    '| ScrapingBee / Zyte / ScrapeOps | ~$50+/mo | Very Low | Managed anti-bot solution |',
    '| Run from non-cloud IP (e.g. self-hosted runner at home) | Free | Medium | Avoids GitHub IP flagging |',
    '',
    '## Cloudflare Worker Note',
    '',
    'A plain `fetch()` inside a Cloudflare Worker makes a **server-side HTTP request**.',
    'It has no browser fingerprint, cannot execute JavaScript challenges, and runs from',
    'Cloudflare infrastructure IPs. CF Bot Management applies at the **application layer**,',
    'not based on the source being Cloudflare-owned - so a plain Worker fetch will likely',
    'receive the same JS challenge / 403 as any other server-side request.',
    '',
    'The **Cloudflare Browser Rendering API** (Workers Paid) is different: it launches a',
    'real headless Chromium, executes JavaScript, passes fingerprint checks, and is',
    'effectively the same as running Playwright from a well-regarded IP range.',
  ];
  return lines.join('\n');
}

async function main() {
  const results = await runAllProbes(TARGET_URL);
  const report = formatMarkdownReport(TARGET_URL, results);
  fs.writeFileSync(RESULTS_PATH, report, 'utf8');
  console.log(`\nReport written to: ${RESULTS_PATH}`);
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
