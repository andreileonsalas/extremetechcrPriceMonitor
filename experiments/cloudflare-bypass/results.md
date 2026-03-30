# Cloudflare / Bot-Detection Probe Results

**Target URL:** https://extremetechcr.com/producto/sony-playstation-5-slim-digital-825gb/
**Last updated:** 2026-03-29

## Quick verdict

> extremetechcr.com runs Cloudflare **managed challenge** (`cType: managed`).
> **Any HTTP client** (axios, got-scraping, curl, raw HTTPS) gets a 403 with a
> "Just a moment…" JS-challenge page — regardless of headers, User-Agent, rate,
> or delay.  Only a **real Chromium browser** that executes the challenge JS gets
> through.  Among browsers, the stealth plugin cuts solve time by ~30–65 %.

---

## Probe 1 — Standard HTTP strategies

| Strategy | Status | Time (ms) | Verdict |
|---|---|---|---|
| Raw HTTPS (no User-Agent) | 403 | 66 | ❌ BLOCKED — CF managed challenge |
| Raw HTTPS (curl User-Agent) | 403 | 61 | ❌ BLOCKED — CF managed challenge |
| Raw HTTPS (Chrome User-Agent) | 403 | 52 | ❌ BLOCKED — CF managed challenge |
| Axios (Chrome UA + all browser headers) | 403 | 70 | ❌ BLOCKED — CF managed challenge |
| Playwright headless (no stealth) | 200 | 2813 | ✅ Real product page (485 KB) |
| Playwright headless + stealth | 200 | 1647 | ✅ Real product page (485 KB) |

*Note:* `HTTP 200 but body unrecognized` in earlier runs was a false negative — the probe
sampled only 4 096 bytes of a 485 KB page, so WooCommerce identifiers were past the cutoff.
All 200-status browser responses contain the real product page.

---

## Probe 2 — Extended npm package comparison

Packages tested to find alternatives to Playwright:

| Package | Version | Type | Status | Time (ms) | Verdict |
|---|---|---|---|---|---|
| `axios` | 1.x | Plain HTTP | 403 | 196 | ❌ BLOCKED — CF managed challenge |
| `got-scraping` (Apify) | 4.2.1 | HTTP + JA3 TLS spoof | 403 | 122 | ❌ BLOCKED — CF managed challenge |
| `tls-client` | 0.0.5 | HTTP + Go TLS imitation | — | — | ⛔ SKIPPED — native ffi-napi fails on Node 24 |
| `puppeteer` headless (no stealth) | 24.40.0 | Real Chromium | 200 | 3599 | ✅ Real product page |
| `puppeteer-extra` + stealth | 3.3.6 + 2.11.2 | Real Chromium + stealth | 200 | 1885 | ✅ Real product page |
| `playwright-extra` + stealth **[PRODUCTION]** | 4.3.6 + 2.11.2 | Real Chromium + stealth + resource blocking | 200 | **1220** | ✅ Real product page — **fastest** |

---

## Why HTTP libraries can never work here

Cloudflare's **managed challenge** (`cType: managed`) requires the client to:

1. Execute a JavaScript challenge that fingerprints the browser environment
   (navigator properties, canvas, WebGL, timing, etc.)
2. Compute a proof-of-work token and POST it back to Cloudflare
3. Receive the `cf_clearance` cookie — only then is the redirect to the real page sent

An HTTP client (even one with a perfect TLS fingerprint like `got-scraping` or
`tls-client`) cannot do steps 1–3 because there is no JavaScript runtime.
This is fundamentally different from a _rate-limit_ block, where slower requests
or a better User-Agent might help.

**Conclusion: a Chromium browser is mandatory for this site. Timing/delay/headers
adjustments on HTTP clients do not help at all.**

---

## Why `got-scraping` still fails despite JA3 TLS spoofing

`got-scraping` mimics Chrome's TLS handshake (JA3 fingerprint) to fool bot detectors
that check only at the TLS layer.  Cloudflare's managed challenge works at the
_application layer_: it serves a page that requires JS execution.  The TLS fingerprint
is irrelevant once the connection is established.

---

## Browser comparison

| Browser package | Time (ms) | vs. production |
|---|---|---|
| `puppeteer` (no stealth) | 3 599 | 3× slower |
| `puppeteer-extra` + stealth | 1 885 | 1.5× slower |
| **`playwright-extra` + stealth + resource blocking** | **1 220** | **baseline** |

**playwright-extra + stealth** is the fastest because:
- `playwright` is more actively maintained than `puppeteer` for modern Chromium
- The stealth plugin reduces time the CF challenge needs to validate fingerprint
- Resource blocking (images / fonts / media / CSS) cuts per-page transfer from ~3 MB to ~300 KB

Both `puppeteer` variants work and could be used as a drop-in if Playwright ever
stops working. The stealth plugin (`puppeteer-extra-plugin-stealth`) is shared between
both — it's already a `dependencies` entry in `package.json`.

---

## 120-product local test results (2026-03-29)

Ran `PRICE_UPDATE_URLS=<120 URLs> node src/jobs/updatePrices.js` with
`USE_HTTP_FETCHER=false`, `CONCURRENT_REQUESTS=5`, `REQUEST_DELAY_MS=500`.

| Metric | Value |
|---|---|
| Products processed | 120 / 120 |
| Cloudflare blocks | **0** |
| Null prices | 0 |
| Total run time | ~2 minutes |
| Throughput | ~60–70 products / min |
| Estimated full catalogue (12 000) | ~170–200 minutes |
| GitHub Actions job limit | 300 minutes ✅ |

---

## Bypass options summary

| Option | Cost | Works? | Notes |
|---|---|---|---|
| `playwright-extra` + stealth **[current]** | Free | ✅ Yes | Fastest browser option; resource blocking reduces load |
| `puppeteer-extra` + stealth | Free | ✅ Yes | ~1.5× slower; same stealth plugin already in package.json |
| `puppeteer` (no stealth) | Free | ✅ Yes | ~3× slower; CF challenge takes longer to solve |
| `got-scraping` (JA3 TLS) | Free | ❌ No | Bypasses TLS-layer checks only; fails Cloudflare managed challenge |
| `tls-client` | Free | ❌ Likely no | Can't compile on Node 24; same reason as got-scraping even if compiled |
| `axios` / plain HTTP | Free | ❌ No | Always blocked |
| Cloudflare Browser Rendering API | ~$5/mo | ✅ Yes | Real Chromium on CF edge IPs |
| Residential proxies (Bright Data) | ~$15+/mo | ✅ Yes | Bypasses IP-reputation flags on cloud runners |
| Self-hosted runner (home IP) | Free | ✅ Yes | Residential IP, no datacenter flag |
