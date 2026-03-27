'use strict';

const axios = require('axios');
const { parseSitemap, isProductUrl, fetchUrlsInBatches, delay } = require('../../src/scraper/sitemapReader');

jest.mock('axios');

describe('sitemapReader', () => {
  describe('isProductUrl', () => {
    test('identifies product URL with /producto/ path', () => {
      expect(isProductUrl('https://extremetechcr.com/producto/laptop-gamer')).toBe(true);
    });

    test('identifies product URL with /product/ path', () => {
      expect(isProductUrl('https://extremetechcr.com/product/mouse-rgb')).toBe(true);
    });

    test('rejects category URL', () => {
      expect(isProductUrl('https://extremetechcr.com/categoria/laptops')).toBe(false);
    });

    test('rejects tag URL', () => {
      expect(isProductUrl('https://extremetechcr.com/tag/gaming')).toBe(false);
    });

    test('rejects cart URL', () => {
      expect(isProductUrl('https://extremetechcr.com/cart/')).toBe(false);
    });

    test('rejects shop page URL', () => {
      expect(isProductUrl('https://extremetechcr.com/shop/')).toBe(false);
    });

    test('rejects home page URL', () => {
      expect(isProductUrl('https://extremetechcr.com/')).toBe(false);
    });
  });

  describe('parseSitemap', () => {
    test('parses regular sitemap and returns URL list', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://extremetechcr.com/producto/laptop-a</loc></url>
          <url><loc>https://extremetechcr.com/categoria/laptops</loc></url>
        </urlset>`;
      const urls = await parseSitemap(xml);
      expect(urls).toContain('https://extremetechcr.com/producto/laptop-a');
      expect(urls).toContain('https://extremetechcr.com/categoria/laptops');
    });

    test('parses sitemap index and fetches child sitemaps', async () => {
      const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://extremetechcr.com/sitemap-products.xml</loc></sitemap>
        </sitemapindex>`;

      const childXml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://extremetechcr.com/producto/monitor-4k</loc></url>
        </urlset>`;

      axios.get.mockResolvedValueOnce({ data: childXml });

      const urls = await parseSitemap(indexXml);
      expect(urls).toContain('https://extremetechcr.com/producto/monitor-4k');
    });
  });

  describe('fetchUrlsInBatches', () => {
    test('processes all items and returns results', async () => {
      const items = ['a', 'b', 'c'];
      const processor = jest.fn((item) => Promise.resolve(item.toUpperCase()));
      const results = await fetchUrlsInBatches(items, processor);
      expect(results).toEqual(['A', 'B', 'C']);
      expect(processor).toHaveBeenCalledTimes(3);
    });
  });

  describe('delay', () => {
    test('resolves after approximately the specified time', async () => {
      const start = Date.now();
      await delay(100);
      expect(Date.now() - start).toBeGreaterThanOrEqual(90);
    });
  });
});
