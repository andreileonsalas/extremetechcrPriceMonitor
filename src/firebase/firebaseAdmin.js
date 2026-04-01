'use strict';
/**
 * Firebase Admin SDK initialization for backend (GitHub Actions) jobs.
 *
 * HOW TO CONFIGURE:
 *   1. Go to https://console.firebase.google.com → your project
 *   2. Project Settings → Service accounts → Generate new private key
 *   3. Download the JSON file (keep it secret!)
 *   4. In your GitHub repository → Settings → Secrets and variables → Actions → New secret:
 *        Name:  FIREBASE_SERVICE_ACCOUNT_JSON
 *        Value: <paste the entire contents of the downloaded JSON file>
 *   5. Optionally, set FIREBASE_PROJECT_ID as a separate secret or use the value from the JSON.
 *
 * The FIREBASE_SERVICE_ACCOUNT_JSON environment variable must be set for this module to work.
 * When running locally, you can either set the env var or point GOOGLE_APPLICATION_CREDENTIALS
 * at the downloaded JSON file.
 *
 * Usage:
 *   const { getFirestore } = require('./src/firebase/firebaseAdmin');
 *   const db = getFirestore();
 *   const snap = await db.collection('priceAlerts').get();
 */

const admin = require('firebase-admin');

let _app = null;

/**
 * Initialises Firebase Admin SDK from the FIREBASE_SERVICE_ACCOUNT_JSON environment variable.
 * Calling this multiple times is safe — it returns the existing app after the first call.
 * @returns {import('firebase-admin').app.App}
 * @throws {Error} When FIREBASE_SERVICE_ACCOUNT_JSON is not set or contains invalid JSON.
 */
function initAdmin() {
  if (_app) return _app;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set. ' +
      'See src/firebase/firebaseAdmin.js for setup instructions.'
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch (e) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON contains invalid JSON: ' + e.message
    );
  }

  _app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  // Log success without printing any fields from the service account object
  // (avoids CodeQL taint-tracking false positives for clear-text logging).
  console.info('[Firebase Admin] Initialized successfully.');
  return _app;
}

/**
 * Returns a Firestore instance, initialising Firebase Admin on the first call.
 * @returns {import('firebase-admin/firestore').Firestore}
 */
function getFirestore() {
  initAdmin();
  return admin.firestore();
}

/**
 * Returns the Firebase Admin app instance.
 * @returns {import('firebase-admin').app.App}
 */
function getAdminApp() {
  return initAdmin();
}

module.exports = { initAdmin, getFirestore, getAdminApp };
