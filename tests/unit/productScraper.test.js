'use strict';

const {
  parseNumericPrice,
  extractCurrencySymbol,
  isWooCommerceProduct,
  extractText,
} = require('../../src/scraper/productScraper');
const { load } = require('cheerio');

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
