# Copilot Instructions for ExtremeTechCR Price Monitor

## Project Overview
This project monitors product prices on extremetechcr.com (WooCommerce). It runs as GitHub Actions, stores data in SQLite compressed as ZIP, and serves a frontend via GitHub Pages with no backend.

## Architecture

### Modules (edit only the relevant file when logic changes)
- `src/config.js` - ALL configuration variables. Edit this first when changing settings.
- `src/scraper/sitemapReader.js` - Fetches and parses sitemap.xml. Edit when sitemap structure changes.
- `src/scraper/productScraper.js` - Scrapes WooCommerce product pages. Edit when HTML structure changes.
- `src/database/db.js` - SQLite CRUD operations and ZIP export. Edit when schema or storage logic changes.
- `src/jobs/updateSitemap.js` - Weekly job orchestration.
- `src/jobs/updatePrices.js` - Daily job orchestration.
- `public/main.js` - Frontend app. Edit for UI changes.

### GitHub Actions
- `.github/workflows/sitemap-crawler.yml` - Runs weekly (Monday 2am UTC)
- `.github/workflows/price-crawler.yml` - Runs daily (3am UTC)

## Coding Standards
- All code in English
- LF line endings (enforced by .gitattributes)
- camelCase for all identifiers
- JSDoc on every function
- No emoji or special symbols in code or comments
- CommonJS modules (`require`/`module.exports`)

## Testing Requirements
ALWAYS run tests after making changes to logic:

```bash
# Unit tests
npm run test:unit

# E2e tests (requires public/db.zip to exist)
npm run test:e2e

# All tests
npm test
```

### Integration Test Rule
Before moving to a new feature, ensure the integration tests pass:
1. Unit tests for the module you changed must pass
2. E2e frontend tests must pass if you changed public/

### Specific Product Test Cases
The following 3 products MUST appear in the database (tests/e2e/frontend.test.js validates this):
1. A laptop product (name contains "laptop")
2. A mouse product (name contains "mouse")
3. A monitor product (name contains "monitor")

If these tests fail, it means data collection is broken and must be fixed before other work.

## Adding New Features

### Changing the sitemap source
Edit only `src/scraper/sitemapReader.js` and update `SITEMAP_URL` in `src/config.js`.

### Changing product scraping selectors
Edit only the `SELECTOR_*` constants in `src/config.js`.

### Changing database schema
Edit `src/database/db.js` (specifically `initializeSchema`). Write a migration if the DB already contains data.

### Changing frontend appearance
Edit `public/index.html` and `public/main.css`. Keep `main.js` for logic only.

## Rate Limiting
- Maximum `CONCURRENT_REQUESTS` (default: 10) simultaneous HTTP requests
- `REQUEST_DELAY_MS` (default: 5000ms) delay between batches
- Both values configured in `src/config.js`

## Price Range Logic
Prices are stored as ranges to save space:
- If price is unchanged: update `endDate` of existing record
- If price changes: close old record, insert new one with new `startDate`
- This means 365 days without price change = 1 database row
