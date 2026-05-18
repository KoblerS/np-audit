'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/obfuscatorIo');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.strictEqual(m.check('var _0xabc = 1;'), null, '1 match = null');
assert.ok(m.check('var _0xabc = _0xdef; var _0x123 = 1;'), '3 matches = finding');
const heavy = Array.from({length: 55}, (_, i) => `_0x${(i + 0xa0).toString(16)}`).join(' + ');
const r = m.check(heavy);
assert.ok(r && r.score >= 30, `55 matches scores >= 30 (got ${r && r.score})`);

console.log('    obfuscatorIo.test.js: passed');
