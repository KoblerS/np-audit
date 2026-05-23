'use strict';

const assert = require('assert');
const { getStaticMarshallers, getPackageMarshallers, getAllMarshallers } = require('../../src/marshallers');

// ─── getStaticMarshallers returns all when no disabled list ──────────────────
const all = getStaticMarshallers();
assert.ok(all.length > 0, 'has static marshallers');
assert.ok(all.some(m => m.name === 'process-env'), 'includes process-env');
assert.ok(all.some(m => m.name === 'network-call'), 'includes network-call');

// ─── getStaticMarshallers filters disabled marshallers ───────────────────────
const filtered = getStaticMarshallers(['process-env', 'network-call']);
assert.ok(!filtered.some(m => m.name === 'process-env'), 'process-env excluded');
assert.ok(!filtered.some(m => m.name === 'network-call'), 'network-call excluded');
assert.strictEqual(filtered.length, all.length - 2, 'exactly 2 removed');

// ─── getStaticMarshallers with empty array returns all ───────────────────────
const allAgain = getStaticMarshallers([]);
assert.strictEqual(allAgain.length, all.length, 'empty array returns all');

// ─── getPackageMarshallers returns CVE marshaller ────────────────────────────
const pkgAll = getPackageMarshallers();
assert.ok(pkgAll.some(m => m.name === 'known-vulnerability'), 'includes CVE marshaller');

// ─── getPackageMarshallers filters disabled ──────────────────────────────────
const pkgFiltered = getPackageMarshallers(['known-vulnerability']);
assert.strictEqual(pkgFiltered.length, 0, 'CVE marshaller excluded');

// ─── getAllMarshallers returns both types unfiltered ──────────────────────────
const { static: s, package: p } = getAllMarshallers();
assert.ok(s.length > 0, 'has static marshallers');
assert.ok(p.length > 0, 'has package marshallers');
assert.ok(s.some(m => m.name === 'process-env'), 'getAllMarshallers includes all static');
assert.ok(p.some(m => m.name === 'known-vulnerability'), 'getAllMarshallers includes all package');

console.log('  marshallers-index.test.js: all tests passed');
