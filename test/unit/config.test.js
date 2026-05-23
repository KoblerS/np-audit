'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { loadConfig, setGlobalConfig, DEFAULT_CONFIG, getGlobalConfigPath } = require('../../src/utils/config');

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npa-config-test-'));
  try { fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ─── loadConfig defaults ─────────────────────────────────────────────────────
withTmpDir(dir => {
  const config = loadConfig(dir);
  assert.strictEqual(config.blockScore, DEFAULT_CONFIG.blockScore, 'default blockScore');
  assert.strictEqual(config.warnScore,  DEFAULT_CONFIG.warnScore,  'default warnScore');
  assert.strictEqual(config.registry,   DEFAULT_CONFIG.registry,   'default registry');
  assert.deepStrictEqual(config.skipScopes,   [], 'default skipScopes');
  assert.deepStrictEqual(config.skipPackages, [], 'default skipPackages');
});

// ─── local config overrides defaults ─────────────────────────────────────────
withTmpDir(dir => {
  fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({
    blockScore: 5,
    skipPackages: ['lodash'],
  }));
  const config = loadConfig(dir);
  assert.strictEqual(config.blockScore, 5, 'local blockScore overrides default');
  assert.deepStrictEqual(config.skipPackages, ['lodash'], 'local skipPackages override');
  assert.strictEqual(config.warnScore, DEFAULT_CONFIG.warnScore, 'unset key still defaults');
});

// ─── corrupt local config falls back to defaults ─────────────────────────────
withTmpDir(dir => {
  fs.writeFileSync(path.join(dir, '.npmauditor.json'), '{ invalid json }');
  const config = loadConfig(dir);
  assert.strictEqual(config.blockScore, DEFAULT_CONFIG.blockScore, 'corrupt config uses defaults');
});

// ─── setGlobalConfig writes and reads back ───────────────────────────────────
withTmpDir(() => {
  // Temporarily redirect global config path by patching process.env is not feasible without
  // dependency injection — test setGlobalConfig by writing to a temp path instead
  // We test the coerce behavior through loadConfig with a local file

  withTmpDir(dir => {
    // Write a local config and verify numeric coercion
    fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({ blockScore: '9' }));
    const config = loadConfig(dir);
    assert.strictEqual(typeof config.blockScore, 'number', 'blockScore coerced to number');
    assert.strictEqual(config.blockScore, 9);
  });
});

// ─── Unknown keys are ignored ─────────────────────────────────────────────────
withTmpDir(dir => {
  fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({
    unknownKey: 'foo',
    blockScore: 6,
  }));
  const config = loadConfig(dir);
  assert.ok(!('unknownKey' in config), 'unknown keys stripped');
  assert.strictEqual(config.blockScore, 6);
});

// ─── Array coercion for skipScopes ───────────────────────────────────────────
withTmpDir(dir => {
  fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({
    skipScopes: '@types',  // string instead of array
  }));
  const config = loadConfig(dir);
  assert.deepStrictEqual(config.skipScopes, ['@types'], 'string coerced to array');
});

// ─── setGlobalConfig rejects invalid key ─────────────────────────────────────
assert.throws(
  () => setGlobalConfig('nonExistentKey', '1'),
  /Unknown config key/,
  'setGlobalConfig throws on unknown key'
);

// ─── disabledMarshallers defaults to empty array ─────────────────────────────
withTmpDir(dir => {
  const config = loadConfig(dir);
  assert.deepStrictEqual(config.disabledMarshallers, [], 'default disabledMarshallers is empty array');
});

// ─── disabledMarshallers coerces string to array ─────────────────────────────
withTmpDir(dir => {
  fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({
    disabledMarshallers: 'process-env',
  }));
  const config = loadConfig(dir);
  assert.deepStrictEqual(config.disabledMarshallers, ['process-env'], 'string coerced to array');
});

// ─── disabledMarshallers accepts array ───────────────────────────────────────
withTmpDir(dir => {
  fs.writeFileSync(path.join(dir, '.npmauditor.json'), JSON.stringify({
    disabledMarshallers: ['process-env', 'network-call'],
  }));
  const config = loadConfig(dir);
  assert.deepStrictEqual(config.disabledMarshallers, ['process-env', 'network-call'], 'array preserved');
});

console.log('  config.test.js: all tests passed');
