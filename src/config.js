'use strict';

/**
 * Central configuration file.
 * All configurable values for the price monitor are defined here.
 * Modify this file to change behavior without touching job logic.
 */

/** @type {string} URL of the WooCommerce sitemap index */
const SITEMAP_URL = 'https://extremetechcr.com/sitemap.xml';

/** @type {number} Maximum concurrent HTTP requests */
const CONCURRENT_REQUESTS = 10;

/** @type {number} Delay in milliseconds between request batches */
const REQUEST_DELAY_MS = 5000;

/** @type {number} HTTP request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 30000;

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

/** @type {string} CSS selector for the product price on WooCommerce pages */
const SELECTOR_PRODUCT_PRICE = '.price .amount, .price ins .amount, .woocommerce-Price-amount';

/** @type {string} CSS selector for the product SKU */
const SELECTOR_PRODUCT_SKU = '.sku';

/** @type {string} CSS selector for the product category */
const SELECTOR_PRODUCT_CATEGORY = '.posted_in a, .product_meta .posted_in a';

/** @type {string} CSS selector for the product image */
const SELECTOR_PRODUCT_IMAGE = '.woocommerce-product-gallery__image img, .product img';

/** @type {string} CSS selector for the product description */
const SELECTOR_PRODUCT_DESCRIPTION = '.woocommerce-product-details__short-description, .product-short-description';

module.exports = {
  SITEMAP_URL,
  CONCURRENT_REQUESTS,
  REQUEST_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  DB_PATH,
  DB_ZIP_PATH,
  USER_AGENT,
  PRODUCT_URL_PATTERNS,
  SKIP_URL_PATTERNS,
  SELECTOR_PRODUCT_TITLE,
  SELECTOR_PRODUCT_PRICE,
  SELECTOR_PRODUCT_SKU,
  SELECTOR_PRODUCT_CATEGORY,
  SELECTOR_PRODUCT_IMAGE,
  SELECTOR_PRODUCT_DESCRIPTION,
};
