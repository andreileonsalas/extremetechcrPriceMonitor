# ExtremeTechCR Price Monitor

Automatic price monitor for [extremetechcr.com](https://extremetechcr.com) built with Node.js, GitHub Actions, and GitHub Pages.

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
- `CONCURRENT_REQUESTS` - Max parallel HTTP requests (default: 10)
- `REQUEST_DELAY_MS` - Delay between batches in ms (default: 5000)
- `DB_PATH` - SQLite database path
- `DB_ZIP_PATH` - Output ZIP path for GitHub Pages

## License

MIT
