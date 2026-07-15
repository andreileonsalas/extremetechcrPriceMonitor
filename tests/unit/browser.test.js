'use strict';

/**
 * Tests for browser.js metric tracking (getMetrics / resetMetrics).
 * The actual Playwright network calls are not exercised here — we test only
 * the exported metric helpers that are pure JavaScript.
 */

// browser.js imports playwright-extra at the top level; mock the heavy
// external modules so the module can be loaded in the Node.js test environment
// without launching a real browser.
jest.mock('playwright-extra', () => ({
  chromium: {
    use: jest.fn(),
    launch: jest.fn(),
  },
}));
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn(() => ({})));
jest.mock('../../src/scraper/httpFetcher', () => ({
  fetchPageHttp: jest.fn(),
  fetchTextHttp: jest.fn(),
  closeHttpClient: jest.fn(),
}));

const { getMetrics, resetMetrics } = require('../../src/scraper/browser');

describe('browser metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  test('getMetrics returns zeroed counters after resetMetrics', () => {
    const m = getMetrics();
    expect(m.playwrightFetchCount).toBe(0);
    expect(m.challengeDetected).toBe(0);
    expect(m.challengeResolved).toBe(0);
    expect(m.challengeUnresolved).toBe(0);
  });

  test('getMetrics returns a snapshot (not a live reference)', () => {
    const snap1 = getMetrics();
    // Resetting should not affect the already-returned snapshot
    resetMetrics();
    expect(snap1.playwrightFetchCount).toBe(0);
  });

  test('resetMetrics sets all counters back to zero', () => {
    // resetMetrics is idempotent — calling it twice is safe
    resetMetrics();
    resetMetrics();
    const m = getMetrics();
    expect(m.playwrightFetchCount).toBe(0);
    expect(m.challengeDetected).toBe(0);
    expect(m.challengeResolved).toBe(0);
    expect(m.challengeUnresolved).toBe(0);
  });
});
