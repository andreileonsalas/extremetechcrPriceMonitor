# FOR_THE_AI.md — ExtremeTechCR Price Monitor: Full Context

## WHAT THIS PROJECT DOES
Monitors prices of products from https://extremetechcr.com (Costa Rican electronics store, WooCommerce).
No backend server. Uses GitHub Actions + SQLite + GitHub Pages. Currency: CRC (₡, colón costarricense).

## ARCHITECTURE (read this first when debugging)

```
GitHub Actions (schedule/manual)
  └─ Weekly (Mon 2am): sitemap-crawler.yml     →  src/jobs/updateSitemap.js
  └─ Daily  (3am):     price-crawler.yml       →  src/jobs/updatePrices.js
  └─ Weekly (Thu 1am): price-crawler-weekly-db.yml → src/jobs/updatePrices.js (INCLUDE_INACTIVE=true)
  └─ Manual:           price-crawler-sample.yml (5 URLs, quick test)
       All jobs write to: data/prices.db (SQLite, cached between runs via actions/cache)
       All jobs export:   public/db.zip  (SQLite → ZIP, committed to repo)

GitHub Pages (serves from root of main branch)
  └─ index.html (root) → meta-refresh redirect to public/
  └─ public/index.html → loads main.js
  └─ public/main.js    → fetches db.zip, loads via sql.js in-browser, renders product cards
                          + mini 7-day sparkline charts below each product image
  └─ public/db.zip     → SQLite inside ZIP (updated by Actions, committed to repo)
```

## KEY FILES

| File | Purpose |
|---|---|
| `src/config.js` | ALL tunable constants — edit here first |
| `src/scraper/httpFetcher.js` | Plain HTTP fetcher using axios (kept for reference; NOT usable — site requires browser) |
| `src/scraper/browser.js` | Routes to httpFetcher or Playwright based on USE_HTTP_FETCHER flag (always false) |
| `src/scraper/productScraper.js` | Cheerio HTML parser, WooCommerce selectors |
| `src/scraper/sitemapReader.js` | sitemap.xml fetcher + URL filter |
| `src/database/db.js` | SQLite CRUD, schema, integrity check |
| `src/jobs/updateSitemap.js` | Weekly job: adds new URLs (name=null until priced) |
| `src/jobs/updatePrices.js` | Daily + weekly job: scrapes + prices URLs, exports ZIP |
| `public/main.js` | Frontend SPA (vanilla JS + sql.js + Chart.js + mini sparklines) |
| `scripts/seedDatabase.js` | One-time: build db.zip from curated seed data |
| `experiments/cloudflare-bypass/` | Diagnostic probes for bot-detection |

## CONFIG.JS VALUES (current)
```js
USE_HTTP_FETCHER = false     // MUST be false — site uses Cloudflare managed challenge;
                              // plain HTTP always returns 403 regardless of headers/rate.
                              // Only a real Chromium browser can solve the CF JS challenge.
CONCURRENT_REQUESTS = 5      // parallel Playwright pages (shared context → shared CF cookie)
REQUEST_DELAY_MS    = 500    // ms between batches
REQUEST_TIMEOUT_MS  = 15000  // ms per request
MAX_URLS_PER_RUN    = 10000  // max URLs per run (~170–200 min for full 12 000-product catalogue)
NULL_PRICE_RETRY_ATTEMPTS         = 2
NULL_PRICE_RETRY_BACKOFF_MULTIPLIER = 2   // exponential: 10s → 20s → 40s
NULL_PRICE_FAIL_THRESHOLD         = 50   // max nulls before job fails (FAIL_ON_NULL_PRICE=true)
DB_PATH             = './data/prices.db'
DB_ZIP_PATH         = './public/db.zip'
SITEMAP_URL         = 'https://extremetechcr.com/sitemap.xml'
```

## SPEED / CRAWLER THROUGHPUT
With USE_HTTP_FETCHER=false (Playwright + stealth + resource blocking):
- Per-page time: ~800–1 500 ms (CF challenge solved once, reused via shared context cookie)
- CONCURRENT_REQUESTS=5 + REQUEST_DELAY_MS=500 → ~60–70 products/min
- 12 000 active products → ~170–200 min per daily run (within 300-min job limit)
- Resource blocking (images/fonts/media/CSS) reduces load from ~3 s to ~1.2 s per page

**DO NOT set USE_HTTP_FETCHER=true** — confirmed blocked by Cloudflare managed challenge.
Diagnose with: `node experiments/cloudflare-bypass/probe.js [url]`

## DATABASE SCHEMA
```sql
products(id, url UNIQUE, name, sku, category, description, imageUrl, stockLocations TEXT/JSON,
         firstSeenAt, lastCheckedAt, isActive INT)

priceHistory(id, productId FK, price REAL, originalPrice REAL, currency TEXT,
             startDate TEXT, endDate TEXT NULL)
-- endDate=NULL means "current price"
-- Same price on consecutive days: extends endDate (no new row)
-- Price change: closes old row (endDate=now), inserts new row
```

## PRICE PARSING — Costa Rica uses dot as thousands separator
```
"₡375.000" → 375000   (allThreeDigits after dot = thousands)
"₡375,000" → 375000   (comma, 3 digits after = thousands)
"₡67.901"  → 67901
Currency: ₡ / \u20a1 = CRC, $ = USD, € = EUR
```

## KNOWN SITE STRUCTURE (WooCommerce + Woodmart/Elementor theme)
```
Title:     h1.product_title, h1.entry-title
Price:     .wd-single-price .price .woocommerce-Price-amount   <- Woodmart/Elementor (this site)
           .summary .price .woocommerce-Price-amount           <- standard WooCommerce (fallback)
Sale:      .wd-single-price .price ins .woocommerce-Price-amount
Original:  .wd-single-price .price del .woocommerce-Price-amount
SKU:       .sku
Category:  .posted_in a
Image:     .woocommerce-product-gallery__image img
IsProduct: body.single-product OR body.woocommerce-page OR [itemtype*="schema.org/Product"]

Stock (primary): .store-list > .store-item structure (custom Woodmart plugin)
  Each .store-item contains:
    .store-name span -> location name (e.g. "San Pedro", "Bodega Central")
    .status div      -> class determines availability:
                        status-out       = 0 units ("No disponible")
                        status-available = 1+ units ("Disponible")
                        status-limited   = N units from .status-text ("Queda 1", "Quedan 2")
    .status-text span -> human-readable status text

Stock (fallback): .wc-stock-locations table tr -> td[0]=location, td[1]="N en stock"

IMPORTANT: The .stock.out-of-stock element next to the price ("Sin existencias") is set by
WooCommerce's global stock status and is UNRELIABLE. A product can show "Sin existencias" next
to the price while individual stores still have units. Always use the .store-item data.
Available: button.single_add_to_cart_button exists + no .out-of-stock (FALLBACK only, unreliable)
```

**NOTE:** The site does NOT use .summary/.entry-summary for the price block.
The price is rendered inside a `.wd-single-price` Elementor widget.
The `.summary`/`.entry-summary` selectors are kept as fallback for standard WooCommerce layouts.

## CLOUDFLARE / BOT DETECTION

**CONFIRMED (2026-03-29): extremetechcr.com uses Cloudflare managed challenge (`cType: managed`).**
All plain HTTP requests (axios, got-scraping, curl, raw HTTPS) receive a 403 "Just a moment…"
challenge page — permanently, regardless of headers, User-Agent, rate, or delay.
A real Chromium browser with JavaScript execution is required to solve the challenge.

Multi-library probe results (see `experiments/cloudflare-bypass/results.md` for full data):

| Library | Type | Works? |
|---|---|---|
| `axios` | Plain HTTP | ❌ Always 403 |
| `got-scraping` (Apify JA3 TLS spoof) | HTTP + TLS fingerprint | ❌ Always 403 |
| `tls-client` (Go TLS imitation) | HTTP + TLS fingerprint | ❌ Can't compile on Node 24 |
| `puppeteer` headless | Real Chromium | ✅ ~3 600 ms/page |
| `puppeteer-extra` + stealth | Real Chromium + stealth | ✅ ~1 900 ms/page |
| `playwright-extra` + stealth + resource blocking | Real Chromium + stealth | ✅ ~1 200 ms/page |

**Current approach:** `playwright-extra` + stealth + context-level resource blocking (fastest).
The shared browser context preserves the `cf_clearance` cookie after the first challenge,
so subsequent pages skip the challenge entirely.

Cloudflare detection (`isCloudflareChallenge()` in productScraper.js) remains as a safety net:
- Detects: `challenges.cloudflare.com`, `cf-browser-verification`, `__cf_chl_f_tk`, `jschl-answer`
- If detected after Playwright fetch: retried with exponential backoff, then skipped with `[CLOUDFLARE]`

To diagnose / re-run probe:
```bash
node experiments/cloudflare-bypass/probe.js [url]
# Writes experiments/cloudflare-bypass/results.md
```

## JOBS EXPLAINED

### Weekly Sitemap Crawler (Monday 2am UTC)
- Fetches sitemap.xml → filters `/producto/` URLs → upserts into DB with name=null
- New products get `lastCheckedAt = '1970-01-01T00:00:00.000Z'` (epoch) so they are treated as
  the most stale and get scraped first in the next price-update run
- Products inserted here show NOTHING on the frontend until price crawler runs
- Frontend filter: `INNER JOIN priceHistory` so unpriced products are hidden

### Daily Price Crawler (every day 3am UTC)
- Calls `getStaleProductUrls(MAX_URLS_PER_RUN, false)` → **active products only** (isActive=1), stale-first
- Uses Playwright+stealth browser (USE_HTTP_FETCHER=false) — shared context reuses CF clearance cookie
- Resource blocking (images/fonts/media/CSS) enabled at context level → ~1.2 s/page
- For each URL: scrapes via browser, upserts product, records price
- 404 responses → `markProductInactive(url)` — product removed from the daily queue
- Exports db.zip every 50 products (progress save in case of cancellation)
- Runs `validateDatabaseIntegrity()` at end → logs CRITICAL warnings
- Commits db.zip with `if: always()` so partial runs are preserved
- Job timeout: 300 minutes (5 hours) — sufficient for full 12 000-product catalogue

### Weekly Full-Database Price Review (Thursday 1am UTC)
- Sets env `INCLUDE_INACTIVE=true` → calls `getStaleProductUrls(MAX_URLS_PER_RUN, true)`
- Includes **all** products (active AND inactive) — detects if 404 products were re-listed
- Re-activates previously-inactive products if they return a valid page
- Same Playwright browser as daily job; runs before the daily job (1am vs 3am)
- Does NOT overlap with sitemap crawl (Monday vs Thursday)

### Sample Crawler (manual trigger only)
- Uses env `PRICE_UPDATE_URLS` with 5 known URLs
- Completes in ~5 minutes — use after any code change to verify scraper works
- Trigger: Actions → "Sample Price Crawler (Quick Test)" → Run workflow

## WORKFLOWS

| Workflow | File | Trigger | Timeout |
|---|---|---|---|
| Weekly Sitemap Crawler | sitemap-crawler.yml | Mon 2am UTC + manual | default |
| Daily Price Crawler | price-crawler.yml | Every day 3am UTC + manual | 300min |
| Weekly DB Review | price-crawler-weekly-db.yml | Thu 1am UTC + manual | 300min |
| Sample Price Crawler | price-crawler-sample.yml | manual only | 30min |

**workflow_dispatch inputs for price-crawler.yml:**
```
urls:               "https://extremetechcr.com/producto/x/,..."  (leave blank for stale-first run)
fail_on_null_price: "true" | "false"  (fail job if null prices exceed NULL_PRICE_FAIL_THRESHOLD)
```

**env vars consumed by src/jobs/updatePrices.js:**
```
PRICE_UPDATE_URLS   comma-separated override list (skips DB selection entirely)
FAIL_ON_NULL_PRICE  "true" | "false"
INCLUDE_INACTIVE    "true" → also process isActive=0 products (used by weekly DB review)
```

> All throughput settings (concurrency, delay, limit) are configured in `src/config.js`, not as workflow inputs.

## DATABASE PERSISTENCE ACROSS RUNS
GitHub Actions **does not** persist files between runs by default.
`data/prices.db` is cached using `actions/cache@v4` with key `sqlite-db-{run_id}` + restore from `sqlite-db-*`.
`public/db.zip` is committed to the repo and is the persistent export.

**If the cache is cold (new DB):** price crawler will insert products but they'll also exist via db.zip.
**Recovery:** run `npm run seed` locally → commit `public/db.zip` to reset to known-good state.

## SEED SCRIPT
```bash
npm run seed          # rebuilds public/db.zip from 15 curated known products
git add public/db.zip
git commit -m "chore: reset db.zip to seed data"
git push
```
Products in seed: Lenovo IdeaPad Slim 3, Intel Pentium G6405, MSI MP225V, Razer Kraken, Logitech G502, Logitech G915, LG 27" 4K, Samsung 970 EVO, Corsair RM850x, Corsair DDR5 32GB, MSI RTX 4060, Sony WH-1000XM5, ASUS TUF F15, Ryzen 5 7600X, Lian Li O11 Dynamic.

## INTEGRITY CHECK
`db.validateDatabaseIntegrity()` — called automatically at end of each price crawl:
- CRITICAL if ≥80% products have no open price record
- CRITICAL if ≥80% products have null name  
- WARNING if one name appears in ≥80% of products (selector broke)

## FRONTEND BEHAVIOR
- Loads `db.zip` → extracts `prices.db` → opens in sql.js (in-browser SQLite)
- **Only shows products with an open price record** (INNER JOIN, not LEFT JOIN)
- Image: shows real img if imageUrl stored; on error hides img and shows "View price history" placeholder
- Clicking any card opens price history modal with Chart.js line chart
- Pagination: 60 products per page, search, sort by name/price/discount/increase

### Dark mode
- Inline `<script>` in `<head>` sets `data-bs-theme` before CSS loads (prevents FOUC)
- Reads `localStorage` for saved preference, falls back to `prefers-color-scheme`
- 🌙/☀️ toggle button in navbar persists choice to `localStorage`

### Columns selector (desktop only)
- `3 / 4` button group (`d-none d-md-inline-flex`) in toolbar
- Swaps `row-cols-md-3` ↔ `row-cols-md-4` on the grid via regex
- Preference persisted to `localStorage`

### Price-change badges
- `calcPriceChangePct(product)` uses `prevPrice` (most recent closed `priceHistory` row) vs current price
- `buildPriceChangeBadge()` renders `↓ X%` (green) / `↑ X%` (red) on cards when |change| ≥ 1%
- Sort options: **Mayor bajada** (`discount-desc`) and **Mayor subida** (`increase-desc`)
- SQL: `queryAllProducts()` includes correlated subquery for `prevPrice`:
  ```sql
  (SELECT ph2.price FROM priceHistory ph2
   WHERE ph2.productId = p.id AND ph2.endDate IS NOT NULL
   ORDER BY ph2.endDate DESC LIMIT 1) AS prevPrice
  ```

### SEO meta tags
- `<title>` and `<meta name="description">` added to `public/index.html`

### UniMart cross-link
- Navbar link to `https://andreileonsalas.github.io/unimartMonitor/`

## TESTING

```bash
npm run test:unit   # jest — 134 tests, pure JS, no network
npm run test:e2e    # playwright — 40 tests, runs local server on port 8080
npm test            # both
```

**E2E creates its own db.zip** from seed data before each run (see `test.beforeAll` in frontend.test.js).
**Do not** commit `public/db.zip` inside e2e tests — they overwrite it with test data.

**Critical e2e tests (must always pass):**
- Intel Pentium Gold G6405 (CPU1011) — price 39900 CRC
- MSI PRO MP225V 22 100Hz (MT2736) — price 34900 CRC  
- Razer Kraken Kitty Edition V2 Pro Rosa (HE6006) — sale 67901, original 69900, -3%
- Dark mode toggle persists to `localStorage`
- Columns selector (3/4) persists to `localStorage`
- Discount sort (Mayor bajada / Mayor subida)
- Price-change badge visible on discounted cards

## GITHUB PAGES URL
- Root: https://andreileonsalas.github.io/extremetechcrPriceMonitor/
- `index.html` at root does meta-refresh to `public/` (the actual app)
- Assets referenced relative to `public/`: `vendor/`, `main.js`, `main.css`, `db.zip`

## COMMON FAILURES & FIXES

| Symptom | Cause | Fix |
|---|---|---|
| All products show "Unknown" / "Price unavailable" | Sitemap ran but price crawler didn't | Run price crawler or `npm run seed` + commit db.zip |
| `[CLOUDFLARE]` warnings in price crawler | Playwright stealth not working or IP flagged | Run `node experiments/cloudflare-bypass/probe.js` to diagnose; check results.md |
| Price crawler cancelled after 6h | Too many URLs or slow site | MAX_URLS_PER_RUN=10000, timeout-minutes=300, if:always commit already set |
| GitHub Pages shows 404 at root URL | index.html missing from root | Already fixed: root index.html with meta-refresh |
| Images don't load | imageUrl null (not yet scraped) or hotlink block | Already fixed: onerror fallback to placeholder |
| integrity check CRITICAL no price | <20% of products have been priced yet | Normal after fresh deploy; price crawler needs to run several times |
| E2e tests fail with wrong product data | db.zip has wrong content | Tests recreate db.zip themselves; don't need to fix db.zip for tests |
| Someone sets USE_HTTP_FETCHER=true | Previous agent mistake — HTTP always 403 | Revert to false; see CLOUDFLARE section above for proof |

## PRICE FORMAT EDGE CASES
```
"₡375,000 I.V.A.I"  → cleaned "375,000..." → 375000  (I.V.A.I dots treated as thousands)
"₡39.900"           → 39900  (allThreeDigits)
"₡67.901"           → 67901  (allThreeDigits)
"$99.99"            → 99.99  (2 decimal digits = decimal)
"1.234,56"          → 1234.56 (European: last separator is comma = decimal)
```

## WHEN ADDING A NEW FEATURE — CHECKLIST
1. Edit `src/config.js` for any new constants
2. Edit the specific module (scraper/db/frontend)
3. `npm run test:unit` must pass
4. `npm run test:e2e` must pass (run `npm run seed` first if db.zip is stale)
5. For scraper changes: trigger "Sample Price Crawler" workflow to verify on real site
6. After confirming sample works: merge so daily crawler runs with real data

## REPO LAYOUT
```
.github/workflows/          CI/CD workflows
experiments/cloudflare-bypass/ Bot-detection probe + CF Worker example
public/                     GitHub Pages static files (index.html, main.js, main.css, db.zip)
scripts/                    serve.js (dev server), seedDatabase.js
src/
  config.js                 All constants
  database/db.js            SQLite layer
  jobs/updatePrices.js      Daily crawler job
  jobs/updateSitemap.js     Weekly sitemap job
  scraper/browser.js        Playwright browser
  scraper/productScraper.js HTML parser
  scraper/sitemapReader.js  Sitemap XML parser
tests/
  e2e/frontend.test.js      Playwright e2e (29 tests)
  unit/db.test.js           DB + integrity (36 tests)
  unit/productScraper.test.js Scraper parsing (56 tests)
  unit/sitemapReader.test.js  Sitemap (11 tests)
index.html                  Root redirect → public/
```
