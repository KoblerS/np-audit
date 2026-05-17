'use strict';

const assert = require('assert');
const { getStaticMarshallers } = require('../../src/marshallers');

const marshallers = getStaticMarshallers();

// ─── Test each marshaller with positive and negative cases ──────────────────

for (const m of marshallers) {
  // Every marshaller should return null for clean code
  const clean = m.check('const x = 1; function hello() { return "world"; }');
  assert.strictEqual(clean, null, `${m.name}: clean code returns null`);
}

// eval
{
  const m = marshallers.find(m => m.name === 'eval/dynamic-exec');
  assert.ok(m.check('eval("code")'), 'eval: detects eval()');
  assert.ok(m.check('new Function("return 1")'), 'eval: detects new Function');
  assert.ok(m.check('(0, eval)("code")'), 'eval: detects indirect eval');
  assert.ok(m.check('globalThis["eval"]("x")'), 'eval: detects bracket-access eval');
  assert.ok(m.check('({}).constructor.constructor("code")()'), 'eval: detects constructor chain');
  assert.ok(m.check("setTimeout('alert(1)', 100)"), 'eval: detects setTimeout with string');
  assert.ok(m.check("require('vm')"), 'eval: detects require vm');
  assert.strictEqual(m.check('setTimeout(fn, 100)'), null, 'eval: setTimeout with function ref is OK');
}

// obfuscator.io
{
  const m = marshallers.find(m => m.name === 'obfuscator.io');
  assert.strictEqual(m.check('var _0xabc = 1;'), null, 'obfuscator: 1 match = null');
  assert.ok(m.check('var _0xabc = _0xdef; var _0x123 = 1;'), 'obfuscator: 3 matches = finding');
  const heavy = Array.from({length: 55}, (_, i) => `_0x${(i + 0xa0).toString(16)}`).join(' + ');
  const r = m.check(heavy);
  assert.ok(r && r.score >= 30, `obfuscator: 55 matches scores >= 30 (got ${r && r.score})`);
}

// high-entropy
{
  const m = marshallers.find(m => m.name === 'high-entropy-string');
  assert.strictEqual(m.check('const s = "hello world";'), null, 'entropy: short string = null');
  const highEntropy = 'const s = "' + 'aB3$kLm9@pQr5vWx1Yz7#hJnFgTcEiDoUbA4sKlM8PqR6VwX2yZ0' + '";';
  assert.ok(m.check(highEntropy), 'entropy: high-entropy long string detected');
}

// hex escapes
{
  const m = marshallers.find(m => m.name === 'hex-escape-density');
  assert.strictEqual(m.check('var x = "\\x41";'), null, 'hex: 1 escape = null');
  const dense = 'var x = "' + Array.from({length: 15}, (_, i) => `\\x${(65+i).toString(16)}`).join('') + '";';
  assert.ok(m.check(dense), 'hex: 15 escapes = finding');
  const unicode = 'var x = "' + Array.from({length: 12}, () => '\\u0041').join('') + '";';
  assert.ok(m.check(unicode), 'hex: 12 unicode escapes = finding');
}

// fromCharCode
{
  const m = marshallers.find(m => m.name === 'fromCharCode');
  assert.strictEqual(m.check('String.fromCharCode(65, 66)'), null, 'fromCharCode: 2 args = null');
  assert.ok(m.check('String.fromCharCode(65, 66, 67, 68, 69)'), 'fromCharCode: 5 args = finding');
  const arr = 'var x = [' + Array.from({length: 20}, (_, i) => 65 + i).join(',') + '];';
  assert.ok(m.check(arr), 'fromCharCode: char-code array of 20 = finding');
}

// base64/hex decode
{
  const m = marshallers.find(m => m.name === 'encoded-decode');
  assert.strictEqual(m.check('console.log("hi")'), null, 'base64: clean = null');
  const r1 = m.check('atob("aGVsbG8=")');
  assert.ok(r1 && r1.score === 3, 'base64: decode without exec = score 3');
  const r2 = m.check('eval(atob("aGVsbG8="))');
  assert.ok(r2 && r2.score === 8, 'base64: decode + eval = score 8');
  const r3 = m.check('Buffer.from(x, "hex")');
  assert.ok(r3 && r3.score === 3, 'hex: Buffer.from hex = score 3');
}

// child-process
{
  const m = marshallers.find(m => m.name === 'child-process');
  assert.strictEqual(m.check('const fs = require("fs")'), null, 'child-process: fs = null');
  assert.ok(m.check('require("child_process")'), 'child-process: direct require');
  assert.ok(m.check('require("node:child_process")'), 'child-process: node: prefix');
  assert.ok(m.check('execSync("ls")'), 'child-process: execSync');
  assert.ok(m.check('new Worker("./w.js")'), 'child-process: new Worker');
}

// hex-array
{
  const m = marshallers.find(m => m.name === 'hex-array');
  assert.strictEqual(m.check('var x = 0xff;'), null, 'hex-array: 1 literal = null');
  const arr = Array.from({length: 25}, (_, i) => `0x${(i+10).toString(16)}`).join(', ');
  assert.ok(m.check(`var x = [${arr}];`), 'hex-array: 25 literals = finding');
}

// process-env
{
  const m = marshallers.find(m => m.name === 'process-env');
  assert.strictEqual(m.check('const x = 1;'), null, 'process-env: clean = null');
  assert.ok(m.check('const token = process.env.TOKEN;'), 'process-env: detects access');
}

// network-call
{
  const m = marshallers.find(m => m.name === 'network-call');
  assert.strictEqual(m.check('const fs = require("fs")'), null, 'network: fs = null');
  assert.ok(m.check('require("https")'), 'network: require https');
  assert.ok(m.check('fetch("http://example.com")'), 'network: fetch()');
  assert.ok(m.check('require("node:dns")'), 'network: node:dns');
}

// filesystem-manipulation
{
  const m = marshallers.find(m => m.name === 'filesystem-manipulation');
  assert.strictEqual(m.check('fs.readFileSync("x")'), null, 'fs: read = null');
  const r1 = m.check('fs.writeFileSync("x", "data")');
  assert.ok(r1 && r1.score === 3, 'fs: write = score 3');
  const r2 = m.check('fs.writeFileSync("x", "y"); fs.chmodSync("x", 0o755)');
  assert.ok(r2 && r2.score === 4, 'fs: write + chmod = score 4');
  assert.ok(m.check('fs.symlinkSync("a", "b")'), 'fs: symlink detected');
}

console.log('  marshallers.test.js: all tests passed');
