/**
 * Firebase Web App Configuration
 * ================================
 * Replace the REPLACE_* placeholder values with your actual Firebase project values.
 *
 * HOW TO GET THESE VALUES:
 *   1. Go to https://console.firebase.google.com
 *   2. Create a project (or use an existing one) — FREE Spark plan is enough
 *   3. Click "Add app" → Web (</>), register the app
 *   4. Copy the firebaseConfig object shown and paste the values below
 *
 * SERVICES TO ENABLE in the Firebase Console:
 *   - Authentication  → Sign-in method → Anonymous  (required — enable this first)
 *   - Authentication  → Sign-in method → Google     (optional, for cross-device sync)
 *   - Authentication  → Sign-in method → Email/Password (optional)
 *   - Firestore Database → Create database (choose a region near Costa Rica, e.g. us-central1)
 *
 * FIRESTORE SECURITY RULES
 *   Paste these in Firebase Console → Firestore Database → Rules tab:
 *
 *     rules_version = '2';
 *     service cloud.firestore {
 *       match /databases/{database}/documents {
 *         // Each user can only read/write their own profile data
 *         match /users/{userId}/{document=**} {
 *           allow read, write: if request.auth != null && request.auth.uid == userId;
 *         }
 *         // Price alerts: only the owning user may read/write; admin SDK (GitHub Action) bypasses rules
 *         match /priceAlerts/{alertId} {
 *           allow read, update, delete: if request.auth != null && request.auth.uid == resource.data.userId;
 *           allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
 *         }
 *       }
 *     }
 *
 * AUTHORIZED DOMAINS
 *   Firebase Console → Authentication → Settings → Authorized domains:
 *   Add your GitHub Pages domain:  <your-username>.github.io
 *
 * ⚠️  Firebase API keys for web apps are safe to commit — they identify the project, not grant
 *     unrestricted access. Security is enforced by the Firestore rules above + authorized domains.
 *     Do NOT confuse this with the firebase-admin service account key (used in GitHub Actions secrets).
 */

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Replace every REPLACE_* value with your real Firebase project config
// ─────────────────────────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            'REPLACE_WITH_FIREBASE_API_KEY',
  authDomain:        'REPLACE_WITH_PROJECT_ID.firebaseapp.com',
  projectId:         'REPLACE_WITH_PROJECT_ID',
  storageBucket:     'REPLACE_WITH_PROJECT_ID.firebasestorage.app',  // Note: older projects may use .appspot.com — use the exact value from your Firebase console
  messagingSenderId: 'REPLACE_WITH_MESSAGING_SENDER_ID',
  appId:             'REPLACE_WITH_APP_ID',
};

// ─────────────────────────────────────────────────────────────────────────────
// Initialization — do not modify below this line
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when all FIREBASE_CONFIG values appear to have been filled in
 * (i.e., none of them still start with the literal string "REPLACE_").
 * @returns {boolean}
 */
function _isFirebaseConfigured() {
  return !Object.values(FIREBASE_CONFIG).some((v) => String(v).startsWith('REPLACE_'));
}

if (_isFirebaseConfigured()) {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    window.__firebaseApp  = firebase.app();
    window.__firebaseAuth = firebase.auth();
    window.__firestoreDb  = firebase.firestore();
    console.info('[Firebase] Initialized — project:', FIREBASE_CONFIG.projectId);
  } catch (e) {
    console.error('[Firebase] Initialization failed:', e);
    window.__firebaseApp  = null;
    window.__firebaseAuth = null;
    window.__firestoreDb  = null;
  }
} else {
  console.info(
    '[Firebase] Not configured — running in localStorage-only mode. ' +
    'Fill in the FIREBASE_CONFIG values in public/firebase-config.js to enable cloud sync and email alerts.'
  );
  window.__firebaseApp  = null;
  window.__firebaseAuth = null;
  window.__firestoreDb  = null;
}
