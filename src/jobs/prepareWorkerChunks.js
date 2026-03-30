'use strict';

/**
 * Prepare stage for the parallel price-crawl pipeline.
 *
 * Reads the stale-first URL list from the database (or from the
 * PRICE_UPDATE_URLS override), divides it into WORKER_COUNT equal
 * chunks, and writes each chunk as a JSON array to:
 *
 *   <chunksDir>/chunk-0.json
 *   <chunksDir>/chunk-1.json
 *   ...
 *   <chunksDir>/chunk-(WORKER_COUNT-1).json
 *
 * The chunk files are uploaded as a workflow artifact and downloaded
 * by each parallel crawl job, which reads its assigned file via the
 * PRICE_UPDATE_CHUNK_FILE environment variable.
 *
 * Environment variables:
 *   PRICE_UPDATE_URLS  Comma-separated URLs to distribute instead of
 *                      querying the database (used for manual test runs).
 *   INCLUDE_INACTIVE   Set to 'true' to include inactive (404) products
 *                      in the distribution (weekly full-database review).
 *   CHUNKS_DIR         Override the output directory (default: 'chunks').
 */

const fs = require('fs');
const path = require('path');
const { getStaleProductUrls } = require('../database/db');
const { WORKER_COUNT, MAX_URLS_PER_RUN } = require('../config');

/**
 * Returns the URL list that should be distributed across workers.
 * Uses PRICE_UPDATE_URLS override when set, otherwise queries the DB.
 * @returns {string[]}
 */
function getUrlsToDistribute() {
  if (process.env.PRICE_UPDATE_URLS) {
    const urls = process.env.PRICE_UPDATE_URLS
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    console.log(`Using PRICE_UPDATE_URLS override: ${urls.length} URLs`);
    return urls;
  }
  const includeInactive = process.env.INCLUDE_INACTIVE === 'true';
  const urls = getStaleProductUrls(MAX_URLS_PER_RUN, includeInactive);
  console.log(`Read ${urls.length} stale URLs from database (INCLUDE_INACTIVE=${includeInactive})`);
  return urls;
}

/**
 * Splits urls into WORKER_COUNT chunks and writes each to
 * <chunksDir>/chunk-N.json.  Chunks are as equal as possible;
 * the last chunk absorbs any remainder.
 *
 * @param {string} [chunksDir] - Output directory (default: 'chunks').
 * @param {string[]} [urls]    - URL list to split.  If omitted, calls
 *                               getUrlsToDistribute() automatically.
 * @returns {{ chunks: string[][], dir: string }} The written chunks and directory.
 */
function prepareChunks(chunksDir, urls) {
  const dir = chunksDir || process.env.CHUNKS_DIR || 'chunks';
  const urlList = urls !== undefined ? urls : getUrlsToDistribute();

  fs.mkdirSync(dir, { recursive: true });

  const baseSize = Math.floor(urlList.length / WORKER_COUNT);
  const remainder = urlList.length % WORKER_COUNT;
  const chunks = [];
  let offset = 0;
  for (let i = 0; i < WORKER_COUNT; i++) {
    const size = baseSize + (i < remainder ? 1 : 0);
    const chunk = urlList.slice(offset, offset + size);
    offset += size;
    chunks.push(chunk);
    const chunkPath = path.join(dir, `chunk-${i}.json`);
    fs.writeFileSync(chunkPath, JSON.stringify(chunk));
    console.log(`Worker ${i}: ${chunk.length} URLs → ${chunkPath}`);
  }

  console.log(`Chunks written to ${dir}/ (total ${urlList.length} URLs, ${WORKER_COUNT} workers)`);
  return { chunks, dir };
}

// Run when executed directly (npm run prepare-chunks)
if (require.main === module) {
  prepareChunks();
}

module.exports = { prepareChunks, getUrlsToDistribute };
