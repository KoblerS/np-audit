'use strict';

const assert = require('assert');
const {
  detectObfuscation,
  shannonEntropy,
  checkEval,
  checkObfuscatorIo,
  checkHighEntropy,
  checkHexEscapes,
  checkFromCharCode,
  checkBase64Exec,
  checkChildProcess,
  checkHexArray,
  checkProcessEnv,
  checkNetworkCalls,
} = require('../../src/detector');

const CONFIG = { blockScore: 7, warnScore: 4 };

// ─── shannonEntropy ───────────────────────────────────────────────────────────
assert.strictEqual(shannonEntropy(''), 0, 'empty string entropy');
assert.ok(shannonEntropy('aaaa') < 0.01, 'single char entropy near 0');
assert.ok(shannonEntropy('abcdefghij') > 3, 'varied string has entropy > 3');

// ─── checkEval ───────────────────────────────────────────────────────────────
assert.strictEqual(checkEval('const x = 1;'), null, 'no eval in clean code');
assert.ok(checkEval('eval("malicious")'), 'detects eval(');
assert.ok(checkEval('new Function("return 1")'), 'detects new Function(');
assert.ok(checkEval('vm.runInThisContext("x")'), 'detects vm.runInThisContext');
assert.strictEqual(checkEval('eval'), null, 'eval standalone not a call — should be null');

// ─── checkObfuscatorIo ───────────────────────────────────────────────────────
assert.strictEqual(checkObfuscatorIo('var x = 1;'), null, 'no _0x in clean code');
assert.strictEqual(checkObfuscatorIo('_0xabc'), null, 'only one _0x — not enough');
assert.ok(checkObfuscatorIo('var _0xabc = _0xdef(_0x123);'), 'detects >=3 _0x identifiers');
const obfResult = checkObfuscatorIo('_0x1 + _0x2 + _0x3 + _0x4');
assert.ok(obfResult && obfResult.score === 9, '_0x score is 9');

// ─── checkHighEntropy ────────────────────────────────────────────────────────
const lowEntropyCode = 'const greeting = "hello world this is a normal readable string okay";';
assert.strictEqual(checkHighEntropy(lowEntropyCode), null, 'normal string not flagged');
const highEntropyCode = 'const x = "xK9mP2qRvL8nJwT5yB3hC6aE1iF4uD7gH0sA+XjZbQ/NWo=YkVIlMzGentr";';
assert.ok(checkHighEntropy(highEntropyCode), 'high entropy string detected');

// ─── checkHexEscapes ─────────────────────────────────────────────────────────
assert.strictEqual(checkHexEscapes('normal code'), null, 'no hex escapes in normal code');
const heavyHex = '\\x68\\x65\\x6c\\x6c\\x6f\\x20\\x77\\x6f\\x72\\x6c\\x64\\x20\\x66\\x6f\\x6f';
assert.ok(checkHexEscapes(heavyHex), 'many hex escapes detected');

// ─── checkFromCharCode ────────────────────────────────────────────────────────
assert.strictEqual(checkFromCharCode('const x = 1;'), null, 'no fromCharCode');
assert.strictEqual(checkFromCharCode('String.fromCharCode(65, 66)'), null, 'only 2 args — not enough');
assert.ok(checkFromCharCode('String.fromCharCode(104, 101, 108, 108, 111)'), 'fromCharCode with 5 args');

// ─── checkBase64Exec ─────────────────────────────────────────────────────────
assert.strictEqual(checkBase64Exec('const x = 1;'), null, 'no base64');
const base64Only = "const data = Buffer.from('aGVsbG8=', 'base64');";
assert.ok(checkBase64Exec(base64Only), 'base64 decode alone gets score 3');
assert.strictEqual(checkBase64Exec(base64Only).score, 3);
const base64AndEval = "eval(Buffer.from('aGVsbG8=', 'base64').toString())";
assert.ok(checkBase64Exec(base64AndEval) && checkBase64Exec(base64AndEval).score === 8, 'base64+eval score 8');

// ─── checkChildProcess ───────────────────────────────────────────────────────
assert.strictEqual(checkChildProcess('const x = 1;'), null, 'no child_process');
assert.ok(checkChildProcess("const cp = require('child_process'); cp.exec('ls')"), 'detects child_process');

// ─── checkHexArray ───────────────────────────────────────────────────────────
assert.strictEqual(checkHexArray('const x = [1, 2, 3];'), null, 'small array');
const hexArr = '[' + Array.from({ length: 25 }, (_, i) => `0x${i.toString(16).padStart(2, '0')}`).join(', ') + ']';
assert.ok(checkHexArray(hexArr), 'detects large hex literal array');

// ─── checkProcessEnv ─────────────────────────────────────────────────────────
assert.strictEqual(checkProcessEnv('const x = 1;'), null, 'no process.env');
assert.ok(checkProcessEnv('const token = process.env.SECRET_TOKEN;'), 'detects process.env');

// ─── checkNetworkCalls ───────────────────────────────────────────────────────
assert.strictEqual(checkNetworkCalls('const x = 1;'), null, 'no network');
assert.ok(checkNetworkCalls("const https = require('https');"), 'detects https require');

// ─── detectObfuscation full ──────────────────────────────────────────────────
const cleanCode = `
  'use strict';
  const fs = require('fs');
  const data = fs.readFileSync('config.json');
  module.exports = JSON.parse(data);
`;
const cleanResult = detectObfuscation(cleanCode, CONFIG);
assert.strictEqual(cleanResult.verdict, 'OK', 'clean code is OK');

const obfuscatedCode = `
  var _0x1a2b = ['\\x65\\x76\\x61\\x6c', '\\x63\\x6f\\x64\\x65'];
  var _0x3c4d = function(_0x5e6f) { return _0x1a2b[_0x5e6f]; };
  eval(_0x3c4d(0));
`;
const obfResult2 = detectObfuscation(obfuscatedCode, CONFIG);
assert.strictEqual(obfResult2.verdict, 'BLOCK', 'obfuscated code is BLOCK');
assert.ok(obfResult2.score >= CONFIG.blockScore, 'obfuscated code score >= blockScore');

const warnCode = `
  const token = process.env.NPM_TOKEN;
  const https = require('https');
`;
const warnResult = detectObfuscation(warnCode, CONFIG);
assert.ok(warnResult.verdict === 'WARN' || warnResult.verdict === 'OK', 'warn code is not blocked');

// ─── Large file handling ─────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const largeFilePath = path.join(__dirname, '../fixtures/obfuscated-large.js');
if (fs.existsSync(largeFilePath)) {
  const largeCode = fs.readFileSync(largeFilePath, 'utf8');
  assert.ok(largeCode.length > 1000000, 'large file is >1MB');
  const start = Date.now();
  const largeResult = detectObfuscation(largeCode, { blockScore: 50, warnScore: 20 });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `large file processed in <5s (took ${elapsed}ms)`);
  assert.strictEqual(largeResult.verdict, 'BLOCK', 'large obfuscated file is BLOCK');
  assert.ok(largeResult.score >= 50, `large file score >= 50 (got ${largeResult.score})`);
  console.log(`  large file test: ${(largeCode.length / 1024 / 1024).toFixed(1)}MB processed in ${elapsed}ms, score=${largeResult.score}`);
}

console.log('  detector.test.js: all tests passed');
