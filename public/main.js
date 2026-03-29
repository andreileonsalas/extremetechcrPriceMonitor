'use strict';

/* =========================================================
   CONFIGURATION - modify these values as needed
   ========================================================= */

/** @type {string} Path to the ZIP file containing the SQLite database */
const DB_ZIP_URL = 'db.zip';

/** @type {string} Path to the sql.js WASM file (relative to the page) */
const SQL_WASM_URL = 'vendor/sql-wasm.wasm';

/** @type {number} Default number of days shown in the price history chart */
const DEFAULT_CHART_DAYS = 365;

/** @type {number} Maximum number of products to render per page */
const PRODUCTS_PER_PAGE = 60;

/** @type {string} Fallback text when a product name is unknown */
const UNKNOWN_PRODUCT_NAME = '(Producto desconocido)';

/** @type {string} Currency symbol for CRC */
const CRC_SYMBOL = '\u20a1';

/* =========================================================
   STATE
   ========================================================= */

/** @type {import('sql.js').Database|null} In-memory SQLite database */
let sqlDb = null;

/** @type {Array<Object>} Cached list of all products (active + inactive with a price) */
let allProducts = [];

/** @type {import('chart.js').Chart|null} Active Chart.js instance */
let activeChart = null;

/** @type {number} Currently selected chart date range in days */
let selectedChartDays = DEFAULT_CHART_DAYS;

/** @type {boolean} Whether to show products that are active on extremetechcr.com */
let filterShowActive = true;

/** @type {boolean} Whether to show products that are no longer on extremetechcr.com */
let filterShowInactive = false;

/** @type {boolean} Whether to show products that have stock */
let filterShowInStock = true;

/** @type {boolean} Whether to show products with no stock */
let filterShowOutOfStock = true;

/** @type {Map<number, import('chart.js').Chart>} Mini sparkline chart instances keyed by product ID */
const miniChartInstances = new Map();

/* =========================================================
   INITIALIZATION
   ========================================================= */

/**
 * Entry point. Loads the SQL.js library, then fetches and loads the database.
 * @returns {Promise<void>}
 */
async function init() {
  try {
    setStatus('Cargando base de datos...');
    const SQL = await initSqlJs({ locateFile: () => SQL_WASM_URL });
    const dbBuffer = await loadDatabaseFromZip();
    sqlDb = new SQL.Database(new Uint8Array(dbBuffer));
    allProducts = queryAllProducts();
    renderProducts(filterProducts(allProducts));
    setStatus(`Base de datos cargada. Última actualización: ${getLastUpdated()}`);
    setupEventListeners();
  } catch (err) {
    showError('Error al cargar la base de datos de productos: ' + err.message);
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
 * Queries all products that have been priced (have a price record), regardless of
 * whether they are still active on the site. Inactive products (removed from the site)
 * are included so the user can find them by toggling the "Ya no en extremetechcr.com" filter.
 * Products inserted by the sitemap crawler but not yet scraped (no price record) are
 * excluded so the UI never shows a wall of "(Producto desconocido)" cards.
 * @returns {Array<Object>} Array of product row objects.
 */
function queryAllProducts() {
  const result = sqlDb.exec(`
    SELECT p.id, p.url, p.name, p.sku, p.category, p.imageUrl, p.lastCheckedAt,
           p.stockLocations, p.isActive, ph.price, ph.originalPrice, ph.currency
    FROM products p
    INNER JOIN priceHistory ph ON ph.productId = p.id AND ph.endDate IS NULL
    ORDER BY p.isActive DESC, p.name ASC
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

  // Use ISO format for 'now' comparison to match our stored dates (YYYY-MM-DDTHH:MM:SS.sssZ)
  const nowIso = new Date().toISOString();

  const stmt = sqlDb.prepare(`
    SELECT price, originalPrice, currency, startDate, endDate
    FROM priceHistory
    WHERE productId = $id
      AND (endDate IS NULL OR endDate >= $since)
      AND startDate <= $now
    ORDER BY startDate ASC
  `);
  stmt.bind({ $id: safeId, $since: sinceIso, $now: nowIso });
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Returns the ISO string of the latest lastCheckedAt value across all products.
 * @returns {string} Date string of last database update, or "desconocido".
 */
function getLastUpdated() {
  const result = sqlDb.exec('SELECT MAX(lastCheckedAt) as ts FROM products');
  if (!result.length || !result[0].values.length) return 'desconocido';
  const ts = result[0].values[0][0];
  if (!ts) return 'desconocido';
  return new Date(ts).toLocaleDateString('es-CR');
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
   FILTERING & SORTING
   ========================================================= */

/**
 * Returns true if the product has at least one stock location with quantity > 0.
 * Returns false when stockLocations is null, empty, or all quantities are 0.
 * @param {string|null} stockLocationsJson - JSON string of StockLocation[].
 * @returns {boolean}
 */
function isProductInStock(stockLocationsJson) {
  if (!stockLocationsJson) return false;
  try {
    const locs = JSON.parse(stockLocationsJson);
    return Array.isArray(locs) && locs.some((loc) => loc.quantity > 0);
  } catch (_) {
    return false;
  }
}

/**
 * Applies the current filter state (active/inactive, in-stock/out-of-stock, search term)
 * and returns the matching subset of allProducts.
 * @param {Array<Object>} products - Full product list to filter.
 * @returns {Array<Object>} Filtered products.
 */
function filterProducts(products) {
  const searchTerm = document.getElementById('searchInput')
    ? document.getElementById('searchInput').value.toLowerCase().trim()
    : '';

  return products.filter((p) => {
    // Existence filter
    if (p.isActive === 1 && !filterShowActive) return false;
    if (p.isActive === 0 && !filterShowInactive) return false;

    // Stock filter (only applied to active products; inactive ones are just shown as-is)
    if (p.isActive === 1) {
      const inStock = isProductInStock(p.stockLocations);
      if (inStock && !filterShowInStock) return false;
      if (!inStock && !filterShowOutOfStock) return false;
    }

    // Search filter: name, URL, or SKU
    if (searchTerm) {
      const name = (p.name || '').toLowerCase();
      const url = (p.url || '').toLowerCase();
      const sku = (p.sku || '').toLowerCase();
      if (!name.includes(searchTerm) && !url.includes(searchTerm) && !sku.includes(searchTerm)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Filters and sorts the product list based on the current search term, sort selection,
 * and checkbox filter state, then re-renders the product grid.
 */
function filterAndSort() {
  const sortValue = document.getElementById('sortSelect').value;
  const filtered = sortProducts(filterProducts(allProducts), sortValue);
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
  count.textContent = `Mostrando ${shown.length} de ${products.length} productos`;

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

  // Render 7-day mini sparklines below each product image
  renderMiniCharts(shown);
}

/**
 * Builds the Bootstrap card HTML for a single product.
 * Shows a strikethrough original price and discount badge when on sale.
 * Shows per-store stock information when available.
 * Shows status badges for inactive products and out-of-stock products.
 * @param {Object} product - Product row object.
 * @returns {string} HTML string for the product card.
 */
function buildProductCardHtml(product) {
  const name = escapeHtml(product.name || UNKNOWN_PRODUCT_NAME);
  const category = product.category ? escapeHtml(product.category) : '';
  const imgHtml = product.imageUrl
    ? `<img src="${escapeHtml(product.imageUrl)}" class="product-img" alt="${name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.classList.remove('d-none')" /><div class="product-img-placeholder d-none">Ver historial de precios</div>`
    : `<div class="product-img-placeholder">Ver historial de precios</div>`;

  const priceHtml = buildPriceHtml(product);
  const stockHtml = buildStockHtml(product.stockLocations);
  const statusBadges = buildStatusBadges(product);

  return `
    <div class="card h-100 product-card"
         data-product-id="${product.id}"
         data-product-name="${escapeHtml(product.name || '')}">
      ${imgHtml}
      <div class="mini-chart-wrapper">
        <canvas class="mini-chart-canvas" data-product-id="${product.id}"></canvas>
      </div>
      <div class="card-body">
        <h6 class="card-title">${name}</h6>
        ${category ? `<p class="card-text text-muted small mb-1">${category}</p>` : ''}
        ${statusBadges}
        ${priceHtml}
        ${stockHtml}
      </div>
      <div class="card-footer text-muted small">
        <a href="${escapeHtml(product.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Ver en ExtremeTechCR</a>
      </div>
    </div>`;
}

/**
 * Builds status badge HTML for a product card.
 * Shows "Ya no disponible" for inactive products (removed from site).
 * Shows "Sin stock" for active products with no available stock locations.
 * @param {Object} product - Product row object with isActive and stockLocations.
 * @returns {string} HTML snippet with status badges, or empty string.
 */
function buildStatusBadges(product) {
  if (product.isActive === 0) {
    return '<div class="mb-1"><span class="badge bg-secondary">Ya no disponible</span></div>';
  }
  if (!isProductInStock(product.stockLocations)) {
    return '<div class="mb-1"><span class="badge bg-warning text-dark">Sin stock</span></div>';
  }
  return '';
}

/**
 * Builds the price section HTML for a product card.
 * Shows original (struck-through) price and a discount badge when on sale.
 * @param {Object} product - Product row object with price, originalPrice fields.
 * @returns {string} HTML snippet for the price display.
 */
function buildPriceHtml(product) {
  if (product.price == null) {
    return '<span class="text-muted small">Precio no disponible</span>';
  }
  const activePrice = `${CRC_SYMBOL} ${formatNumber(product.price)}`;

  if (product.originalPrice != null && product.originalPrice > product.price) {
    const origPrice = `${CRC_SYMBOL} ${formatNumber(product.originalPrice)}`;
    const discountPct = Math.round(
      ((product.originalPrice - product.price) / product.originalPrice) * 100
    );
    return `
      <div class="price-block">
        <span class="text-muted text-decoration-line-through small">${origPrice}</span>
        <span class="badge bg-danger ms-1 discount-badge">-${discountPct}%</span>
        <br/>
        <span class="badge bg-success price-badge">${activePrice}</span>
      </div>`;
  }

  return `<span class="badge bg-success price-badge">${activePrice}</span>`;
}

/**
 * Builds the stock location HTML for a product card.
 * Parses the JSON stockLocations string stored in the database.
 * @param {string|null} stockLocationsJson - JSON string of StockLocation[].
 * @returns {string} HTML snippet listing stock per location, or empty string.
 */
function buildStockHtml(stockLocationsJson) {
  if (!stockLocationsJson) return '';
  let locations;
  try {
    locations = JSON.parse(stockLocationsJson);
  } catch (_) {
    return '';
  }
  if (!Array.isArray(locations) || locations.length === 0) return '';

  const rows = locations
    .map((loc) => `<li class="list-inline-item stock-location-item">${escapeHtml(loc.location)}: ${loc.quantity}</li>`)
    .join('');
  return `<ul class="list-inline stock-locations mt-1 mb-0">${rows}</ul>`;
}

/**
 * Renders 7-day mini sparkline charts for each product in the list.
 * Charts are drawn on the `.mini-chart-canvas` elements already in the DOM.
 * Any previous mini chart instances are destroyed first to prevent memory leaks.
 * When a product has no price history in the last 7 days, the chart wrapper is
 * hidden so it does not leave an empty gap on the card.
 *
 * Clicking the card still opens the full price-history modal as before.
 *
 * @param {Array<Object>} products - Products currently rendered on the page.
 */
function renderMiniCharts(products) {
  // Destroy all previous mini chart instances
  miniChartInstances.forEach((chart) => chart.destroy());
  miniChartInstances.clear();

  products.forEach((product) => {
    const canvas = document.querySelector(
      `.mini-chart-canvas[data-product-id="${product.id}"]`
    );
    if (!canvas) return;

    const history = queryPriceHistory(product.id, 7);
    if (!history.length) {
      // No 7-day data: hide the wrapper so the card doesn't show an empty bar
      const wrapper = canvas.parentElement;
      if (wrapper) wrapper.classList.add('d-none');
      return;
    }

    const { labels, prices } = buildChartData(history, 7);

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: prices,
          borderColor: '#0d6efd',
          borderWidth: 1.5,
          backgroundColor: 'rgba(13, 110, 253, 0.08)',
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          pointHoverRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) => `${CRC_SYMBOL} ${formatNumber(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });

    miniChartInstances.set(product.id, chart);
  });
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
    'Historial de precios: ' + (name || UNKNOWN_PRODUCT_NAME);

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
        label: 'Precio',
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

  document.getElementById('filterActive').addEventListener('change', (e) => {
    filterShowActive = e.target.checked;
    filterAndSort();
  });

  document.getElementById('filterInactive').addEventListener('change', (e) => {
    filterShowInactive = e.target.checked;
    filterAndSort();
  });

  document.getElementById('filterInStock').addEventListener('change', (e) => {
    filterShowInStock = e.target.checked;
    filterAndSort();
  });

  document.getElementById('filterOutOfStock').addEventListener('change', (e) => {
    filterShowOutOfStock = e.target.checked;
    filterAndSort();
  });

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
 * Formats a Date object as a short date string.
 * @param {Date} date - Date to format.
 * @returns {string}
 */
function formatDate(date) {
  return date.toLocaleDateString('es-CR', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* =========================================================
   BOOTSTRAP
   ========================================================= */

document.addEventListener('DOMContentLoaded', init);
