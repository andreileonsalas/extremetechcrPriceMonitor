'use strict';

const axios = require('axios');
const { load } = require('cheerio');
const {
  USER_AGENT,
  REQUEST_TIMEOUT_MS,
  SELECTOR_PRODUCT_TITLE,
  SELECTOR_PRODUCT_PRICE,
  SELECTOR_PRODUCT_SKU,
  SELECTOR_PRODUCT_CATEGORY,
  SELECTOR_PRODUCT_IMAGE,
  SELECTOR_PRODUCT_DESCRIPTION,
} = require('../config');

/**
 * @typedef {Object} ProductData
 * @property {string} url - The product URL.
 * @property {string|null} name - The product name.
 * @property {number|null} price - The numeric price (null if unavailable).
 * @property {string|null} currency - The currency string (e.g. "CRC", "$").
 * @property {string|null} sku - The product SKU.
 * @property {string|null} category - The product category.
 * @property {string|null} imageUrl - URL of the main product image.
 * @property {string|null} description - Short product description.
 * @property {boolean} isAvailable - Whether the product is in stock.
 * @property {boolean} isProduct - Whether the page appears to be a product page.
 * @property {number} statusCode - HTTP status code returned.
 */

/**
 * Fetches and parses a product page, extracting structured product data.
 * Returns null if the page returns a 404 or cannot be parsed as a product.
 * @param {string} url - The product page URL to scrape.
 * @returns {Promise<ProductData>} Scraped product data.
 */
async function scrapeProduct(url) {
  let html;
  let statusCode = 200;

  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: (status) => status < 500,
    });
    statusCode = response.status;
    html = response.data;
  } catch (err) {
    console.error(`Request failed for ${url}: ${err.message}`);
    return {
      url,
      name: null,
      price: null,
      currency: null,
      sku: null,
      category: null,
      imageUrl: null,
      description: null,
      isAvailable: false,
      isProduct: false,
      statusCode: err.response ? err.response.status : 0,
    };
  }

  if (statusCode === 404) {
    return {
      url,
      name: null,
      price: null,
      currency: null,
      sku: null,
      category: null,
      imageUrl: null,
      description: null,
      isAvailable: false,
      isProduct: false,
      statusCode,
    };
  }

  const $ = load(html);
  const isProduct = isWooCommerceProduct($);

  if (!isProduct) {
    return {
      url,
      name: null,
      price: null,
      currency: null,
      sku: null,
      category: null,
      imageUrl: null,
      description: null,
      isAvailable: false,
      isProduct: false,
      statusCode,
    };
  }

  const name = extractText($, SELECTOR_PRODUCT_TITLE);
  const { price, currency } = extractPrice($);
  const sku = extractText($, SELECTOR_PRODUCT_SKU);
  const category = extractText($, SELECTOR_PRODUCT_CATEGORY);
  const imageUrl = extractImageUrl($);
  const description = extractText($, SELECTOR_PRODUCT_DESCRIPTION);
  const isAvailable = checkAvailability($);

  return {
    url,
    name,
    price,
    currency,
    sku,
    category,
    imageUrl,
    description,
    isAvailable,
    isProduct: true,
    statusCode,
  };
}

/**
 * Determines whether a parsed page is a WooCommerce product page.
 * @param {import('cheerio').CheerioAPI} $ - Loaded Cheerio instance.
 * @returns {boolean} True if the page is a WooCommerce product.
 */
function isWooCommerceProduct($) {
  return (
    $('body').hasClass('single-product') ||
    $('body').hasClass('woocommerce-page') ||
    $('.product').length > 0 ||
    $('[itemtype="http://schema.org/Product"]').length > 0 ||
    $('[itemtype="https://schema.org/Product"]').length > 0
  );
}

/**
 * Extracts the trimmed text content of the first element matching a CSS selector.
 * @param {import('cheerio').CheerioAPI} $ - Loaded Cheerio instance.
 * @param {string} selector - CSS selector to query.
 * @returns {string|null} Trimmed text content, or null if not found.
 */
function extractText($, selector) {
  const el = $(selector).first();
  if (!el.length) return null;
  return el.text().trim() || null;
}

/**
 * Extracts a numeric price and currency string from a WooCommerce product page.
 * Handles price ranges by returning the lowest price.
 * @param {import('cheerio').CheerioAPI} $ - Loaded Cheerio instance.
 * @returns {{ price: number|null, currency: string|null }}
 */
function extractPrice($) {
  const priceSelector = SELECTOR_PRODUCT_PRICE;
  const amounts = [];

  $(priceSelector).each((_, el) => {
    const text = $(el).text().trim();
    if (text) amounts.push(text);
  });

  if (amounts.length === 0) return { price: null, currency: null };

  // Use the first price amount found
  const raw = amounts[0];
  const numeric = parseNumericPrice(raw);
  const currency = extractCurrencySymbol(raw);

  return { price: numeric, currency };
}

/**
 * Parses a raw price string into a numeric value, removing currency symbols and formatting.
 * @param {string} raw - Raw price string (e.g. "\u20a1 12,345.00" or "$ 99.99").
 * @returns {number|null} Numeric price, or null if parsing fails.
 */
function parseNumericPrice(raw) {
  // Remove currency symbols, letters, and whitespace; handle comma/dot formatting
  const cleaned = raw.replace(/[^0-9.,]/g, '').trim();
  if (!cleaned) return null;

  // Handle formats: "1,234.56" -> 1234.56 or "1.234,56" -> 1234.56
  let normalized;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Determine which is decimal separator
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastDot > lastComma) {
      // "1,234.56" style
      normalized = cleaned.replace(/,/g, '');
    } else {
      // "1.234,56" style
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else if (cleaned.includes(',')) {
    // Could be "1,234" (no cents) or "1,23" (European decimal)
    const parts = cleaned.split(',');
    if (parts[parts.length - 1].length === 2) {
      // Likely European decimal
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else {
    normalized = cleaned;
  }

  const value = parseFloat(normalized);
  return isNaN(value) ? null : value;
}

/**
 * Extracts a currency symbol or code from a raw price string.
 * @param {string} raw - Raw price string.
 * @returns {string|null} Currency symbol/code or null.
 */
function extractCurrencySymbol(raw) {
  if (raw.includes('\u20a1') || raw.toLowerCase().includes('crc')) return 'CRC';
  if (raw.includes('$')) return 'USD';
  if (raw.includes('\u20ac')) return 'EUR';
  return null;
}

/**
 * Checks whether a WooCommerce product is currently in stock.
 * @param {import('cheerio').CheerioAPI} $ - Loaded Cheerio instance.
 * @returns {boolean} True if the product is available/in-stock.
 */
function checkAvailability($) {
  const outOfStock = $('.stock.out-of-stock, .out-of-stock').length > 0;
  const inStock = $('.stock.in-stock, .in-stock').length > 0;
  const addToCart = $('button.single_add_to_cart_button').length > 0;
  return !outOfStock && (inStock || addToCart);
}

/**
 * Extracts the main product image URL from a WooCommerce product page.
 * @param {import('cheerio').CheerioAPI} $ - Loaded Cheerio instance.
 * @returns {string|null} Absolute URL of the product image, or null.
 */
function extractImageUrl($) {
  const img = $(SELECTOR_PRODUCT_IMAGE).first();
  if (!img.length) return null;
  return img.attr('src') || img.attr('data-src') || null;
}

module.exports = {
  scrapeProduct,
  isWooCommerceProduct,
  extractText,
  extractPrice,
  parseNumericPrice,
  extractCurrencySymbol,
  checkAvailability,
  extractImageUrl,
};
