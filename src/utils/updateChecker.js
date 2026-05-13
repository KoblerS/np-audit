'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CACHE_FILE = path.join(os.homedir(), '.npa-update-check');
const CHECK_INTERVAL = 172800000; // 2 days in ms

/**
 * Check for a newer version of np-audit on the registry.
 * Non-blocking — swallows all errors and returns null on failure.
 * @param {object} config  Must have `registry` and `timeout` keys.
 * @param {string} currentVersion  The currently installed version.
 * @returns {Promise<string|null>} The latest version if newer, or null.
 */
async function checkForUpdate(config, currentVersion) {
  try {
    const cache = readCache();
    const now = Date.now();

    if (cache && (now - cache.lastCheck) < CHECK_INTERVAL) {
      return isNewer(cache.latestVersion, currentVersion) ? cache.latestVersion : null;
    }

    const { fetchJSON } = require('./fetcher');
    const meta = await fetchJSON(`${config.registry}/np-audit`, { timeout: 5000 });
    const latest = meta['dist-tags'] && meta['dist-tags'].latest;

    if (latest) {
      writeCache({ lastCheck: now, latestVersion: latest });
      return isNewer(latest, currentVersion) ? latest : null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Compare two semver strings. Returns true if `a` is newer than `b`.
 */
function isNewer(a, b) {
  const pa = a.split(/[-.]/).map(s => parseInt(s, 10) || 0);
  const pb = b.split(/[-.]/).map(s => parseInt(s, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  // Same x.y.z — pre-release (e.g. "beta") is older than stable
  if (b.includes('-') && !a.includes('-')) return true;
  return false;
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
  } catch {
    // Non-critical — ignore write failures
  }
}

module.exports = { checkForUpdate, isNewer, CHECK_INTERVAL, CACHE_FILE };
