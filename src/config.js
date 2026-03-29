'use strict';

/**
 * Central configuration file.
 * ALL configurable values for the price monitor are defined here.
 * Edit this file to change any behavior — no environment variables needed.
 */

/** @type {string} URL of the WooCommerce sitemap index */
const SITEMAP_URL = 'https://extremetechcr.com/sitemap.xml';

/** @type {number} Maximum concurrent browser pages used when scraping */
const CONCURRENT_REQUESTS = 10;

/** @type {number} Delay in milliseconds between request batches */
const REQUEST_DELAY_MS = 250;

/** @type {number} HTTP request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 15000;

/** @type {number} Maximum number of URLs to process per price-update run (rotates stale-first) */
const MAX_URLS_PER_RUN = 3500;

/** @type {number} Number of times to retry scraping a product whose price came back null (0 = no retries) */
const NULL_PRICE_RETRY_ATTEMPTS = 2;

/** @type {number} Base milliseconds to wait before the first retry (exponential backoff applies for subsequent attempts) */
const NULL_PRICE_RETRY_DELAY_MS = 10000;

/**
 * Exponential-backoff multiplier applied to the retry delay on each successive attempt.
 * The wait before attempt N is: NULL_PRICE_RETRY_DELAY_MS * (NULL_PRICE_RETRY_BACKOFF_MULTIPLIER ^ (N-1))
 * Examples with base=10 s and multiplier=2: attempt 1 → 10 s, attempt 2 → 20 s, attempt 3 → 40 s.
 * Set to 1 to disable backoff (constant delay).
 * @type {number}
 */
const NULL_PRICE_RETRY_BACKOFF_MULTIPLIER = 2;

/** @type {number} How many null-price products are allowed before the job fails (when FAIL_ON_NULL_PRICE is true). 0 = fail on any single null price. */
const NULL_PRICE_FAIL_THRESHOLD = 50;

/** @type {string} Path to the SQLite database file */
const DB_PATH = './data/prices.db';

/** @type {string} Path for the exported ZIP file (served via GitHub Pages) */
const DB_ZIP_PATH = './public/db.zip';

/** @type {string} User-Agent header for HTTP requests */
const USER_AGENT = 'ExtremeTechCR-PriceMonitor/1.0 (+https://github.com/andreileonsalas/extremetechcrPriceMonitor)';

/** @type {string[]} URL path patterns that indicate a WooCommerce product page */
const PRODUCT_URL_PATTERNS = ['/producto/', '/product/'];

/** @type {string[]} URL path patterns to skip (non-product pages) */
const SKIP_URL_PATTERNS = [
  '/categoria/', '/category/', '/tag/', '/etiqueta/',
  '/page/', '/cart/', '/checkout/', '/my-account/',
  '/shop/', '/tienda/', '/wp-', '/feed', '.xml',
  '/author/', '/autor/', '/blog/', '/noticias/'
];

/** @type {string} CSS selector for the product title on WooCommerce pages */
const SELECTOR_PRODUCT_TITLE = 'h1.product_title, h1.entry-title';

/**
 * Price selectors are scoped to .summary / .entry-summary (the main WooCommerce product
 * info section) to avoid accidentally picking up prices from related products, upsell
 * widgets, product add-ons, or mini-cart elements that also render .price elements.
 */

/** @type {string} CSS selector for the active (sale) price inside an <ins> element */
const SELECTOR_PRODUCT_SALE_PRICE = [
  // Standard WooCommerce layout (summary sidebar)
  '.summary .price ins .woocommerce-Price-amount',
  '.entry-summary .price ins .woocommerce-Price-amount',
  '.summary .price ins .amount',
  '.entry-summary .price ins .amount',
  // Woodmart / Elementor theme — price rendered via .wd-single-price widget
  '.wd-single-price .price ins .woocommerce-Price-amount',
  '.wd-single-price .price ins .amount',
].join(', ');

/** @type {string} CSS selector for any price amount (fallback when no sale price) */
const SELECTOR_PRODUCT_PRICE = [
  // Standard WooCommerce layout
  '.summary .price .woocommerce-Price-amount',
  '.entry-summary .price .woocommerce-Price-amount',
  '.summary .price .amount',
  '.entry-summary .price .amount',
  // Woodmart / Elementor theme
  '.wd-single-price .price .woocommerce-Price-amount',
  '.wd-single-price .price .amount',
].join(', ');

/** @type {string} CSS selector for the original (struck-through) price inside a <del> element */
const SELECTOR_PRODUCT_ORIGINAL_PRICE = [
  // Standard WooCommerce layout
  '.summary .price del .woocommerce-Price-amount',
  '.entry-summary .price del .woocommerce-Price-amount',
  '.summary .price del .amount',
  '.entry-summary .price del .amount',
  // Woodmart / Elementor theme
  '.wd-single-price .price del .woocommerce-Price-amount',
  '.wd-single-price .price del .amount',
].join(', ');

/** @type {string} CSS selector for the on-sale badge showing the discount percentage */
const SELECTOR_DISCOUNT_BADGE = '.onsale, .woocommerce-badge--onsale, span.onsale';

/**
 * Selectors tried in order when looking for per-store stock location rows.
 * Each entry is a pair: [containerSelector, rowSelector].
 * The scraper iterates these until it finds results.
 * @type {Array<[string, string]>}
 */
const STOCK_LOCATION_SELECTORS = [
  ['.wc-stock-locations', 'tr'],
  ['.stock-locations', 'li'],
  ['.atum-stock-details', 'tr'],
  ['.woosq-table', 'tr'],
  ['.store-locator-table', 'tr'],
  ['table.shop_table.stock', 'tr'],
];

/** @type {string} CSS selector for the product SKU */
const SELECTOR_PRODUCT_SKU = '.summary .sku, .entry-summary .sku, .sku';

/** @type {string} CSS selector for the product category */
const SELECTOR_PRODUCT_CATEGORY = '.summary .posted_in a, .entry-summary .posted_in a, .summary .product_meta .posted_in a, .posted_in a, .product_meta .posted_in a';

/** @type {string} CSS selector for the product image — scoped to the WooCommerce gallery only */
const SELECTOR_PRODUCT_IMAGE = '.woocommerce-product-gallery__image img';

/** @type {string} CSS selector for the product description */
const SELECTOR_PRODUCT_DESCRIPTION = '.woocommerce-product-details__short-description, .product-short-description';

module.exports = {
  SITEMAP_URL,
  CONCURRENT_REQUESTS,
  REQUEST_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  MAX_URLS_PER_RUN,
  NULL_PRICE_RETRY_ATTEMPTS,
  NULL_PRICE_RETRY_DELAY_MS,
  NULL_PRICE_RETRY_BACKOFF_MULTIPLIER,
  NULL_PRICE_FAIL_THRESHOLD,
  DB_PATH,
  DB_ZIP_PATH,
  USER_AGENT,
  PRODUCT_URL_PATTERNS,
  SKIP_URL_PATTERNS,
  SELECTOR_PRODUCT_TITLE,
  SELECTOR_PRODUCT_PRICE,
  SELECTOR_PRODUCT_SALE_PRICE,
  SELECTOR_PRODUCT_ORIGINAL_PRICE,
  SELECTOR_DISCOUNT_BADGE,
  STOCK_LOCATION_SELECTORS,
  SELECTOR_PRODUCT_SKU,
  SELECTOR_PRODUCT_CATEGORY,
  SELECTOR_PRODUCT_IMAGE,
  SELECTOR_PRODUCT_DESCRIPTION,
};
