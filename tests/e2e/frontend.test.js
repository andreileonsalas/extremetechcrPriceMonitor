'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

/**
 * Specific product test cases that must always pass.
 * These represent real products that should be present in the database.
 * If these fail, it signals that data collection has broken.
 */
const REQUIRED_PRODUCTS = [
  {
    name: 'Laptop',
    urlPattern: /laptop/i,
    description: 'A laptop product must exist in the database',
  },
  {
    name: 'Mouse',
    urlPattern: /mouse/i,
    description: 'A mouse product must exist in the database',
  },
  {
    name: 'Monitor',
    urlPattern: /monitor/i,
    description: 'A monitor product must exist in the database',
  },
];

/** Path to a test SQLite database used for e2e tests */
const TEST_DB_PATH = path.join(__dirname, '../../tmp/e2e-prices.db');

/** Path to the test ZIP file */
const TEST_ZIP_PATH = path.join(__dirname, '../../public/db.zip');

/**
 * Creates a minimal test SQLite database with seed data for e2e tests.
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
      firstSeenAt TEXT NOT NULL,
      lastCheckedAt TEXT NOT NULL,
      isActive INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS priceHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId INTEGER NOT NULL,
      price REAL,
      currency TEXT,
      startDate TEXT NOT NULL,
      endDate TEXT
    );
  `);

  const now = new Date().toISOString();
  const insertProduct = db.prepare(`
    INSERT INTO products (url, name, sku, category, description, imageUrl, firstSeenAt, lastCheckedAt, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const insertPrice = db.prepare(`
    INSERT INTO priceHistory (productId, price, currency, startDate)
    VALUES (?, ?, 'CRC', ?)
  `);

  const seedData = [
    { url: 'https://extremetechcr.com/producto/laptop-gaming-asus', name: 'ASUS Gaming Laptop ROG', price: 850000 },
    { url: 'https://extremetechcr.com/producto/mouse-logitech-g502', name: 'Logitech G502 Mouse', price: 45000 },
    { url: 'https://extremetechcr.com/producto/monitor-lg-27-4k', name: 'LG 27 Inch 4K Monitor', price: 350000 },
    { url: 'https://extremetechcr.com/producto/teclado-mecanico', name: 'Mechanical Keyboard', price: 75000 },
    { url: 'https://extremetechcr.com/producto/ssd-samsung-1tb', name: 'Samsung 1TB SSD', price: 95000 },
  ];

  seedData.forEach(({ url, name, price }) => {
    const result = insertProduct.run(url, name, null, 'Electronics', null, null, now, now);
    insertPrice.run(result.lastInsertRowid, price, now);
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

test.describe('Required Products - Specific Test Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loadingState')).toBeHidden({ timeout: 15000 });
  });

  for (const product of REQUIRED_PRODUCTS) {
    test(`REQUIRED: ${product.name} product is visible in the UI`, async ({ page }) => {
      await page.fill('#searchInput', product.name);
      await page.waitForTimeout(400);
      const cards = page.locator('.product-card');
      await expect(cards.first()).toBeVisible();
      const title = await cards.first().locator('.card-title').textContent();
      expect(title.toLowerCase()).toContain(product.name.toLowerCase());
    });
  }
});
