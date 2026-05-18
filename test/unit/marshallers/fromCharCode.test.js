'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/fromCharCode');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.strictEqual(m.check('String.fromCharCode(65, 66)'), null, '2 args = null');
assert.ok(m.check('String.fromCharCode(65, 66, 67, 68, 69)'), '5 args = finding');
const arr = 'var x = [' + Array.from({length: 20}, (_, i) => 65 + i).join(',') + '];';
assert.ok(m.check(arr), 'char-code array of 20 = finding');

console.log('    fromCharCode.test.js: passed');
