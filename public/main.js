'use strict';

/* =========================================================
   CONFIGURATION - modify these values as needed
   ========================================================= */

/** @type {string} Path to the ZIP file containing the SQLite database */
const DB_ZIP_URL = 'db.zip';

/** @type {string} Path to the sql.js WASM file */
const SQL_WASM_URL = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.wasm';

/** @type {number} Default number of days shown in the price history chart */
const DEFAULT_CHART_DAYS = 365;

/** @type {number} Maximum number of products to render per page */
const PRODUCTS_PER_PAGE = 60;

/** @type {string} Fallback text when a product name is unknown */
const UNKNOWN_PRODUCT_NAME = '(Unknown Product)';

/** @type {string} Currency symbol for CRC */
const CRC_SYMBOL = '\u20a1';

/* =========================================================
   STATE
   ========================================================= */

/** @type {import('sql.js').Database|null} In-memory SQLite database */
let sqlDb = null;

/** @type {Array<Object>} Cached list of all products */
let allProducts = [];

/** @type {import('chart.js').Chart|null} Active Chart.js instance */
let activeChart = null;

/** @type {number} Currently selected chart date range in days */
let selectedChartDays = DEFAULT_CHART_DAYS;

/* =========================================================
   INITIALIZATION
   ========================================================= */

/**
 * Entry point. Loads the SQL.js library, then fetches and loads the database.
 * @returns {Promise<void>}
 */
async function init() {
  try {
    setStatus('Loading database...');
    const SQL = await initSqlJs({ locateFile: () => SQL_WASM_URL });
    const dbBuffer = await loadDatabaseFromZip();
    sqlDb = new SQL.Database(new Uint8Array(dbBuffer));
    allProducts = queryAllProducts();
    renderProducts(allProducts);
    setStatus(`Database loaded. Last updated: ${getLastUpdated()}`);
    setupEventListeners();
  } catch (err) {
    showError('Failed to load the product database: ' + err.message);
    console.error(err);
  }
}

/**
 * Fetches the ZIP file from DB_ZIP_URL, extracts it, and returns the SQLite file as ArrayBuffer.
 * @returns {Promise<ArrayBuffer>} The raw SQLite database bytes.
 */
async function loadDatabaseFromZip() {
  const response = await fetch(DB_ZIP_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${DB_ZIP_URL}`);
  }
  const zipBuffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuffer);
  const dbFile = zip.file('prices.db');
  if (!dbFile) {
    throw new Error('prices.db not found inside the ZIP archive');
  }
  return dbFile.async('arraybuffer');
}

/* =========================================================
   DATABASE QUERIES
   ========================================================= */

/**
 * Queries all active products with their current (latest) price.
 * @returns {Array<Object>} Array of product row objects.
 */
function queryAllProducts() {
  const result = sqlDb.exec(`
    SELECT p.id, p.url, p.name, p.sku, p.category, p.imageUrl, p.lastCheckedAt,
           ph.price, ph.currency
    FROM products p
    LEFT JOIN priceHistory ph ON ph.productId = p.id AND ph.endDate IS NULL
    WHERE p.isActive = 1
    ORDER BY p.name ASC
  `);
  if (!result.length) return [];
  return rowsToObjects(result[0]);
}

/**
 * Queries the price history for a given product ID within a date range.
 * Uses parameterized queries via sql.js prepared statements to prevent injection.
 * @param {number} productId - The product's database ID.
 * @param {number} days - Number of days back from today to include.
 * @returns {Array<Object>} Array of price history row objects.
 */
function queryPriceHistory(productId, days) {
  const safeId = parseInt(productId, 10);
  if (!Number.isFinite(safeId) || safeId <= 0) return [];

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const stmt = sqlDb.prepare(`
    SELECT price, currency, startDate, endDate
    FROM priceHistory
    WHERE productId = :id
      AND (endDate IS NULL OR endDate >= :since)
      AND startDate <= datetime('now')
    ORDER BY startDate ASC
  `);
  stmt.bind({ ':id': safeId, ':since': sinceIso });
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Returns the ISO string of the latest lastCheckedAt value across all products.
 * @returns {string} Date string of last database update, or "unknown".
 */
function getLastUpdated() {
  const result = sqlDb.exec('SELECT MAX(lastCheckedAt) as ts FROM products');
  if (!result.length || !result[0].values.length) return 'unknown';
  const ts = result[0].values[0][0];
  if (!ts) return 'unknown';
  return new Date(ts).toLocaleDateString();
}

/**
 * Converts a sql.js query result into an array of plain objects.
 * @param {{ columns: string[], values: Array<Array<any>> }} queryResult - sql.js result set.
 * @returns {Array<Object>}
 */
function rowsToObjects(queryResult) {
  const { columns, values } = queryResult;
  return values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

/* =========================================================
   RENDERING
   ========================================================= */

/**
 * Renders an array of product objects into the product grid.
 * @param {Array<Object>} products - Products to render.
 */
function renderProducts(products) {
  const grid = document.getElementById('productGrid');
  const loading = document.getElementById('loadingState');
  const count = document.getElementById('productCount');

  loading.classList.add('d-none');
  grid.classList.remove('d-none');
  grid.innerHTML = '';

  const shown = products.slice(0, PRODUCTS_PER_PAGE);
  count.textContent = `Showing ${shown.length} of ${products.length} products`;

  shown.forEach((product) => {
    const col = document.createElement('div');
    col.className = 'col';
    col.innerHTML = buildProductCardHtml(product);
    grid.appendChild(col);
  });

  // Attach price history click handlers
  grid.querySelectorAll('.product-card').forEach((card) => {
    card.addEventListener('click', () => {
      const productId = parseInt(card.dataset.productId, 10);
      const name = card.dataset.productName;
      openPriceModal(productId, name);
    });
  });
}

/**
 * Builds the Bootstrap card HTML for a single product.
 * @param {Object} product - Product row object.
 * @returns {string} HTML string for the product card.
 */
function buildProductCardHtml(product) {
  const name = escapeHtml(product.name || UNKNOWN_PRODUCT_NAME);
  const price = product.price != null
    ? `${CRC_SYMBOL} ${formatNumber(product.price)}`
    : 'Price unavailable';
  const category = product.category ? escapeHtml(product.category) : '';
  const imgHtml = product.imageUrl
    ? `<img src="${escapeHtml(product.imageUrl)}" class="product-img" alt="${name}" loading="lazy" />`
    : `<div class="product-img-placeholder">No image</div>`;

  return `
    <div class="card h-100 product-card"
         data-product-id="${product.id}"
         data-product-name="${escapeHtml(product.name || '')}">
      ${imgHtml}
      <div class="card-body">
        <h6 class="card-title">${name}</h6>
        ${category ? `<p class="card-text text-muted small mb-1">${category}</p>` : ''}
        <span class="badge bg-success price-badge">${price}</span>
      </div>
      <div class="card-footer text-muted small">
        <a href="${escapeHtml(product.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">View product</a>
      </div>
    </div>`;
}

/* =========================================================
   PRICE HISTORY MODAL
   ========================================================= */

/**
 * Opens the price history modal for the given product.
 * @param {number} productId - Database ID of the product.
 * @param {string} name - Display name of the product.
 */
function openPriceModal(productId, name) {
  document.getElementById('priceModalTitle').textContent =
    'Price History: ' + (name || UNKNOWN_PRODUCT_NAME);

  selectedChartDays = DEFAULT_CHART_DAYS;
  document.querySelectorAll('.range-btn').forEach((btn) => {
    btn.classList.toggle('active', parseInt(btn.dataset.days, 10) === selectedChartDays);
  });

  renderPriceChart(productId, selectedChartDays);

  // Store current productId for range changes
  document.getElementById('priceModal').dataset.productId = productId;
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('priceModal'));
  modal.show();
}

/**
 * Renders the Chart.js price history chart for a product over the given day range.
 * @param {number} productId - Database ID of the product.
 * @param {number} days - Number of days back to display.
 */
function renderPriceChart(productId, days) {
  const history = queryPriceHistory(productId, days);
  const canvas = document.getElementById('priceChart');
  const empty = document.getElementById('priceChartEmpty');

  if (activeChart) {
    activeChart.destroy();
    activeChart = null;
  }

  if (!history.length) {
    canvas.classList.add('d-none');
    empty.classList.remove('d-none');
    return;
  }

  canvas.classList.remove('d-none');
  empty.classList.add('d-none');

  const { labels, prices } = buildChartData(history, days);

  activeChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Price',
        data: prices,
        borderColor: '#0d6efd',
        backgroundColor: 'rgba(13, 110, 253, 0.1)',
        fill: true,
        tension: 0.2,
        pointRadius: prices.length <= 60 ? 4 : 2,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${CRC_SYMBOL} ${formatNumber(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        y: {
          ticks: { callback: (v) => `${CRC_SYMBOL} ${formatNumber(v)}` },
        },
      },
    },
  });
}

/**
 * Converts raw price history records into Chart.js compatible labels and data arrays.
 * Each price range record is expanded to show start and end points.
 * @param {Array<Object>} history - Price history records from the database.
 * @param {number} days - Number of days being shown (used for date filtering).
 * @returns {{ labels: string[], prices: number[] }}
 */
function buildChartData(history, days) {
  const labels = [];
  const prices = [];
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  history.forEach((record) => {
    if (record.price == null) return;
    const start = new Date(record.startDate);
    const end = record.endDate ? new Date(record.endDate) : now;

    const effectiveStart = start < cutoff ? cutoff : start;
    const effectiveEnd = end > now ? now : end;

    labels.push(formatDate(effectiveStart));
    prices.push(record.price);

    if (effectiveStart.toDateString() !== effectiveEnd.toDateString()) {
      labels.push(formatDate(effectiveEnd));
      prices.push(record.price);
    }
  });

  return { labels, prices };
}

/* =========================================================
   SEARCH AND SORT
   ========================================================= */

/**
 * Filters and sorts the product list based on the current search term and sort selection.
 */
function filterAndSort() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
  const sortValue = document.getElementById('sortSelect').value;

  let filtered = allProducts.filter((p) => {
    if (!searchTerm) return true;
    const name = (p.name || '').toLowerCase();
    const url = (p.url || '').toLowerCase();
    return name.includes(searchTerm) || url.includes(searchTerm);
  });

  filtered = sortProducts(filtered, sortValue);
  renderProducts(filtered);
}

/**
 * Sorts an array of product objects by the given sort key.
 * @param {Array<Object>} products - Products to sort.
 * @param {string} sortKey - One of "name-asc", "name-desc", "price-asc", "price-desc".
 * @returns {Array<Object>} Sorted array (new array, original unchanged).
 */
function sortProducts(products, sortKey) {
  const sorted = [...products];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case 'name-asc':
        return (a.name || '').localeCompare(b.name || '');
      case 'name-desc':
        return (b.name || '').localeCompare(a.name || '');
      case 'price-asc':
        return (a.price ?? Infinity) - (b.price ?? Infinity);
      case 'price-desc':
        return (b.price ?? -Infinity) - (a.price ?? -Infinity);
      default:
        return 0;
    }
  });
  return sorted;
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

/**
 * Attaches all interactive event listeners to page controls.
 */
function setupEventListeners() {
  let searchTimeout;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(filterAndSort, 300);
  });

  document.getElementById('sortSelect').addEventListener('change', filterAndSort);

  document.querySelectorAll('.range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedChartDays = parseInt(btn.dataset.days, 10);
      const productId = parseInt(document.getElementById('priceModal').dataset.productId, 10);
      renderPriceChart(productId, selectedChartDays);
    });
  });
}

/* =========================================================
   UTILITY HELPERS
   ========================================================= */

/**
 * Updates the database status text in the navbar.
 * @param {string} message - Status message to display.
 */
function setStatus(message) {
  document.getElementById('dbStatus').textContent = message;
}

/**
 * Shows an error alert and hides the loading spinner.
 * @param {string} message - Error message to display.
 */
function showError(message) {
  document.getElementById('loadingState').classList.add('d-none');
  const errorEl = document.getElementById('errorState');
  errorEl.textContent = message;
  errorEl.classList.remove('d-none');
}

/**
 * Escapes special HTML characters to prevent XSS.
 * @param {string} str - Raw string to escape.
 * @returns {string} HTML-safe string.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a number with thousand separators.
 * @param {number} value - Number to format.
 * @returns {string} Formatted string (e.g. "1,234,567").
 */
function formatNumber(value) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Formats a Date object as a short date string (MM/DD/YYYY).
 * @param {Date} date - Date to format.
 * @returns {string}
 */
function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* =========================================================
   BOOTSTRAP
   ========================================================= */

document.addEventListener('DOMContentLoaded', init);
