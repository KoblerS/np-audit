'use strict';

const assert = require('assert');
const { resolveVersion, extractSemver } = require('../../src/core/scanner');

// ─── extractSemver ────────────────────────────────────────────────────────────
assert.strictEqual(extractSemver('^5.1.0'),          '5.1.0', 'caret full version');
assert.strictEqual(extractSemver('~2.3.1'),          '2.3.1', 'tilde full version');
assert.strictEqual(extractSemver('4.22.1 || ^5'),    '4.22.1', 'or-range picks first');
assert.strictEqual(extractSemver('^2'),              '2',     'caret major-only');
assert.strictEqual(extractSemver('>=8.3'),           '8.3',   'gte minor range');
assert.strictEqual(extractSemver('*'),               null,    'wildcard returns null');
assert.strictEqual(extractSemver('latest'),          null,    'tag returns null');

// ─── resolveVersion ──────────────────────────────────────────────────────────
const meta = {
  'dist-tags': { latest: '3.2.1' },
  versions: {
    '1.0.0': {},
    '2.4.1': {},
    '3.2.1': {},
  },
};

// Exact full match wins
assert.strictEqual(resolveVersion('2.4.1', meta), '2.4.1', 'exact full version found');

// Partial version not in versions → falls back to latest
assert.strictEqual(resolveVersion('2',   meta), '3.2.1', 'major-only falls back to latest');
assert.strictEqual(resolveVersion('8.3', meta), '3.2.1', 'partial minor falls back to latest');

// Non-existent full version → falls back to latest
assert.strictEqual(resolveVersion('2.0.0', meta), '3.2.1', 'missing full version falls back to latest');

// No dist-tags at all → null
assert.strictEqual(resolveVersion('2', { versions: { '2.1.0': {} } }), null, 'no dist-tags returns null');

// dist-tags.latest not in versions → null
assert.strictEqual(
  resolveVersion('99', { 'dist-tags': { latest: '99.0.0' }, versions: {} }),
  null,
  'latest not in versions returns null'
);

// No versions map → null
assert.strictEqual(resolveVersion('1.0.0', { 'dist-tags': { latest: '1.0.0' } }), null, 'no versions map returns null');

console.log('resolveVersion.test.js: all tests passed');
