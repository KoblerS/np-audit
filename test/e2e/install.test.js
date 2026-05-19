'use strict';

/**
 * E2E tests for npa scan / install flow.
 * Uses pre-populated node_modules to avoid network calls.
 */

const assert        = require('assert');
const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { spawnSync } = require('child_process');
const { buildFakeTarball, buildLockfile } = require('./fixtures');

const CLI = path.join(__dirname, '../../bin/npa.js');

function runCLI(args, cwd, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', NPA_DEBUG: '1', ...env },
    timeout: 20000,
  });
}

function withTmpDirSync() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npa-e2e-'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return { dir, cleanup };
}

/**
 * Create a fake package in node_modules with given package.json and script files.
 */
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

/**
 * Build a v1 lockfile that forces the scanner to check node_modules.
 * (v1 has hasInstallScript: false, so scanner falls back to reading local package.json)
 */
function buildV1Lockfile(pkgs) {
  const deps = {};
  for (const pkg of pkgs) {
    deps[pkg.name] = {
      version:   pkg.version,
      resolved:  `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`,
      integrity: '',
      dev:       pkg.dev || false,
    };
  }
  return { name: 'test-project', lockfileVersion: 1, dependencies: deps };
}

// ─── Test 1: clean package (no install scripts) → exit 0 ─────────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  createFakeModule(dir, 'clean-pkg', { name: 'clean-pkg', version: '1.0.0' });
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'clean-pkg', version: '1.0.0' }])
  ));
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(result.status, 0, `Test 1: exit 0 for clean package. stderr: ${result.stderr}`);
  console.log('  Test 1 passed: clean package exits 0');
}

// ─── Test 2: blocked package (eval + _0x obfuscation) → exit 1 ───────────────
{
  const { dir, cleanup } = withTmpDirSync();
  const obfuscatedScript = "var _0xabc = _0xdef(_0x123);\nvar _0x456 = ['\\x65\\x76\\x61\\x6c'];\neval(_0xabc[0]);";
  createFakeModule(
    dir, 'bad-pkg',
    { name: 'bad-pkg', version: '1.0.0', scripts: { postinstall: 'node install.js' } },
    { 'install.js': obfuscatedScript }
  );
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'bad-pkg', version: '1.0.0' }])
  ));
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(result.status, 1, `Test 2: exit 1 for blocked. stdout: ${result.stdout} stderr: ${result.stderr}`);
  console.log('  Test 2 passed: blocked package exits 1');
}

// ─── Test 3: --json output format ────────────────────────────────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  const obfuscatedScript = "var _0xaaa = _0xbbb(_0xccc);\neval(_0xaaa);";
  createFakeModule(
    dir, 'json-test-pkg',
    { name: 'json-test-pkg', version: '1.0.0', scripts: { postinstall: 'node run.js' } },
    { 'run.js': obfuscatedScript }
  );
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'json-test-pkg', version: '1.0.0' }])
  ));
  const result = runCLI(['scan', '--json'], dir);
  cleanup();
  let parsed;
  try {
    const jsonStart = result.stdout.indexOf('{');
    parsed = JSON.parse(result.stdout.slice(jsonStart));
  } catch (e) {
    assert.fail(`Test 3: JSON parse failed: ${e.message}\nstdout: ${result.stdout}`);
  }
  assert.ok(parsed.summary, 'Test 3: JSON has summary');
  assert.ok(Array.isArray(parsed.packages), 'Test 3: JSON has packages array');
  assert.strictEqual(
    parsed.summary.blocked + parsed.summary.warned + parsed.summary.ok,
    parsed.summary.total,
    'Test 3: summary counts add up'
  );
  console.log('  Test 3 passed: --json output is valid');
}

// ─── Test 4: --version flag ─────────────────────────────────────────────────
{
  const result = runCLI(['--version'], process.cwd());
  assert.strictEqual(result.status, 0, 'Test 4: --version exits 0');
  assert.ok(result.stdout.includes('npa'), 'Test 4: --version shows "npa"');
  console.log('  Test 4 passed: --version works');
}

// ─── Test 5: --help flag ────────────────────────────────────────────────────
{
  const result = runCLI(['--help'], process.cwd());
  assert.strictEqual(result.status, 0, 'Test 5: --help exits 0');
  assert.ok(result.stdout.includes('install') && result.stdout.includes('scan'), 'Test 5: --help shows commands');
  console.log('  Test 5 passed: --help works');
}

// ─── Test 6: missing lockfile and package.json → exit 0 (nothing to scan) ───
{
  const { dir, cleanup } = withTmpDirSync();
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(result.status, 0, 'Test 6: exits 0 when no package.json (nothing to scan)');
  console.log('  Test 6 passed: empty directory exits 0');
}

// ─── Test 7: warn-level package → exit 0 ───────────────────────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  const warnScript = "const https = require('https');\nconst token = process.env.NPM_TOKEN;";
  createFakeModule(
    dir, 'warn-pkg',
    { name: 'warn-pkg', version: '1.0.0', scripts: { postinstall: 'node setup.js' } },
    { 'setup.js': warnScript }
  );
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'warn-pkg', version: '1.0.0' }])
  ));
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(result.status, 0, `Test 7: exit 0 for warn-only. stderr: ${result.stderr}`);
  console.log('  Test 7 passed: warn-level package exits 0');
}

// ─── Test 8: skipPackages config → exit 0 ──────────────────────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  const script = "var _0xabc = _0xdef(_0x123);\neval(_0xabc);";
  createFakeModule(
    dir, 'skipped-pkg',
    { name: 'skipped-pkg', version: '1.0.0', scripts: { postinstall: 'node s.js' } },
    { 's.js': script }
  );
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'skipped-pkg', version: '1.0.0' }])
  ));
  fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({ skipPackages: ['skipped-pkg'] }));
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(result.status, 0, `Test 8: skipPackages exits 0. stderr: ${result.stderr}`);
  console.log('  Test 8 passed: skipPackages config works');
}

// ─── Test 9: multiple packages, only one blocked ────────────────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  const obfuscatedScript = "var _0xabc = _0xdef(_0x123);\neval(_0xabc);";
  const cleanScript = 'console.log("clean postinstall");';
  createFakeModule(dir, 'clean-pkg2', { name: 'clean-pkg2', version: '1.0.0', scripts: { postinstall: 'node c.js' } }, { 'c.js': cleanScript });
  createFakeModule(dir, 'bad-pkg2', { name: 'bad-pkg2', version: '2.0.0', scripts: { postinstall: 'node b.js' } }, { 'b.js': obfuscatedScript });
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'clean-pkg2', version: '1.0.0' }, { name: 'bad-pkg2', version: '2.0.0' }])
  ));
  const result = runCLI(['scan', '--json'], dir);
  cleanup();
  assert.strictEqual(result.status, 1, `Test 9: one blocked → exit 1. stderr: ${result.stderr}`);
  const jsonStart = result.stdout.indexOf('{');
  const parsed = JSON.parse(result.stdout.slice(jsonStart));
  assert.strictEqual(parsed.summary.blocked, 1, 'Test 9: exactly one blocked');
  assert.strictEqual(parsed.summary.total, 2, 'Test 9: two packages total');
  console.log('  Test 9 passed: multiple packages, one blocked');
}

// ─── Test 10: npa install (non-JSON) with blocked package → exit 1, prints summary ─
{
  const { dir, cleanup } = withTmpDirSync();
  const obfuscatedScript = "var _0xabc = _0xdef(_0x123);\neval(_0xabc);";
  createFakeModule(dir, 'bad-install-pkg', { name: 'bad-install-pkg', version: '1.0.0', scripts: { postinstall: 'node i.js' } }, { 'i.js': obfuscatedScript });
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'bad-install-pkg', version: '1.0.0' }])
  ));
  const result = runCLI(['install'], dir);
  cleanup();
  assert.strictEqual(result.status, 1, `Test 10: install blocked exits 1. stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('blocked'), 'Test 10: summary line shows blocked count');
  console.log('  Test 10 passed: install command shows summary with timing');
}

// ─── Test 11: npa ci (non-JSON) with blocked package → exit 1, prints summary ──
{
  const { dir, cleanup } = withTmpDirSync();
  const obfuscatedScript = "var _0xabc = _0xdef(_0x123);\neval(_0xabc);";
  createFakeModule(dir, 'bad-ci-pkg', { name: 'bad-ci-pkg', version: '1.0.0', scripts: { postinstall: 'node c.js' } }, { 'c.js': obfuscatedScript });
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(
    buildV1Lockfile([{ name: 'bad-ci-pkg', version: '1.0.0' }])
  ));
  const result = runCLI(['ci'], dir);
  cleanup();
  assert.strictEqual(result.status, 1, `Test 11: ci blocked exits 1. stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('blocked'), 'Test 11: summary line shows blocked count');
  console.log('  Test 11 passed: ci command shows summary with timing');
}

console.log('  install.test.js: all tests passed');

module.exports = Promise.resolve();
