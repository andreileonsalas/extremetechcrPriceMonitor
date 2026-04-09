'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

/** Path to a test SQLite database used for e2e tests */
const TEST_DB_PATH = path.join(__dirname, '../../tmp/e2e-prices.db');

/** Path to the test ZIP file */
const TEST_ZIP_PATH = path.join(__dirname, '../../public/db.zip');

/**
 * Creates a minimal test SQLite database with seed data for e2e tests.
 * Includes the 3 required specific products from ExtremeTechCR with their
 * exact prices and SKUs as provided by the product owner.
 */
function createTestDatabase() {
  const dir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  const db = new Database(TEST_DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      name TEXT,
      sku TEXT,
      category TEXT,
      description TEXT,
      imageUrl TEXT,
      stockLocations TEXT,
      firstSeenAt TEXT NOT NULL,
      lastCheckedAt TEXT NOT NULL,
      isActive INTEGER DEFAULT 1,
      publishedDateFirst TEXT,
      publishedDateLatest TEXT,
      publishedDateFirstScrapedAt TEXT,
      publishedDateLatestScrapedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS priceHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId INTEGER NOT NULL,
      price REAL,
      originalPrice REAL,
      currency TEXT,
      startDate TEXT NOT NULL,
      endDate TEXT
    );
  `);

  const now = new Date().toISOString();
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const weekAgo = new Date(Date.now() - ONE_WEEK_MS).toISOString();

  const insertProduct = db.prepare(`
    INSERT INTO products (url, name, sku, category, description, imageUrl, stockLocations, firstSeenAt, lastCheckedAt, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPrice = db.prepare(`
    INSERT INTO priceHistory (productId, price, originalPrice, currency, startDate)
    VALUES (?, ?, ?, 'CRC', ?)
  `);
  const insertPrevPrice = db.prepare(`
    INSERT INTO priceHistory (productId, price, originalPrice, currency, startDate, endDate)
    VALUES (?, ?, ?, 'CRC', ?, ?)
  `);

  /**
   * Seed data - includes the 3 required specific products plus extras.
   * originalPrice is non-null for products on sale (Razer Kraken).
   * prevPrice is non-null for products whose price changed, enabling discount-sort tests.
   * The Memoria RAM product is inactive (removed from the site) for filter tests.
   */
  const seedData = [
    {
      url: 'https://extremetechcr.com/producto/intel-pentium-gold-g6405/',
      name: 'Intel Pentium Gold G6405',
      sku: 'CPU1011',
      category: 'Procesadores',
      price: 39900,
      prevPrice: 45000,
      originalPrice: null,
      isActive: 1,
      stockLocations: JSON.stringify([
        { location: 'Alajuela', quantity: 1 },
        { location: 'San Jose Centro', quantity: 1 },
        { location: 'Bodega Central', quantity: 2 },
      ]),
    },
    {
      url: 'https://extremetechcr.com/producto/msi-pro-mp225v-22-100hz-9s6-3pe0cm-020/',
      name: 'MSI PRO MP225V 22 100Hz Monitor',
      sku: 'MT2736',
      category: 'Monitores',
      price: 34900,
      prevPrice: 39900,
      originalPrice: null,
      isActive: 1,
      stockLocations: JSON.stringify([{ location: 'Guapiles', quantity: 1 }]),
    },
    {
      url: 'https://extremetechcr.com/producto/razer-kraken-kitty-edition-v2-pro-rosa/',
      name: 'Razer Kraken Kitty Edition V2 Pro Rosa',
      sku: 'HE6006',
      category: 'Audifonos',
      price: 67901,
      prevPrice: null,
      originalPrice: 69900,
      isActive: 1,
      stockLocations: JSON.stringify([
        { location: 'San Jose Centro', quantity: 2 },
        { location: 'Alajuela', quantity: 1 },
        { location: 'Heredia', quantity: 3 },
      ]),
    },
    {
      url: 'https://extremetechcr.com/producto/laptop-gaming-asus',
      name: 'ASUS Gaming Laptop ROG',
      sku: 'LT001',
      category: 'Laptops',
      price: 850000,
      prevPrice: 800000,
      originalPrice: null,
      isActive: 1,
      stockLocations: JSON.stringify([{ location: 'San Jose Centro', quantity: 1 }]),
    },
    {
      url: 'https://extremetechcr.com/producto/mouse-logitech-g502',
      name: 'Logitech G502 Mouse',
      sku: 'MS001',
      category: 'Mouses',
      price: 45000,
      prevPrice: null,
      originalPrice: null,
      isActive: 1,
      stockLocations: JSON.stringify([{ location: 'Alajuela', quantity: 2 }]),
    },
    {
      url: 'https://extremetechcr.com/producto/memoria-ram-para-pc-8gb-2400mhz-oem/',
      name: 'Memoria RAM para PC 8GB 2400MHz OEM',
      sku: 'MM001',
      category: 'Memorias RAM',
      price: 25000,
      prevPrice: null,
      originalPrice: null,
      isActive: 0, // Product has been removed from the site
      stockLocations: null,
    },
  ];

  seedData.forEach(({ url, name, sku, category, price, prevPrice, originalPrice, isActive, stockLocations }) => {
    const result = insertProduct.run(url, name, sku, category, null, null, stockLocations, now, now, isActive ?? 1);
    if (prevPrice != null) {
      insertPrevPrice.run(result.lastInsertRowid, prevPrice, null, weekAgo, now);
    }
    insertPrice.run(result.lastInsertRowid, price, originalPrice, now);
  });

  db.close();

  // Export to ZIP for the frontend to load
  const publicDir = path.dirname(TEST_ZIP_PATH);
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  const zip = new AdmZip();
  zip.addLocalFile(TEST_DB_PATH, '', 'prices.db');
  zip.writeZip(TEST_ZIP_PATH);
}

test.beforeAll(() => {
  createTestDatabase();
});

test.describe('Frontend - Product Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for products to load (spinner goes away)
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
  });

  test('shows the page title', async ({ page }) => {
    await expect(page).toHaveTitle(/ExtremeTechCR Price Monitor/);
  });

  test('displays product cards after loading', async ({ page }) => {
    const grid = page.locator('#productGrid');
    await expect(grid).toBeVisible();
    const cards = grid.locator('.product-card');
    // 5 active products shown by default (inactive product hidden until filter enabled)
    await expect(cards).toHaveCount(5);
  });

  test('shows product count label', async ({ page }) => {
    // 5 active products visible by default
    await expect(page.locator('#productCount')).toContainText('5');
  });

  test('each product card shows a price badge', async ({ page }) => {
    const badges = page.locator('.price-badge');
    await expect(badges.first()).toBeVisible();
    const text = await badges.first().textContent();
    expect(text).toMatch(/[\d,]/);
  });

  test('product card has a link to the product URL', async ({ page }) => {
    const link = page.locator('.product-card a').first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('extremetechcr.com');
  });

  test('card link text is in Spanish', async ({ page }) => {
    const link = page.locator('.product-card .card-footer a').first();
    const text = await link.textContent();
    expect(text.trim()).toBe('Ver en ExtremeTechCR');
  });
});

test.describe('Frontend - Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
  });

  test('filters products by name', async ({ page }) => {
    await page.fill('#searchInput', 'Laptop');
    await page.waitForTimeout(400);
    const cards = page.locator('.product-card');
    await expect(cards).toHaveCount(1);
  });

  test('search is case-insensitive', async ({ page }) => {
    await page.fill('#searchInput', 'laptop');
    await page.waitForTimeout(400);
    const cards = page.locator('.product-card');
    await expect(cards).toHaveCount(1);
  });

  test('filters products by SKU', async ({ page }) => {
    await page.fill('#searchInput', 'CPU1011');
    await page.waitForTimeout(400);
    const cards = page.locator('.product-card');
    await expect(cards).toHaveCount(1);
  });

  test('SKU search finds the correct product', async ({ page }) => {
    await page.fill('#searchInput', 'CPU1011');
    await page.waitForTimeout(400);
    const title = await page.locator('.product-card .card-title').first().textContent();
    expect(title.toLowerCase()).toContain('pentium');
  });

  test('filters products by URL fragment', async ({ page }) => {
    await page.fill('#searchInput', 'razer-kraken');
    await page.waitForTimeout(400);
    const cards = page.locator('.product-card');
    await expect(cards).toHaveCount(1);
  });
});

test.describe('Frontend - Status Filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
  });

  test('inactive product is hidden by default', async ({ page }) => {
    // Only active products visible by default (filterIncludeInactive unchecked)
    const cards = page.locator('.product-card');
    await expect(cards).toHaveCount(5);
  });

  test('shows inactive product when filterIncludeInactive is checked', async ({ page }) => {
    await page.check('#filterIncludeInactive');
    await page.waitForTimeout(300);
    const cards = page.locator('.product-card');
    // All 6 products: 5 active + 1 inactive (Memoria RAM)
    await expect(cards).toHaveCount(6);
  });

  test('inactive product shows "Ya no disponible" badge', async ({ page }) => {
    await page.check('#filterIncludeInactive');
    await page.waitForTimeout(300);
    await page.fill('#searchInput', 'memoria');
    await page.waitForTimeout(400);
    const badge = page.locator('.product-card .badge.bg-secondary');
    await expect(badge.first()).toContainText('Ya no disponible');
  });

  test('inactive product card links back to its URL on extremetechcr.com', async ({ page }) => {
    await page.check('#filterIncludeInactive');
    await page.waitForTimeout(300);
    await page.fill('#searchInput', 'memoria');
    await page.waitForTimeout(400);
    const link = page.locator('.product-card .card-footer a').first();
    const href = await link.getAttribute('href');
    expect(href).toContain('memoria-ram-para-pc-8gb-2400mhz-oem');
  });
});

test.describe('Frontend - Sort', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
  });

  test('sorts by price ascending', async ({ page }) => {
    await page.selectOption('#sortSelect', 'price-asc');
    const badges = page.locator('.price-badge');
    const first = await badges.first().textContent();
    const last = await badges.last().textContent();
    const parsePrice = (s) => parseFloat(s.replace(/[^0-9.]/g, ''));
    expect(parsePrice(first)).toBeLessThanOrEqual(parsePrice(last));
  });
});

test.describe('Frontend - Price History Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
  });

  test('opens price history modal on product card click', async ({ page }) => {
    await page.locator('.product-card').first().click();
    await expect(page.locator('#priceModal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#priceModalTitle')).toBeVisible();
  });

  test('modal shows a chart canvas', async ({ page }) => {
    await page.locator('.product-card').first().click();
    await expect(page.locator('#priceModal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#priceChart')).toBeVisible();
  });

  test('modal has time range buttons', async ({ page }) => {
    await page.locator('.product-card').first().click();
    await expect(page.locator('#priceModal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.range-btn[data-days="7"]')).toBeVisible();
    await expect(page.locator('.range-btn[data-days="30"]')).toBeVisible();
    await expect(page.locator('.range-btn[data-days="365"]')).toBeVisible();
    await expect(page.locator('.range-btn[data-days="1825"]')).toBeVisible();
  });

  test('closes modal with the close button', async ({ page }) => {
    await page.locator('.product-card').first().click();
    await expect(page.locator('#priceModal')).toBeVisible({ timeout: 5000 });
    await page.locator('#priceModal .btn-close').click();
    await expect(page.locator('#priceModal')).toBeHidden({ timeout: 5000 });
  });
});

/* =========================================================
   REQUIRED SPECIFIC PRODUCT TESTS
   These 3 specific products from ExtremeTechCR must ALWAYS
   appear correctly in the UI. Failure here means data
   collection or the frontend display logic is broken.
   ========================================================= */

test.describe('REQUIRED: Intel Pentium Gold G6405 (CPU1011)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
    await page.fill('#searchInput', 'Pentium');
    await page.waitForTimeout(400);
  });

  test('product card is visible', async ({ page }) => {
    await expect(page.locator('.product-card').first()).toBeVisible();
  });

  test('product name contains Intel Pentium Gold G6405', async ({ page }) => {
    const title = await page.locator('.product-card .card-title').first().textContent();
    expect(title.toLowerCase()).toContain('pentium');
  });

  test('displays price 39900 CRC', async ({ page }) => {
    const badge = await page.locator('.product-card .price-badge').first().textContent();
    expect(badge).toContain('39');
    expect(badge).toContain('900');
  });

  test('does not show a discount badge (not on sale)', async ({ page }) => {
    const card = page.locator('.product-card').first();
    await expect(card.locator('.discount-badge')).not.toBeVisible();
  });

  test('shows stock location information', async ({ page }) => {
    const card = page.locator('.product-card').first();
    const stockHtml = await card.locator('.stock-locations').textContent();
    expect(stockHtml).toContain('Alajuela');
    expect(stockHtml).toContain('Bodega Central');
  });
});

test.describe('REQUIRED: MSI PRO MP225V 22 100Hz Monitor (MT2736)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
    await page.fill('#searchInput', 'MSI PRO');
    await page.waitForTimeout(400);
  });

  test('product card is visible', async ({ page }) => {
    await expect(page.locator('.product-card').first()).toBeVisible();
  });

  test('product name contains MSI', async ({ page }) => {
    const title = await page.locator('.product-card .card-title').first().textContent();
    expect(title.toLowerCase()).toContain('msi');
  });

  test('displays price 34900 CRC', async ({ page }) => {
    const badge = await page.locator('.product-card .price-badge').first().textContent();
    expect(badge).toContain('34');
    expect(badge).toContain('900');
  });

  test('does not show a discount badge (not on sale)', async ({ page }) => {
    const card = page.locator('.product-card').first();
    await expect(card.locator('.discount-badge')).not.toBeVisible();
  });

  test('shows stock location for Guapiles', async ({ page }) => {
    const card = page.locator('.product-card').first();
    const stockHtml = await card.locator('.stock-locations').textContent();
    expect(stockHtml).toContain('Guapiles');
  });
});

test.describe('REQUIRED: Razer Kraken Kitty Edition V2 Pro Rosa (HE6006)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
    await page.fill('#searchInput', 'Razer');
    await page.waitForTimeout(400);
  });

  test('product card is visible', async ({ page }) => {
    await expect(page.locator('.product-card').first()).toBeVisible();
  });

  test('product name contains Razer Kraken', async ({ page }) => {
    const title = await page.locator('.product-card .card-title').first().textContent();
    expect(title.toLowerCase()).toContain('razer');
    expect(title.toLowerCase()).toContain('kraken');
  });

  test('displays sale price 67901 CRC', async ({ page }) => {
    const badge = await page.locator('.product-card .price-badge').first().textContent();
    expect(badge).toContain('67');
    expect(badge).toContain('901');
  });

  test('shows the original price (69900) struck-through', async ({ page }) => {
    const card = page.locator('.product-card').first();
    const strikethrough = await card.locator('.text-decoration-line-through').first().textContent();
    expect(strikethrough).toContain('69');
    expect(strikethrough).toContain('900');
  });

  test('shows discount badge with 3% off', async ({ page }) => {
    const card = page.locator('.product-card').first();
    const badge = await card.locator('.discount-badge').first().textContent();
    expect(badge).toContain('3%');
  });

  test('shows stock location information', async ({ page }) => {
    const card = page.locator('.product-card').first();
    const stockHtml = await card.locator('.stock-locations').textContent();
    expect(stockHtml).toContain('San Jose Centro');
    expect(stockHtml).toContain('Alajuela');
  });
});

test.describe('Frontend - Dark Mode Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
  });

  test('theme toggle button is visible in the navbar', async ({ page }) => {
    await expect(page.locator('#themeToggle')).toBeVisible();
  });

  test('clicking the toggle switches from light to dark mode', async ({ page }) => {
    // Start in light mode (default when no localStorage value and no system dark pref)
    await page.evaluate(() => localStorage.removeItem('theme'));
    await page.evaluate(() => document.documentElement.setAttribute('data-bs-theme', 'light'));
    await page.locator('#themeToggle').click();
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-bs-theme'));
    expect(theme).toBe('dark');
  });

  test('clicking the toggle again switches back to light mode', async ({ page }) => {
    await page.evaluate(() => document.documentElement.setAttribute('data-bs-theme', 'dark'));
    await page.locator('#themeToggle').click();
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-bs-theme'));
    expect(theme).toBe('light');
  });

  test('theme preference is saved in localStorage', async ({ page }) => {
    await page.evaluate(() => document.documentElement.setAttribute('data-bs-theme', 'light'));
    await page.locator('#themeToggle').click();
    const stored = await page.evaluate(() => localStorage.getItem('theme'));
    expect(stored).toBe('dark');
  });
});

test.describe('Frontend - Columns Selector', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
  });

  test('columns selector is visible on wide viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('#colsSelector')).toBeVisible();
  });

  test('clicking 4-column button switches grid to 4 columns', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('#colsSelector [data-cols="4"]').click();
    const gridClass = await page.locator('#productGrid').getAttribute('class');
    expect(gridClass).toContain('row-cols-md-4');
  });

  test('clicking 3-column button switches grid back to 3 columns', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('#colsSelector [data-cols="4"]').click();
    await page.locator('#colsSelector [data-cols="3"]').click();
    const gridClass = await page.locator('#productGrid').getAttribute('class');
    expect(gridClass).toContain('row-cols-md-3');
  });
});

test.describe('Frontend - Discount Sort', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
  });

  test('sort options include discount options', async ({ page }) => {
    const options = page.locator('#sortSelect option');
    const values = await options.evaluateAll((opts) => opts.map((o) => o.value));
    expect(values).toContain('discount-desc');
    expect(values).toContain('increase-desc');
  });

  test('sorting by discount-desc places a price-drop product first', async ({ page }) => {
    await page.selectOption('#sortSelect', 'discount-desc');
    // Intel Pentium dropped from 45000 to 39900 (~11.3%) and
    // MSI Monitor dropped from 39900 to 34900 (~12.5%); both are bigger drops than any other product.
    // ASUS Laptop rose from 800000 to 850000 (6.25% increase).
    // After sorting by biggest price drop, the products with a drop should come before
    // those with no price change or a rise.
    const firstCardTitle = await page.locator('.product-card .card-title').first().textContent();
    // The first card should be one that had a price drop (not the laptop that rose)
    const firstTitleLower = firstCardTitle.toLowerCase();
    expect(firstTitleLower).not.toContain('asus gaming laptop');
    expect(firstTitleLower).not.toContain('logitech');
  });

  test('sorting by increase-desc places a price-rise product first', async ({ page }) => {
    await page.selectOption('#sortSelect', 'increase-desc');
    // ASUS Gaming Laptop rose from 800000 to 850000 (6.25%)
    const firstCardTitle = await page.locator('.product-card .card-title').first().textContent();
    expect(firstCardTitle.toLowerCase()).toContain('asus');
  });

  test('price-change badge appears on product cards with a previous price', async ({ page }) => {
    // Intel Pentium Gold G6405 has a prevPrice (45000 → 39900, ~11% drop)
    await page.fill('#searchInput', 'Pentium');
    await page.waitForTimeout(400);
    const badge = page.locator('.product-card .price-change-badge').first();
    await expect(badge).toBeVisible();
    const text = await badge.textContent();
    expect(text).toMatch(/↓/);
    expect(text).toMatch(/\d+%/);
  });
});
