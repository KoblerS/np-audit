'use strict';

/**
 * E2E tests for npa config commands.
 */

const assert        = require('assert');
const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '../../bin/npa.js');

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npa-config-e2e-'));
  try { return fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function runCLI(args, cwd, env = {}) {
  const homeEnv = env.HOME
    ? { HOME: env.HOME, USERPROFILE: env.HOME }
    : {};
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...homeEnv, ...env },
  });
}

// ─── Test: config get shows all keys ─────────────────────────────────────────
withTmpDir(dir => {
  const result = runCLI(['config', 'get'], dir);
  assert.strictEqual(result.status, 0, 'config get exits 0');
  assert.ok(result.stdout.includes('blockScore'), 'config get shows blockScore');
  assert.ok(result.stdout.includes('warnScore'),  'config get shows warnScore');
  assert.ok(result.stdout.includes('registry'),   'config get shows registry');
});

// ─── Test: config set writes to ~/.npmauditor.json ───────────────────────────
withTmpDir(homeDir => {
  const globalConfigPath = path.join(homeDir, '.npmauditor.json');

  const result = runCLI(['config', 'set', 'blockScore', '6'], homeDir, { HOME: homeDir });
  assert.strictEqual(result.status, 0, `config set exits 0. stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('6'), 'output mentions new value');

  assert.ok(fs.existsSync(globalConfigPath), 'config file created');
  const written = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
  assert.strictEqual(written.blockScore, 6, 'blockScore written correctly');
});

// ─── Test: config set then get reflects new value ────────────────────────────
withTmpDir(homeDir => {
  runCLI(['config', 'set', 'warnScore', '3'], homeDir, { HOME: homeDir });
  const result = runCLI(['config', 'get'], homeDir, { HOME: homeDir });
  assert.ok(result.stdout.includes('3'), 'config get shows updated warnScore');
});

// ─── Test: config set with invalid key exits non-zero ────────────────────────
withTmpDir(homeDir => {
  const result = runCLI(['config', 'set', 'nonExistentKey', 'foo'], homeDir, { HOME: homeDir });
  assert.notStrictEqual(result.status, 0, 'invalid key exits non-zero');
  assert.ok(result.stderr.includes('Unknown config key'), 'error message shown');
});

// ─── Test: local .npmauditor.json overrides global ───────────────────────────
withTmpDir(homeDir => {
  withTmpDir(projectDir => {
    // Write global config
    fs.writeFileSync(
      path.join(homeDir, '.npmauditor.json'),
      JSON.stringify({ blockScore: 8 })
    );
    // Write local config overriding it
    fs.writeFileSync(
      path.join(projectDir, '.npmauditor.json'),
      JSON.stringify({ blockScore: 3 })
    );

    const result = runCLI(['config', 'get'], projectDir, { HOME: homeDir });
    // The output shows the merged config — local should win
    // We look for "3" in the blockScore line
    const lines = result.stdout.split('\n');
    const blockLine = lines.find(l => l.includes('blockScore'));
    assert.ok(blockLine && blockLine.includes('3'), `local config wins. blockScore line: ${blockLine}`);
  });
});

console.log('  config.test.js (e2e): all tests passed');
