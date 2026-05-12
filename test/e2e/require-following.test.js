'use strict';

/**
 * E2E tests for transitive require/import following.
 *
 * The original tool only analyzed the file named in the install command.
 * A malicious package could ship a harmless entry script that delegates to
 * a helper file containing the actual payload — those helpers were invisible.
 * These tests build that exact scenario and assert that the payload is now
 * caught wherever it sits in the require graph.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npa-walk-e2e-'));
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
      version:   pkg.version,
      resolved:  `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`,
      integrity: '',
      dev:       pkg.dev || false,
    };
  }
  return { name: 'test-project', lockfileVersion: 1, dependencies: deps };
}

const OBFUSCATED =
  "var _0xa=_0xb(_0xc),_0xd=_0xe(_0xf),_0x10=_0x11(_0x12);\n" +
  "eval(_0xa[0]);";

// ─── Test 1: payload in a directly-required helper file ──────────────────────
//
// install.js  →  require('./lib/helper')   →  payload here
//
// Previously this was a free pass: install.js was clean, lib/helper.js was
// never read.
{
  const { dir, cleanup } = withTmpDirSync();
  createFakeModule(
    dir, 'hop1',
    { name: 'hop1', version: '1.0.0', scripts: { postinstall: 'node install.js' } },
    {
      'install.js': "require('./lib/helper');",
      'lib/helper.js': OBFUSCATED,
    }
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'hop1', version: '1.0.0' }]))
  );
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 1,
    `Test 1: payload in directly-required file must be detected. stdout: ${result.stdout}`,
  );
  console.log('  Test 1 passed: single require hop is followed');
}

// ─── Test 2: payload three hops deep ─────────────────────────────────────────
//
// install.js → require('./a') → require('./b') → require('./lib/deep/c')
//                                                  ↑ payload
{
  const { dir, cleanup } = withTmpDirSync();
  createFakeModule(
    dir, 'hop3',
    { name: 'hop3', version: '1.0.0', scripts: { postinstall: 'node install.js' } },
    {
      'install.js':       "require('./a');",
      'a.js':             "require('./b');",
      'b.js':             "require('./lib/deep/c');",
      'lib/deep/c.js':    OBFUSCATED,
    }
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'hop3', version: '1.0.0' }]))
  );
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 1,
    `Test 2: payload 3 hops deep must be detected. stdout: ${result.stdout}`,
  );
  console.log('  Test 2 passed: deep require chain is followed');
}

// ─── Test 3: ESM import chain ────────────────────────────────────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  createFakeModule(
    dir, 'esm-hop',
    { name: 'esm-hop', version: '1.0.0', scripts: { postinstall: 'node install.mjs' } },
    {
      'install.mjs': "import './helper.mjs';",
      'helper.mjs': OBFUSCATED,
    }
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'esm-hop', version: '1.0.0' }]))
  );
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 1,
    `Test 3: ESM import chain must be followed. stdout: ${result.stdout}`,
  );
  console.log('  Test 3 passed: ESM import chain is followed');
}

// ─── Test 4: dynamic require(variable) is flagged ───────────────────────────
//
// Even when we can't resolve the target statically, a dynamic require from a
// postinstall script is suspicious enough to warrant a finding.
{
  const { dir, cleanup } = withTmpDirSync();
  createFakeModule(
    dir, 'dyn-pkg',
    { name: 'dyn-pkg', version: '1.0.0', scripts: { postinstall: 'node install.js' } },
    {
      'install.js': "const m = process.env.WHICH || './a'; require(m);",
    }
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'dyn-pkg', version: '1.0.0' }]))
  );
  fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({ blockScore: 4, warnScore: 3 }));
  const result = runCLI(['scan', '--json'], dir);
  cleanup();
  const jsonStart = result.stdout.indexOf('{');
  const parsed = JSON.parse(result.stdout.slice(jsonStart));
  const dynFinding = parsed.packages[0].findings.find(f => f.name === 'dynamic-require');
  assert.ok(dynFinding, `Test 4: dynamic-require finding recorded. findings: ${JSON.stringify(parsed.packages[0].findings)}`);
  console.log('  Test 4 passed: dynamic require is recorded as a finding');
}

// ─── Test 5: external (package-name) requires are NOT followed ──────────────
//
// require('lodash') must not be followed into ../node_modules/lodash — those
// are separate dependencies and will be scanned independently. We only walk
// *internal* (./ ../ /) requires.
{
  const { dir, cleanup } = withTmpDirSync();
  createFakeModule(
    dir, 'ext-pkg',
    { name: 'ext-pkg', version: '1.0.0', scripts: { postinstall: 'node install.js' } },
    {
      'install.js': "const _ = require('lodash'); console.log('ok');",
    }
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'ext-pkg', version: '1.0.0' }]))
  );
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 0,
    `Test 5: requiring an external package must not block. stdout: ${result.stdout}`,
  );
  console.log('  Test 5 passed: external requires are not walked');
}

// ─── Test 6: cycle in require graph terminates cleanly ──────────────────────
{
  const { dir, cleanup } = withTmpDirSync();
  createFakeModule(
    dir, 'cycle-pkg',
    { name: 'cycle-pkg', version: '1.0.0', scripts: { postinstall: 'node a.js' } },
    {
      'a.js':       "require('./b'); console.log('a');",
      'b.js':       "require('./a'); console.log('b');",
    }
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'cycle-pkg', version: '1.0.0' }]))
  );
  const result = runCLI(['scan'], dir, { });
  cleanup();
  // Cycle alone shouldn't block — just shouldn't hang or crash.
  assert.strictEqual(
    result.status, 0,
    `Test 6: clean cycle must not block. stdout: ${result.stdout} stderr: ${result.stderr}`,
  );
  console.log('  Test 6 passed: cycle terminates without hanging');
}

// ─── Test 7: payload appears in a JSON finding tagged with the file path ────
//
// When multiple files contribute findings, each finding's detail is prefixed
// with [filename] so the user can see exactly which file in the require chain
// is responsible.
{
  const { dir, cleanup } = withTmpDirSync();
  createFakeModule(
    dir, 'tagged-pkg',
    { name: 'tagged-pkg', version: '1.0.0', scripts: { postinstall: 'node install.js' } },
    {
      'install.js': "require('./payload.js');",
      'payload.js': OBFUSCATED,
    }
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'tagged-pkg', version: '1.0.0' }]))
  );
  const result = runCLI(['scan', '--json'], dir);
  cleanup();
  const jsonStart = result.stdout.indexOf('{');
  const parsed = JSON.parse(result.stdout.slice(jsonStart));
  const finding = parsed.packages[0].findings.find(f => f.name === 'obfuscator.io');
  assert.ok(finding, 'Test 7: obfuscator.io finding present');
  assert.ok(
    finding.detail.includes('payload.js'),
    `Test 7: finding detail mentions originating file. Got: ${finding.detail}`,
  );
  console.log('  Test 7 passed: findings tagged with originating file');
}

console.log('  require-following.test.js: all tests passed');

module.exports = Promise.resolve();
