'use strict';
/**
 * sendPriceAlerts.js — Backend job for Firebase-powered price alert emails.
 *
 * What it does:
 *   1. Reads active price alerts from Firestore (`priceAlerts` collection).
 *   2. Opens the current prices.db (extracted from public/db.zip).
 *   3. For each alert, checks if the current price satisfies the alert condition:
 *        - If alert.targetPrice is set   → trigger when price <= targetPrice
 *        - If alert.notifyOnAnyDrop=true → trigger when price dropped vs priceAtCreation
 *   4. Sends an HTML email via Nodemailer SMTP.
 *   5. Updates the Firestore alert document (lastTriggeredAt, priceAtCreation reset).
 *
 * REQUIRED ENVIRONMENT VARIABLES (GitHub Actions secrets):
 *
 *   FIREBASE_SERVICE_ACCOUNT_JSON
 *     Full contents of the Firebase service account JSON file.
 *     See src/firebase/firebaseAdmin.js for how to generate this.
 *
 *   SMTP_HOST
 *     SMTP server hostname. Examples:
 *       - Gmail:      smtp.gmail.com
 *       - SendGrid:   smtp.sendgrid.net
 *       - Brevo:      smtp-relay.brevo.com
 *       - Mailgun:    smtp.mailgun.org
 *
 *   SMTP_PORT
 *     SMTP port number. Typically 587 (STARTTLS) or 465 (SSL).
 *     Default: 587
 *
 *   SMTP_USER
 *     SMTP username (usually your email address or API key identifier).
 *     For Gmail with App Password: your Gmail address.
 *     For SendGrid: the literal string "apikey".
 *
 *   SMTP_PASS
 *     SMTP password / API key.
 *     For Gmail: generate an App Password at myaccount.google.com/apppasswords
 *     For SendGrid: your SendGrid API key.
 *
 *   SMTP_FROM
 *     The "From" email address shown to recipients.
 *     Example: "ExtremeTechCR Alertas <no-reply@tudominio.com>"
 *     If not set, falls back to SMTP_USER.
 *
 *   SITE_URL  (optional)
 *     Base URL of the price monitor site, used in email links.
 *     Default: https://andreileonsalas.github.io/extremetechcrPriceMonitor/public/
 *
 * USAGE:
 *   node src/jobs/sendPriceAlerts.js
 *
 * Add to package.json scripts:
 *   "price-alerts": "node src/jobs/sendPriceAlerts.js"
 */

const path   = require('path');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const { getFirestore } = require('../firebase/firebaseAdmin');

/* ── Configuration ──────────────────────────────────────────────────────────── */

const DB_ZIP_PATH = path.resolve(__dirname, '../../public/db.zip');
const SITE_URL    = (process.env.SITE_URL || 'https://andreileonsalas.github.io/extremetechcrPriceMonitor/public/').replace(/\/$/, '');

/** Maximum number of emails to send per run (safety cap for free email tiers). */
const MAX_EMAILS_PER_RUN = 200;

/* ── SMTP Transport ─────────────────────────────────────────────────────────── */

/**
 * Creates a Nodemailer transporter from SMTP environment variables.
 * @returns {import('nodemailer').Transporter}
 */
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      'Missing SMTP configuration. Set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables. ' +
      'See src/jobs/sendPriceAlerts.js for details.'
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/* ── Database helpers ───────────────────────────────────────────────────────── */

/**
 * Extracts prices.db from public/db.zip and returns a better-sqlite3 Database instance.
 * The DB is loaded in-memory so no temp file is needed.
 * @returns {import('better-sqlite3').Database}
 */
function openDatabaseFromZip() {
  const zip = new AdmZip(DB_ZIP_PATH);
  const entry = zip.getEntry('prices.db');
  if (!entry) throw new Error('prices.db not found inside public/db.zip');
  const buffer = zip.readFile(entry);
  return new Database(buffer);
}

/**
 * Queries the current (open) price for a product by its database ID.
 * Returns null when the product is not found or has no open price record.
 * @param {import('better-sqlite3').Database} db
 * @param {number} productId
 * @returns {{ price: number|null, name: string|null, url: string|null }|null}
 */
function getCurrentPrice(db, productId) {
  const row = db.prepare(`
    SELECT p.name, p.url, ph.price
    FROM products p
    INNER JOIN priceHistory ph ON ph.productId = p.id AND ph.endDate IS NULL
    WHERE p.id = ? AND p.isActive = 1
    LIMIT 1
  `).get(productId);
  return row || null;
}

/* ── Email formatting ───────────────────────────────────────────────────────── */

/**
 * Formats a CRC price number as a human-readable string.
 * @param {number} price
 * @returns {string}
 */
function formatCRC(price) {
  return `\u20a1 ${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/**
 * Builds an HTML email body for a price alert notification.
 * @param {Object} opts
 * @param {string} opts.productName
 * @param {string} opts.productUrl
 * @param {number} opts.currentPrice
 * @param {number} opts.previousPrice
 * @param {number|null} opts.targetPrice
 * @returns {string} HTML string
 */
function buildEmailHtml({ productName, productUrl, currentPrice, previousPrice, targetPrice }) {
  const dropPct = previousPrice > 0
    ? Math.round(((previousPrice - currentPrice) / previousPrice) * 100)
    : 0;

  const targetLine = targetPrice
    ? `<p style="color:#198754;">El precio ha bajado a tu precio objetivo de <strong>${formatCRC(targetPrice)}</strong>.</p>`
    : `<p style="color:#198754;">El precio ha bajado un <strong>${dropPct}%</strong> desde que creaste la alerta.</p>`;

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;color:#212529;">
  <h2 style="color:#0d6efd;">🔔 Alerta de precio — ExtremeTechCR</h2>
  <p>¡Buenas noticias! El precio del producto que estás siguiendo ha bajado:</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr>
      <td style="padding:8px;border:1px solid #dee2e6;font-weight:bold;">Producto</td>
      <td style="padding:8px;border:1px solid #dee2e6;">
        <a href="${productUrl}" style="color:#0d6efd;">${productName}</a>
      </td>
    </tr>
    <tr>
      <td style="padding:8px;border:1px solid #dee2e6;font-weight:bold;">Precio anterior</td>
      <td style="padding:8px;border:1px solid #dee2e6;color:#6c757d;">
        <s>${formatCRC(previousPrice)}</s>
      </td>
    </tr>
    <tr>
      <td style="padding:8px;border:1px solid #dee2e6;font-weight:bold;">Precio actual</td>
      <td style="padding:8px;border:1px solid #dee2e6;color:#198754;font-size:1.1em;font-weight:bold;">
        ${formatCRC(currentPrice)}
      </td>
    </tr>
  </table>
  ${targetLine}
  <p>
    <a href="${productUrl}"
       style="display:inline-block;background:#0d6efd;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;">
      Ver en ExtremeTechCR ↗
    </a>
    &nbsp;
    <a href="${SITE_URL}"
       style="display:inline-block;background:#6c757d;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;">
      Ver monitor de precios
    </a>
  </p>
  <hr style="border:none;border-top:1px solid #dee2e6;margin:24px 0;">
  <p style="font-size:0.8em;color:#6c757d;">
    Recibiste este correo porque registraste una alerta de precio en
    <a href="${SITE_URL}" style="color:#6c757d;">${SITE_URL}</a>.
    Para dejar de recibir alertas de este producto, abre el monitor, busca el producto,
    haz clic en "Historial de precios" → "Notificarme por correo" y elimina la alerta.
  </p>
</body>
</html>`;
}

/* ── Main job ───────────────────────────────────────────────────────────────── */

/**
 * Main entry point. Reads active Firestore alerts, checks prices, and sends emails.
 */
async function main() {
  console.log('[sendPriceAlerts] Starting price alert email job…');

  const db         = openDatabaseFromZip();
  const firestore  = getFirestore();
  const transporter = createTransporter();

  // Verify SMTP connection before processing alerts
  try {
    await transporter.verify();
    console.log('[sendPriceAlerts] SMTP connection verified.');
  } catch (e) {
    console.error('[sendPriceAlerts] SMTP connection failed:', e.message);
    throw e;
  }

  // Fetch all active price alerts from Firestore
  const snap = await firestore.collection('priceAlerts')
    .where('active', '==', true)
    .get();

  if (snap.empty) {
    console.log('[sendPriceAlerts] No active alerts found. Done.');
    db.close();
    return;
  }

  console.log(`[sendPriceAlerts] Found ${snap.size} active alert(s).`);

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  let emailsSent = 0;
  let alertsTriggered = 0;

  for (const doc of snap.docs) {
    if (emailsSent >= MAX_EMAILS_PER_RUN) {
      console.warn(`[sendPriceAlerts] Reached MAX_EMAILS_PER_RUN (${MAX_EMAILS_PER_RUN}). Stopping.`);
      break;
    }

    const alert = doc.data();
    const {
      productId, productName, productUrl, email,
      targetPrice, notifyOnAnyDrop, priceAtCreation,
    } = alert;

    // Get current price from the SQLite database
    const row = getCurrentPrice(db, productId);
    if (!row || row.price == null) {
      console.log(`[sendPriceAlerts] Product ${productId} not found or inactive — skipping alert ${doc.id}`);
      continue;
    }

    const currentPrice  = row.price;
    const previousPrice = priceAtCreation || null;

    // Check if the alert condition is met
    let shouldNotify = false;
    if (targetPrice && currentPrice <= targetPrice) {
      // Target price alert: fire when price is at or below the target
      shouldNotify = true;
      console.log(`[sendPriceAlerts] Alert ${doc.id}: target price met (${currentPrice} <= ${targetPrice})`);
    } else if (notifyOnAnyDrop && previousPrice !== null && currentPrice < previousPrice) {
      // Any-drop alert: fire when price dropped since alert was created / last triggered
      shouldNotify = true;
      console.log(`[sendPriceAlerts] Alert ${doc.id}: price drop detected (${currentPrice} < ${previousPrice})`);
    } else if (!previousPrice) {
      // No baseline price recorded yet — update it silently but do not notify
      await doc.ref.update({ priceAtCreation: currentPrice }).catch(() => {});
    }

    if (!shouldNotify) continue;

    alertsTriggered++;

    // Send the email
    try {
      await transporter.sendMail({
        from,
        to: email,
        subject: `🔔 Bajó de precio: ${productName}`,
        html: buildEmailHtml({
          productName,
          productUrl,
          currentPrice,
          previousPrice: previousPrice !== null ? previousPrice : currentPrice,
          targetPrice: targetPrice || null,
        }),
      });
      emailsSent++;
      console.log(`[sendPriceAlerts] Email sent to ${email} for product ${productId} (${productName})`);
    } catch (e) {
      console.error(`[sendPriceAlerts] Failed to send email to ${email} for alert ${doc.id}:`, e.message);
      continue;
    }

    // Update Firestore: record when alert was last triggered and reset priceAtCreation
    // so the next alert only fires if the price drops again from the current level.
    try {
      await doc.ref.update({
        lastTriggeredAt: admin.firestore.FieldValue.serverTimestamp(),
        priceAtCreation: currentPrice,  // Reset baseline so future drop is relative to this
      });
    } catch (e) {
      console.warn(`[sendPriceAlerts] Failed to update alert ${doc.id}:`, e.message);
    }
  }

  db.close();
  console.log(`[sendPriceAlerts] Done. ${alertsTriggered} alert(s) triggered, ${emailsSent} email(s) sent.`);
}

main().catch((err) => {
  console.error('[sendPriceAlerts] Fatal error:', err);
  process.exit(1);
});
