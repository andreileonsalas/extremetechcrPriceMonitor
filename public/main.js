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

/** @type {string} localStorage key for the master app-data JSON blob (favorites, prefs, etc.) */
const APP_DATA_KEY = 'priceMonitorAppData';

/** @type {string} localStorage key that tracks whether the user dismissed the localStorage disclaimer */
const DISCLAIMER_KEY = 'priceMonitorDisclaimerDismissed';

/* =========================================================
   ADAPTERS
   ─────────────────────────────────────────────────────────
   There are two adapters in this file:
     storageAdapter  — saves/loads user data (favourites, preferences)
     emailAdapter    — sends price-alert notification emails

   HOW THE PATTERN WORKS
   ─────────────────────
   Each adapter is a plain object with a fixed set of methods.
   The rest of this file only calls those method names and never
   knows (or cares) which real service is behind them.

   To connect a real service you only need to do THREE things:
     1. Find the adapter you want to replace (storageAdapter or emailAdapter).
     2. Uncomment the "OPTION A / B" block for the service you chose.
     3. Change the ONE line that reads
            const storageAdapter = { … active stub … };
        to
            const storageAdapter = firebaseStorageAdapter;   ← or whichever name
        (same for emailAdapter).
   Nothing else in this file needs to change.

   NOTE ON async: The active stubs below are synchronous (localStorage).
   Firebase, REST endpoints, and EmailJS are all async. If you switch,
   add async/await to loadAppData, saveAppData, and their callers, or
   wrap the calls in .then() chains.
   ========================================================= */

/* ─────────────────────────────────────────────────────────
   ADAPTER 1 — STORAGE
   Saves and loads all user-generated data (favourites, prefs).

   Required methods:
     get(key)         → any | null
     set(key, value)  → void
     remove(key)      → void
   ───────────────────────────────────────────────────────── */

// ── ACTIVE: localStorage (no signup, data lives in this browser only) ─────────
const storageAdapter = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (err) {
      console.warn('[storageAdapter] Failed to parse value for key', key, err);
      return null;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {
      console.warn('[storageAdapter] Failed to set value for key', key, err);
    }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  },
};

/*
// ── OPTION A: Firebase / Firestore ────────────────────────────────────────────
// HOW TO SWITCH:
//   1. Go to https://console.firebase.google.com → create a project → add a web app.
//   2. Enable Firestore Database in the Firebase console.
//   3. In index.html, add these three scripts BEFORE main.js:
//        <script src="https://www.gstatic.com/firebasejs/10.x.x/firebase-app-compat.js"></script>
//        <script src="https://www.gstatic.com/firebasejs/10.x.x/firebase-firestore-compat.js"></script>
//        <script src="https://www.gstatic.com/firebasejs/10.x.x/firebase-auth-compat.js"></script>
//   4. Fill in the YOUR_* values below.
//   5. Change the active line above to:   const storageAdapter = firebaseStorageAdapter;
//   6. Also uncomment the GOOGLE AUTH block at the bottom of this section.
//
// const firebaseApp = firebase.initializeApp({
//   apiKey:            'YOUR_API_KEY',
//   authDomain:        'YOUR_PROJECT.firebaseapp.com',
//   projectId:         'YOUR_PROJECT_ID',
//   storageBucket:     'YOUR_PROJECT.appspot.com',
//   messagingSenderId: 'YOUR_SENDER_ID',
//   appId:             'YOUR_APP_ID',
// });
// const firestoreDb = firebase.firestore();
//
// const firebaseStorageAdapter = {
//   async get(key) {
//     if (!currentUser) return null;
//     const snap = await firestoreDb.collection('users').doc(currentUser.uid).get();
//     return snap.exists ? (snap.data()[key] ?? null) : null;
//   },
//   async set(key, value) {
//     if (!currentUser) return;
//     await firestoreDb.collection('users').doc(currentUser.uid).set({ [key]: value }, { merge: true });
//   },
//   async remove(key) {
//     if (!currentUser) return;
//     await firestoreDb.collection('users').doc(currentUser.uid)
//       .update({ [key]: firebase.firestore.FieldValue.delete() });
//   },
// };
*/

/*
// ── OPTION B: Any REST backend (Node, Python, PHP, etc.) ──────────────────────
// ⚠️  REQUIRES A BACKEND SERVER — there is no backend today.
//     Use this only if you add a server (Node/Express, Firebase Cloud Functions, etc.)
// Works with any server that stores data — MongoDB, PostgreSQL, S3, DynamoDB…
// HOW TO SWITCH:
//   1. Create three endpoints on your server:
//        GET    /api/user-data/:key  → responds with { value: <stored JSON> }
//        PUT    /api/user-data/:key  → accepts body { value: <JSON> }, responds 200
//        DELETE /api/user-data/:key  → responds 200
//   2. If your API requires auth, uncomment the Authorization header lines
//      and replace YOUR_TOKEN with your auth logic.
//   3. Change the active line above to:   const storageAdapter = restStorageAdapter;
//
// const restStorageAdapter = {
//   async get(key) {
//     const res = await fetch(`/api/user-data/${encodeURIComponent(key)}`);
//     // { headers: { Authorization: 'Bearer YOUR_TOKEN' } }  ← add if needed
//     return res.ok ? ((await res.json()).value ?? null) : null;
//   },
//   async set(key, value) {
//     await fetch(`/api/user-data/${encodeURIComponent(key)}`, {
//       method: 'PUT',
//       headers: { 'Content-Type': 'application/json' },
//       // headers: { 'Content-Type': 'application/json', Authorization: 'Bearer YOUR_TOKEN' },
//       body: JSON.stringify({ value }),
//     });
//   },
//   async remove(key) {
//     await fetch(`/api/user-data/${encodeURIComponent(key)}`, { method: 'DELETE' });
//   },
// };
*/

/* ─────────────────────────────────────────────────────────
   ADAPTER 2 — EMAIL
   Sends price-alert notification emails to the user.

   Required methods:
     isAvailable()  → boolean
       Return true when the adapter is configured and can actually send.
       The "🔔 Notificarme por correo" button is automatically ENABLED
       when this returns true and DISABLED when false — no HTML edits needed.

     send(opts)     → Promise<{ ok: boolean, error?: string }>
       opts = { toEmail, productName, productUrl, currentPrice, priceAtAddition }
   ───────────────────────────────────────────────────────── */

// ── ACTIVE: disabled stub (button stays disabled, nothing is sent) ─────────────
// Replace with OPTION A or B below to enable real email notifications.
const emailAdapter = {
  isAvailable() { return false; },
  async send(opts) {
    console.warn('[emailAdapter] No email provider configured. ' +
      'See OPTION A or B below to enable notifications.', opts);
    return { ok: false, error: 'No email provider configured' };
  },
};

/*
// ── OPTION A: EmailJS (works from the browser — no server needed) ─────────────
// Free tier: 200 emails/month. Zero backend required.
// HOW TO SWITCH:
//   1. Create a free account at https://www.emailjs.com
//   2. Add an Email Service (Gmail, Outlook, etc.) and note your Service ID.
//   3. Create an Email Template using these variable names in the message body:
//        {{to_email}}  {{product_name}}  {{product_url}}
//        {{current_price}}  {{price_at_addition}}
//      Note your Template ID.
//   4. In Account → API Keys, copy your Public Key.
//   5. In index.html, add this script BEFORE main.js:
//        <script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js"></script>
//   6. Fill in the three constants below.
//   7. Change the active line above to:   const emailAdapter = emailJsAdapter;
//
// const EMAILJS_PUBLIC_KEY  = 'YOUR_PUBLIC_KEY';
// const EMAILJS_SERVICE_ID  = 'YOUR_SERVICE_ID';
// const EMAILJS_TEMPLATE_ID = 'YOUR_TEMPLATE_ID';
// emailjs.init(EMAILJS_PUBLIC_KEY);
//
// const emailJsAdapter = {
//   isAvailable() { return true; },
//   async send({ toEmail, productName, productUrl, currentPrice, priceAtAddition }) {
//     try {
//       await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
//         to_email:          toEmail,
//         product_name:      productName,
//         product_url:       productUrl,
//         current_price:     `\u20a1 ${currentPrice.toLocaleString('en-US')}`,
//         price_at_addition: `\u20a1 ${priceAtAddition.toLocaleString('en-US')}`,
//       });
//       return { ok: true };
//     } catch (err) {
//       console.error('[emailAdapter] EmailJS send failed:', err);
//       return { ok: false, error: err.message };
//     }
//   },
// };
*/

/*
// ── OPTION B: Custom backend endpoint (Node, Firebase Functions, etc.) ─────────
// ⚠️  REQUIRES A BACKEND SERVER — there is no backend today.
//     If you ever add a server, this is ready to wire in.
// Works with any backend that can send email — SendGrid, Mailgun, AWS SES,
// Nodemailer, Resend, etc.
// HOW TO SWITCH:
//   1. Create a POST endpoint on your server at /api/notify that:
//        — accepts JSON body: { toEmail, productName, productUrl, currentPrice, priceAtAddition }
//        — sends the email via your chosen SMTP / email API
//        — responds with { ok: true } on success or { ok: false, error: '…' } on failure
//   2. If your endpoint requires auth, uncomment the Authorization header line
//      and replace YOUR_TOKEN with your auth logic.
//   3. Change the active line above to:   const emailAdapter = backendEmailAdapter;
//
// const backendEmailAdapter = {
//   isAvailable() { return true; },
//   async send({ toEmail, productName, productUrl, currentPrice, priceAtAddition }) {
//     try {
//       const res = await fetch('/api/notify', {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           // Authorization: 'Bearer YOUR_TOKEN',  ← uncomment if your API requires auth
//         },
//         body: JSON.stringify({ toEmail, productName, productUrl, currentPrice, priceAtAddition }),
//       });
//       const body = await res.json().catch(() => ({}));
//       return res.ok ? { ok: true } : { ok: false, error: body.error || `HTTP ${res.status}` };
//     } catch (err) {
//       console.error('[emailAdapter] Backend request failed:', err);
//       return { ok: false, error: err.message };
//     }
//   },
// };
*/

/* ─────────────────────────────────────────────────────────
   GOOGLE AUTH PLACEHOLDER
   Lets users sign in so their favourites sync across devices.
   HOW TO ENABLE:
     1. Complete storageAdapter OPTION A (Firebase), steps 1–5.
     2. In the Firebase console → Authentication → Sign-in method → enable Google.
     3. Uncomment the block below.
     4. In index.html, uncomment the <button id="authBtn"> in the navbar.
     5. Add initAuth(); as the very first line inside the init() function.
   ───────────────────────────────────────────────────────── */

/*
// let currentUser = null;
//
// function initAuth() {
//   firebase.auth().onAuthStateChanged((user) => {
//     currentUser = user;
//     updateAuthUI(user);
//   });
// }
//
// function signInWithGoogle() {
//   firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider())
//     .catch((err) => console.error('Google sign-in failed:', err));
// }
//
// function signOutUser() {
//   firebase.auth().signOut();
// }
//
// function updateAuthUI(user) {
//   const btn = document.getElementById('authBtn');
//   if (!btn) return;
//   if (user) {
//     btn.innerHTML = user.photoURL
//       ? `<img src="${user.photoURL}" class="auth-avatar" alt="" /> ${escapeHtml(user.displayName || user.email)}`
//       : escapeHtml(user.displayName || user.email);
//     btn.title = 'Cerrar sesión';
//     btn.onclick = signOutUser;
//   } else {
//     btn.innerHTML = '\uD83D\uDD11 Entrar con Google';
//     btn.title = '';
//     btn.onclick = signInWithGoogle;
//   }
// }
*/

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

/** @type {boolean} Whether to include products that are no longer on extremetechcr.com */
let filterIncludeInactive = false;

/** @type {boolean} Whether to show only products that are in stock (hides out-of-stock when true) */
let filterOnlyInStock = true;

/** @type {boolean} Whether to show only products the user has added to their favourites */
let filterOnlyFavorites = false;

/** @type {Map<number, import('chart.js').Chart>} Mini sparkline chart instances keyed by product ID */
const miniChartInstances = new Map();

/**
 * Number of columns shown per row on medium+ screens.
 * Stored in localStorage so the preference persists across page loads.
 * @type {number}
 */
let colsPerRow = (() => {
  const saved = parseInt(localStorage.getItem('colsPerRow') || '3', 10);
  return saved === 4 ? 4 : 3;
})();

/* =========================================================
   APP DATA — master JSON object
   Single source of truth for all user-generated data.
   Stored under APP_DATA_KEY through `storageAdapter` so swapping the
   backend only requires changing the adapter — no other code changes.

   Shape:
   {
     version: 1,
     favorites: {
       "[productId]": {
         productId:        number,
         url:              string,
         name:             string,
         addedAt:          ISO string,
         priceAtAddition:  number | null,
         notifyByEmail:    boolean,   // set to true by sendPriceAlert() — needs emailAdapter configured
         notifyEmail:      string,    // persisted by sendPriceAlert() when user enters their email
       }
     }
   }
   ========================================================= */

/**
 * Loads the complete app-data object from the storage adapter.
 * Returns a fresh default object when nothing is stored yet.
 * @returns {{ version: number, favorites: Object }}
 */
function loadAppData() {
  const saved = storageAdapter.get(APP_DATA_KEY);
  if (saved && typeof saved === 'object' && saved.version === 1) return saved;
  return { version: 1, favorites: {} };
}

/**
 * Persists the complete app-data object through the storage adapter.
 * @param {{ version: number, favorites: Object }} data
 */
function saveAppData(data) {
  storageAdapter.set(APP_DATA_KEY, data);
}

/**
 * Adds a product to the user's favourites and records the price at that moment.
 * @param {Object} product - Product row object from the database query.
 */
function addFavorite(product) {
  const data = loadAppData();
  data.favorites[String(product.id)] = {
    productId: product.id,
    url: product.url,
    name: product.name || UNKNOWN_PRODUCT_NAME,
    addedAt: new Date().toISOString(),
    priceAtAddition: product.price ?? null,
    notifyByEmail: false, // used by sendPriceAlert() — enable via emailAdapter
    notifyEmail: '',      // persisted by sendPriceAlert() when user enters their email
  };
  saveAppData(data);
}

/**
 * Removes a product from the user's favourites.
 * @param {number|string} productId - The product's database ID.
 */
function removeFavorite(productId) {
  const data = loadAppData();
  delete data.favorites[String(productId)];
  saveAppData(data);
}

/**
 * Returns true when the product is in the user's favourites list.
 * @param {number|string} productId
 * @returns {boolean}
 */
function isFavorite(productId) {
  return Boolean(loadAppData().favorites[String(productId)]);
}

/**
 * Returns the stored favourites map { [productId]: FavoriteEntry }.
 * @returns {Object}
 */
function getFavorites() {
  return loadAppData().favorites;
}

/**
 * Returns the number of products in the favourites list.
 * @returns {number}
 */
function getFavoriteCount() {
  return Object.keys(getFavorites()).length;
}

/**
 * Updates the favourites filter button label to reflect the current count.
 */
function updateFavoritesFilterLabel() {
  const btn = document.getElementById('filterFavoritesBtn');
  if (!btn) return;
  const count = getFavoriteCount();
  btn.textContent = count > 0 ? `⭐ Mis favoritos (${count})` : '⭐ Mis favoritos';
  btn.classList.toggle('active', filterOnlyFavorites);
}

/**
 * Syncs the "🔔 Notificarme por correo" button in the price modal.
 * Enables the button when emailAdapter.isAvailable() is true;
 * disables it with an explanatory tooltip otherwise.
 * Also pre-fills the email input with any email saved in the favourite entry,
 * and hides the email form whenever a different product is opened.
 * @param {number} productId
 */
function updateModalNotifyBtn(productId) {
  const btn = document.getElementById('modalNotifyBtn');
  if (!btn) return;

  const available = emailAdapter.isAvailable();
  btn.disabled = !available;
  btn.title = available
    ? ''
    : 'Notificaciones por correo no configuradas. Ver el bloque emailAdapter en main.js para habilitarlas.';
  btn.dataset.productId = productId;

  // Pre-fill the email input from the saved favourite entry (if any)
  const emailInput = document.getElementById('notifyEmailInput');
  if (emailInput) {
    const entry = getFavorites()[String(productId)];
    emailInput.value = (entry && entry.notifyEmail) || '';
  }

  // Reset the feedback text and hide the form when switching products
  const form = document.getElementById('notifyEmailForm');
  if (form) form.classList.add('d-none');
  const feedback = document.getElementById('notifyEmailFeedback');
  if (feedback) { feedback.className = 'small mt-1'; feedback.textContent = ''; }
}

/**
 * Sends a price-alert email for a favourited product via emailAdapter.
 * Persists the email address in the favourite entry so it is pre-filled next time.
 * @param {number} productId - Database ID of the product.
 * @param {string} email - Recipient email address.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function sendPriceAlert(productId, email) {
  const product = allProducts.find((p) => p.id === productId);
  if (!product) return { ok: false, error: 'Producto no encontrado' };

  // Save the email in the favourite entry so the form is pre-filled next time
  const data = loadAppData();
  if (data.favorites[String(productId)]) {
    data.favorites[String(productId)].notifyByEmail = true;
    data.favorites[String(productId)].notifyEmail = email;
    saveAppData(data);
  }

  return emailAdapter.send({
    toEmail: email,
    productName: product.name || UNKNOWN_PRODUCT_NAME,
    productUrl: product.url,
    currentPrice: product.price,
    priceAtAddition: (data.favorites[String(productId)] || {}).priceAtAddition ?? product.price,
  });
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

/**
 * Entry point. Loads the SQL.js library, then fetches and loads the database.
 * @returns {Promise<void>}
 */
async function init() {
  try {
    initTheme();
    initDisclaimer();
    updateFavoritesFilterLabel();
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
 * Shows or hides the localStorage disclaimer banner.
 * The banner is shown once and dismissed permanently when the user closes it.
 */
function initDisclaimer() {
  const banner = document.getElementById('localStorageDisclaimer');
  if (!banner) return;
  const dismissed = storageAdapter.get(DISCLAIMER_KEY);
  if (!dismissed) {
    banner.classList.remove('d-none');
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
   DARK MODE
   ========================================================= */

/**
 * Initialises the theme from localStorage or system preference.
 * Called once on startup; the inline script in <head> already sets the
 * data-bs-theme attribute before CSS loads to prevent flash of wrong theme.
 * This function only updates the toggle button icon to match current state.
 */
function initTheme() {
  updateThemeToggleIcon();
}

/**
 * Toggles between light and dark mode, stores the choice in localStorage.
 */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-bs-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-bs-theme', next);
  try { localStorage.setItem('theme', next); } catch (_) {}
  updateThemeToggleIcon();
}

/**
 * Syncs the theme toggle button icon and aria-label with the current theme.
 */
function updateThemeToggleIcon() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  btn.textContent = isDark ? '☀️' : '🌙';
  btn.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
}

/* =========================================================
   COLUMNS PER ROW
   ========================================================= */

/**
 * Applies the current colsPerRow value to the product grid class and updates
 * the column selector button active state.
 */
function applyColsPerRow() {
  const grid = document.getElementById('productGrid');
  if (grid) {
    grid.className = grid.className.replace(/\brow-cols-md-\d+\b/, `row-cols-md-${colsPerRow}`);
  }
  document.querySelectorAll('#colsSelector [data-cols]').forEach((btn) => {
    btn.classList.toggle('active', parseInt(btn.dataset.cols, 10) === colsPerRow);
  });
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
 *
 * The correlated subquery for prevPrice finds the most recently closed price record
 * (endDate IS NOT NULL, ordered by endDate DESC). This is the price that was active
 * immediately before the current open record and is used to show price-change badges
 * and to enable sorting by biggest price drop or increase.
 *
 * @returns {Array<Object>} Array of product row objects.
 */
function queryAllProducts() {
  const result = sqlDb.exec(`
    SELECT p.id, p.url, p.name, p.sku, p.category, p.imageUrl, p.lastCheckedAt,
           p.firstSeenAt, p.stockLocations, p.isActive, ph.price, ph.originalPrice, ph.currency,
           p.publishedDateFirst, p.publishedDateLatest,
           p.publishedDateFirstScrapedAt, p.publishedDateLatestScrapedAt,
           (
             SELECT ph2.price
             FROM priceHistory ph2
             WHERE ph2.productId = p.id AND ph2.endDate IS NOT NULL
             ORDER BY ph2.endDate DESC
             LIMIT 1
           ) AS prevPrice
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
 * Computes the price change percentage vs the most recent previous price on record.
 * A negative value indicates the price dropped; a positive value indicates it rose.
 * Returns 0 when no previous price is available (first-time price or never changed).
 * @param {Object} product - Product row with price and prevPrice fields.
 * @returns {number} Percentage change (e.g. -12.5 for a 12.5% drop).
 */
function calcPriceChangePct(product) {
  if (product.prevPrice == null || product.prevPrice === 0) return 0;
  return (product.price - product.prevPrice) / product.prevPrice * 100;
}

/* =========================================================
   SEARCH HELPERS  (see public/search.js — loaded before this script)
   All pure search functions (normalizeText, tokenize, levenshtein,
   tokenMatchScore, fieldTokenScore, expandToken, computeSearchScore,
   SYNONYMS, SEARCH_FIELD_WEIGHTS) are defined there as browser globals.
   ========================================================= */

/** Maps product id → relevance score for the most recent search query. */
let productSearchScores = new Map();

/* =========================================================
   FILTERING
   ========================================================= */

/**
 * Applies the current filter state (active/inactive, in-stock/out-of-stock, search term)
 * and returns the matching subset of allProducts.
 * When a search term is active, relevance scores are stored in productSearchScores
 * (keyed by product id) so that filterAndSort can order results without mutating
 * the original product objects.
 * @param {Array<Object>} products - Full product list to filter.
 * @returns {Array<Object>} Filtered products.
 */
function filterProducts(products) {
  const rawSearch = document.getElementById('searchInput')
    ? document.getElementById('searchInput').value.trim()
    : '';
  const queryTokens = tokenize(rawSearch);

  productSearchScores = new Map();
  const favorites = filterOnlyFavorites ? getFavorites() : null;

  return products.filter((p) => {
    // Favourites filter: hide products not in the user's favourites list
    if (favorites && !favorites[String(p.id)]) return false;

    // Existence filter: always show active; only show inactive when filterIncludeInactive is on
    if (p.isActive === 0 && !filterIncludeInactive) return false;

    // Stock filter (only applied to active products; inactive ones are shown regardless of stock)
    if (p.isActive === 1 && filterOnlyInStock) {
      if (!isProductInStock(p.stockLocations)) return false;
    }

    // Search filter: tokenized, normalized, multi-field, scored
    if (queryTokens.length > 0) {
      const score = computeSearchScore(p, queryTokens);
      if (score === 0) return false;
      productSearchScores.set(p.id, score);
    }

    return true;
  });
}

/**
 * Filters and sorts the product list based on the current search term, sort selection,
 * and checkbox filter state, then re-renders the product grid.
 * When a search term is active, results are ordered by relevance score (descending).
 * Otherwise the user-selected sort order is applied.
 */
function filterAndSort() {
  const sortValue = document.getElementById('sortSelect').value;
  const hasSearch = document.getElementById('searchInput')
    && document.getElementById('searchInput').value.trim().length > 0;
  const filtered = filterProducts(allProducts);
  let sorted;
  if (hasSearch) {
    sorted = [...filtered].sort((a, b) => (productSearchScores.get(b.id) || 0) - (productSearchScores.get(a.id) || 0));
  } else {
    sorted = sortProducts(filtered, sortValue);
  }
  renderProducts(sorted);
}

/**
 * Sorts an array of product objects by the given sort key.
 * @param {Array<Object>} products - Products to sort.
 * @param {string} sortKey - One of "name-asc", "name-desc", "price-asc", "price-desc",
 *   "discount-desc" (biggest price drop first), or "increase-desc" (biggest rise first).
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
      case 'discount-desc':
        // Products with the biggest price DROP first (most negative change %)
        return calcPriceChangePct(a) - calcPriceChangePct(b);
      case 'increase-desc':
        // Products with the biggest price RISE first (most positive change %)
        return calcPriceChangePct(b) - calcPriceChangePct(a);
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

  // Apply stored columns-per-row preference after building the grid
  applyColsPerRow();

  // Attach price history click handlers
  grid.querySelectorAll('.product-card').forEach((card) => {
    card.addEventListener('click', () => {
      const productId = parseInt(card.dataset.productId, 10);
      const name = card.dataset.productName;
      openPriceModal(productId, name);
    });
  });

  // Attach favourite toggle handlers (stop propagation so the modal doesn't open)
  grid.querySelectorAll('.favorite-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const productId = parseInt(btn.dataset.productId, 10);
      const product = allProducts.find((p) => p.id === productId);
      if (!product) return;
      if (isFavorite(productId)) {
        removeFavorite(productId);
        btn.textContent = '☆';
        btn.setAttribute('aria-label', 'Agregar a favoritos');
        btn.closest('.product-card').classList.remove('is-favorite');
      } else {
        addFavorite(product);
        btn.textContent = '⭐';
        btn.setAttribute('aria-label', 'Quitar de favoritos');
        btn.closest('.product-card').classList.add('is-favorite');
      }
      updateFavoritesFilterLabel();
      // If the favorites filter is active, re-render so the card disappears/appears correctly
      if (filterOnlyFavorites) filterAndSort();
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
  const favorited = isFavorite(product.id);
  const favoriteClass = favorited ? ' is-favorite' : '';
  const favoriteIcon = favorited ? '⭐' : '☆';
  const favoriteLabel = favorited ? 'Quitar de favoritos' : 'Agregar a favoritos';
  const priceSinceFavoriteHtml = buildPriceSinceFavoriteHtml(product);
  const publishedDateHtml = buildPublishedDateHtml(product);
  const crawlDatesHtml = buildCrawlDatesHtml(product);

  return `
    <div class="card h-100 product-card${favoriteClass}"
         data-product-id="${product.id}"
         data-product-name="${escapeHtml(product.name || '')}">
      <button class="favorite-btn" data-product-id="${product.id}"
              aria-label="${favoriteLabel}"
              onclick="event.stopPropagation()">${favoriteIcon}</button>
      ${imgHtml}
      <div class="mini-chart-wrapper">
        <canvas class="mini-chart-canvas" data-product-id="${product.id}"></canvas>
      </div>
      <div class="card-body">
        <h6 class="card-title">${name}</h6>
        ${category ? `<p class="card-text text-muted small mb-1">${category}</p>` : ''}
        ${statusBadges}
        ${priceHtml}
        ${priceSinceFavoriteHtml}
        ${stockHtml}
        ${publishedDateHtml}
        ${crawlDatesHtml}
      </div>
      <div class="card-footer text-muted small">
        <a href="${escapeHtml(product.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Ver en ExtremeTechCR</a>
      </div>
    </div>`;
}

/**
 * Builds a small "precio desde que lo agregaste" indicator for favourited products.
 * Shows the price change since the user added the product to favourites.
 * Returns an empty string for non-favourited products.
 * @param {Object} product - Product row object with price field.
 * @returns {string} HTML snippet or empty string.
 */
function buildPriceSinceFavoriteHtml(product) {
  const favorites = getFavorites();
  const entry = favorites[String(product.id)];
  if (!entry || entry.priceAtAddition == null || entry.priceAtAddition === 0 || product.price == null) return '';
  const diff = product.price - entry.priceAtAddition;
  if (diff === 0) return '';
  const pct = Math.round(Math.abs(diff / entry.priceAtAddition) * 100);
  if (pct === 0) return '';
  const arrow = diff < 0 ? '↓' : '↑';
  const colorClass = diff < 0 ? 'text-success' : 'text-danger';
  const addedDate = formatDate(new Date(entry.addedAt));
  const titleText = `Precio cuando lo agregaste: ${CRC_SYMBOL} ${formatNumber(entry.priceAtAddition)} (${addedDate})`;
  return `<div class="favorite-price-change ${colorClass} small mt-1" title="${titleText}">${arrow} ${pct}% desde que lo agregaste</div>`;
}

/**
 * Builds the publication date HTML for a product card.
 * If both the first and latest scraped dates are the same, shows one date with a tooltip
 * indicating when it was scraped. If they differ (site modified the published date),
 * shows both so the user can spot the discrepancy; hovering each reveals the scrape time.
 * @param {Object} product - Product row object with publishedDate* fields.
 * @returns {string} HTML snippet or empty string when no date is available.
 */
function buildPublishedDateHtml(product) {
  const first = product.publishedDateFirst;
  const latest = product.publishedDateLatest;
  if (!first && !latest) return '';

  const fmtDate = (iso) => {
    if (!iso) return '';
    // Parse the YYYY-MM-DD date at noon UTC to avoid timezone-boundary issues
    const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-CR', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const fmtScrapeTime = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-CR', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (!latest || first === latest) {
    // Only one date value — show it once
    const scrapedAt = product.publishedDateFirstScrapedAt
      ? `Detectado el ${fmtScrapeTime(product.publishedDateFirstScrapedAt)}`
      : '';
    return `<div class="product-published-date text-muted small mt-1">
      <span title="${escapeHtml(scrapedAt)}">📅 Publicado: ${escapeHtml(fmtDate(first || latest))}</span>
    </div>`;
  }

  // Dates differ — show both with their respective scrape timestamps
  const firstTitle = product.publishedDateFirstScrapedAt
    ? `Fecha original detectada el ${fmtScrapeTime(product.publishedDateFirstScrapedAt)}`
    : 'Fecha detectada originalmente';
  const latestTitle = product.publishedDateLatestScrapedAt
    ? `Fecha actualizada detectada el ${fmtScrapeTime(product.publishedDateLatestScrapedAt)}`
    : 'Fecha actualizada recientemente';
  return `<div class="product-published-date text-muted small mt-1">
    <span title="${escapeHtml(firstTitle)}">📅 Publicado: ${escapeHtml(fmtDate(first))}</span>
    <span class="ms-1 text-warning" title="${escapeHtml(latestTitle)}">(actualizado: ${escapeHtml(fmtDate(latest))})</span>
  </div>`;
}

/**
 * Builds the crawl-date subtitle for a product card.
 * Shows "Visto por primera vez" (firstSeenAt) and "Último chequeo" (lastCheckedAt)
 * as small text. Both dates are shown as tooltips with the full ISO timestamp.
 * @param {Object} product - Product row with firstSeenAt and lastCheckedAt fields.
 * @returns {string} HTML snippet or empty string when no dates are available.
 */
function buildCrawlDatesHtml(product) {
  const fmtShort = (iso) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('es-CR', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const fmtFull = (iso) => {
    if (!iso) return null;
    return new Date(iso).toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' });
  };

  const first = product.firstSeenAt ? fmtShort(product.firstSeenAt) : null;
  const last = product.lastCheckedAt ? fmtShort(product.lastCheckedAt) : null;

  if (!first && !last) return '';

  const firstTitle = product.firstSeenAt ? `Detectado el ${fmtFull(product.firstSeenAt)}` : '';
  const lastTitle = product.lastCheckedAt ? `Chequeado el ${fmtFull(product.lastCheckedAt)}` : '';

  const firstPart = first
    ? `<span title="${escapeHtml(firstTitle)}">🔍 Detectado: ${escapeHtml(first)}</span>`
    : '';
  const sep = first && last ? ' · ' : '';
  const lastPart = last
    ? `<span title="${escapeHtml(lastTitle)}">🕐 Chequeado: ${escapeHtml(last)}</span>`
    : '';

  return `<div class="product-crawl-dates text-muted small mt-1">${firstPart}${sep}${lastPart}</div>`;
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
 * Shows a price-change badge (↓/↑ X%) when a previous price record is available.
 * @param {Object} product - Product row object with price, originalPrice, prevPrice fields.
 * @returns {string} HTML snippet for the price display.
 */
function buildPriceHtml(product) {
  if (product.price == null) {
    return '<span class="text-muted small">Precio no disponible</span>';
  }
  const activePrice = `${CRC_SYMBOL} ${formatNumber(product.price)}`;
  const changeHtml = buildPriceChangeBadge(product);

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
        <span class="badge bg-success price-badge">${activePrice}</span>${changeHtml}
      </div>`;
  }

  return `<div class="price-block"><span class="badge bg-success price-badge">${activePrice}</span>${changeHtml}</div>`;
}

/**
 * Builds a small price-change indicator badge comparing current price to the previous
 * price on record (prevPrice). Shows a green down-arrow badge for price drops and a
 * red up-arrow badge for price increases. Returns an empty string when there is no
 * previous price or the change rounds to 0%.
 * The change percentage is rounded to the nearest whole number for display; sub-1%
 * changes are suppressed (shown as 0 and therefore hidden) to avoid cluttering cards
 * with trivial fluctuations.
 * @param {Object} product - Product row object with price and prevPrice fields.
 * @returns {string} HTML badge or empty string.
 */
function buildPriceChangeBadge(product) {
  if (product.prevPrice == null || product.price == null) return '';
  const pct = Math.round(Math.abs(calcPriceChangePct(product)));
  if (pct === 0) return '';
  if (product.price < product.prevPrice) {
    return `<span class="badge bg-success-subtle text-success ms-1 price-change-badge">↓ ${pct}%</span>`;
  }
  return `<span class="badge bg-danger-subtle text-danger ms-1 price-change-badge">↑ ${pct}%</span>`;
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

  // Update the in-modal favourite and notify buttons
  updateModalFavoriteBtn(productId);
  updateModalNotifyBtn(productId);

  // Store current productId for range changes and modal actions
  document.getElementById('priceModal').dataset.productId = productId;
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('priceModal'));
  modal.show();
}

/**
 * Refreshes the favourite toggle button inside the price modal.
 * @param {number} productId
 */
function updateModalFavoriteBtn(productId) {
  const btn = document.getElementById('modalFavoriteBtn');
  if (!btn) return;
  const favorited = isFavorite(productId);
  btn.textContent = favorited ? '❤️ Quitar de favoritos' : '🤍 Agregar a favoritos';
  btn.classList.toggle('btn-danger', favorited);
  btn.classList.toggle('btn-outline-secondary', !favorited);
  btn.dataset.productId = productId;
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
    searchTimeout = setTimeout(filterAndSort, 250);
  });

  document.getElementById('sortSelect').addEventListener('change', filterAndSort);

  document.getElementById('filterIncludeInactive').addEventListener('change', (e) => {
    filterIncludeInactive = e.target.checked;
    filterAndSort();
  });

  document.getElementById('filterOnlyInStock').addEventListener('change', (e) => {
    filterOnlyInStock = e.target.checked;
    filterAndSort();
  });

  // Favourites filter toggle
  const favBtn = document.getElementById('filterFavoritesBtn');
  if (favBtn) {
    favBtn.addEventListener('click', () => {
      filterOnlyFavorites = !filterOnlyFavorites;
      updateFavoritesFilterLabel();
      filterAndSort();
    });
  }

  document.querySelectorAll('.range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedChartDays = parseInt(btn.dataset.days, 10);
      const productId = parseInt(document.getElementById('priceModal').dataset.productId, 10);
      renderPriceChart(productId, selectedChartDays);
    });
  });

  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', toggleTheme);
  }

  document.querySelectorAll('#colsSelector [data-cols]').forEach((btn) => {
    btn.addEventListener('click', () => {
      colsPerRow = parseInt(btn.dataset.cols, 10);
      try { localStorage.setItem('colsPerRow', String(colsPerRow)); } catch (_) {}
      applyColsPerRow();
    });
  });

  // In-modal favourite toggle
  const modalFavBtn = document.getElementById('modalFavoriteBtn');
  if (modalFavBtn) {
    modalFavBtn.addEventListener('click', () => {
      const productId = parseInt(modalFavBtn.dataset.productId, 10);
      const product = allProducts.find((p) => p.id === productId);
      if (!product) return;
      if (isFavorite(productId)) {
        removeFavorite(productId);
      } else {
        addFavorite(product);
      }
      updateModalFavoriteBtn(productId);
      updateFavoritesFilterLabel();
      // Refresh the card in the grid if it's visible
      const card = document.querySelector(`.product-card[data-product-id="${productId}"]`);
      if (card) {
        const favCardBtn = card.querySelector('.favorite-btn');
        const favorited = isFavorite(productId);
        if (favCardBtn) {
          favCardBtn.textContent = favorited ? '⭐' : '☆';
          favCardBtn.setAttribute('aria-label', favorited ? 'Quitar de favoritos' : 'Agregar a favoritos');
        }
        card.classList.toggle('is-favorite', favorited);
      }
    });
  }

  // In-modal notify button — toggle the email input form
  const notifyBtn = document.getElementById('modalNotifyBtn');
  if (notifyBtn) {
    notifyBtn.addEventListener('click', () => {
      const form = document.getElementById('notifyEmailForm');
      if (form) form.classList.toggle('d-none');
    });
  }

  // Email form submit — call sendPriceAlert() via emailAdapter
  const notifySubmit = document.getElementById('notifyEmailSubmit');
  if (notifySubmit) {
    notifySubmit.addEventListener('click', async () => {
      const productId = parseInt(document.getElementById('modalNotifyBtn').dataset.productId, 10);
      const emailInput = document.getElementById('notifyEmailInput');
      const feedback = document.getElementById('notifyEmailFeedback');
      const email = emailInput ? emailInput.value.trim() : '';

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (feedback) {
          feedback.className = 'small mt-1 text-danger';
          feedback.textContent = 'Ingresa un correo electrónico válido.';
        }
        return;
      }

      if (feedback) {
        feedback.className = 'small mt-1 text-muted';
        feedback.textContent = 'Enviando…';
      }
      notifySubmit.disabled = true;

      const result = await sendPriceAlert(productId, email);

      notifySubmit.disabled = false;
      if (result.ok) {
        if (feedback) {
          feedback.className = 'small mt-1 text-success';
          feedback.textContent = '✓ Notificación enviada correctamente.';
        }
      } else {
        if (feedback) {
          feedback.className = 'small mt-1 text-danger';
          feedback.textContent = `Error al enviar: ${result.error}`;
        }
      }
    });
  }

  // Dismiss the localStorage disclaimer banner
  const disclaimerDismiss = document.getElementById('disclaimerDismiss');
  if (disclaimerDismiss) {
    disclaimerDismiss.addEventListener('click', () => {
      storageAdapter.set(DISCLAIMER_KEY, true);
      const banner = document.getElementById('localStorageDisclaimer');
      if (banner) banner.classList.add('d-none');
    });
  }
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
