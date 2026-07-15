# ExtremeTechCR Price Monitor

[![Daily Price Crawler](https://github.com/andreileonsalas/extremetechcrPriceMonitor/actions/workflows/price-crawler.yml/badge.svg)](https://github.com/andreileonsalas/extremetechcrPriceMonitor/actions/workflows/price-crawler.yml)
[![Weekly Sitemap Crawler](https://github.com/andreileonsalas/extremetechcrPriceMonitor/actions/workflows/sitemap-crawler.yml/badge.svg)](https://github.com/andreileonsalas/extremetechcrPriceMonitor/actions/workflows/sitemap-crawler.yml)

Automatic price monitor for [extremetechcr.com](https://extremetechcr.com) built with Node.js, GitHub Actions, and GitHub Pages.

🌐 **Live site:** [andreileonsalas.github.io/extremetechcrPriceMonitor](https://andreileonsalas.github.io/extremetechcrPriceMonitor/)

## How It Works

1. **Weekly**: A GitHub Action reads the sitemap to discover product URLs and adds them to a SQLite database.
2. **Daily**: A GitHub Action visits all tracked product URLs to check for price changes.
3. **Storage**: The SQLite database is compressed as a ZIP file and committed to the repository.
4. **Frontend**: GitHub Pages serves a static frontend that downloads the ZIP, extracts the database in-browser, and displays products with price history charts.

## Project Structure

```
src/
  config.js              - All configuration variables
  scraper/
    sitemapReader.js     - Sitemap fetching and parsing
    productScraper.js    - WooCommerce product page scraper
  database/
    db.js                - SQLite operations and ZIP export
  jobs/
    updateSitemap.js     - Weekly job
    updatePrices.js      - Daily job
public/
  index.html             - Frontend app
  main.css               - Styles
  main.js                - Frontend logic
.github/workflows/
  sitemap-crawler.yml    - Weekly GitHub Action
  price-crawler.yml      - Daily GitHub Action
```

## Development

```bash
# Install dependencies
npm install

# Run unit tests
npm run test:unit

# Run e2e tests
npm run test:e2e

# Run linter
npm run lint

# Run sitemap job manually
npm run sitemap

# Run price job manually
npm run prices
```

## Configuration

All configuration is in `src/config.js`. Key settings:

- `SITEMAP_URL` - The WooCommerce sitemap URL
- `CONCURRENT_REQUESTS` - Max parallel browser pages per batch.  
  Overridable via `MAX_CONCURRENCY` env var (default **2** for safer behavior on GitHub Actions datacenter IPs).
- `REQUEST_DELAY_MS` - Base delay between batches in ms (default: 500)
- `REQUEST_JITTER_MS` - Max random extra delay added to each inter-batch pause, reducing predictable timing patterns.  
  Overridable via `REQUEST_JITTER_MS` env var (default: 1500).
- `CF_CHALLENGE_TIMEOUT_MS` - How long (ms) to wait for a Cloudflare challenge page to self-resolve before giving up.  
  Overridable via `CF_CHALLENGE_TIMEOUT_MS` env var (default: **60000** = 60 s).  
  GitHub Actions datacenter IPs may need the full 60 s; residential IPs typically solve in 5–20 s.
- `MAX_URLS_PER_RUN` - Products scraped per daily run, stale-first (default: 10000)
- `USE_HTTP_FETCHER` - **Always false** — the site uses Cloudflare managed challenge; plain HTTP is permanently blocked regardless of headers or rate. Only a real Chromium browser (Playwright + stealth) can pass the JS challenge.
- `NULL_PRICE_RETRY_ATTEMPTS` - Retries when a price comes back null (default: 2)
- `NULL_PRICE_RETRY_BACKOFF_MULTIPLIER` - Exponential backoff multiplier per retry (default: 2)
- `NULL_PRICE_FAIL_THRESHOLD` - Max null prices before job fails (default: 50)
- `DB_PATH` - SQLite database path
- `DB_ZIP_PATH` - Output ZIP path for GitHub Pages

### Cloudflare challenge tuning

The scraper uses Playwright stealth to bypass Cloudflare's managed challenge. If you see `[CLOUDFLARE] ... Challenge not resolved` in the logs, try:

1. **Reduce concurrency** — set `MAX_CONCURRENCY=1` or `MAX_CONCURRENCY=2` (already the default).
2. **Increase challenge timeout** — set `CF_CHALLENGE_TIMEOUT_MS=90000` to give CF 90 s to solve.
3. **Run locally** — a residential IP bypasses CF much faster (~5 s) than a GitHub Actions datacenter IP (~20–60 s). The scraper is fully functional locally with default settings.

At the end of each run the job logs a `[METRICS]` summary line:
```
[METRICS] URLs total: 3000 | Processed: 2950 | CF skipped: 12 | Null price: 5
[METRICS] Playwright fetches: 3000 | CF challenge detected: 18 | CF challenge resolved: 6 | CF challenge unresolved: 12
```

## License

MIT
