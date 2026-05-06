'use strict';

/**
 * E2E tests for --review mode and --no-dev flag.
 * Uses pre-populated node_modules to avoid network calls.
 */

const assert        = require('assert');
const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '../../bin/npa.js');

function withTmpDirSync() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npa-review-e2e-'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return { dir, cleanup };
}

function createFakeModule(dir, name, pkgJson, scriptFiles = {}) {
  const pkgDir = path.join(dir, 'node_modules', name);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2));
  for (const [filename, content] of Object.entries(scriptFiles)) {
    const filePath = path.join(pkgDir, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function buildV1Lockfile(pkgs) {
  const deps = {};
  for (const pkg of pkgs) {
    deps[pkg.name] = {
      version:  pkg.version,
      resolved: `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`,
      integrity: '',
      dev: pkg.dev || false,
    };
  }
  return { name: 'test-project', lockfileVersion: 1, dependencies: deps };
}

// ─── Test: blocked package exits 1 ──────────────────────────────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  const obfuscatedScript = "var _0xabc = _0xdef(_0x123);\neval(_0xabc);";
  createFakeModule(
    dir, 'review-test',
    { name: 'review-test', version: '1.0.0', scripts: { postinstall: 'node run.js' } },
    { 'run.js': obfuscatedScript }
  );
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'review-test', version: '1.0.0' }])
  ));
  const result = spawnSync(process.execPath, [CLI, 'scan', '--json'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    input: '', timeout: 20000,
  });
  cleanup();
  assert.strictEqual(result.status, 1, `review test 1: blocked exits 1. stderr: ${result.stderr}`);
  const jsonStart = result.stdout.indexOf('{');
  if (jsonStart >= 0) {
    const parsed = JSON.parse(result.stdout.slice(jsonStart));
    assert.strictEqual(parsed.summary.blocked, 1, 'one blocked package');
  }
  console.log('  Test 1 passed: blocked package exits 1');
}

// ─── Test: clean script → OK verdict ─────────────────────────────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  createFakeModule(
    dir, 'review-clean',
    { name: 'review-clean', version: '2.0.0', scripts: { postinstall: 'node post.js' } },
    { 'post.js': 'console.log("postinstall running");' }
  );
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'review-clean', version: '2.0.0' }])
  ));
  const result = spawnSync(process.execPath, [CLI, 'scan', '--json'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }, timeout: 20000,
  });
  cleanup();
  assert.strictEqual(result.status, 0, `review test 2: clean exits 0. stderr: ${result.stderr}`);
  const jsonStart = result.stdout.indexOf('{');
  if (jsonStart >= 0) {
    const parsed = JSON.parse(result.stdout.slice(jsonStart));
    const pkg = parsed.packages.find(p => p.name === 'review-clean');
    assert.ok(pkg, 'package in output');
    assert.ok(['OK', 'WARN'].includes(pkg.verdict), `verdict OK or WARN: ${pkg.verdict}`);
  }
  console.log('  Test 2 passed: clean script is OK or WARN');
}

// ─── Test: --no-dev skips dev dependencies ────────────────────────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  const devScript = "var _0xabc = _0xdef(_0x123);\neval(_0xabc);";
  createFakeModule(
    dir, 'dev-obfuscated',
    { name: 'dev-obfuscated', version: '1.0.0', scripts: { postinstall: 'node s.js' } },
    { 's.js': devScript }
  );
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'dev-obfuscated', version: '1.0.0', dev: true }])
  ));

  // Without --no-dev should block
  const result1 = spawnSync(process.execPath, [CLI, 'scan'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }, timeout: 20000,
  });
  assert.strictEqual(result1.status, 1, `review test 3a: dev obfuscated blocks. stderr: ${result1.stderr}`);

  // With --no-dev should pass
  const result2 = spawnSync(process.execPath, [CLI, 'scan', '--no-dev'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }, timeout: 20000,
  });
  cleanup();
  assert.strictEqual(result2.status, 0, `review test 3b: --no-dev skips dev. stderr: ${result2.stderr}`);
  console.log('  Test 3 passed: --no-dev skips dev dependencies');
}

// ─── Test: preinstall script is also checked ─────────────────────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  const preScript = "var _0xabc = _0xdef(_0x123);\neval(_0xabc);";
  createFakeModule(
    dir, 'pre-bad',
    { name: 'pre-bad', version: '1.0.0', scripts: { preinstall: 'node pre.js' } },
    { 'pre.js': preScript }
  );
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'pre-bad', version: '1.0.0' }])
  ));
  const result = spawnSync(process.execPath, [CLI, 'scan'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }, timeout: 20000,
  });
  cleanup();
  assert.strictEqual(result.status, 1, `review test 4: preinstall obfuscation blocked. stderr: ${result.stderr}`);
  console.log('  Test 4 passed: preinstall obfuscation is blocked');
}

console.log('  review.test.js: all tests passed');

module.exports = Promise.resolve();
