# Cloudflare / Bot-Detection Probe Results

**Target URL:** https://extremetechcr.com/producto/lenovo-ideapad-slim-3-ryzen-7-7735hs-16gb-cosmic-blue-83k700b8gj/
**Date:** 2026-03-29T22:26:55.244Z

## Summary Table

| Strategy | Status | Time (ms) | Verdict |
|---|---|---|---|
| Raw HTTPS (no User-Agent) | 403 | 73 | BLOCKED (403 Forbidden) |
| Raw HTTPS (curl User-Agent) | 403 | 60 | BLOCKED (403 Forbidden) |
| Raw HTTPS (Chrome User-Agent) | 403 | 55 | BLOCKED (403 Forbidden) |
| Axios (Chrome User-Agent) | 403 | 62 | BLOCKED (403 Forbidden) |
| Playwright headless (no stealth) | 0 | 8 | TIMEOUT or CONNECTION ERROR |
| Playwright headless (with stealth) | 0 | 29 | TIMEOUT or CONNECTION ERROR |

## Response Headers per Strategy

### Raw HTTPS (no User-Agent)

```
{
  "server": "cloudflare",
  "cf-ray": "9e424c38693edadb-ORD",
  "content-type": "text/html; charset=UTF-8",
  "x-frame-options": "SAMEORIGIN"
}
```

### Raw HTTPS (curl User-Agent)

```
{
  "server": "cloudflare",
  "cf-ray": "9e424c4559d26bb0-DFW",
  "content-type": "text/html; charset=UTF-8",
  "x-frame-options": "SAMEORIGIN"
}
```

### Raw HTTPS (Chrome User-Agent)

```
{
  "server": "cloudflare",
  "cf-ray": "9e424c522c6addb3-DFW",
  "content-type": "text/html; charset=UTF-8",
  "x-frame-options": "SAMEORIGIN"
}
```

### Axios (Chrome User-Agent)

```
{
  "server": "cloudflare",
  "cf-ray": "9e424c5f5f6ee894-ORD",
  "content-type": "text/html; charset=UTF-8",
  "x-frame-options": "SAMEORIGIN"
}
```

### Playwright headless (no stealth)

```
{}
```

### Playwright headless (with stealth)

```
{}
```

## Analysis Guide

- **`cf-ray` header present** = Cloudflare is in front of the site
- **Status 403 / body "Just a moment..."** = Cloudflare Bot Management or JS Challenge
- **Status 200 but body unrecognized** = Possible silent bot fingerprinting page
- **Status 200 with product content** = Request was allowed through
- **If only Playwright+stealth succeeds**: real browser fingerprinting is required
- **If even Playwright+stealth fails**: IP reputation block (GitHub Actions IPs are cloud-flagged)

## Bypass Options (in order of practicality)

| Option | Cost | Effort | Notes |
|---|---|---|---|
| Playwright + stealth (current) | Free | Done | Works if IP not blocked |
| Slower request rate (lower concurrency + longer delay) | Free | Low | Reduces bot-score triggers |
| Cloudflare Worker `fetch()` proxy | Free | Medium | Does NOT bypass CF Bot Mgmt - same server-side request |
| Cloudflare Browser Rendering API | ~$5/mo Workers Paid | Medium | Real Chromium on CF edge - bypasses most checks |
| Residential proxy service (e.g. Bright Data, Oxylabs) | ~$15+/mo | Low | Bypasses IP-reputation blocks |
| ScrapingBee / Zyte / ScrapeOps | ~$50+/mo | Very Low | Managed anti-bot solution |
| Run from non-cloud IP (e.g. self-hosted runner at home) | Free | Medium | Avoids GitHub IP flagging |

## Cloudflare Worker Note

A plain `fetch()` inside a Cloudflare Worker makes a **server-side HTTP request**.
It has no browser fingerprint, cannot execute JavaScript challenges, and runs from
Cloudflare infrastructure IPs. CF Bot Management applies at the **application layer**,
not based on the source being Cloudflare-owned - so a plain Worker fetch will likely
receive the same JS challenge / 403 as any other server-side request.

The **Cloudflare Browser Rendering API** (Workers Paid) is different: it launches a
real headless Chromium, executes JavaScript, passes fingerprint checks, and is
effectively the same as running Playwright from a well-regarded IP range.