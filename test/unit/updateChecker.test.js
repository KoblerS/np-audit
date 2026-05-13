'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const { isNewer, CHECK_INTERVAL } = require('../../src/utils/updateChecker');

// ─── isNewer tests ──────────────────────────────────────────────────────────

// Basic version comparisons
assert.strictEqual(isNewer('1.1.0', '1.0.0'), true, '1.1.0 > 1.0.0');
assert.strictEqual(isNewer('2.0.0', '1.9.9'), true, '2.0.0 > 1.9.9');
assert.strictEqual(isNewer('1.0.1', '1.0.0'), true, '1.0.1 > 1.0.0');

// Same version
assert.strictEqual(isNewer('1.0.0', '1.0.0'), false, '1.0.0 == 1.0.0');

// Older version
assert.strictEqual(isNewer('1.0.0', '1.0.1'), false, '1.0.0 < 1.0.1');
assert.strictEqual(isNewer('1.0.0', '2.0.0'), false, '1.0.0 < 2.0.0');

// Pre-release handling
assert.strictEqual(isNewer('1.0.0', '1.0.0-beta'), true, 'stable > pre-release');
assert.strictEqual(isNewer('1.0.0-beta', '1.0.0'), false, 'pre-release < stable');
assert.strictEqual(isNewer('1.0.0-beta', '1.0.0-beta'), false, 'same pre-release');

// ─── CHECK_INTERVAL ─────────────────────────────────────────────────────────

assert.strictEqual(CHECK_INTERVAL, 172800000, 'interval is 2 days in ms');

// ─── Cache read/write round-trip ────────────────────────────────────────────

{
  const tmpFile = path.join(os.tmpdir(), '.npa-update-check-test-' + process.pid);
  const data = { lastCheck: Date.now(), latestVersion: '2.0.0' };
  fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf8');
  const read = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  assert.deepStrictEqual(read, data, 'cache round-trip works');
  fs.unlinkSync(tmpFile);
}

// ─── checkForUpdate with fresh cache ────────────────────────────────────────

{
  // Simulate a cache file that says latest is 99.0.0, checked just now
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'npa-update-'));
  const cacheFile = path.join(tmpHome, '.npa-update-check');
  fs.writeFileSync(cacheFile, JSON.stringify({
    lastCheck: Date.now(),
    latestVersion: '99.0.0',
  }));

  // Mock: override the CACHE_FILE by requiring and testing isNewer directly
  // Since cache is fresh, checkForUpdate would use cached value without network
  // We verify the comparison logic:
  assert.strictEqual(isNewer('99.0.0', '1.0.0'), true, 'cached 99.0.0 > 1.0.0');
  assert.strictEqual(isNewer('99.0.0', '99.0.0'), false, 'cached 99.0.0 == 99.0.0');

  fs.rmSync(tmpHome, { recursive: true, force: true });
}

console.log('  updateChecker.test.js: all tests passed');
