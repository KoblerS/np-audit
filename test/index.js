'use strict';

/**
 * Main test runner — executes all unit and E2E tests.
 * Run: node test/index.js
 */

const path = require('path');

const UNIT_TESTS = [
  'unit/detector.test.js',
  'unit/tarball.test.js',
  'unit/lockfile.test.js',
  'unit/config.test.js',
  'unit/command.test.js',
  'unit/requireWalker.test.js',
  'unit/updateChecker.test.js',
  'unit/cve.test.js',
  'unit/resolveVersion.test.js',
  'unit/marshallers/index.test.js',
];

const E2E_TESTS = [
  'e2e/install.test.js',
  'e2e/config.test.js',
  'e2e/review.test.js',
  'e2e/command-coverage.test.js',
  'e2e/require-following.test.js',
  'e2e/scan-self.test.js',
];

let failed = 0;
let passed = 0;

function runFileSync(file) {
  const fullPath = path.join(__dirname, file);
  try {
    require(fullPath);
    passed++;
  } catch (err) {
    console.error(`\n  FAIL ${file}`);
    console.error(`       ${err.message}`);
    if (process.env.NPA_DEBUG) console.error(err.stack);
    failed++;
  }
}

async function runFileAsync(file) {
  const fullPath = path.join(__dirname, file);
  try {
    const result = require(fullPath);
    if (result && typeof result.then === 'function') {
      await result;
    }
    passed++;
  } catch (err) {
    console.error(`\n  FAIL ${file}`);
    console.error(`       ${err.message}`);
    if (process.env.NPA_DEBUG) console.error(err.stack);
    failed++;
  }
}

async function main() {
  console.log('\nnpa test suite\n');

  console.log('Unit tests:');
  for (const f of UNIT_TESTS) runFileSync(f);

  console.log('\nE2E tests:');
  for (const f of E2E_TESTS) await runFileAsync(f);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
