'use strict';

/**
 * E2E tests for own-project lifecycle scanning.
 *
 * `npa` now scans the current project's own package.json lifecycle scripts
 * by default. This catches PRs / supply-chain attacks that target the
 * repository itself (e.g. injecting a postinstall into the project that
 * runs during developer / CI installs).
 *
 * The behaviour can be opted out of with `scanSelf: false` in
 * .npmauditor.json — that escape hatch is also covered here.
 */

const assert        = require('assert');
const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { spawnSync } = require('child_process');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npa-self-e2e-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const OBFUSCATED =
  "var _0xa=_0xb(_0xc),_0xd=_0xe(_0xf),_0x10=_0x11(_0x12);\n" +
  "eval(_0xa[0]);";

// ─── Test 1: payload in own postinstall is now caught by default ─────────────
{
  const { dir, cleanup } = withTmpDirSync();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'self-default',
    version: '1.0.0',
    scripts: { postinstall: 'node setup.js' },
  }));
  fs.writeFileSync(path.join(dir, 'setup.js'), OBFUSCATED);
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 1,
    `Test 1: own-project payload should block by default. stdout: ${result.stdout}`,
  );
  assert.ok(
    result.stdout.includes('self-default'),
    `Test 1: own package shows up in output. stdout: ${result.stdout}`,
  );
  console.log('  Test 1 passed: own-project payload blocks by default');
}

// ─── Test 2: clean own package.json doesn't false-positive ──────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'self-clean',
    version: '1.0.0',
    scripts: { postinstall: 'node setup.js' },
  }));
  fs.writeFileSync(path.join(dir, 'setup.js'), "console.log('hello from clean postinstall');");
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 0,
    `Test 2: clean own scripts must not block. stdout: ${result.stdout}`,
  );
  console.log('  Test 2 passed: clean own-project scripts pass');
}

// ─── Test 3: opt-out via config disables own-project scanning ───────────────
{
  const { dir, cleanup } = withTmpDirSync();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'self-optout',
    version: '1.0.0',
    scripts: { postinstall: 'node setup.js' },
  }));
  fs.writeFileSync(path.join(dir, 'setup.js'), OBFUSCATED);
  fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({ scanSelf: false }));
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 0,
    `Test 3: scanSelf:false in config must disable own-project scan. stdout: ${result.stdout}`,
  );
  console.log('  Test 3 passed: scanSelf:false opts out of own-project scan');
}

// ─── Test 4: own-project require-chain is followed ──────────────────────────
//
// The require walker also applies to own-project scripts: a project that does
// `node setup.js` where setup.js does `require('./lib/helper')` must have the
// helper scanned too.
{
  const { dir, cleanup } = withTmpDirSync();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'self-chain',
    version: '1.0.0',
    scripts: { postinstall: 'node setup.js' },
  }));
  fs.writeFileSync(path.join(dir, 'setup.js'), "require('./lib/helper');");
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib/helper.js'), OBFUSCATED);
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 1,
    `Test 4: own-project require chain must be followed. stdout: ${result.stdout}`,
  );
  console.log('  Test 4 passed: own-project require chain is followed');
}

// ─── Test 5: own project without lifecycle scripts is a no-op ──────────────
{
  const { dir, cleanup } = withTmpDirSync();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'self-no-scripts',
    version: '1.0.0',
  }));
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 0,
    `Test 5: project without lifecycle scripts should pass. stdout: ${result.stdout}`,
  );
  console.log('  Test 5 passed: own project without lifecycle scripts is a no-op');
}

console.log('  scan-self.test.js: all tests passed');

module.exports = Promise.resolve();
