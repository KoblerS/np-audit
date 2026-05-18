'use strict';

const assert = require('assert');
const m = require('../../../src/marshallers/hexArray');

assert.strictEqual(m.check('const x = 1;'), null, 'clean code returns null');
assert.strictEqual(m.check('var x = 0xff;'), null, '1 literal = null');
const arr = Array.from({length: 25}, (_, i) => `0x${(i+10).toString(16)}`).join(', ');
assert.ok(m.check(`var x = [${arr}];`), '25 literals = finding');

console.log('    hexArray.test.js: passed');
