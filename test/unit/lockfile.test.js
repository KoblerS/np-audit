'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { parseLockfile, nameFromKey } = require('../../src/lockfile');

// ─── nameFromKey ─────────────────────────────────────────────────────────────
assert.strictEqual(nameFromKey('node_modules/express'),         'express',        'simple package');
assert.strictEqual(nameFromKey('node_modules/@babel/core'),     '@babel/core',    'scoped package');
assert.strictEqual(nameFromKey('foo/node_modules/bar'),         'bar',            'nested package');
assert.strictEqual(nameFromKey('node_modules/@scope/pkg/node_modules/deep'), 'deep', 'deeply nested');
assert.strictEqual(nameFromKey(''),                             null,              'empty key');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npa-test-'));
  try { fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function writeLockfile(dir, data) {
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(data, null, 2));
}

// ─── v2 lockfile ─────────────────────────────────────────────────────────────
withTmpDir(dir => {
  writeLockfile(dir, {
    name: 'myapp',
    lockfileVersion: 2,
    packages: {
      '': { name: 'myapp', version: '1.0.0', dependencies: { express: '^4.18.0' } },
      'node_modules/express': {
        version: '4.18.2',
        resolved: 'https://registry.npmjs.org/express/-/express-4.18.2.tgz',
        integrity: 'sha512-fake',
        hasInstallScript: false,
        dev: false,
      },
      'node_modules/@babel/core': {
        version: '7.0.0',
        resolved: 'https://registry.npmjs.org/@babel/core/-/@babel/core-7.0.0.tgz',
        integrity: 'sha512-fake2',
        hasInstallScript: true,
        dev: true,
      },
    },
  });

  const { lockfileVersion, packages } = parseLockfile(dir);
  assert.strictEqual(lockfileVersion, 2, 'v2 version');
  assert.strictEqual(packages.length, 2, 'root excluded');

  const express = packages.find(p => p.name === 'express');
  assert.ok(express, 'express found');
  assert.strictEqual(express.version, '4.18.2');
  assert.strictEqual(express.hasInstallScript, false);
  assert.strictEqual(express.dev, false);

  const babel = packages.find(p => p.name === '@babel/core');
  assert.ok(babel, '@babel/core found');
  assert.strictEqual(babel.hasInstallScript, true);
  assert.strictEqual(babel.dev, true);
});

// ─── v1 lockfile ─────────────────────────────────────────────────────────────
withTmpDir(dir => {
  writeLockfile(dir, {
    name: 'myapp',
    lockfileVersion: 1,
    dependencies: {
      lodash: {
        version: '4.17.21',
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
        integrity: 'sha512-v2kDE',
        dev: false,
        dependencies: {
          'inner-dep': {
            version: '1.0.0',
            resolved: 'https://registry.npmjs.org/inner-dep/-/inner-dep-1.0.0.tgz',
            integrity: 'sha512-inner',
          },
        },
      },
    },
  });

  const { lockfileVersion, packages } = parseLockfile(dir);
  assert.strictEqual(lockfileVersion, 1, 'v1 version');
  assert.strictEqual(packages.length, 2, 'flattened including nested');

  const lodash = packages.find(p => p.name === 'lodash');
  assert.ok(lodash, 'lodash found');
  assert.strictEqual(lodash.hasInstallScript, false, 'v1 hasInstallScript always false');

  const inner = packages.find(p => p.name === 'inner-dep');
  assert.ok(inner, 'nested dep flattened');
});

// ─── Missing lockfile ─────────────────────────────────────────────────────────
withTmpDir(dir => {
  assert.throws(() => parseLockfile(dir), /package-lock\.json not found/, 'throws on missing file');
});

// ─── Skip link packages ───────────────────────────────────────────────────────
withTmpDir(dir => {
  writeLockfile(dir, {
    lockfileVersion: 2,
    packages: {
      '': { name: 'myapp' },
      'node_modules/linked': { version: '1.0.0', link: true },
      'node_modules/real': { version: '2.0.0', resolved: 'https://r.js/real.tgz' },
    },
  });

  const { packages } = parseLockfile(dir);
  assert.ok(!packages.find(p => p.name === 'linked'), 'link packages excluded');
  assert.ok(packages.find(p => p.name === 'real'), 'real packages included');
});

// ─── Bundle packages ──────────────────────────────────────────────────────────
withTmpDir(dir => {
  writeLockfile(dir, {
    lockfileVersion: 2,
    packages: {
      '': { name: 'myapp' },
      'node_modules/bundled': { version: '1.0.0', inBundle: true, resolved: 'https://r.js/b.tgz' },
    },
  });

  const { packages } = parseLockfile(dir);
  const bundled = packages.find(p => p.name === 'bundled');
  assert.ok(bundled, 'bundled packages still included in list');
  assert.ok(bundled.inBundle, 'inBundle flag set');
});

console.log('  lockfile.test.js: all tests passed');
