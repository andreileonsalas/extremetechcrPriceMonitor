'use strict';

const {
  parseNumericPrice,
  extractCurrencySymbol,
  isWooCommerceProduct,
  extractText,
  extractPrice,
  extractDiscountPercentage,
  extractStockLocations,
  parseStockQuantity,
  parseStockLocationText,
  scrapeProductFromHtml,
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
    test('extracts stock from wc-stock-locations table', () => {
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

    test('returns empty array when no stock location container is found', () => {
      const $ = load('<div class="product"></div>');
      expect(extractStockLocations($)).toEqual([]);
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
