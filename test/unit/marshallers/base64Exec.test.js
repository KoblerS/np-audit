'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/base64Exec');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.strictEqual(m.check('console.log("hi")'), null, 'clean = null');
const r1 = m.check('atob("aGVsbG8=")');
assert.ok(r1 && r1.score === 3, 'decode without exec = score 3');
const r2 = m.check('eval(atob("aGVsbG8="))');
assert.ok(r2 && r2.score === 8, 'decode + eval = score 8');
const r3 = m.check('Buffer.from(x, "hex")');
assert.ok(r3 && r3.score === 3, 'Buffer.from hex = score 3');

console.log('    base64Exec.test.js: passed');
