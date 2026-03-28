# Cloudflare / Bot-Detection Bypass Experiment

## Purpose
Determine *what* is actually blocking or slowing scraper requests to extremetechcr.com
before choosing a bypass strategy.  The timeout in the GitHub Actions job could be
caused by any of these (from most to least likely):

1. GitHub Actions IPs are flagged as cloud/datacenter IPs by Cloudflare or the CDN
2. Cloudflare JS Challenge fires on every request (requires browser JS execution)
3. The site is simply slow (large page, many assets, WooCommerce + plugins)
4. The `networkidle` / navigation waits in the scraper are too generous
5. A different WAF / rate-limiter (not Cloudflare) is in front

## How to run the probe

```bash
# From the repository root
node experiments/cloudflare-bypass/probe.js

# Or against a custom URL:
node experiments/cloudflare-bypass/probe.js https://extremetechcr.com/producto/some-product/
```

A `results.md` file will be written next to this README with the full report.

## What the probe tests

| Strategy | What it tells us |
|---|---|
| Raw HTTPS, no User-Agent | Baseline: does the server accept raw TLS with no UA? |
| Raw HTTPS, curl User-Agent | Is the blocking UA-based? |
| Raw HTTPS, Chrome User-Agent | Does spoofing a browser UA as a plain HTTP client help? |
| Axios, Chrome UA | Does a Node.js HTTP client with a good UA get through? |
| Playwright headless (no stealth) | Does a real browser (bad TLS fingerprint) get through? |
| Playwright headless + stealth | Does a real browser with stealth patches get through? |

## Interpreting results

- **`cf-ray` header in response** = Cloudflare is definitely the proxy
- **403 / 503 on all non-browser methods** = Cloudflare Bot Management or JS Challenge
  - Only Playwright+stealth gets through = real browser fingerprint needed
- **All methods get 200** = No bot protection; slowness is due to page weight
- **Only Playwright fails / timeouts** = GitHub Actions IP is flagged (not UA/fingerprint)
- **200 but HTML is a challenge page** = Silent CF JS challenge (stealth is solving it)

## Bypass options

### Free options

| Option | Works? | Notes |
|---|---|---|
| Playwright + stealth (current) | Likely yes | Bypasses CF JS challenge; may fail if IP is flagged |
| Lower concurrency (CONCURRENT_REQUESTS=1) | Partial | Reduces bot-score but makes full crawl very slow |
| Longer delay between requests | Partial | Same as above |
| GitHub Actions self-hosted runner (home IP) | Yes | Residential IP bypasses IP-reputation blocks |

### Cloudflare Worker (free tier)

A basic Cloudflare Worker using `fetch()` **does NOT bypass Cloudflare Bot Management**.
Reasons:
1. `Worker.fetch()` is a server-side HTTP request - no JS execution, no browser fingerprint
2. CF Bot Management operates at the application/firewall layer, not based on whether
   the request comes from Cloudflare-owned IPs
3. The JS Challenge that Cloudflare fires requires a real browser to solve; a Worker
   `fetch()` cannot execute it

A Worker would only help if the block is purely IP-reputation-based (GitHub IPs are
flagged but Cloudflare edge IPs are trusted). This is worth testing with the probe.

### Cloudflare Browser Rendering (paid, ~$5/month)

This **would work** because it runs a real Chromium browser inside a Cloudflare Worker:
- Executes JavaScript (solves CF JS challenges)
- Has proper browser fingerprinting (TLS, navigator properties)
- Runs from Cloudflare edge IPs (well-regarded, not flagged as datacenter bot)

Example Worker code:
```javascript
import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env) {
    const targetUrl = new URL(request.url).searchParams.get("url");
    const browser = await puppeteer.launch(env.MYBROWSER);
    const page = await browser.newPage();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    const html = await page.content();
    await browser.close();
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
};
```

Then in the Node.js scraper, instead of Playwright navigating directly, it calls:
`https://your-worker.workers.dev/?url=https://extremetechcr.com/producto/...`

### Other paid options

| Service | Cost | Notes |
|---|---|---|
| Bright Data (residential proxies) | ~$15+/mo | Best for IP-reputation blocks |
| ScrapingBee | ~$50+/mo | Managed, handles CF automatically |
| Zyte API | ~$25+/mo | Purpose-built for e-commerce scraping |

## Recommended path

1. Run the probe to identify the actual blocker
2. If Playwright+stealth succeeds in the probe:
   - The current code is correct; the job timeout is just a performance issue
   - Fix: reduce timeouts, reduce concurrency, limit URLs per run (already done in this PR)
3. If Playwright+stealth fails:
   - GitHub Actions datacenter IPs are flagged
   - Fix: use a self-hosted runner on a residential IP, OR use CF Browser Rendering API
4. If all methods get 200:
   - The blocking was never real; slowness is page-weight + GitHub runner performance
   - Fix: optimize waits in browser.js (already done in this PR)
