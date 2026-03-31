'use strict';

const {
  parseNumericPrice,
  extractCurrencySymbol,
  isWooCommerceProduct,
  extractText,
  extractPrice,
  extractDiscountPercentage,
  extractStockLocations,
  parseStoreStatusQuantity,
  parseStockQuantity,
  parseStockLocationText,
  scrapeProductFromHtml,
  buildHtmlDebug,
  isCloudflareChallenge,
} = require('../../src/scraper/productScraper');
const { load } = require('cheerio');

/* =========================================================
   HTML FIXTURES for 3 specific ExtremeTechCR products
   Based on standard WooCommerce markup used by this store.
   ========================================================= */

/**
 * Minimal WooCommerce product page HTML for Intel Pentium Gold G6405.
 * Regular price 39,900 CRC (no sale), SKU CPU1011.
 * Stock: Alajuela 1, San Jose Centro 1, Bodega Central 2.
 */
const HTML_PENTIUM_G6405 = `
<!DOCTYPE html>
<html>
<body class="single-product woocommerce woocommerce-page">
  <div class="product" itemscope itemtype="https://schema.org/Product">
    <h1 class="product_title entry-title">Intel Pentium Gold G6405</h1>
    <div class="summary entry-summary">
      <p class="price">
        <span class="woocommerce-Price-amount amount">
          <bdi><span class="woocommerce-Price-currencySymbol">&#8353;</span>39.900</bdi>
        </span>
      </p>
      <div class="product_meta">
        <span class="sku_wrapper">SKU: <span class="sku">CPU1011</span></span>
        <span class="posted_in"><a href="/categoria/procesadores">Procesadores</a></span>
      </div>
      <button class="single_add_to_cart_button button alt">Add to cart</button>
    </div>
    <div class="wc-stock-locations">
      <table>
        <tr><td>Alajuela</td><td>1 en stock</td></tr>
        <tr><td>San Jose Centro</td><td>1 en stock</td></tr>
        <tr><td>Bodega Central</td><td>2 en stock</td></tr>
      </table>
    </div>
  </div>
</body>
</html>`;

/**
 * Minimal WooCommerce product page HTML for MSI PRO MP225V 22" 100Hz monitor.
 * Regular price 34,900 CRC, SKU MT2736.
 * Stock: Guapiles 1.
 */
const HTML_MSI_MP225V = `
<!DOCTYPE html>
<html>
<body class="single-product woocommerce woocommerce-page">
  <div class="product" itemscope itemtype="https://schema.org/Product">
    <h1 class="product_title entry-title">MSI PRO MP225V 22 100Hz Monitor</h1>
    <div class="summary entry-summary">
      <p class="price">
        <span class="woocommerce-Price-amount amount">
          <bdi><span class="woocommerce-Price-currencySymbol">&#8353;</span>34.900</bdi>
        </span>
      </p>
      <div class="product_meta">
        <span class="sku_wrapper">SKU: <span class="sku">MT2736</span></span>
        <span class="posted_in"><a href="/categoria/monitores">Monitores</a></span>
      </div>
      <button class="single_add_to_cart_button button alt">Add to cart</button>
    </div>
    <div class="wc-stock-locations">
      <table>
        <tr><td>Guapiles</td><td>1 en stock</td></tr>
      </table>
    </div>
  </div>
</body>
</html>`;

/**
 * Minimal WooCommerce product page HTML for Razer Kraken Kitty V2 Pro Rosa.
 * On sale: original 69,900 CRC, sale price 67,901 CRC, 3% off. SKU HE6006.
 */
const HTML_RAZER_KRAKEN = `
<!DOCTYPE html>
<html>
<body class="single-product woocommerce woocommerce-page">
  <div class="product" itemscope itemtype="https://schema.org/Product">
    <span class="onsale">-3%</span>
    <h1 class="product_title entry-title">Razer Kraken Kitty Edition V2 Pro Rosa</h1>
    <div class="summary entry-summary">
      <p class="price">
        <del aria-hidden="true">
          <span class="woocommerce-Price-amount amount">
            <bdi><span class="woocommerce-Price-currencySymbol">&#8353;</span>69.900</bdi>
          </span>
        </del>
        <ins>
          <span class="woocommerce-Price-amount amount">
            <bdi><span class="woocommerce-Price-currencySymbol">&#8353;</span>67.901</bdi>
          </span>
        </ins>
      </p>
      <div class="product_meta">
        <span class="sku_wrapper">SKU: <span class="sku">HE6006</span></span>
        <span class="posted_in"><a href="/categoria/audifonos">Audifonos</a></span>
      </div>
      <button class="single_add_to_cart_button button alt">Add to cart</button>
    </div>
    <div class="wc-stock-locations">
      <table>
        <tr><td>San Jose Centro</td><td>2 en stock</td></tr>
        <tr><td>Alajuela</td><td>1 en stock</td></tr>
        <tr><td>Heredia</td><td>3 en stock</td></tr>
      </table>
    </div>
  </div>
</body>
</html>`;

/* =========================================================
   FIXTURES — Woodmart / Elementor layout (real ExtremeTechCR theme)
   Price lives in .wd-single-price widget, NOT in .summary/.entry-summary.
   ========================================================= */

/**
 * Minimal Woodmart/Elementor product page for MSI MAG 274F monitor.
 * Regular price ₡65,000 CRC (no sale) — comma is thousands separator.
 */
const HTML_WOODMART_REGULAR = `
<!DOCTYPE html>
<html>
<head><title>MSI MAG 274F – 27" – IPS – 200 Hz » ExtremeTech</title></head>
<body class="wp-singular product-template-default single single-product postid-164166 wp-theme-woodmart woocommerce woocommerce-page">
  <div class="product">
    <h1 class="product_title entry-title">MSI MAG 274F – 27" – IPS – 200 Hz</h1>
    <div class="elementor-element wd-single-price text-left elementor">
      <div class="elementor-widget-container">
        <p class="price">
          <span class="woocommerce-Price-amount amount">
            <bdi><span class="woocommerce-Price-currencySymbol">&#8353;</span>65,000</bdi>
          </span>
          <small style="font-size:0.85em;color:#888;">I.V.A.I</small>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

/**
 * Minimal Woodmart/Elementor product page with a sale price.
 * Original ₡375,000 CRC, sale ₡350,000 CRC.
 */
const HTML_WOODMART_SALE = `
<!DOCTYPE html>
<html>
<head><title>Sale Product » ExtremeTech</title></head>
<body class="single single-product woocommerce woocommerce-page wp-theme-woodmart">
  <div class="product">
    <span class="onsale">-7%</span>
    <h1 class="product_title entry-title">Sale Product</h1>
    <div class="elementor-element wd-single-price text-left elementor">
      <div class="elementor-widget-container">
        <p class="price">
          <del>
            <span class="woocommerce-Price-amount amount">
              <bdi><span class="woocommerce-Price-currencySymbol">&#8353;</span>375,000</bdi>
            </span>
          </del>
          <ins>
            <span class="woocommerce-Price-amount amount">
              <bdi><span class="woocommerce-Price-currencySymbol">&#8353;</span>350,000</bdi>
            </span>
          </ins>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

/* =========================================================
   HTML FIXTURES — custom store-item structure (real extremetechcr.com Woodmart theme)
   Stock availability shown via .store-list > .store-item elements.
   Status classes: status-limited (N units), status-available (Disponible), status-out (No disponible).
   ========================================================= */

/**
 * Minimal product page with mix of store availability states:
 * San Pedro: Quedan 2 (limited), Cartago: Queda 1 (limited), Escazu: No disponible (out),
 * Bodega Central: Disponible (available).
 */
const HTML_STORE_ITEM_MIXED = `
<!DOCTYPE html>
<html>
<body class="single-product woocommerce woocommerce-page">
  <div class="product" itemscope itemtype="https://schema.org/Product">
    <h1 class="product_title entry-title">Test Product Mixed Stock</h1>
    <div class="wd-single-price">
      <p class="price">
        <span class="woocommerce-Price-amount amount">
          <bdi><span class="woocommerce-Price-currencySymbol">&#8353;</span>500,000</bdi>
        </span>
      </p>
    </div>
    <p class="stock out-of-stock wd-style-default">Sin existencias</p>
    <div class="store-list">
      <div class="store-item gam-location-item">
        <div class="store-info"><span class="store-name">San Pedro</span></div>
        <div class="status status-limited"><span class="status-text">Quedan 2</span></div>
      </div>
      <div class="store-item gam-location-item">
        <div class="store-info"><span class="store-name">Cartago</span></div>
        <div class="status status-limited"><span class="status-text">Queda 1</span></div>
      </div>
      <div class="store-item gam-location-item">
        <div class="store-info"><span class="store-name">Escazu</span></div>
        <div class="status status-out"><span class="status-text">No disponible</span></div>
      </div>
    </div>
    <div class="store-list">
      <div class="store-item central-warehouse-item">
        <div class="store-info"><span class="store-name">Bodega Central</span></div>
        <div class="status status-available"><span class="status-text">Disponible</span></div>
      </div>
    </div>
  </div>
</body>
</html>`;

/**
 * Minimal product page where ALL stores show "No disponible" (truly out of stock).
 */
const HTML_STORE_ITEM_ALL_OUT = `
<!DOCTYPE html>
<html>
<body class="single-product woocommerce woocommerce-page">
  <div class="product" itemscope itemtype="https://schema.org/Product">
    <h1 class="product_title entry-title">Test Product No Stock</h1>
    <div class="wd-single-price">
      <p class="price">
        <span class="woocommerce-Price-amount amount">
          <bdi><span class="woocommerce-Price-currencySymbol">&#8353;</span>250,000</bdi>
        </span>
      </p>
    </div>
    <p class="stock out-of-stock wd-style-default">Sin existencias</p>
    <div class="store-list">
      <div class="store-item gam-location-item">
        <div class="store-info"><span class="store-name">Alajuela</span></div>
        <div class="status status-out"><span class="status-text">No disponible</span></div>
      </div>
      <div class="store-item gam-location-item">
        <div class="store-info"><span class="store-name">San Pedro</span></div>
        <div class="status status-out"><span class="status-text">No disponible</span></div>
      </div>
    </div>
    <div class="store-list">
      <div class="store-item central-warehouse-item">
        <div class="store-info"><span class="store-name">Bodega Central</span></div>
        <div class="status status-out"><span class="status-text">No disponible</span></div>
      </div>
    </div>
  </div>
</body>
</html>`;

/* =========================================================
   TESTS
   ========================================================= */

describe('productScraper', () => {
  describe('parseNumericPrice', () => {
    test('parses simple integer price', () => {
      expect(parseNumericPrice('99999')).toBe(99999);
    });

    test('parses price with comma thousand separator (US style)', () => {
      expect(parseNumericPrice('1,234,567')).toBe(1234567);
    });

    test('parses price with dot decimal', () => {
      expect(parseNumericPrice('99.99')).toBe(99.99);
    });

    test('parses price with comma decimal (European style)', () => {
      expect(parseNumericPrice('1.234,56')).toBe(1234.56);
    });

    test('parses Costa Rican price format - dot is thousands separator (39.900 -> 39900)', () => {
      expect(parseNumericPrice('39.900')).toBe(39900);
    });

    test('parses Costa Rican price format - multi-segment (1.234.567 -> 1234567)', () => {
      expect(parseNumericPrice('1.234.567')).toBe(1234567);
    });

    test('parses Razer sale price (67.901 -> 67901)', () => {
      expect(parseNumericPrice('67.901')).toBe(67901);
    });

    test('parses Razer original price (69.900 -> 69900)', () => {
      expect(parseNumericPrice('69.900')).toBe(69900);
    });

    test('parses MSI price (34.900 -> 34900)', () => {
      expect(parseNumericPrice('34.900')).toBe(34900);
    });

    test('returns null for empty string', () => {
      expect(parseNumericPrice('')).toBeNull();
    });

    test('returns null for non-numeric string', () => {
      expect(parseNumericPrice('N/A')).toBeNull();
    });
  });

  describe('extractCurrencySymbol', () => {
    test('detects CRC colones symbol', () => {
      expect(extractCurrencySymbol('\u20a1 12,345')).toBe('CRC');
    });

    test('detects USD dollar symbol', () => {
      expect(extractCurrencySymbol('$ 99.99')).toBe('USD');
    });

    test('detects EUR euro symbol', () => {
      expect(extractCurrencySymbol('\u20ac 49.99')).toBe('EUR');
    });

    test('returns null for unrecognized currency', () => {
      expect(extractCurrencySymbol('49.99')).toBeNull();
    });
  });

  describe('isWooCommerceProduct', () => {
    test('returns true for page with single-product body class', () => {
      const $ = load('<html><body class="single-product"><div class="product"></div></body></html>');
      expect(isWooCommerceProduct($)).toBe(true);
    });

    test('returns true for page with schema.org/Product itemtype', () => {
      const $ = load('<html><body><div itemtype="https://schema.org/Product"></div></body></html>');
      expect(isWooCommerceProduct($)).toBe(true);
    });

    test('returns false for a non-product page', () => {
      const $ = load('<html><body class="blog"><article></article></body></html>');
      expect(isWooCommerceProduct($)).toBe(false);
    });
  });

  describe('extractText', () => {
    test('returns trimmed text of first matching element', () => {
      const $ = load('<h1 class="product_title">  My Product  </h1>');
      expect(extractText($, 'h1.product_title')).toBe('My Product');
    });

    test('returns null when selector does not match', () => {
      const $ = load('<html><body></body></html>');
      expect(extractText($, 'h1.product_title')).toBeNull();
    });
  });

  describe('extractPrice', () => {
    test('returns regular price when no sale (Costa Rican dot-thousands format)', () => {
      const $ = load(`<div class="summary entry-summary"><p class="price">
        <span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">&#8353;</span>39.900</bdi></span>
      </p></div>`);
      const { price, originalPrice, currency } = extractPrice($);
      expect(price).toBe(39900);
      expect(originalPrice).toBeNull();
      expect(currency).toBe('CRC');
    });

    test('returns sale price from <ins> and original from <del>', () => {
      const $ = load(`<div class="summary entry-summary"><p class="price">
        <del><span class="woocommerce-Price-amount amount"><bdi><span>&#8353;</span>69.900</bdi></span></del>
        <ins><span class="woocommerce-Price-amount amount"><bdi><span>&#8353;</span>67.901</bdi></span></ins>
      </p></div>`);
      const { price, originalPrice, currency } = extractPrice($);
      expect(price).toBe(67901);
      expect(originalPrice).toBe(69900);
      expect(currency).toBe('CRC');
    });

    test('returns nulls when no price element is present', () => {
      const $ = load('<div class="product"></div>');
      const { price, originalPrice, currency } = extractPrice($);
      expect(price).toBeNull();
      expect(originalPrice).toBeNull();
      expect(currency).toBeNull();
    });

    test('ignores prices in related products — only reads from .summary', () => {
      // Related product has ₡1.900 (cheap add-on price) appearing BEFORE the main product in DOM.
      // Main product is ₡375.000. The scraper must return the summary price, not the related one.
      const $ = load(`
        <div class="related products">
          <article class="product">
            <p class="price">
              <span class="woocommerce-Price-amount amount"><bdi><span>&#8353;</span>1.900</bdi></span>
            </p>
          </article>
        </div>
        <div class="summary entry-summary">
          <p class="price">
            <span class="woocommerce-Price-amount amount"><bdi><span>&#8353;</span>375.000</bdi></span>
          </p>
        </div>
      `);
      const { price } = extractPrice($);
      expect(price).toBe(375000);
    });

    test('ignores sale prices in related products — only reads from .summary', () => {
      const $ = load(`
        <div class="related products">
          <article class="product">
            <p class="price">
              <ins><span class="woocommerce-Price-amount amount"><bdi><span>&#8353;</span>6.500</bdi></span></ins>
            </p>
          </article>
        </div>
        <div class="summary entry-summary">
          <p class="price">
            <del><span class="woocommerce-Price-amount amount"><bdi><span>&#8353;</span>850.000</bdi></span></del>
            <ins><span class="woocommerce-Price-amount amount"><bdi><span>&#8353;</span>799.000</bdi></span></ins>
          </p>
        </div>
      `);
      const { price, originalPrice } = extractPrice($);
      expect(price).toBe(799000);
      expect(originalPrice).toBe(850000);
    });
  });

  describe('extractDiscountPercentage', () => {
    test('extracts percentage from -3% badge', () => {
      const $ = load('<span class="onsale">-3%</span>');
      expect(extractDiscountPercentage($)).toBe(3);
    });

    test('extracts percentage from "20% OFF" badge', () => {
      const $ = load('<span class="onsale">20% OFF</span>');
      expect(extractDiscountPercentage($)).toBe(20);
    });

    test('returns null when no sale badge is present', () => {
      const $ = load('<div class="product"></div>');
      expect(extractDiscountPercentage($)).toBeNull();
    });
  });

  describe('extractStockLocations', () => {
    test('extracts stock from wc-stock-locations table (legacy fallback)', () => {
      const $ = load(`<div class="wc-stock-locations">
        <table>
          <tr><td>Alajuela</td><td>1 en stock</td></tr>
          <tr><td>Bodega Central</td><td>2 en stock</td></tr>
        </table>
      </div>`);
      const locations = extractStockLocations($);
      expect(locations).toHaveLength(2);
      expect(locations[0]).toEqual({ location: 'Alajuela', quantity: 1 });
      expect(locations[1]).toEqual({ location: 'Bodega Central', quantity: 2 });
    });

    test('extracts stock from .store-item structure (primary path for extremetechcr.com)', () => {
      const $ = load(HTML_STORE_ITEM_MIXED);
      const locations = extractStockLocations($);
      expect(locations.length).toBe(4);
      expect(locations.find((l) => l.location === 'San Pedro')).toEqual({ location: 'San Pedro', quantity: 2 });
      expect(locations.find((l) => l.location === 'Cartago')).toEqual({ location: 'Cartago', quantity: 1 });
      expect(locations.find((l) => l.location === 'Escazu')).toEqual({ location: 'Escazu', quantity: 0 });
      expect(locations.find((l) => l.location === 'Bodega Central')).toEqual({ location: 'Bodega Central', quantity: 1 });
    });

    test('store-item structure: isAvailable true when at least one store has stock', () => {
      const result = scrapeProductFromHtml('https://example.com/producto/x/', HTML_STORE_ITEM_MIXED);
      expect(result.isAvailable).toBe(true);
    });

    test('store-item structure: isAvailable false when all stores are out of stock', () => {
      const result = scrapeProductFromHtml('https://example.com/producto/x/', HTML_STORE_ITEM_ALL_OUT);
      expect(result.isAvailable).toBe(false);
      expect(result.stockLocations.every((l) => l.quantity === 0)).toBe(true);
    });

    test('returns empty array when no stock location container is found', () => {
      const $ = load('<div class="product"></div>');
      expect(extractStockLocations($)).toEqual([]);
    });
  });

  describe('parseStoreStatusQuantity', () => {
    test('status-out returns 0 (No disponible)', () => {
      expect(parseStoreStatusQuantity('status status-out', 'No disponible')).toBe(0);
    });

    test('status-available returns 1 (Disponible)', () => {
      expect(parseStoreStatusQuantity('status status-available', 'Disponible')).toBe(1);
    });

    test('status-limited parses "Queda 1" as 1', () => {
      expect(parseStoreStatusQuantity('status status-limited', 'Queda 1')).toBe(1);
    });

    test('status-limited parses "Quedan 2" as 2', () => {
      expect(parseStoreStatusQuantity('status status-limited', 'Quedan 2')).toBe(2);
    });

    test('status-limited with no digit falls back to 1', () => {
      expect(parseStoreStatusQuantity('status status-limited', 'Disponible')).toBe(1);
    });

    test('unknown status class with digit falls back to parsed number', () => {
      expect(parseStoreStatusQuantity('status status-unknown', '3 unidades')).toBe(3);
    });

    test('unknown status class with no digit returns null', () => {
      expect(parseStoreStatusQuantity('status status-unknown', 'Desconocido')).toBeNull();
    });
  });

  describe('parseStockQuantity', () => {
    test('parses "1 en stock"', () => {
      expect(parseStockQuantity('1 en stock')).toBe(1);
    });

    test('parses "2 unidades"', () => {
      expect(parseStockQuantity('2 unidades')).toBe(2);
    });

    test('parses plain number', () => {
      expect(parseStockQuantity('5')).toBe(5);
    });

    test('returns null for non-numeric text', () => {
      expect(parseStockQuantity('Out of stock')).toBeNull();
    });
  });

  describe('parseStockLocationText', () => {
    test('parses "Alajuela: 1 en stock"', () => {
      expect(parseStockLocationText('Alajuela: 1 en stock')).toEqual({ location: 'Alajuela', quantity: 1 });
    });

    test('returns null for unrecognized format', () => {
      expect(parseStockLocationText('No stock info')).toBeNull();
    });
  });

  describe('isCloudflareChallenge', () => {
    test('detects managed challenge via challenges.cloudflare.com script', () => {
      const html = '<html><body><script src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/orchestrate/managed/v1"></script></body></html>';
      expect(isCloudflareChallenge(html)).toBe(true);
    });

    test('detects interactive challenge via cf-browser-verification', () => {
      const html = '<html><body><div id="cf-browser-verification">Checking...</div></body></html>';
      expect(isCloudflareChallenge(html)).toBe(true);
    });

    test('detects legacy JS challenge via __cf_chl_f_tk token', () => {
      const html = '<html><body><script>var __cf_chl_f_tk="abc123";</script></body></html>';
      expect(isCloudflareChallenge(html)).toBe(true);
    });

    test('detects legacy JS challenge via jschl-answer', () => {
      const html = '<html><body><input id="jschl-answer" value="abc"/></body></html>';
      expect(isCloudflareChallenge(html)).toBe(true);
    });

    test('returns false for a normal product page', () => {
      expect(isCloudflareChallenge(HTML_WOODMART_REGULAR)).toBe(false);
    });

    test('scrapeProductFromHtml returns isCloudflarePage:true for CF challenge HTML', () => {
      const cfHtml = '<html><head><title>Just a moment...</title></head><body><script src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/orchestrate/managed/v1"></script></body></html>';
      const result = scrapeProductFromHtml('https://extremetechcr.com/producto/test/', cfHtml);
      expect(result.isCloudflarePage).toBe(true);
      expect(result.isProduct).toBe(false);
      expect(result.price).toBeNull();
    });

    test('scrapeProductFromHtml does NOT set isCloudflarePage for a normal product page', () => {
      const result = scrapeProductFromHtml('https://extremetechcr.com/producto/test/', HTML_WOODMART_REGULAR);
      expect(result.isCloudflarePage).toBeUndefined();
      expect(result.isProduct).toBe(true);
    });
  });

  describe('WOODMART/ELEMENTOR FIXTURE: regular price via .wd-single-price', () => {
    let result;
    beforeAll(() => {
      result = scrapeProductFromHtml('https://extremetechcr.com/producto/msi-mag-274f-27-ips-200-hz/', HTML_WOODMART_REGULAR);
    });

    test('is recognized as a product page', () => {
      expect(result.isProduct).toBe(true);
    });

    test('extracts price as 65000 (comma-thousands format ₡65,000)', () => {
      expect(result.price).toBe(65000);
    });

    test('has no original price (not on sale)', () => {
      expect(result.originalPrice).toBeNull();
    });

    test('extracts currency as CRC', () => {
      expect(result.currency).toBe('CRC');
    });

    test('does not set htmlDebug (price was found)', () => {
      expect(result.htmlDebug).toBeUndefined();
    });
  });

  describe('WOODMART/ELEMENTOR FIXTURE: sale price via .wd-single-price', () => {
    let result;
    beforeAll(() => {
      result = scrapeProductFromHtml('https://extremetechcr.com/producto/sale-product/', HTML_WOODMART_SALE);
    });

    test('is recognized as a product page', () => {
      expect(result.isProduct).toBe(true);
    });

    test('extracts sale price as 350000', () => {
      expect(result.price).toBe(350000);
    });

    test('extracts original (pre-sale) price as 375000', () => {
      expect(result.originalPrice).toBe(375000);
    });

    test('extracts discount percentage as 7', () => {
      expect(result.discountPercentage).toBe(7);
    });

    test('extracts currency as CRC', () => {
      expect(result.currency).toBe('CRC');
    });
  });

  describe('buildHtmlDebug', () => {
    test('includes page title in output', () => {
      const $ = load('<html><head><title>Test Product Page</title></head><body class="single-product"></body></html>');
      const debug = buildHtmlDebug($);
      expect(debug).toContain('Page title: "Test Product Page"');
    });

    test('falls back to (no title) when title element is missing', () => {
      const $ = load('<html><body class="single-product"></body></html>');
      const debug = buildHtmlDebug($);
      expect(debug).toContain('Page title: "(no title)"');
    });

    test('reports true when .summary container is present', () => {
      const $ = load('<html><body><div class="summary entry-summary"><p class="price"></p></div></body></html>');
      const debug = buildHtmlDebug($);
      expect(debug).toContain('Has .summary/.entry-summary: true');
    });

    test('reports false when .summary container is absent', () => {
      const $ = load('<html><body><div class="other"></div></body></html>');
      const debug = buildHtmlDebug($);
      expect(debug).toContain('Has .summary/.entry-summary: false');
    });

    test('includes price container HTML when price container exists', () => {
      const $ = load('<html><body><div class="summary entry-summary"><p class="price"><span>₡39.900</span></p></div></body></html>');
      const debug = buildHtmlDebug($);
      expect(debug).toContain('Price container HTML:');
      expect(debug).toContain('39.900');
    });

    test('reports (not found) for price container when absent', () => {
      const $ = load('<html><body><div class="summary entry-summary"></div></body></html>');
      const debug = buildHtmlDebug($);
      expect(debug).toContain('Price container HTML: (not found)');
    });

    test('includes body text snippet', () => {
      const $ = load('<html><head><title>Just a moment...</title></head><body>Cloudflare challenge text here</body></html>');
      const debug = buildHtmlDebug($);
      expect(debug).toContain('Body text snippet:');
      expect(debug).toContain('Cloudflare challenge text here');
    });

    test('attaches htmlDebug to scrapeProductFromHtml result when price is null', () => {
      const nopriceHtml = `
        <!DOCTYPE html>
        <html><head><title>Product Page</title></head>
        <body class="single-product woocommerce-page">
          <div class="product" itemscope itemtype="https://schema.org/Product">
            <h1 class="product_title entry-title">No Price Product</h1>
            <div class="summary entry-summary">
              <!-- no price element -->
            </div>
          </div>
        </body></html>`;
      const result = scrapeProductFromHtml('https://example.com/producto/test/', nopriceHtml);
      expect(result.price).toBeNull();
      expect(result.htmlDebug).toBeDefined();
      expect(result.htmlDebug).toContain('Page title: "Product Page"');
      expect(result.htmlDebug).toContain('Has .summary/.entry-summary: true');
    });

    test('does not attach htmlDebug when price is found', () => {
      const result = scrapeProductFromHtml(
        'https://extremetechcr.com/producto/intel-pentium-gold-g6405/',
        HTML_PENTIUM_G6405
      );
      expect(result.price).not.toBeNull();
      expect(result.htmlDebug).toBeUndefined();
    });
  });

  /* =========================================================
     SPECIFIC PRODUCT FIXTURE TESTS
     These validate against real product data provided by the user.
     If these tests break it means the scraper selectors need updating.
     ========================================================= */

  describe('PRODUCT FIXTURE: Intel Pentium Gold G6405 (CPU1011)', () => {
    let result;
    beforeAll(() => {
      result = scrapeProductFromHtml(
        'https://extremetechcr.com/producto/intel-pentium-gold-g6405/',
        HTML_PENTIUM_G6405
      );
    });

    test('is recognized as a product page', () => {
      expect(result.isProduct).toBe(true);
    });

    test('extracts name correctly', () => {
      expect(result.name).toBe('Intel Pentium Gold G6405');
    });

    test('extracts price as 39900 (Costa Rican dot-thousands format)', () => {
      expect(result.price).toBe(39900);
    });

    test('has no original price (not on sale)', () => {
      expect(result.originalPrice).toBeNull();
    });

    test('has no discount percentage (not on sale)', () => {
      expect(result.discountPercentage).toBeNull();
    });

    test('extracts currency as CRC', () => {
      expect(result.currency).toBe('CRC');
    });

    test('extracts SKU as CPU1011', () => {
      expect(result.sku).toBe('CPU1011');
    });

    test('extracts stock in Alajuela (1 unit)', () => {
      const alajuela = result.stockLocations.find((l) => l.location === 'Alajuela');
      expect(alajuela).toBeDefined();
      expect(alajuela.quantity).toBe(1);
    });

    test('extracts stock in San Jose Centro (1 unit)', () => {
      const sanjose = result.stockLocations.find((l) => l.location === 'San Jose Centro');
      expect(sanjose).toBeDefined();
      expect(sanjose.quantity).toBe(1);
    });

    test('extracts stock in Bodega Central (2 units)', () => {
      const bodega = result.stockLocations.find((l) => l.location === 'Bodega Central');
      expect(bodega).toBeDefined();
      expect(bodega.quantity).toBe(2);
    });

    test('isAvailable is true (has stock)', () => {
      expect(result.isAvailable).toBe(true);
    });
  });

  describe('PRODUCT FIXTURE: MSI PRO MP225V 22 100Hz (MT2736)', () => {
    let result;
    beforeAll(() => {
      result = scrapeProductFromHtml(
        'https://extremetechcr.com/producto/msi-pro-mp225v-22-100hz-9s6-3pe0cm-020/',
        HTML_MSI_MP225V
      );
    });

    test('is recognized as a product page', () => {
      expect(result.isProduct).toBe(true);
    });

    test('extracts name correctly', () => {
      expect(result.name).toContain('MSI PRO MP225V');
    });

    test('extracts price as 34900', () => {
      expect(result.price).toBe(34900);
    });

    test('has no original price (not on sale)', () => {
      expect(result.originalPrice).toBeNull();
    });

    test('extracts SKU as MT2736', () => {
      expect(result.sku).toBe('MT2736');
    });

    test('extracts stock in Guapiles (1 unit)', () => {
      const guapiles = result.stockLocations.find((l) => l.location === 'Guapiles');
      expect(guapiles).toBeDefined();
      expect(guapiles.quantity).toBe(1);
    });

    test('isAvailable is true (has stock)', () => {
      expect(result.isAvailable).toBe(true);
    });
  });

  describe('PRODUCT FIXTURE: Razer Kraken Kitty V2 Pro Rosa (HE6006)', () => {
    let result;
    beforeAll(() => {
      result = scrapeProductFromHtml(
        'https://extremetechcr.com/producto/razer-kraken-kitty-edition-v2-pro-rosa/',
        HTML_RAZER_KRAKEN
      );
    });

    test('is recognized as a product page', () => {
      expect(result.isProduct).toBe(true);
    });

    test('extracts name correctly', () => {
      expect(result.name).toContain('Razer Kraken Kitty');
    });

    test('extracts sale price as 67901 (not the original)', () => {
      expect(result.price).toBe(67901);
    });

    test('extracts original (pre-sale) price as 69900', () => {
      expect(result.originalPrice).toBe(69900);
    });

    test('extracts discount percentage as 3', () => {
      expect(result.discountPercentage).toBe(3);
    });

    test('extracts currency as CRC', () => {
      expect(result.currency).toBe('CRC');
    });

    test('extracts SKU as HE6006', () => {
      expect(result.sku).toBe('HE6006');
    });

    test('has stock in at least 3 locations', () => {
      expect(result.stockLocations.length).toBeGreaterThanOrEqual(3);
    });

    test('isAvailable is true (has stock)', () => {
      expect(result.isAvailable).toBe(true);
    });
  });
});

describe('productScraper', () => {
  describe('parseNumericPrice', () => {
    test('parses simple integer price', () => {
      expect(parseNumericPrice('99999')).toBe(99999);
    });

    test('parses price with comma thousand separator', () => {
      expect(parseNumericPrice('1,234,567')).toBe(1234567);
    });

    test('parses price with dot decimal', () => {
      expect(parseNumericPrice('99.99')).toBe(99.99);
    });

    test('parses price with comma decimal (European style)', () => {
      expect(parseNumericPrice('1.234,56')).toBe(1234.56);
    });

    test('returns null for empty string', () => {
      expect(parseNumericPrice('')).toBeNull();
    });

    test('returns null for non-numeric string', () => {
      expect(parseNumericPrice('N/A')).toBeNull();
    });
  });

  describe('extractCurrencySymbol', () => {
    test('detects CRC colones symbol', () => {
      expect(extractCurrencySymbol('\u20a1 12,345')).toBe('CRC');
    });

    test('detects USD dollar symbol', () => {
      expect(extractCurrencySymbol('$ 99.99')).toBe('USD');
    });

    test('detects EUR euro symbol', () => {
      expect(extractCurrencySymbol('\u20ac 49.99')).toBe('EUR');
    });

    test('returns null for unrecognized currency', () => {
      expect(extractCurrencySymbol('49.99')).toBeNull();
    });
  });

  describe('isWooCommerceProduct', () => {
    test('returns true for page with single-product body class', () => {
      const $ = load('<html><body class="single-product"><div class="product"></div></body></html>');
      expect(isWooCommerceProduct($)).toBe(true);
    });

    test('returns true for page with schema.org/Product itemtype', () => {
      const $ = load('<html><body><div itemtype="https://schema.org/Product"></div></body></html>');
      expect(isWooCommerceProduct($)).toBe(true);
    });

    test('returns false for a non-product page', () => {
      const $ = load('<html><body class="blog"><article></article></body></html>');
      expect(isWooCommerceProduct($)).toBe(false);
    });
  });

  describe('extractText', () => {
    test('returns trimmed text of first matching element', () => {
      const $ = load('<h1 class="product_title">  My Product  </h1>');
      expect(extractText($, 'h1.product_title')).toBe('My Product');
    });

    test('returns null when selector does not match', () => {
      const $ = load('<html><body></body></html>');
      expect(extractText($, 'h1.product_title')).toBeNull();
    });
  });
});
