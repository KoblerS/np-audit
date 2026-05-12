'use strict';

const assert = require('assert');
const {
  walkRequires,
  extractRequires,
  resolveRelative,
  isInternalRequire,
  MAX_FILES_PER_PACKAGE,
  MAX_TOTAL_BYTES,
} = require('../../src/core/requireWalker');

// ─── extractRequires ─────────────────────────────────────────────────────────

{
  const { staticTargets, dynamicHints } = extractRequires(`
    const a = require('./a');
    const b = require('./b.js');
    const c = require('../shared/c');
    const lodash = require('lodash');
  `);
  assert.deepStrictEqual(
    staticTargets.sort(),
    ['../shared/c', './a', './b.js', 'lodash'],
    'extracts plain require literals'
  );
  assert.deepStrictEqual(dynamicHints, [], 'no dynamic hints for static requires');
}

{
  const { staticTargets } = extractRequires(`
    import a from './a';
    import { b } from './b.mjs';
    import './side-effects';
    const dyn = await import('./c');
  `);
  assert.deepStrictEqual(
    staticTargets.sort(),
    ['./a', './b.mjs', './c', './side-effects'],
    'extracts ESM import literals (static, named, side-effect, dynamic-literal)'
  );
}

{
  const { staticTargets, dynamicHints } = extractRequires(`
    const mod = 'child' + '_process';
    const cp = require(mod);
    const cp2 = require('child' + '_process');
    const cp3 = require(\`child_\${'process'}\`);
  `);
  assert.deepStrictEqual(staticTargets, [], 'no static targets for any dynamic forms');
  assert.strictEqual(dynamicHints.length, 3, 'three dynamic require hints recorded');
}

{
  const { dynamicHints } = extractRequires(`
    const mod = await import(someVariable);
  `);
  assert.strictEqual(dynamicHints.length, 1);
  assert.ok(dynamicHints[0].startsWith('import('), 'dynamic import is tagged as import(...)');
}

// ─── isInternalRequire ───────────────────────────────────────────────────────
assert.strictEqual(isInternalRequire('./a'),       true);
assert.strictEqual(isInternalRequire('../a'),      true);
assert.strictEqual(isInternalRequire('/abs/path'), true);
assert.strictEqual(isInternalRequire('lodash'),    false);
assert.strictEqual(isInternalRequire('@scope/p'),  false);

// ─── resolveRelative ─────────────────────────────────────────────────────────
{
  const files = new Map([
    ['package/index.js',        Buffer.from('')],
    ['package/lib/util.js',     Buffer.from('')],
    ['package/lib/dir/index.js', Buffer.from('')],
    ['package/cjs/m.cjs',       Buffer.from('')],
  ]);
  const readFile = (p) => files.get(p) || null;

  assert.strictEqual(
    resolveRelative('package/index.js', './lib/util', readFile),
    'package/lib/util.js',
    'resolves with implicit .js'
  );
  assert.strictEqual(
    resolveRelative('package/index.js', './lib/util.js', readFile),
    'package/lib/util.js',
    'resolves explicit .js'
  );
  assert.strictEqual(
    resolveRelative('package/index.js', './lib/dir', readFile),
    'package/lib/dir/index.js',
    'resolves directory to index.js'
  );
  assert.strictEqual(
    resolveRelative('package/index.js', './cjs/m', readFile),
    'package/cjs/m.cjs',
    'resolves implicit .cjs'
  );
  assert.strictEqual(
    resolveRelative('package/lib/util.js', '../index', readFile),
    'package/index.js',
    'resolves parent traversal'
  );
  assert.strictEqual(
    resolveRelative('package/index.js', './missing', readFile),
    null,
    'returns null for nonexistent target'
  );
}

// ─── walkRequires: simple chain ──────────────────────────────────────────────
{
  const files = new Map([
    ['package/install.js',  Buffer.from("require('./lib/helper');")],
    ['package/lib/helper.js', Buffer.from("require('./inner');")],
    ['package/lib/inner.js',  Buffer.from("const { exec } = require('child_process'); exec('id');")],
  ]);
  const readFile = (p) => files.get(p) || null;

  const result = walkRequires('package/install.js', readFile);
  assert.strictEqual(result.files.size, 3, 'all three files walked');
  assert.ok(result.files.has('package/lib/inner.js'), 'deepest file is reached');
  assert.deepStrictEqual(result.dynamicRequires, []);
  assert.deepStrictEqual(result.unresolved, []);
  assert.strictEqual(result.truncated, false);
}

// ─── walkRequires: cycle detection ───────────────────────────────────────────
{
  const files = new Map([
    ['p/a.js', Buffer.from("require('./b');")],
    ['p/b.js', Buffer.from("require('./a');")],
  ]);
  const result = walkRequires('p/a.js', (p) => files.get(p) || null);
  assert.strictEqual(result.files.size, 2, 'cycle does not loop');
  assert.strictEqual(result.truncated, false);
}

// ─── walkRequires: external packages ignored, dynamic requires recorded ──────
{
  const files = new Map([
    ['p/install.js', Buffer.from(`
      const fs = require('fs');
      const lodash = require('lodash');
      const helper = require('./helper');
      const dyn = require(someVar);
    `)],
    ['p/helper.js', Buffer.from('module.exports = {};')],
  ]);
  const result = walkRequires('p/install.js', (p) => files.get(p) || null);
  assert.strictEqual(result.files.size, 2, 'walks internal helper, ignores fs/lodash');
  assert.strictEqual(result.dynamicRequires.length, 1, 'dynamic require recorded');
  assert.strictEqual(result.dynamicRequires[0].file, 'p/install.js');
}

// ─── walkRequires: unresolved internal requires recorded ─────────────────────
{
  const files = new Map([
    ['p/install.js', Buffer.from("require('./missing');")],
  ]);
  const result = walkRequires('p/install.js', (p) => files.get(p) || null);
  assert.strictEqual(result.unresolved.length, 1);
  assert.strictEqual(result.unresolved[0].target, './missing');
}

// ─── walkRequires: file-count cap ────────────────────────────────────────────
{
  const files = new Map();
  // Build a chain of 100 files: a0 → a1 → a2 → ... → a99
  for (let i = 0; i < 100; i++) {
    const next = i < 99 ? `require('./a${i + 1}');` : '';
    files.set(`p/a${i}.js`, Buffer.from(next));
  }
  const result = walkRequires('p/a0.js', (p) => files.get(p) || null);
  assert.strictEqual(result.files.size, MAX_FILES_PER_PACKAGE, 'capped at MAX_FILES_PER_PACKAGE');
  assert.strictEqual(result.truncated, true, 'truncated flag set');
}

// ─── walkRequires: byte cap ──────────────────────────────────────────────────
{
  // One giant file just over the byte cap
  const big = Buffer.alloc(MAX_TOTAL_BYTES + 1000, 'x');
  const files = new Map([['p/install.js', big]]);
  const result = walkRequires('p/install.js', (p) => files.get(p) || null);
  // The file IS read (we add it before checking the cap), but the loop
  // terminates immediately afterwards.
  assert.ok(result.truncated, 'byte cap triggers truncated flag');
}

// ─── walkRequires: ESM dynamic import with literal arg follows ───────────────
{
  const files = new Map([
    ['p/index.mjs',  Buffer.from("await import('./lazy.mjs');")],
    ['p/lazy.mjs',   Buffer.from("export const x = 1;")],
  ]);
  const result = walkRequires('p/index.mjs', (p) => files.get(p) || null);
  assert.strictEqual(result.files.size, 2, 'dynamic import with literal arg is followed');
}

console.log('  requireWalker.test.js: all tests passed');
