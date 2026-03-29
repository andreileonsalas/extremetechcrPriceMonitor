'use strict';

const { fetchPage } = require('./browser');
const { load } = require('cheerio');
const {
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
} = require('../config');

/**
 * @typedef {Object} StockLocation
 * @property {string} location - Store/warehouse name.
 * @property {number} quantity - Available units at that location.
 */

/**
 * @typedef {Object} ProductData
 * @property {string} url - The product URL.
 * @property {string|null} name - The product name.
 * @property {number|null} price - The active (sale) price, or regular price if no sale.
 * @property {number|null} originalPrice - The original price before discount (null when not on sale).
 * @property {number|null} discountPercentage - Discount percentage (null when not on sale).
 * @property {string|null} currency - The currency string (e.g. "CRC", "USD").
 * @property {string|null} sku - The product SKU.
 * @property {string|null} category - The product category.
 * @property {string|null} imageUrl - URL of the main product image.
 * @property {string|null} description - Short product description.
 * @property {StockLocation[]} stockLocations - Per-store stock availability.
 * @property {boolean} isAvailable - Whether the product is in stock anywhere.
 * @property {boolean} isProduct - Whether the page appears to be a product page.
 * @property {number} statusCode - HTTP status code returned.
 * @property {string|undefined} priceDebug - Human-readable explanation of why price is null (only set when price is null).
 * @property {string|undefined} htmlDebug - Diagnostic snapshot of the page (title, price container, body excerpt) when price is null.
 */

/**
 * Fetches a product page URL and passes the HTML to scrapeProductFromHtml.
 * Returns a ProductData object with all fields set to null/false on failure.
 * @param {string} url - The product page URL to scrape.
 * @returns {Promise<ProductData>} Scraped product data.
 */
async function scrapeProduct(url) {
  let html;
  let statusCode = 200;

  try {
    ({ html, statusCode } = await fetchPage(url));
  } catch (err) {
    console.error(`Request failed for ${url}: ${err.message}`);
    return buildEmptyResult(url, 0);
  }

  if (statusCode === 404) {
    return buildEmptyResult(url, 404);
  }

  return scrapeProductFromHtml(url, html, statusCode);
}

/**
 * Parses raw HTML for a product page and extracts all product fields.
 * Separated from scrapeProduct to allow unit testing with HTML fixtures.
 * @param {string} url - The product URL (used only in the return value).
 * @param {string} html - Raw HTML string of the product page.
 * @param {number} [statusCode=200] - HTTP status code of the response.
 * @returns {ProductData} Parsed product data.
 */
function scrapeProductFromHtml(url, html, statusCode = 200) {
  const $ = load(html);
  const isProduct = isWooCommerceProduct($);

  if (!isProduct) {
    return buildEmptyResult(url, statusCode);
  }

  const name = extractText($, SELECTOR_PRODUCT_TITLE);
  const { price, originalPrice, currency, priceDebug } = extractPrice($);
  const discountPercentage = extractDiscountPercentage($);
  const sku = extractText($, SELECTOR_PRODUCT_SKU);
  const category = extractText($, SELECTOR_PRODUCT_CATEGORY);
  const imageUrl = extractImageUrl($);
  const description = extractText($, SELECTOR_PRODUCT_DESCRIPTION);
  const stockLocations = extractStockLocations($);
  const isAvailable = stockLocations.length > 0
    ? stockLocations.some((loc) => loc.quantity > 0)
    : checkAvailability($);

  return {
    url,
    name,
    price,
    originalPrice,
    discountPercentage,
    currency,
    sku,
    category,
    imageUrl,
    description,
    stockLocations,
    isAvailable,
    isProduct: true,
    statusCode,
    ...(price === null ? { priceDebug, htmlDebug: buildHtmlDebug($) } : {}),
  };
}

/**
 * Builds a human-readable diagnostic snapshot of a page to help debug why no price was found.
 * Includes the page title, whether the WooCommerce summary container exists, the HTML of the
 * price container, and a short body-text excerpt.
 * @param {import('cheerio').CheerioAPI} $ - Loaded Cheerio instance.
 * @returns {string} Multi-line diagnostic string.
 */
function buildHtmlDebug($) {
  const title = $('title').text().trim() || '(no title)';
  const hasSummary = $('.summary, .entry-summary').length > 0;
  const priceHtml = $('.summary .price, .entry-summary .price').first().html();
  const priceContainerInfo = priceHtml
    ? priceHtml.replace(/\s+/g, ' ').trim().slice(0, 300)
    : '(not found)';
  const bodySnippet = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 500);
  return [
    `Page title: "${title}"`,
    `Has .summary/.entry-summary: ${hasSummary}`,
    `Price container HTML: ${priceContainerInfo}`,
    `Body text snippet: ${bodySnippet}`,
  ].join('\n    ');
}

/**
 * Builds a blank ProductData object for pages that are not products or that errored.
 * @param {string} url - The product URL.
 * @param {number} statusCode - HTTP status code.
 * @returns {ProductData}
 */
function buildEmptyResult(url, statusCode) {
  return {
    url,
    name: null,
    price: null,
    originalPrice: null,
    discountPercentage: null,
    currency: null,
    sku: null,
    category: null,
    imageUrl: null,
    description: null,
    stockLocations: [],
    isAvailable: false,
    isProduct: false,
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
 * Extracts price information from a WooCommerce product page.
 * When a sale price is present (inside an <ins> element), that is returned as `price`
 * and the struck-through original is returned as `originalPrice`.
 * When no sale, `price` is the regular price and `originalPrice` is null.
 * When price cannot be determined, `priceDebug` contains a human-readable explanation.
 * @param {import('cheerio').CheerioAPI} $ - Loaded Cheerio instance.
 * @returns {{ price: number|null, originalPrice: number|null, currency: string|null, priceDebug?: string }}
 */
function extractPrice($) {
  // Check for a sale price first (inside <ins>)
  const saleEl = $(SELECTOR_PRODUCT_SALE_PRICE).first();
  if (saleEl.length) {
    const saleRaw = saleEl.text().trim();
    const salePrice = parseNumericPrice(saleRaw);
    const currency = extractCurrencySymbol(saleRaw);

    // Also grab original (del) price
    const origEl = $(SELECTOR_PRODUCT_ORIGINAL_PRICE).first();
    const origPrice = origEl.length ? parseNumericPrice(origEl.text().trim()) : null;

    if (salePrice === null) {
      return {
        price: null,
        originalPrice: null,
        currency,
        priceDebug: `Sale price element found but numeric parsing failed. Raw text: "${saleRaw}"`,
      };
    }

    return { price: salePrice, originalPrice: origPrice, currency };
  }

  // No sale: use regular price
  const priceEl = $(SELECTOR_PRODUCT_PRICE).first();
  if (!priceEl.length) {
    return {
      price: null,
      originalPrice: null,
      currency: null,
      priceDebug: `No price element found in the page. Selectors tried: "${SELECTOR_PRODUCT_SALE_PRICE}" and "${SELECTOR_PRODUCT_PRICE}"`,
    };
  }

  const raw = priceEl.text().trim();
  const price = parseNumericPrice(raw);

  if (price === null) {
    return {
      price: null,
      originalPrice: null,
      currency: extractCurrencySymbol(raw),
      priceDebug: `Price element found but numeric parsing failed. Raw text: "${raw}"`,
    };
  }

  return {
    price,
    originalPrice: null,
    currency: extractCurrencySymbol(raw),
  };
}

/**
 * Parses a raw price string into a numeric value, removing currency symbols and formatting.
 * Handles formats used in Costa Rica where a period is the thousands separator
 * (e.g. "39.900" means 39,900) as well as standard US and European formats.
 * @param {string} raw - Raw price string (e.g. "\u20a1 39.900" or "$ 99.99").
 * @returns {number|null} Numeric price, or null if parsing fails.
 */
function parseNumericPrice(raw) {
  const cleaned = raw.replace(/[^0-9.,]/g, '').trim();
  if (!cleaned) return null;

  let normalized;

  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Both separators present: determine which is decimal
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastDot > lastComma) {
      // US style: "1,234.56" - comma is thousands, dot is decimal
      normalized = cleaned.replace(/,/g, '');
    } else {
      // European style: "1.234,56" - dot is thousands, comma is decimal
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else if (cleaned.includes(',') && !cleaned.includes('.')) {
    const parts = cleaned.split(',');
    const afterComma = parts[parts.length - 1];
    if (afterComma.length <= 2) {
      // "1,50" or "1234,56" - comma is decimal separator
      normalized = cleaned.replace(',', '.');
    } else {
      // "1,234" or "1,234,567" - comma is thousands separator
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes('.') && !cleaned.includes(',')) {
    const parts = cleaned.split('.');
    // If every part after the first has exactly 3 digits, dots are thousands separators
    // e.g. "39.900" -> 39900, "1.234.567" -> 1234567
    const allThreeDigits = parts.slice(1).every((p) => p.length === 3);
    if (allThreeDigits && parts.length > 1) {
      normalized = cleaned.replace(/\./g, '');
    } else {
      // e.g. "99.99" or "1.5" - dot is decimal separator
      normalized = cleaned;
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
 * Extracts the discount percentage from a WooCommerce on-sale badge.
 * Returns null if the product is not on sale or no percentage badge is found.
 * @param {import('cheerio').CheerioAPI} $ - Loaded Cheerio instance.
 * @returns {number|null} Discount percentage as a positive integer, or null.
 */
function extractDiscountPercentage($) {
  const badge = $(SELECTOR_DISCOUNT_BADGE).first();
  if (!badge.length) return null;
  const text = badge.text().trim();
  // Match patterns like "-3%", "3% OFF", "Descuento 3%"
  const match = text.match(/(\d+)\s*%/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * Extracts per-store stock location data from the product page.
 * Tries multiple container/row selector pairs defined in STOCK_LOCATION_SELECTORS.
 * Falls back to parsing visible stock text if no structured table is found.
 * @param {import('cheerio').CheerioAPI} $ - Loaded Cheerio instance.
 * @returns {StockLocation[]} Array of location objects with name and quantity.
 */
function extractStockLocations($) {
  for (const [containerSel, rowSel] of STOCK_LOCATION_SELECTORS) {
    const container = $(containerSel);
    if (!container.length) continue;

    const locations = [];
    container.find(rowSel).each((_, el) => {
      const cells = $(el).find('td');
      if (cells.length >= 2) {
        const locationName = $(cells[0]).text().trim();
        const qtyText = $(cells[1]).text().trim();
        const qty = parseStockQuantity(qtyText);
        if (locationName && qty !== null) {
          locations.push({ location: locationName, quantity: qty });
        }
      } else {
        // For <li> elements: "Alajuela: 1 en stock"
        const text = $(el).text().trim();
        const parsed = parseStockLocationText(text);
        if (parsed) locations.push(parsed);
      }
    });

    if (locations.length > 0) return locations;
  }

  return [];
}

/**
 * Parses a quantity string (e.g. "1 en stock", "2 unidades", "1") into a number.
 * @param {string} text - Raw quantity text from a stock cell.
 * @returns {number|null} Quantity as a number, or null if unparseable.
 */
function parseStockQuantity(text) {
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parses a stock location string in the format "Location Name: N en stock".
 * @param {string} text - Raw text of a stock location list item.
 * @returns {StockLocation|null} Parsed location object, or null if format is unrecognized.
 */
function parseStockLocationText(text) {
  const match = text.match(/^(.+?):\s*(\d+)/);
  if (!match) return null;
  return { location: match[1].trim(), quantity: parseInt(match[2], 10) };
}

/**
 * Checks whether a WooCommerce product is currently in stock using standard WooCommerce classes.
 * Used as a fallback when no structured stock location data is found.
 * @param {import('cheerio').CheerioAPI} $ - Loaded Cheerio instance.
 * @returns {boolean} True if the product appears to be available.
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
  scrapeProductFromHtml,
  buildEmptyResult,
  buildHtmlDebug,
  isWooCommerceProduct,
  extractText,
  extractPrice,
  parseNumericPrice,
  extractCurrencySymbol,
  extractDiscountPercentage,
  extractStockLocations,
  parseStockQuantity,
  parseStockLocationText,
  checkAvailability,
  extractImageUrl,
};
