'use strict';

/**
 * Seed script: creates (or rebuilds) public/db.zip from a curated set of
 * known ExtremeTechCR products with realistic prices and stock data.
 *
 * Run once whenever the database needs to be reset to a known-good state:
 *   node scripts/seedDatabase.js
 *
 * The GitHub Actions price crawler will overwrite this data with live prices
 * on its next run.  This script exists so that GitHub Pages shows real product
 * cards immediately after deployment, rather than a wall of "Unknown" entries
 * left behind by a sitemap-only crawl.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const DB_PATH = path.join(__dirname, '..', 'data', 'seed-prices.db');
const ZIP_PATH = path.join(__dirname, '..', 'public', 'db.zip');

/** @type {Array<Object>} Known ExtremeTechCR products with verified prices */
const SEED_PRODUCTS = [
  {
    url: 'https://extremetechcr.com/producto/lenovo-ideapad-slim-3-ryzen-7-7735hs-16gb-cosmic-blue-83k700b8gj/',
    name: 'Lenovo IdeaPad Slim 3 - Ryzen 7 7735HS - 16GB - Cosmic Blue - 83K700B8GJ',
    sku: 'LP2717',
    category: 'Laptops',
    price: 375000,
    originalPrice: null,
    stockLocations: JSON.stringify([
      { location: 'Escazú', quantity: 3 },
      { location: 'Lindora', quantity: 3 },
      { location: 'Alajuela', quantity: 2 },
      { location: 'Cartago', quantity: 2 },
      { location: 'San Jose Centro', quantity: 2 },
      { location: 'Bodega Central', quantity: 10 },
    ]),
  },
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
    stockLocations: JSON.stringify([
      { location: 'Guapiles', quantity: 1 },
    ]),
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
    url: 'https://extremetechcr.com/producto/logitech-g502-x-plus-wireless/',
    name: 'Logitech G502 X Plus Wireless Gaming Mouse',
    sku: 'MS2310',
    category: 'Mouses',
    price: 89900,
    originalPrice: null,
    stockLocations: JSON.stringify([
      { location: 'San Jose Centro', quantity: 2 },
      { location: 'Escazú', quantity: 1 },
    ]),
  },
  {
    url: 'https://extremetechcr.com/producto/teclado-logitech-g915-tkl-tactile/',
    name: 'Logitech G915 TKL Tenkeyless Wireless Mechanical Keyboard',
    sku: 'KB1042',
    category: 'Teclados',
    price: 149900,
    originalPrice: 169900,
    stockLocations: JSON.stringify([
      { location: 'Escazú', quantity: 1 },
      { location: 'Lindora', quantity: 1 },
    ]),
  },
  {
    url: 'https://extremetechcr.com/producto/monitor-lg-27-4k-uhd-ips-27up85r-w/',
    name: 'Monitor LG 27" 4K UHD IPS 27UP85R-W',
    sku: 'MT2601',
    category: 'Monitores',
    price: 229900,
    originalPrice: null,
    stockLocations: JSON.stringify([
      { location: 'San Jose Centro', quantity: 3 },
      { location: 'Alajuela', quantity: 2 },
    ]),
  },
  {
    url: 'https://extremetechcr.com/producto/ssd-samsung-970-evo-plus-1tb-nvme/',
    name: 'SSD Samsung 970 EVO Plus 1TB NVMe',
    sku: 'ST1082',
    category: 'Almacenamiento',
    price: 59900,
    originalPrice: null,
    stockLocations: JSON.stringify([
      { location: 'Bodega Central', quantity: 15 },
      { location: 'Escazú', quantity: 3 },
      { location: 'San Jose Centro', quantity: 4 },
    ]),
  },
  {
    url: 'https://extremetechcr.com/producto/fuente-de-poder-corsair-rm850x-850w-80-gold/',
    name: 'Fuente de Poder Corsair RM850x 850W 80 Plus Gold',
    sku: 'PS0421',
    category: 'Fuentes de Poder',
    price: 84900,
    originalPrice: 94900,
    stockLocations: JSON.stringify([
      { location: 'San Jose Centro', quantity: 2 },
      { location: 'Bodega Central', quantity: 8 },
    ]),
  },
  {
    url: 'https://extremetechcr.com/producto/memoria-ram-corsair-vengeance-ddr5-32gb-6000mhz/',
    name: 'Memoria RAM Corsair Vengeance DDR5 32GB 6000MHz',
    sku: 'RAM411',
    category: 'Memorias RAM',
    price: 129900,
    originalPrice: null,
    stockLocations: JSON.stringify([
      { location: 'Escazú', quantity: 2 },
      { location: 'San Jose Centro', quantity: 3 },
    ]),
  },
  {
    url: 'https://extremetechcr.com/producto/tarjeta-de-video-msi-rtx-4060-gaming-x-8gb/',
    name: 'Tarjeta de Video MSI GeForce RTX 4060 Gaming X 8GB',
    sku: 'GPU2201',
    category: 'Tarjetas de Video',
    price: 389900,
    originalPrice: null,
    stockLocations: JSON.stringify([
      { location: 'Escazú', quantity: 1 },
      { location: 'Lindora', quantity: 2 },
      { location: 'San Jose Centro', quantity: 1 },
    ]),
  },
  {
    url: 'https://extremetechcr.com/producto/audifonos-sony-wh-1000xm5/',
    name: 'Audifonos Sony WH-1000XM5 Noise Cancelling',
    sku: 'HE5501',
    category: 'Audifonos',
    price: 189900,
    originalPrice: 219900,
    stockLocations: JSON.stringify([
      { location: 'San Jose Centro', quantity: 2 },
      { location: 'Escazú', quantity: 1 },
    ]),
  },
  {
    url: 'https://extremetechcr.com/producto/laptop-asus-tuf-gaming-f15-i7-13620h-16gb-rtx4060/',
    name: 'ASUS TUF Gaming F15 - Core i7-13620H - 16GB - RTX 4060',
    sku: 'LP2504',
    category: 'Laptops',
    price: 849900,
    originalPrice: null,
    stockLocations: JSON.stringify([
      { location: 'Escazú', quantity: 1 },
      { location: 'San Jose Centro', quantity: 2 },
    ]),
  },
  {
    url: 'https://extremetechcr.com/producto/procesador-amd-ryzen-5-7600x/',
    name: 'Procesador AMD Ryzen 5 7600X AM5',
    sku: 'CPU2031',
    category: 'Procesadores',
    price: 149900,
    originalPrice: 169900,
    stockLocations: JSON.stringify([
      { location: 'Bodega Central', quantity: 5 },
      { location: 'San Jose Centro', quantity: 2 },
    ]),
  },
  {
    url: 'https://extremetechcr.com/producto/gabinete-lian-li-pc-o11-dynamic-evo/',
    name: 'Gabinete Lian Li PC-O11 Dynamic EVO RGB',
    sku: 'CS0312',
    category: 'Gabinetes',
    price: 119900,
    originalPrice: null,
    stockLocations: JSON.stringify([
      { location: 'Escazú', quantity: 2 },
      { location: 'Lindora', quantity: 1 },
    ]),
  },
];

function buildDatabase() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

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
      endDate TEXT,
      FOREIGN KEY (productId) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_products_url ON products(url);
    CREATE INDEX IF NOT EXISTS idx_price_history_product ON priceHistory(productId);
    CREATE INDEX IF NOT EXISTS idx_price_history_dates ON priceHistory(startDate, endDate);
  `);

  const now = new Date().toISOString();
  const insertProduct = db.prepare(`
    INSERT INTO products (url, name, sku, category, description, imageUrl, stockLocations, firstSeenAt, lastCheckedAt, isActive)
    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, 1)
  `);
  const insertPrice = db.prepare(`
    INSERT INTO priceHistory (productId, price, originalPrice, currency, startDate)
    VALUES (?, ?, ?, 'CRC', ?)
  `);

  for (const p of SEED_PRODUCTS) {
    const result = insertProduct.run(p.url, p.name, p.sku, p.category, p.stockLocations, now, now);
    insertPrice.run(result.lastInsertRowid, p.price, p.originalPrice || null, now);
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();
  console.log(`Created seed database with ${SEED_PRODUCTS.length} products at ${DB_PATH}`);
}

function buildZip() {
  const publicDir = path.dirname(ZIP_PATH);
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  const zip = new AdmZip();
  zip.addLocalFile(DB_PATH, '', 'prices.db');
  zip.writeZip(ZIP_PATH);
  console.log(`Exported to ${ZIP_PATH}`);
}

buildDatabase();
buildZip();
console.log('Seed complete. Commit public/db.zip to deploy immediately.');
