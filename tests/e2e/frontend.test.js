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
      isActive INTEGER DEFAULT 1
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
  const insertProduct = db.prepare(`
    INSERT INTO products (url, name, sku, category, description, imageUrl, stockLocations, firstSeenAt, lastCheckedAt, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const insertPrice = db.prepare(`
    INSERT INTO priceHistory (productId, price, originalPrice, currency, startDate)
    VALUES (?, ?, ?, 'CRC', ?)
  `);

  /**
   * Seed data - includes the 3 required specific products plus extras.
   * originalPrice is non-null for products on sale (Razer Kraken).
   */
  const seedData = [
    {
      url: 'https://extremetechcr.com/producto/intel-pentium-gold-g6405/',
      name: 'Intel Pentium Gold G6405',
      sku: 'CPU1011',
      category: 'Procesadores',
      price: 39900,
      originalPrice: null,
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
      originalPrice: null,
      stockLocations: JSON.stringify([{ location: 'Guapiles', quantity: 1 }]),
    },
    {
      url: 'https://extremetechcr.com/producto/razer-kraken-kitty-edition-v2-pro-rosa/',
      name: 'Razer Kraken Kitty Edition V2 Pro Rosa',
      sku: 'HE6006',
      category: 'Audifonos',
      price: 67901,
      originalPrice: 69900,
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
      originalPrice: null,
      stockLocations: null,
    },
    {
      url: 'https://extremetechcr.com/producto/mouse-logitech-g502',
      name: 'Logitech G502 Mouse',
      sku: 'MS001',
      category: 'Mouses',
      price: 45000,
      originalPrice: null,
      stockLocations: null,
    },
  ];

  seedData.forEach(({ url, name, sku, category, price, originalPrice, stockLocations }) => {
    const result = insertProduct.run(url, name, sku, category, null, null, stockLocations, now, now);
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
    await expect(cards).toHaveCount(5);
  });

  test('shows product count label', async ({ page }) => {
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

  test('shows no results message when nothing matches', async ({ page }) => {
    await page.fill('#searchInput', 'xxxxxxxxxxx');
    await page.waitForTimeout(400);
    const count = page.locator('#productCount');
    await expect(count).toContainText('0');
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
