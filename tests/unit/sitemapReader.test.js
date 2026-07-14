'use strict';

const {
  parseSitemap,
  isProductUrl,
  isCloudflareContent,
  extractProductUrlsFromHtml,
  getProductUrlsFromDiscoveryPages,
  getProductUrlsFromSitemap,
  fetchUrlsInBatches,
  delay,
} = require('../../src/scraper/sitemapReader');

jest.mock('../../src/scraper/browser');
const browser = require('../../src/scraper/browser');

// Silence console output during tests to avoid noise
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  console.log.mockRestore();
  console.warn.mockRestore();
  console.error.mockRestore();
});

beforeEach(() => {
  // Use mockReset() (not clearAllMocks) so that any pending mockResolvedValueOnce
  // implementations queued by previous tests are flushed. mockReset() clears both
  // call history AND mock implementations; clearAllMocks() only clears call history.
  browser.fetchText.mockReset();
  browser.fetchPage.mockReset();
});

describe('sitemapReader', () => {
  describe('isProductUrl', () => {
    test('identifies product URL with /producto/ path', () => {
      expect(isProductUrl('https://extremetechcr.com/producto/laptop-gamer')).toBe(true);
    });

    test('identifies product URL with /product/ path', () => {
      expect(isProductUrl('https://extremetechcr.com/product/mouse-rgb')).toBe(true);
    });

    test('identifies new 2026 TV product URL', () => {
      expect(isProductUrl('https://extremetechcr.com/producto/televisor-lg-oled-c6-evo-ai-oled65c6-2026-65-pulgadas-4k/')).toBe(true);
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

    test('rejects XML sitemap URL (SKIP_URL_PATTERNS includes .xml)', () => {
      expect(isProductUrl('https://extremetechcr.com/sitemap-products.xml')).toBe(false);
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

      browser.fetchText.mockResolvedValueOnce(childXml);

      const urls = await parseSitemap(indexXml);
      expect(urls).toContain('https://extremetechcr.com/producto/monitor-4k');
    });

    test('returns empty array for empty XML', async () => {
      const urls = await parseSitemap('');
      expect(urls).toEqual([]);
    });

    test('returns empty array for Cloudflare challenge HTML', async () => {
      const cfHtml = '<html><head><title>Just a moment...</title></head><body>challenges.cloudflare.com</body></html>';
      const urls = await parseSitemap(cfHtml);
      expect(urls).toEqual([]);
    });
  });

  describe('isCloudflareContent', () => {
    test('detects CF challenge with challenges.cloudflare.com script', () => {
      const cfHtml = '<html><body><script src="https://challenges.cloudflare.com/..."></script></body></html>';
      expect(isCloudflareContent(cfHtml)).toBe(true);
    });

    test('detects "Just a moment..." title page', () => {
      const cfHtml = '<html><head><title>Just a moment...</title></head><body>Enable JavaScript</body></html>';
      expect(isCloudflareContent(cfHtml)).toBe(true);
    });

    test('detects CF challenge with __cf_chl_f_tk token', () => {
      const cfHtml = '<html><body>__cf_chl_f_tk=abc123</body></html>';
      expect(isCloudflareContent(cfHtml)).toBe(true);
    });

    test('detects CF interactive challenge element', () => {
      const cfHtml = '<html><body><div id="cf-browser-verification"></div></body></html>';
      expect(isCloudflareContent(cfHtml)).toBe(true);
    });

    test('detects "Enable JavaScript" + cloudflare combination', () => {
      const cfHtml = '<html><body>cloudflare Enable JavaScript to continue</body></html>';
      expect(isCloudflareContent(cfHtml)).toBe(true);
    });

    test('does not flag valid sitemap XML as Cloudflare', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://extremetechcr.com/sitemap-1.xml</loc></sitemap>
        </sitemapindex>`;
      expect(isCloudflareContent(xml)).toBe(false);
    });

    test('does not flag regular WooCommerce HTML as Cloudflare', () => {
      const html = '<html><body><div class="woocommerce"><h1>Tienda</h1></div></body></html>';
      expect(isCloudflareContent(html)).toBe(false);
    });

    test('does not flag empty string as Cloudflare', () => {
      expect(isCloudflareContent('')).toBe(false);
    });
  });

  describe('extractProductUrlsFromHtml', () => {
    test('extracts absolute product links from WooCommerce shop page', () => {
      const html = `
        <html><body>
          <a href="https://extremetechcr.com/producto/laptop-a/">Laptop A</a>
          <a href="https://extremetechcr.com/producto/mouse-b/">Mouse B</a>
          <a href="https://extremetechcr.com/categoria/laptops/">Laptops</a>
          <a href="https://extremetechcr.com/tienda/">Tienda</a>
        </body></html>
      `;
      const urls = extractProductUrlsFromHtml(html, 'https://extremetechcr.com/tienda/');
      expect(urls).toContain('https://extremetechcr.com/producto/laptop-a/');
      expect(urls).toContain('https://extremetechcr.com/producto/mouse-b/');
      expect(urls).not.toContain('https://extremetechcr.com/categoria/laptops/');
      expect(urls).not.toContain('https://extremetechcr.com/tienda/');
    });

    test('resolves relative product links to absolute URLs', () => {
      const html = `
        <html><body>
          <a href="/producto/tv-samsung-55/">TV Samsung</a>
          <a href="/categoria/televisores/">Televisores</a>
        </body></html>
      `;
      const urls = extractProductUrlsFromHtml(html, 'https://extremetechcr.com/tienda/');
      expect(urls).toContain('https://extremetechcr.com/producto/tv-samsung-55/');
      expect(urls).not.toContain('https://extremetechcr.com/categoria/televisores/');
    });

    test('strips query parameters from product URLs', () => {
      const html = `
        <html><body>
          <a href="https://extremetechcr.com/producto/laptop-x/?ref=featured">Laptop X</a>
        </body></html>
      `;
      const urls = extractProductUrlsFromHtml(html, 'https://extremetechcr.com/tienda/');
      expect(urls).toContain('https://extremetechcr.com/producto/laptop-x/');
      expect(urls.every((u) => !u.includes('?'))).toBe(true);
    });

    test('deduplicates repeated product links', () => {
      const html = `
        <html><body>
          <a href="/producto/monitor-4k/">Monitor</a>
          <a href="/producto/monitor-4k/">Monitor (duplicate)</a>
        </body></html>
      `;
      const urls = extractProductUrlsFromHtml(html, 'https://extremetechcr.com/tienda/');
      expect(urls.filter((u) => u.includes('monitor-4k')).length).toBe(1);
    });

    test('returns empty array when no product links found', () => {
      const html = '<html><body><a href="/categoria/laptops/">Laptops</a></body></html>';
      const urls = extractProductUrlsFromHtml(html, 'https://extremetechcr.com/');
      expect(urls).toEqual([]);
    });

    test('returns empty array for Cloudflare challenge HTML', () => {
      const cfHtml = '<html><head><title>Just a moment...</title></head><body>challenges.cloudflare.com</body></html>';
      const urls = extractProductUrlsFromHtml(cfHtml, 'https://extremetechcr.com/');
      expect(urls).toEqual([]);
    });

    test('discovers the missing TV product URL from category page HTML', () => {
      const html = `
        <html><body>
          <div class="products">
            <a href="/producto/televisor-lg-oled-c6-evo-ai-oled65c6-2026-65-pulgadas-4k/">LG OLED C6 2026</a>
            <a href="/producto/televisor-samsung-neo-qled-65/">Samsung QLED 65"</a>
          </div>
        </body></html>
      `;
      const urls = extractProductUrlsFromHtml(html, 'https://extremetechcr.com/categoria/televisores/');
      expect(urls).toContain('https://extremetechcr.com/producto/televisor-lg-oled-c6-evo-ai-oled65c6-2026-65-pulgadas-4k/');
    });
  });

  describe('getProductUrlsFromDiscoveryPages', () => {
    test('returns product URLs extracted from a discovery page', async () => {
      const shopHtml = `
        <html><body>
          <a href="/producto/tv-a/">TV A</a>
          <a href="/producto/tv-b/">TV B</a>
          <a href="/categoria/televisores/">Televisores</a>
        </body></html>
      `;
      browser.fetchPage.mockResolvedValueOnce({ html: shopHtml, statusCode: 200 });
      // Second page returns 404 to stop pagination
      browser.fetchPage.mockResolvedValueOnce({ html: '', statusCode: 404 });

      const urls = await getProductUrlsFromDiscoveryPages(
        ['https://extremetechcr.com/tienda/'],
        5
      );

      expect(urls.some((u) => u.includes('/producto/tv-a/'))).toBe(true);
      expect(urls.some((u) => u.includes('/producto/tv-b/'))).toBe(true);
      expect(urls.every((u) => isProductUrl(u))).toBe(true);
    });

    test('stops pagination when a page returns 404', async () => {
      const page1Html = '<html><body><a href="/producto/item-1/">Item 1</a></body></html>';
      browser.fetchPage
        .mockResolvedValueOnce({ html: page1Html, statusCode: 200 })
        .mockResolvedValueOnce({ html: '', statusCode: 404 });

      await getProductUrlsFromDiscoveryPages(['https://extremetechcr.com/tienda/'], 5);

      // Should stop after the 404 response — only 2 fetches (page 1 + page 2 which 404s)
      expect(browser.fetchPage).toHaveBeenCalledTimes(2);
    });

    test('stops pagination when a page returns no product links', async () => {
      const page1Html = '<html><body><a href="/producto/item-1/">Item 1</a></body></html>';
      const emptyPage = '<html><body><p>No products</p></body></html>';
      browser.fetchPage
        .mockResolvedValueOnce({ html: page1Html, statusCode: 200 })
        .mockResolvedValueOnce({ html: emptyPage, statusCode: 200 });

      await getProductUrlsFromDiscoveryPages(['https://extremetechcr.com/tienda/'], 5);

      expect(browser.fetchPage).toHaveBeenCalledTimes(2);
    });

    test('returns empty array when discovery page returns CF challenge', async () => {
      const cfHtml = '<html><head><title>Just a moment...</title></head><body>challenges.cloudflare.com</body></html>';
      browser.fetchPage.mockResolvedValueOnce({ html: cfHtml, statusCode: 200 });
      // page 2 returns 404
      browser.fetchPage.mockResolvedValueOnce({ html: '', statusCode: 404 });

      const urls = await getProductUrlsFromDiscoveryPages(
        ['https://extremetechcr.com/tienda/'],
        2
      );
      expect(urls).toEqual([]);
    });

    test('respects maxPagesPerUrl limit', async () => {
      const pageHtml = '<html><body><a href="/producto/item-X/">Item</a></body></html>';
      // All pages return products (pagination never exhausts naturally)
      browser.fetchPage.mockResolvedValue({ html: pageHtml, statusCode: 200 });

      await getProductUrlsFromDiscoveryPages(['https://extremetechcr.com/tienda/'], 3);

      // Should stop after 3 pages
      expect(browser.fetchPage).toHaveBeenCalledTimes(3);
    });

    test('returns empty array for empty discoveryUrls list', async () => {
      const urls = await getProductUrlsFromDiscoveryPages([], 5);
      expect(urls).toEqual([]);
      expect(browser.fetchPage).not.toHaveBeenCalled();
    });
  });

  describe('getProductUrlsFromSitemap', () => {
    test('returns product URLs from primary sitemap when successful', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          ${Array.from({ length: 150 }, (_, i) =>
    `<url><loc>https://extremetechcr.com/producto/product-${i}/</loc></url>`
  ).join('')}
        </urlset>`;
      browser.fetchText.mockResolvedValue(xml);

      const urls = await getProductUrlsFromSitemap();

      expect(urls.length).toBe(150);
      expect(urls.every((u) => isProductUrl(u))).toBe(true);
    });

    test('returns empty array and logs CRITICAL when all sitemaps return CF challenge HTML', async () => {
      const cfHtml = '<html><head><title>Just a moment...</title></head><body>challenges.cloudflare.com</body></html>';
      browser.fetchText.mockResolvedValue(cfHtml);

      const urls = await getProductUrlsFromSitemap();

      expect(urls).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL')
      );
    });

    test('logs CRITICAL and returns empty array when all sitemaps return empty string', async () => {
      browser.fetchText.mockResolvedValue('');

      const urls = await getProductUrlsFromSitemap();

      expect(urls).toEqual([]);
      // Should log that a CRITICAL situation occurred (either empty response or 0 URLs)
      expect(console.error).toHaveBeenCalled();
    });

    test('falls back to secondary sitemap URL when primary returns CF challenge', async () => {
      const cfHtml = '<html><head><title>Just a moment...</title></head><body>challenges.cloudflare.com</body></html>';
      const goodXml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          ${Array.from({ length: 150 }, (_, i) =>
    `<url><loc>https://extremetechcr.com/producto/product-${i}/</loc></url>`
  ).join('')}
        </urlset>`;

      // Primary sitemap URL → CF challenge; first fallback → good XML
      browser.fetchText
        .mockResolvedValueOnce(cfHtml)   // SITEMAP_URL
        .mockResolvedValueOnce(goodXml); // SITEMAP_FALLBACK_URLS[0]

      const urls = await getProductUrlsFromSitemap();

      expect(urls.length).toBe(150);
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
