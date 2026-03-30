# Cloudflare / Bot-Detection Bypass Experiment

## Confirmed finding (2026-03-29)

extremetechcr.com uses Cloudflare **managed challenge** (`cType: managed`).

**All plain HTTP clients are permanently blocked — no timing, delay, or header trick helps.**
Only a real Chromium browser that executes the challenge JavaScript gets through.

See `results.md` for the full multi-library probe data.

---

## How to run the probes

```bash
# Standard probe (from repo root) — tests raw HTTPS, axios, and Playwright variants
node experiments/cloudflare-bypass/probe.js [url]
# Writes experiments/cloudflare-bypass/results.md

# Extended npm-package probe (from /tmp/cf-probes after npm install)
node /tmp/cf-probes/extended-probe.js [url]
# Compares: axios, got-scraping, puppeteer, puppeteer-extra+stealth, playwright-extra+stealth
```

---

## What each strategy tests

| Strategy | What it tells us |
|---|---|
| Raw HTTPS / axios | Baseline: does the server accept server-side HTTP? |
| `got-scraping` (JA3 TLS) | Does TLS fingerprint spoofing bypass the challenge? |
| `tls-client` (Go TLS imitation) | Would perfect TLS impersonation help? |
| `puppeteer` headless (no stealth) | Does a real browser without anti-detection pass? |
| `puppeteer-extra` + stealth | Does the stealth plugin make a difference vs plain puppeteer? |
| `playwright-extra` + stealth | Current production approach — fastest? |

---

## Results summary

| Approach | Works | Notes |
|---|---|---|
| Plain HTTP (any library) | ❌ | Cloudflare managed challenge requires JS execution — HTTP can never solve it |
| `got-scraping` JA3 TLS spoof | ❌ | Only helps with TLS-layer checks; CF challenge is application-layer JS |
| `tls-client` Go TLS imitation | ❌ (can't build) | ffi-napi fails on Node 24; likely same story as got-scraping if it compiled |
| `puppeteer` no stealth | ✅ ~3 600 ms | Works but slowest — CF challenge takes longer without stealth |
| `puppeteer-extra` + stealth | ✅ ~1 900 ms | Works; 1.5× slower than Playwright |
| `playwright-extra` + stealth | ✅ **~1 200 ms** | **Fastest** — current production choice |

---

## Why the managed challenge can't be bypassed by HTTP clients

Cloudflare's managed challenge requires the client to:
1. Execute JavaScript that fingerprints the browser (navigator, canvas, WebGL, timing)
2. Compute a proof-of-work token and POST it back
3. Receive the `cf_clearance` cookie — only then is the real page served

No HTTP library (even with perfect TLS fingerprinting) can do steps 1–3.
This is a **JS execution requirement**, not a rate-limit or IP-reputation block.

---

## Bypass options (cheapest to most expensive)

| Option | Cost | Notes |
|---|---|---|
| `playwright-extra` + stealth **[current]** | Free | Fastest; resource blocking cuts page load from ~3 s to ~1.2 s |
| `puppeteer-extra` + stealth | Free | Same stealth plugin already in package.json; ~1.9 s/page |
| Self-hosted runner (home IP) | Free | Avoids GitHub datacenter IP flags for stricter CF configs |
| Cloudflare Browser Rendering API | ~$5/mo Workers Paid | Real Chromium on CF edge; bypasses most bot checks |
| Residential proxy (Bright Data) | ~$15+/mo | Best for IP-reputation blocks |

---

## `worker-browser-rendering.js`

A prototype of using the Cloudflare Browser Rendering API (paid Workers tier).
Only needed if `playwright-extra + stealth` stops working in GitHub Actions due to
IP-reputation flagging of the runner datacenter.
